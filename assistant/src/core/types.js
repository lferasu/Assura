/**
 * Normalized message shape used by the core pipeline.
 *
 * {
 *   source: "gmail",
 *   accountId: "primary",
 *   messageId: string,
 *   threadId: string | null,
 *   from: string,
 *   subject: string,
 *   sentAt: string, // ISO-8601 timestamp
 *   bodyText: string
 * }
 */

/**
 * Strict extraction schema (schemaVersion=1):
 * {
 *   schemaVersion: 1,
 *   type: "schedule_change" | "not_schedule_change",
 *   confidence: number, // 0..1
 *   changes: Array<{
 *     date: "YYYY-MM-DD",
 *     dayOfWeek: "Monday"|"Tuesday"|"Wednesday"|"Thursday"|"Friday"|"Saturday"|"Sunday"|null,
 *     studentsAttend: boolean,
 *     staffWorkDay: boolean|null,
 *     notes: string|null
 *   }>,
 *   importantDates: Array<{ label: string, date: "YYYY-MM-DD" }>,
 *   calendarProposals: Array<{
 *     action: "create_event",
 *     title: string,
 *     date: "YYYY-MM-DD",
 *     allDay: true,
 *     details: string|null
 *   }>,
 *   evidence: Array<{ quote: string }>
 * }
 */

export const EXTRACT_SCHEMA_VERSION = 1;

export const DAYS = new Set([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
]);
