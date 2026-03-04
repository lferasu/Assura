import {
  getToolCallableActionDefinition,
  getToolCallableActionLabel,
  inferToolCallableActionKind,
  normalizeToolCallableActionKind
} from "../../shared/toolRegistry";
import type { MobileAssessment, SuggestedActionItem } from "./types";

function inferKind(action: SuggestedActionItem): string | null {
  return inferToolCallableActionKind(action);
}

export function countToolCallableActions(item: Pick<MobileAssessment, "suggestedActions">): number {
  return item.suggestedActions.filter((action) => Boolean(inferKind(action))).length;
}

export function hasToolCallableActions(item: Pick<MobileAssessment, "suggestedActions">): boolean {
  return countToolCallableActions(item) > 0;
}

export function getToolCallableActions(
  item: Pick<MobileAssessment, "suggestedActions">
): SuggestedActionItem[] {
  return item.suggestedActions
    .map((action) => {
      const kind = inferKind(action);
      return kind ? { ...action, kind } : null;
    })
    .filter((action): action is SuggestedActionItem => Boolean(action));
}

export function getToolCallableActionDisplayLabel(kind: string): string {
  const normalized = normalizeToolCallableActionKind(kind);
  return normalized ? getToolCallableActionLabel(normalized) : kind.replace(/_/g, " ");
}

export function getToolCallableActionDisplayMeta(kind: string): {
  label: string;
  icon: string | null;
  badgeColor: string;
  badgeTextColor: string;
  badgeBorderColor: string;
} {
  const normalized = normalizeToolCallableActionKind(kind);
  if (!normalized) {
    return {
      label: kind.replace(/_/g, " "),
      icon: null,
      badgeColor: "#FFFFFF",
      badgeTextColor: "#4F466B",
      badgeBorderColor: "#E7DCFF"
    };
  }

  const definition = getToolCallableActionDefinition(normalized);
  return {
    label: definition.label,
    icon: definition.icon,
    badgeColor: definition.badgeColor,
    badgeTextColor: definition.badgeTextColor,
    badgeBorderColor: definition.badgeBorderColor
  };
}
