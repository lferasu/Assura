import fs from "node:fs/promises";
import path from "node:path";
import { formatMessageSender, type NormalizedMessage } from "../core/message.js";
import type { ImportanceLevel } from "../core/types.js";

export interface ProcessedMessageRecord {
  id: string;
  source: NormalizedMessage["source"];
  senderName?: string;
  senderId: string;
  senderDisplay: string;
  subject?: string;
  receivedAt: string;
  summary: string;
  importance: ImportanceLevel;
  importanceScore: number;
  category: string;
}

function clip(value: string, limit = 240): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 3)}...`;
}

function heuristicScore(message: NormalizedMessage): number {
  const fromText = formatMessageSender(message).toLowerCase();
  const subjectText = (message.subject || "").toLowerCase();
  let score = 0;

  if (/\b(boss|devops|build|incident)\b/.test(fromText)) {
    score += 3;
  }

  if (/\b(urgent|action required|failed|blocked)\b/.test(subjectText)) {
    score += 2;
  }

  const receivedMs = new Date(message.receivedAt).getTime();
  if (Number.isFinite(receivedMs) && Date.now() - receivedMs <= 24 * 60 * 60 * 1000) {
    score += 1;
  }

  return score;
}

export function getImportanceScore(
  message: NormalizedMessage,
  importance?: ImportanceLevel
): number {
  if (importance === "critical") return 4;
  if (importance === "high") return 3;
  if (importance === "medium") return 2;
  if (importance === "low") return 1;
  return heuristicScore(message);
}

function toRecord(input: {
  message: NormalizedMessage;
  summary: string;
  importance: ImportanceLevel;
  category: string;
}): ProcessedMessageRecord {
  return {
    id: input.message.id,
    source: input.message.source,
    senderName: input.message.senderName,
    senderId: input.message.senderId,
    senderDisplay: formatMessageSender(input.message),
    subject: input.message.subject,
    receivedAt: input.message.receivedAt,
    summary: clip(input.summary || input.message.bodyText || input.message.subject || ""),
    importance: input.importance,
    importanceScore: getImportanceScore(input.message, input.importance),
    category: input.category
  };
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }
}

export async function saveProcessedMessage(input: {
  filePath: string;
  message: NormalizedMessage;
  summary: string;
  importance: ImportanceLevel;
  category: string;
}): Promise<ProcessedMessageRecord> {
  const record = toRecord(input);
  await fs.mkdir(path.dirname(input.filePath), { recursive: true });
  await fs.appendFile(input.filePath, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function queryImportantEmailsSince(input: {
  filePath: string;
  sinceIsoTimestamp: string;
  limit: number;
}): Promise<ProcessedMessageRecord[]> {
  const sinceMs = new Date(input.sinceIsoTimestamp).getTime();
  const thresholdMs = Number.isFinite(sinceMs) ? sinceMs : Date.now() - 24 * 60 * 60 * 1000;
  const records = await readJsonLines<ProcessedMessageRecord>(input.filePath);

  return records
    .filter((record) => record.source === "gmail")
    .filter((record) => {
      const receivedMs = new Date(record.receivedAt).getTime();
      return Number.isFinite(receivedMs) && receivedMs > thresholdMs;
    })
    .filter((record) => record.importanceScore >= 3)
    .sort((left, right) => {
      const leftReceived = new Date(left.receivedAt).getTime();
      const rightReceived = new Date(right.receivedAt).getTime();
      if (rightReceived !== leftReceived) {
        return rightReceived - leftReceived;
      }

      return right.importanceScore - left.importanceScore;
    })
    .slice(0, Math.max(1, input.limit));
}

export async function queryLatestImportantEmails(input: {
  filePath: string;
  limit: number;
}): Promise<ProcessedMessageRecord[]> {
  const records = await readJsonLines<ProcessedMessageRecord>(input.filePath);

  return records
    .filter((record) => record.source === "gmail" && record.importanceScore >= 3)
    .sort((left, right) => {
      const leftReceived = new Date(left.receivedAt).getTime();
      const rightReceived = new Date(right.receivedAt).getTime();
      if (rightReceived !== leftReceived) {
        return rightReceived - leftReceived;
      }

      return right.importanceScore - left.importanceScore;
    })
    .slice(0, Math.max(1, input.limit));
}
