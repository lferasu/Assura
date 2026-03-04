import {
  getToolCallableActionToolName,
  inferToolCallableActionKind,
  type ToolCallableActionKind
} from "../../../shared/toolRegistry.js";
import type { MessageAssessment, SuggestedAction } from "./types.js";

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function inferKind(action: SuggestedAction): ToolCallableActionKind | null {
  return inferToolCallableActionKind(action);
}

export function normalizeSuggestedActions(actions: SuggestedAction[]): SuggestedAction[] {
  const seen = new Set<string>();
  const normalized: SuggestedAction[] = [];

  for (const action of actions) {
    const kind = inferKind(action);
    if (!kind) {
      continue;
    }

    const dedupeKey = `${kind}|${normalizeWhitespace(action.title)}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push({
      ...action,
      kind
    });
  }

  return normalized;
}

export function applyToolCallableSemantics(assessment: MessageAssessment): MessageAssessment {
  const actionItems = normalizeSuggestedActions(assessment.actionItems);
  const needsAction = actionItems.length > 0;

  return {
    ...assessment,
    needsAction,
    actionSummary: needsAction ? assessment.actionSummary : null,
    actionItems
  };
}

export function getSuggestedActionToolName(action: SuggestedAction): string | null {
  const kind = inferKind(action);
  return kind ? getToolCallableActionToolName(kind) : null;
}
