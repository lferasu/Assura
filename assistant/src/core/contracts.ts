import type { MessageAssessment, NormalizedMessage, PreparedAction, SuggestedAction } from "./types.js";

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

export interface PipelineDependencies {
  messageStore: MessageStore;
  actionStore: ActionStore;
  toolExecutor: ToolExecutor;
}
