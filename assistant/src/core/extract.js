import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { DAYS, EXTRACT_SCHEMA_VERSION } from "./types.js";

function buildModel() {
  return new ChatOpenAI({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    temperature: 0
  });
}

function getTextContent(response) {
  if (typeof response.content === "string") return response.content;
  if (Array.isArray(response.content)) {
    return response.content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("\n");
  }
  return String(response.content || "");
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validateExtractionShape(parsed) {
  if (!parsed || typeof parsed !== "object") throw new Error("root must be object");
  if (parsed.schemaVersion !== EXTRACT_SCHEMA_VERSION) throw new Error("schemaVersion must be 1");
  if (!["schedule_change", "not_schedule_change"].includes(parsed.type)) throw new Error("invalid type");
  if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) throw new Error("invalid confidence");

  if (!Array.isArray(parsed.changes)) throw new Error("changes must be array");
  for (const change of parsed.changes) {
    if (!isIsoDate(change.date)) throw new Error("change.date must be YYYY-MM-DD");
    if (!(change.dayOfWeek === null || DAYS.has(change.dayOfWeek))) throw new Error("invalid dayOfWeek");
    if (typeof change.studentsAttend !== "boolean") throw new Error("studentsAttend must be boolean");
    if (!(change.staffWorkDay === null || typeof change.staffWorkDay === "boolean")) throw new Error("staffWorkDay must be boolean|null");
    if (!(change.notes === null || typeof change.notes === "string")) throw new Error("notes must be string|null");
  }

  if (!Array.isArray(parsed.importantDates)) throw new Error("importantDates must be array");
  for (const item of parsed.importantDates) {
    if (typeof item.label !== "string") throw new Error("importantDates.label must be string");
    if (!isIsoDate(item.date)) throw new Error("importantDates.date must be YYYY-MM-DD");
  }

  if (!Array.isArray(parsed.calendarProposals)) throw new Error("calendarProposals must be array");
  for (const item of parsed.calendarProposals) {
    if (item.action !== "create_event") throw new Error("calendar action must be create_event");
    if (typeof item.title !== "string") throw new Error("calendar title must be string");
    if (!isIsoDate(item.date)) throw new Error("calendar date must be YYYY-MM-DD");
    if (item.allDay !== true) throw new Error("calendar allDay must be true");
    if (!(item.details === null || typeof item.details === "string")) throw new Error("calendar details must be string|null");
  }

  if (!Array.isArray(parsed.evidence)) throw new Error("evidence must be array");
  for (const item of parsed.evidence) {
    if (typeof item.quote !== "string") throw new Error("evidence.quote must be string");
  }

  return parsed;
}

function buildExtractionPrompt(message) {
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

export async function extractScheduleJson(message) {
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
