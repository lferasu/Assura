import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { OPENAI_API_KEY, OPENAI_MODEL } from "../config/env.js";
import { EXTRACT_SCHEMA_VERSION, IMPORTANCE_LEVELS } from "./types.js";
import type { MessageAssessment, NormalizedMessage } from "./types.js";

function buildModel(): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: OPENAI_API_KEY,
    model: OPENAI_MODEL,
    temperature: 0
  });
}

function getTextContent(response: { content: unknown }): string {
  if (typeof response.content === "string") return response.content;
  if (Array.isArray(response.content)) {
    return response.content
      .map((part) => (typeof part === "string" ? part : (part as { text?: string })?.text || ""))
      .join("\n");
  }
  return String(response.content || "");
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("root must be object");
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown, fieldName: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${fieldName} must be string|null`);
  return value;
}

function asNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function validateExtractionShape(parsed: unknown): MessageAssessment {
  const obj = asRecord(parsed);

  if (obj.schemaVersion !== EXTRACT_SCHEMA_VERSION) throw new Error("schemaVersion must be 1");
  asNonEmptyString(obj.category, "category");
  if (!IMPORTANCE_LEVELS.includes(String(obj.importance) as (typeof IMPORTANCE_LEVELS)[number])) {
    throw new Error("invalid importance");
  }
  if (typeof obj.needsAction !== "boolean") throw new Error("needsAction must be boolean");
  asNonEmptyString(obj.summary, "summary");
  asOptionalString(obj.actionSummary, "actionSummary");
  if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) {
    throw new Error("invalid confidence");
  }

  if (!Array.isArray(obj.keyDates)) throw new Error("keyDates must be array");
  for (const item of obj.keyDates) {
    const row = asRecord(item);
    asNonEmptyString(row.label, "keyDates.label");
    if (!isIsoDate(row.date)) throw new Error("keyDates.date must be YYYY-MM-DD");
  }

  if (!Array.isArray(obj.actionItems)) throw new Error("actionItems must be array");
  for (const item of obj.actionItems) {
    const row = asRecord(item);
    asNonEmptyString(row.kind, "actionItems.kind");
    asNonEmptyString(row.title, "actionItems.title");
    if (!(row.dueDate === null || isIsoDate(row.dueDate))) {
      throw new Error("actionItems.dueDate must be YYYY-MM-DD|null");
    }
    asOptionalString(row.details, "actionItems.details");
  }

  if (!Array.isArray(obj.facts)) throw new Error("facts must be array");
  for (const item of obj.facts) {
    const row = asRecord(item);
    asNonEmptyString(row.label, "facts.label");
    asNonEmptyString(row.value, "facts.value");
  }

  if (!Array.isArray(obj.evidence)) throw new Error("evidence must be array");
  for (const item of obj.evidence) {
    const row = asRecord(item);
    asNonEmptyString(row.quote, "evidence.quote");
  }

  return obj as unknown as MessageAssessment;
}

function buildExtractionPrompt(message: NormalizedMessage): string {
  const clippedBody = (message.bodyText || "").slice(0, 6000);
  return `Analyze this email for a personal Gmail assistant and return ONLY valid JSON.
No markdown. No explanation outside JSON.

Goal:
- classify the message broadly
- estimate importance
- identify whether follow-up is needed
- suggest possible actions without assuming only calendar workflows

Use schemaVersion=1.

Required JSON shape:
{
  "schemaVersion": 1,
  "category": string,
  "importance": "low" | "medium" | "high" | "critical",
  "needsAction": boolean,
  "summary": string,
  "actionSummary": string | null,
  "keyDates": [{"label": string, "date": "YYYY-MM-DD"}],
  "actionItems": [{"kind": string, "title": string, "dueDate": "YYYY-MM-DD" | null, "details": string | null}],
  "facts": [{"label": string, "value": string}],
  "evidence": [{"quote": string}],
  "confidence": number
}

Guidance:
- category should be broad and useful, such as education, work, family, billing, travel, appointment, task, reminder, promotion, or other.
- needsAction should be true only when the user likely needs to do something.
- actionItems may include calendar updates, to-do items, replies, document review, or any other useful next step.
- If the email is informational only, use needsAction=false and an empty actionItems array.
- Keep summaries concise and factual.

Email metadata:
subject: ${message.subject || ""}
from: ${message.from || ""}
sentAt: ${message.sentAt || ""}
bodyText:\n${clippedBody}`;
}

export async function extractMessageAssessment(message: NormalizedMessage): Promise<MessageAssessment> {
  const model = buildModel();
  const system = new SystemMessage("You are an information extraction engine that outputs strict JSON.");
  const prompt = buildExtractionPrompt(message);

  let raw = "";
  try {
    const response = await model.invoke([system, new HumanMessage(prompt)]);
    raw = getTextContent(response).trim();
    return validateExtractionShape(JSON.parse(raw));
  } catch (error) {
    const repairPrompt = `Repair this content into ONLY valid JSON matching the required schema. Return ONLY JSON. No markdown.\n\n${raw || String(error)}`;
    const repaired = await model.invoke([system, new HumanMessage(repairPrompt)]);
    const repairedRaw = getTextContent(repaired).trim();
    return validateExtractionShape(JSON.parse(repairedRaw));
  }
}
