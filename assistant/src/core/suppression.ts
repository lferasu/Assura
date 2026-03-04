import type { NormalizedMessage } from "./types.js";

export type FeedbackAction = "NOT_INTERESTED";
export type FeedbackMode = "SENDER_ONLY" | "SENDER_AND_CONTEXT" | "THREAD";
export type SuppressionRuleType = "SENDER" | "SENDER_AND_CONTEXT" | "THREAD";

export interface FeedbackEvent {
  id: string;
  userId: string;
  messageId: string;
  action: FeedbackAction;
  mode: FeedbackMode;
  senderEmail: string;
  threadId?: string;
  subject: string;
  snippet: string;
  createdAt: string;
}

export interface SuppressionRuleContext {
  embedding?: number[];
  keywords?: string[];
  topic?: string;
}

export interface SuppressionRule {
  id: string;
  userId: string;
  type: SuppressionRuleType;
  senderEmail?: string;
  threadId?: string;
  context: SuppressionRuleContext;
  threshold?: number;
  isActive: boolean;
  createdAt: string;
}

export interface SuppressionEvaluation {
  suppressed: boolean;
  rule?: SuppressionRule;
  reason?: string;
  similarity?: number;
  keywords?: string[];
  topic?: string;
}

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "below",
  "could",
  "email",
  "from",
  "have",
  "here",
  "into",
  "just",
  "more",
  "only",
  "other",
  "should",
  "subject",
  "than",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "your"
]);

export function normalizeSenderEmail(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/<([^>]+)>/);
  if (match?.[1]) {
    return match[1].trim();
  }

  return trimmed.replace(/^"+|"+$/g, "");
}

export function buildContextText(input: {
  subject?: string;
  snippet?: string;
  bodyText?: string;
  maxBodyLength?: number;
}): string {
  const maxBodyLength = input.maxBodyLength ?? 1200;
  const body = (input.bodyText || "").slice(0, maxBodyLength);

  return [input.subject || "", input.snippet || "", body]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");
}

export function buildMessageContextText(message: NormalizedMessage): string {
  return buildContextText({
    subject: message.subject,
    snippet: message.bodyText.slice(0, 280),
    bodyText: message.bodyText,
    maxBodyLength: 1600
  });
}

export function extractKeywords(text: string, maxKeywords = 6): string[] {
  const counts = new Map<string, number>();

  for (const token of text.toLowerCase().match(/[a-z0-9]{4,}/g) || []) {
    if (STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, maxKeywords)
    .map(([token]) => token);
}

export function inferTopic(text: string, keywords: string[]): string | undefined {
  const headline = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (headline) {
    return headline.slice(0, 80);
  }

  if (keywords.length > 0) {
    return keywords.slice(0, 3).join(", ");
  }

  return undefined;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function getSuppressionThreshold(rule: SuppressionRule): number {
  return rule.threshold ?? 0.82;
}

export function buildRuleSearchText(rule: SuppressionRule): string {
  return [
    rule.type,
    rule.senderEmail || "",
    rule.threadId || "",
    rule.context.topic || "",
    ...(rule.context.keywords || [])
  ]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .join("\n");
}
