export type ImportanceLevel = "low" | "medium" | "high" | "critical";

export interface SuggestedActionItem {
  id: string;
  kind: string;
  title: string;
  dueDate: string | null;
  details?: string | null;
}

export interface KeyDateItem {
  label: string;
  date: string;
}

export interface MobileAssessment {
  id: string;
  subject: string;
  from: string;
  category: string;
  importance: ImportanceLevel;
  needsAction: boolean;
  summary: string;
  actionSummary: string | null;
  keyDates: KeyDateItem[];
  suggestedActions: SuggestedActionItem[];
  storedAt: string;
  done: boolean;
  removed: boolean;
}

export interface MobileExpectation {
  id: string;
  query: string;
  createdAt: string;
  lastAcknowledgedMessageId: string | null;
  lastAcknowledgedAt: string | null;
}

export interface ExpectationAlert {
  id: string;
  expectationId: string;
  query: string;
  matchedMessageId: string;
  matchedAt: string;
  message: MobileAssessment;
}
