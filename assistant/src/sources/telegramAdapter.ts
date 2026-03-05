import { createNormalizedMessage, type NormalizedMessage } from "../core/message.js";
import type { FetchResult, MessageSourceAdapter, SourceCursor } from "./types.js";
import {
  getLastTelegramUpdateId,
  TelegramClient,
  type TelegramMessage,
  type TelegramUpdate,
  type TelegramUser
} from "../telegram/telegramClient.js";

function asLastUpdateId(cursor: SourceCursor): number {
  const raw = cursor.lastUpdateId;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function buildSenderName(user?: TelegramUser): string | undefined {
  const name = [user?.first_name || "", user?.last_name || ""].join(" ").trim();
  return name || undefined;
}

export function isTelegramCommandMessage(message?: TelegramMessage): boolean {
  const text = message?.text?.trim();
  return Boolean(text && text.startsWith("/"));
}

export function mapTelegramUpdateToNormalizedMessage(update: TelegramUpdate): NormalizedMessage | null {
  const message = update.message;
  if (!message?.message_id || !message.chat?.id || !message.date) {
    return null;
  }

  if (isTelegramCommandMessage(message)) {
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
  private readonly client: TelegramClient;

  constructor(
    private readonly input: {
      botToken?: string;
      fetchImpl?: typeof fetch;
    } = {}
  ) {
    this.client = new TelegramClient(input);
  }

  key(): string {
    return "telegram:bot";
  }

  async fetchNew(cursor: SourceCursor): Promise<FetchResult> {
    const lastUpdateId = asLastUpdateId(cursor);
    let updates: TelegramUpdate[];

    try {
      updates = await this.client.getUpdates({
        offset: lastUpdateId > 0 ? lastUpdateId + 1 : undefined
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "TELEGRAM_BOT_TOKEN is required."
      ) {
        return {
          messages: [],
          nextCursor: { lastUpdateId }
        };
      }

      throw error;
    }

    const messages = updates
      .map((update) => mapTelegramUpdateToNormalizedMessage(update))
      .filter((message): message is NormalizedMessage => Boolean(message));

    return {
      messages,
      nextCursor: { lastUpdateId: getLastTelegramUpdateId(updates, lastUpdateId) }
    };
  }
}
