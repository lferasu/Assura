import type { ExtractedChange, ExtractedSchedule } from "./types.js";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
] as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
] as const;

function computeDayOfWeek(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return WEEKDAYS[utc.getUTCDay()];
}

function formatLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

function describeChange(change: ExtractedChange): string {
  const day = change.dayOfWeek || computeDayOfWeek(change.date);
  const dateLabel = formatLongDate(change.date);

  const attendance = change.studentsAttend ? "School IS in session" : "NO school for students";

  const details: string[] = [];
  if (change.staffWorkDay === true) details.push("staff work day");
  if (change.staffWorkDay === false) details.push("staff not scheduled to work");
  if (change.notes) details.push(change.notes);

  const detailSuffix = details.length ? ` (${details.join("; ")}).` : ".";
  return `${day}, ${dateLabel}: ${attendance}${detailSuffix}`;
}

export function summarizeExtraction(extracted: ExtractedSchedule): string {
  if (extracted.type === "not_schedule_change" || extracted.changes.length === 0) {
    return "No schedule-impacting change detected.";
  }
  return extracted.changes.map(describeChange).join("\n");
}
