import {
  createNormalizedMessage,
  type NormalizedMessage
} from "../core/message.js";
import { TELEGRAM_BOT_TOKEN } from "../config/env.js";
import type { FetchResult, MessageSourceAdapter, SourceCursor } from "./types.js";

interface TelegramUser {
  id?: number;
  first_name?: string;
  last_name?: string;
}

interface TelegramChat {
  id?: number;
}

interface TelegramMessagePayload {
  message_id?: number;
  chat?: TelegramChat;
  from?: TelegramUser;
  date?: number;
  text?: string;
  caption?: string;
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessagePayload;
}

interface TelegramGetUpdatesResponse {
  ok: boolean;
  result?: TelegramUpdate[];
}

function asLastUpdateId(cursor: SourceCursor): number {
  const raw = cursor.lastUpdateId;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function buildSenderName(user?: TelegramUser): string | undefined {
  const name = [user?.first_name || "", user?.last_name || ""].join(" ").trim();
  return name || undefined;
}

export function mapTelegramUpdateToNormalizedMessage(update: TelegramUpdate): NormalizedMessage | null {
  const message = update.message;
  if (!message?.message_id || !message.chat?.id || !message.date) {
    return null;
  }

  const bodyText = message.text ?? message.caption ?? "";
  if (!bodyText.trim()) {
    return null;
  }

  const senderId =
    message.from?.id !== undefined && message.from?.id !== null
      ? String(message.from.id)
      : String(message.chat.id);

  return createNormalizedMessage({
    source: "telegram",
    accountId: "telegram:bot",
    externalId: String(message.message_id),
    conversationId: String(message.chat.id),
    senderId,
    senderName: buildSenderName(message.from),
    subject: undefined,
    bodyText,
    receivedAt: new Date(message.date * 1000).toISOString(),
    raw: update
  });
}

export class TelegramSourceAdapter implements MessageSourceAdapter {
  constructor(
    private readonly input: {
      botToken?: string;
      fetchImpl?: typeof fetch;
    } = {}
  ) {}

  key(): string {
    return "telegram:bot";
  }

  async fetchNew(cursor: SourceCursor): Promise<FetchResult> {
    const botToken = this.input.botToken ?? TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return {
        messages: [],
        nextCursor: { lastUpdateId: asLastUpdateId(cursor) }
      };
    }

    const lastUpdateId = asLastUpdateId(cursor);
    const offset = lastUpdateId > 0 ? lastUpdateId + 1 : 0;
    const fetchImpl = this.input.fetchImpl ?? fetch;
    const url = new URL(`https://api.telegram.org/bot${botToken}/getUpdates`);
    url.searchParams.set("timeout", "0");
    if (offset > 0) {
      url.searchParams.set("offset", String(offset));
    }

    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Telegram getUpdates failed with status ${response.status}`);
    }

    const payload = (await response.json()) as TelegramGetUpdatesResponse;
    if (!payload.ok) {
      throw new Error("Telegram getUpdates returned ok=false");
    }

    const updates = Array.isArray(payload.result) ? payload.result : [];
    let nextLastUpdateId = lastUpdateId;
    const messages: NormalizedMessage[] = [];

    for (const update of updates) {
      if (typeof update.update_id !== "number") {
        continue;
      }

      nextLastUpdateId = Math.max(nextLastUpdateId, update.update_id);
      const normalized = mapTelegramUpdateToNormalizedMessage(update);
      if (normalized) {
        messages.push(normalized);
      }
    }

    return {
      messages,
      nextCursor: { lastUpdateId: nextLastUpdateId }
    };
  }
}
