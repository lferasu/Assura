import { TELEGRAM_BOT_TOKEN } from "../config/env.js";

export interface TelegramUser {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id?: number;
  type?: string;
  title?: string;
}

export interface TelegramMessage {
  message_id?: number;
  chat?: TelegramChat;
  from?: TelegramUser;
  date?: number;
  text?: string;
  caption?: string;
}

export interface TelegramCallbackQuery {
  id?: string;
  from?: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: Array<
    Array<{
      text: string;
      callback_data: string;
    }>
  >;
}

export class TelegramClient {
  constructor(
    private readonly input: {
      botToken?: string;
      fetchImpl?: typeof fetch;
    } = {}
  ) {}

  private get botToken(): string | null {
    return this.input.botToken ?? TELEGRAM_BOT_TOKEN ?? null;
  }

  private get fetchImpl(): typeof fetch {
    return this.input.fetchImpl ?? fetch;
  }

  async getUpdates(input: { offset?: number } = {}): Promise<TelegramUpdate[]> {
    const botToken = this.botToken;
    if (!botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN is required.");
    }

    const url = new URL(`https://api.telegram.org/bot${botToken}/getUpdates`);
    url.searchParams.set("timeout", "0");
    if (typeof input.offset === "number" && Number.isFinite(input.offset) && input.offset > 0) {
      url.searchParams.set("offset", String(input.offset));
    }

    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Telegram getUpdates failed with status ${response.status}`);
    }

    const payload = (await response.json()) as TelegramApiResponse<TelegramUpdate[]>;
    if (!payload.ok) {
      throw new Error(payload.description || "Telegram getUpdates returned ok=false");
    }

    return Array.isArray(payload.result) ? payload.result : [];
  }

  async sendMessage(
    chatId: string,
    text: string,
    replyMarkup?: TelegramInlineKeyboardMarkup
  ): Promise<void> {
    await this.callApi("sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: replyMarkup
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.callApi("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: text || undefined
    });
  }

  private async callApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const botToken = this.botToken;
    if (!botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN is required.");
    }

    const response = await this.fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Telegram ${method} failed with status ${response.status}`);
    }

    const payload = (await response.json()) as TelegramApiResponse<T>;
    if (!payload.ok) {
      throw new Error(payload.description || `Telegram ${method} returned ok=false`);
    }

    return payload.result as T;
  }
}

export function getLastTelegramUpdateId(
  updates: TelegramUpdate[],
  fallback = 0
): number {
  return updates.reduce((current, update) => {
    return typeof update.update_id === "number" && Number.isFinite(update.update_id)
      ? Math.max(current, update.update_id)
      : current;
  }, fallback);
}
