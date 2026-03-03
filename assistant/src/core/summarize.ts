import type { MessageAssessment, SuggestedAction } from "./types.js";

function formatActionItem(action: SuggestedAction): string {
  const due = action.dueDate ? ` (due ${action.dueDate})` : "";
  const details = action.details ? `: ${action.details}` : "";
  return `- ${action.kind}: ${action.title}${due}${details}`;
}

export function summarizeExtraction(extracted: MessageAssessment): string {
  const lines = [
    `Category: ${extracted.category}`,
    `Importance: ${extracted.importance}`,
    `Needs action: ${extracted.needsAction ? "yes" : "no"}`,
    `Summary: ${extracted.summary}`
  ];

  if (extracted.actionSummary) {
    lines.push(`Suggested next step: ${extracted.actionSummary}`);
  }

  if (extracted.keyDates.length > 0) {
    const keyDates = extracted.keyDates.map((item) => `${item.label} (${item.date})`).join(", ");
    lines.push(`Key dates: ${keyDates}`);
  }

  if (extracted.actionItems.length > 0) {
    lines.push("Action items:");
    lines.push(...extracted.actionItems.map(formatActionItem));
  }

  return lines.join("\n");
}
