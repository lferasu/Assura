import { getSuggestedActionToolName } from "../core/actionSemantics.js";
import {
  getToolCallableActionDefinition,
  normalizeToolCallableActionKind
} from "../../../shared/toolRegistry.js";
import type { ToolExecutor } from "../core/contracts.js";
import type { PreparedAction } from "../core/types.js";

export class ManualReviewToolExecutor implements ToolExecutor {
  async prepareActions({
    suggestedActions
  }: Parameters<ToolExecutor["prepareActions"]>[0]): Promise<PreparedAction[]> {
    return suggestedActions.map((action) => {
      const toolName = getSuggestedActionToolName(action);
      const kind = normalizeToolCallableActionKind(action.kind);
      const definition = kind ? getToolCallableActionDefinition(kind) : null;
      const parameterSummary = definition
        ? [
            `required: ${definition.parameterSchema.required.join(", ")}`,
            definition.parameterSchema.optional.length
              ? `optional: ${definition.parameterSchema.optional.join(", ")}`
              : null
          ]
            .filter(Boolean)
            .join(" | ")
        : null;

      return {
        ...action,
        executionMode: "manual_review",
        toolName,
        reason: toolName
          ? `Tool intent recognized, but no external executor is configured yet. ${parameterSummary || "Review before executing."}`
          : "No supported tool mapping is configured for this action."
      };
    });
  }
}
