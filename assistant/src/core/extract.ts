import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { DAYS, EXTRACT_SCHEMA_VERSION } from "./types.js";
import type { ExtractedSchedule, NormalizedMessage } from "./types.js";

function buildModel(): ChatOpenAI {
  return new ChatOpenAI({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
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

function validateExtractionShape(parsed: unknown): ExtractedSchedule {
  const obj = asRecord(parsed);

  if (obj.schemaVersion !== EXTRACT_SCHEMA_VERSION) throw new Error("schemaVersion must be 1");
  if (!["schedule_change", "not_schedule_change"].includes(String(obj.type))) throw new Error("invalid type");
  if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) throw new Error("invalid confidence");

  if (!Array.isArray(obj.changes)) throw new Error("changes must be array");
  for (const change of obj.changes) {
    const row = asRecord(change);
    if (!isIsoDate(row.date)) throw new Error("change.date must be YYYY-MM-DD");
    if (!(row.dayOfWeek === null || DAYS.has(String(row.dayOfWeek)))) throw new Error("invalid dayOfWeek");
    if (typeof row.studentsAttend !== "boolean") throw new Error("studentsAttend must be boolean");
    if (!(row.staffWorkDay === null || typeof row.staffWorkDay === "boolean")) throw new Error("staffWorkDay must be boolean|null");
    if (!(row.notes === null || typeof row.notes === "string")) throw new Error("notes must be string|null");
  }

  if (!Array.isArray(obj.importantDates)) throw new Error("importantDates must be array");
  for (const item of obj.importantDates) {
    const row = asRecord(item);
    if (typeof row.label !== "string") throw new Error("importantDates.label must be string");
    if (!isIsoDate(row.date)) throw new Error("importantDates.date must be YYYY-MM-DD");
  }

  if (!Array.isArray(obj.calendarProposals)) throw new Error("calendarProposals must be array");
  for (const item of obj.calendarProposals) {
    const row = asRecord(item);
    if (row.action !== "create_event") throw new Error("calendar action must be create_event");
    if (typeof row.title !== "string") throw new Error("calendar title must be string");
    if (!isIsoDate(row.date)) throw new Error("calendar date must be YYYY-MM-DD");
    if (row.allDay !== true) throw new Error("calendar allDay must be true");
    if (!(row.details === null || typeof row.details === "string")) throw new Error("calendar details must be string|null");
  }

  if (!Array.isArray(obj.evidence)) throw new Error("evidence must be array");
  for (const item of obj.evidence) {
    const row = asRecord(item);
    if (typeof row.quote !== "string") throw new Error("evidence.quote must be string");
  }

  return obj as unknown as ExtractedSchedule;
}

function buildExtractionPrompt(message: NormalizedMessage): string {
  const clippedBody = (message.bodyText || "").slice(0, 6000);
  return `Extract schedule impact details from this email into strict JSON.
Return ONLY valid JSON. No markdown.
The JSON must contain the exact keys and data types described below.
Use schemaVersion=1.
If this is not schedule impacting, type must be "not_schedule_change" and arrays may be empty.

Required JSON shape:
{
  "schemaVersion": 1,
  "type": "schedule_change" | "not_schedule_change",
  "confidence": number,
  "changes": [{"date":"YYYY-MM-DD","dayOfWeek":"Monday"|"Tuesday"|"Wednesday"|"Thursday"|"Friday"|"Saturday"|"Sunday"|null,"studentsAttend":boolean,"staffWorkDay":boolean|null,"notes":string|null}],
  "importantDates": [{"label":string,"date":"YYYY-MM-DD"}],
  "calendarProposals": [{"action":"create_event","title":string,"date":"YYYY-MM-DD","allDay":true,"details":string|null}],
  "evidence": [{"quote":string}]
}

Email metadata:
subject: ${message.subject || ""}
from: ${message.from || ""}
sentAt: ${message.sentAt || ""}
bodyText:\n${clippedBody}`;
}

export async function extractScheduleJson(message: NormalizedMessage): Promise<ExtractedSchedule> {
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
