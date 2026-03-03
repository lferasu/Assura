export const EXTRACT_SCHEMA_VERSION = 1;

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
] as const;

export const DAYS = new Set<string>(DAY_NAMES);

export type DayName = (typeof DAY_NAMES)[number] | null;

export interface NormalizedMessage {
  source: "gmail";
  accountId: "primary";
  messageId: string;
  threadId: string | null;
  from: string;
  subject: string;
  sentAt: string;
  bodyText: string;
}

export interface GmailMessage extends NormalizedMessage {
  internalDateMs: number;
}

export interface GateResult {
  shouldProcess: boolean;
  reason: string;
}

export interface ExtractedChange {
  date: string;
  dayOfWeek: DayName;
  studentsAttend: boolean;
  staffWorkDay: boolean | null;
  notes: string | null;
}

export interface ImportantDate {
  label: string;
  date: string;
}

export interface CalendarProposal {
  action: "create_event";
  title: string;
  date: string;
  allDay: true;
  details: string | null;
}

export interface ExtractionEvidence {
  quote: string;
}

export interface ExtractedSchedule {
  schemaVersion: 1;
  type: "schedule_change" | "not_schedule_change";
  confidence: number;
  changes: ExtractedChange[];
  importantDates: ImportantDate[];
  calendarProposals: CalendarProposal[];
  evidence: ExtractionEvidence[];
}

export interface PipelineSkippedResult {
  status: "skipped";
  gate: GateResult;
}

export interface PipelineProcessedResult {
  status: "processed";
  gate: GateResult;
  extracted: ExtractedSchedule;
  summary: string;
  calendarProposals: CalendarProposal[];
}

export type PipelineResult = PipelineSkippedResult | PipelineProcessedResult;
