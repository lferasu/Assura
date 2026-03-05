import {
  queryImportantEmailsSince,
  queryLatestImportantEmail,
  type ProcessedMessageRecord
} from "../storage/messageStore.js";

function emojiForImportance(score: number): string {
  if (score >= 4) return "\u{1F534}";
  return "\u{1F7E1}";
}

function formatReceived(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

function clipSummary(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "No summary available.";
  return trimmed.length <= 240 ? trimmed : `${trimmed.slice(0, 237)}...`;
}

function formatItem(record: ProcessedMessageRecord, index: number): string {
  return [
    `${index + 1}) ${emojiForImportance(record.importanceScore)} ${record.senderDisplay}`,
    `Subject: ${record.subject || "(no subject)"}`,
    `Summary: ${clipSummary(record.summary)}`,
    `Received: ${formatReceived(record.receivedAt)}`
  ].join("\n");
}

function getDefaultSinceIso(now = new Date()): string {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
}

export interface EmailUpdateResult {
  text: string;
  newestReceivedAt: string;
  count: number;
}

export async function generateEmailUpdate(input: {
  filePath: string;
  lastEmailUpdateAt?: string | null;
  limit?: number;
  now?: Date;
}): Promise<EmailUpdateResult> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, input.limit ?? 10);
  const sinceIsoTimestamp = input.lastEmailUpdateAt || getDefaultSinceIso(now);
  const records = await queryImportantEmailsSince({
    filePath: input.filePath,
    sinceIsoTimestamp,
    limit
  });

  if (records.length === 0) {
    const lastViewed = await queryLatestImportantEmail({ filePath: input.filePath });
    if (lastViewed) {
      return {
        text: [
          "\u2705 Assura is up to date.",
          "",
          "Last important email (already viewed):",
          "",
          formatItem(lastViewed, 0),
          "",
          "Tip: Use /update anytime to see what matters."
        ].join("\n"),
        newestReceivedAt: now.toISOString(),
        count: 0
      };
    }

    return {
      text: "\u2705 Assura is up to date. No important emails have been reviewed yet.",
      newestReceivedAt: now.toISOString(),
      count: 0
    };
  }

  const newestReceivedAt = records
    .map((record) => new Date(record.receivedAt).getTime())
    .filter((value) => Number.isFinite(value))
    .reduce((current, next) => Math.max(current, next), new Date(sinceIsoTimestamp).getTime());

  return {
    text: [
      "\u{1F4EC} Assura Update (Email)",
      `Since last check: ${records.length} important emails`,
      "",
      ...records.map((record, index) => formatItem(record, index)),
      "",
      "Tip: Use /update anytime to see what matters."
    ].join("\n"),
    newestReceivedAt: new Date(newestReceivedAt).toISOString(),
    count: records.length
  };
}
