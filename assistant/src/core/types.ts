export const EXTRACT_SCHEMA_VERSION = 1;

export const IMPORTANCE_LEVELS = ["low", "medium", "high", "critical"] as const;

export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number];
export type MessageSource = "gmail";

export interface NormalizedMessage {
  source: MessageSource;
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

export interface KeyDate {
  label: string;
  date: string;
}

export interface SuggestedAction {
  kind: string;
  title: string;
  dueDate: string | null;
  details: string | null;
}

export interface PreparedAction extends SuggestedAction {
  executionMode: "manual_review" | "auto_execute";
  toolName: string | null;
  reason: string;
}

export interface ExtractedFact {
  label: string;
  value: string;
}

export interface ExtractionEvidence {
  quote: string;
}

export interface MessageAssessment {
  schemaVersion: 1;
  category: string;
  importance: ImportanceLevel;
  needsAction: boolean;
  summary: string;
  actionSummary: string | null;
  keyDates: KeyDate[];
  actionItems: SuggestedAction[];
  facts: ExtractedFact[];
  evidence: ExtractionEvidence[];
  confidence: number;
}

export interface PipelineSkippedResult {
  status: "skipped";
  gate: GateResult;
}

export interface PipelineProcessedResult {
  status: "processed";
  gate: GateResult;
  extracted: MessageAssessment;
  summary: string;
  actionItems: SuggestedAction[];
  preparedActions: PreparedAction[];
}

export interface PipelineSuppressedResult {
  status: "suppressed";
  gate: GateResult;
  reason: string;
  ruleId: string;
  similarity?: number;
}

export type PipelineResult =
  | PipelineSkippedResult
  | PipelineProcessedResult
  | PipelineSuppressedResult;
