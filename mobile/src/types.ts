export type ImportanceLevel = "low" | "medium" | "high" | "critical";
export type MobileMessageSource = "gmail";

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
  source: MobileMessageSource;
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

export type MobileSuppressionRuleType = "SENDER" | "SENDER_AND_CONTEXT" | "THREAD";

export interface MobileSuppressionRule {
  id: string;
  userId: string;
  type: MobileSuppressionRuleType;
  senderEmail?: string;
  threadId?: string;
  context: {
    keywords?: string[];
    topic?: string;
  };
  threshold?: number;
  isActive: boolean;
  createdAt: string;
  searchScore?: number;
}
