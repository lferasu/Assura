import { getImportanceScore } from "../storage/messageStore.js";
import { generateEmailUpdate } from "../briefing/generateEmailUpdate.js";
import { formatMessageSender, type NormalizedMessage } from "../core/message.js";
import type { MessageAssessment, PipelineProcessedResult } from "../core/types.js";
import {
  getLastEmailUpdateAt,
  getTelegramAdminChatId,
  saveState,
  setLastEmailUpdateAt,
  setTelegramAdminChatId,
  setTelegramUiCursor,
  type PersistedState
} from "../adapters/fileStateStore.js";
import { TelegramClient, type TelegramUpdate } from "./telegramClient.js";

function clip(value: string, limit = 280): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 3)}...`;
}

function buildPushedMessage(input: {
  message: NormalizedMessage;
  assessment: MessageAssessment;
  summary: string;
}): string {
  return [
    `📩 Important ${input.message.source.toUpperCase()} message`,
    `From: ${formatMessageSender(input.message)}`,
    `Subject: ${input.message.subject || "(no subject)"}`,
    `Priority: ${input.assessment.importance}`,
    `Summary: ${clip(input.summary, 240)}`
  ].join("\n");
}

function isImportant(input: { message: NormalizedMessage; assessment: MessageAssessment }): boolean {
  return getImportanceScore(input.message, input.assessment.importance) >= 3;
}

export class TelegramUiController {
  constructor(
    private readonly input: {
      client: TelegramClient;
      state: PersistedState;
      statePath: string;
      processedMessagesStorePath: string;
    }
  ) {}

  async sendProcessedSummary(input: {
    message: NormalizedMessage;
    result: PipelineProcessedResult;
  }): Promise<void> {
    const adminChatId = getTelegramAdminChatId(this.input.state);
    if (!adminChatId) {
      return;
    }

    if (!isImportant({ message: input.message, assessment: input.result.extracted })) {
      return;
    }

    await this.input.client.sendMessage(
      adminChatId,
      buildPushedMessage({
        message: input.message,
        assessment: input.result.extracted,
        summary: input.result.summary
      })
    );
  }

  async handleUpdates(updates: TelegramUpdate[]): Promise<void> {
    for (const update of updates) {
      await this.handleUpdate(update);
      if (typeof update.update_id === "number" && Number.isFinite(update.update_id)) {
        setTelegramUiCursor(this.input.state, update.update_id);
      }
      await saveState(this.input.statePath, this.input.state);
    }
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const text = update.message?.text?.trim();
    const chatId = update.message?.chat?.id;
    if (!text || !text.startsWith("/") || chatId === undefined || chatId === null) {
      return;
    }

    const chatIdText = String(chatId);
    const command = text.split(/\s+/)[0]?.toLowerCase() || "";
    const adminChatId = getTelegramAdminChatId(this.input.state);

    if (command === "/start" && !adminChatId) {
      setTelegramAdminChatId(this.input.state, chatIdText);
      await this.input.client.sendMessage(chatIdText, "✅ Assura connected. I will push important messages here.");
      return;
    }

    if (command === "/start") {
      await this.input.client.sendMessage(chatIdText, "✅ Assura is already connected to this chat.");
      return;
    }

    if (!adminChatId || adminChatId !== chatIdText) {
      await this.input.client.sendMessage(chatIdText, "Send /start first.");
      return;
    }

    if (command === "/help") {
      await this.input.client.sendMessage(
        chatIdText,
        ["Assura commands:", "/start", "/help", "/update", "/brief"].join("\n")
      );
      return;
    }

    if (command === "/update" || command === "/brief") {
      const updatePayload = await generateEmailUpdate({
        filePath: this.input.processedMessagesStorePath,
        lastEmailUpdateAt: getLastEmailUpdateAt(this.input.state),
        limit: 10
      });
      await this.input.client.sendMessage(chatIdText, updatePayload.text);
      setLastEmailUpdateAt(this.input.state, updatePayload.newestReceivedAt);
      return;
    }

    await this.input.client.sendMessage(chatIdText, "Unknown command. Send /help.");
  }
}
