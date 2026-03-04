import type { NormalizedMessage } from "./message.js";
import type { MessageAssessment, PreparedAction, SuggestedAction } from "./types.js";
import type {
  FeedbackEvent,
  SuppressionEvaluation,
  SuppressionRule
} from "./suppression.js";

export interface StoredMessageAssessment {
  message: NormalizedMessage;
  assessment: MessageAssessment;
  summary: string;
  storedAt: string;
}

export interface StoredActionBatch {
  message: NormalizedMessage;
  assessment: MessageAssessment;
  suggestedActions: SuggestedAction[];
  preparedActions: PreparedAction[];
  storedAt: string;
}

export interface StoredSuppressedMessage {
  userId: string;
  message: NormalizedMessage;
  ruleId: string;
  suppressionType: SuppressionRule["type"];
  reason: string;
  similarity: number | null;
  keywords: string[];
  topic: string | null;
  storedAt: string;
}

export interface MessageStore {
  saveAssessment(record: StoredMessageAssessment): Promise<void>;
}

export interface ActionStore {
  savePlannedActions(record: StoredActionBatch): Promise<void>;
}

export interface ToolExecutor {
  prepareActions(input: {
    message: NormalizedMessage;
    assessment: MessageAssessment;
    suggestedActions: SuggestedAction[];
  }): Promise<PreparedAction[]>;
}

export interface FeedbackStore {
  appendEvent(event: FeedbackEvent): Promise<void>;
}

export interface SuppressionRuleStore {
  createRule(rule: SuppressionRule): Promise<SuppressionRule>;
  listRules(userId: string): Promise<SuppressionRule[]>;
  getRuleById(userId: string, ruleId: string): Promise<SuppressionRule | null>;
  updateRule(
    userId: string,
    ruleId: string,
    updates: Partial<Pick<SuppressionRule, "threshold" | "isActive" | "context">>
  ): Promise<SuppressionRule | null>;
  deleteRule(userId: string, ruleId: string): Promise<void>;
}

export interface SuppressionEvaluator {
  evaluate(input: {
    userId: string;
    message: NormalizedMessage;
  }): Promise<SuppressionEvaluation>;
}

export interface SuppressedMessageStore {
  saveSuppressed(record: StoredSuppressedMessage): Promise<void>;
}

export interface PipelineDependencies {
  userId: string;
  messageStore: MessageStore;
  actionStore: ActionStore;
  toolExecutor: ToolExecutor;
  suppressionEvaluator: SuppressionEvaluator;
  suppressedMessageStore: SuppressedMessageStore;
}
