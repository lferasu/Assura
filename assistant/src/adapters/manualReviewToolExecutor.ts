import type { ToolExecutor } from "../core/contracts.js";
import type { PreparedAction } from "../core/types.js";

export class ManualReviewToolExecutor implements ToolExecutor {
  async prepareActions({
    suggestedActions
  }: Parameters<ToolExecutor["prepareActions"]>[0]): Promise<PreparedAction[]> {
    return suggestedActions.map((action) => ({
      ...action,
      executionMode: "manual_review",
      toolName: null,
      reason: "No external tool is configured yet. Review before executing."
    }));
  }
}
