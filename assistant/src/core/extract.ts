import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { OPENAI_API_KEY, OPENAI_MODEL } from "../config/env.js";
import { applyToolCallableSemantics } from "./actionSemantics.js";
import { formatMessageSender, type NormalizedMessage } from "./message.js";
import { getToolCallableActionKinds } from "../../../shared/toolRegistry.js";
import { EXTRACT_SCHEMA_VERSION, IMPORTANCE_LEVELS } from "./types.js";
import type { MessageAssessment } from "./types.js";

function buildModel(): ChatOpenAI {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for message extraction.");
  }

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

function clipForLog(value: string, maxLength = 500): string {
  if (!value) return "<empty>";
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function describeValidationFailure(error: unknown, payload: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `Message assessment validation failed: ${message}\nRaw model output (truncated): ${clipForLog(payload)}`
  );
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
  const allowedKinds = getToolCallableActionKinds().join(", ");
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
- needsAction should be true only when at least one action can be expressed as a concrete tool call.
- Allowed actionItems.kind values are: ${allowedKinds}.
- Do not emit vague actions like review, explore, track package, booking, browse, read, or unsubscribe.
- If the email is informational only, promotional, or does not map to one of the allowed action kinds, use needsAction=false and an empty actionItems array.
- Keep summaries concise and factual.

Email metadata:
subject: ${message.subject || ""}
from: ${formatMessageSender(message)}
receivedAt: ${message.receivedAt || ""}
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
    const parsed = JSON.parse(raw);
    return applyToolCallableSemantics(validateExtractionShape(parsed));
  } catch (error) {
    if (raw) {
      console.error(describeValidationFailure(error, raw).message);
    }

    const repairPrompt = `Repair this content into ONLY valid JSON matching the required schema. Return ONLY JSON. No markdown.\n\n${raw || String(error)}`;
    const repaired = await model.invoke([system, new HumanMessage(repairPrompt)]);
    const repairedRaw = getTextContent(repaired).trim();
    try {
      const repairedParsed = JSON.parse(repairedRaw);
      return applyToolCallableSemantics(validateExtractionShape(repairedParsed));
    } catch (repairError) {
      throw describeValidationFailure(repairError, repairedRaw);
    }
  }
}
