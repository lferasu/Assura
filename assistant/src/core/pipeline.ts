import { extractMessageAssessment } from "./extract.js";
import { shouldProcessMessage } from "./gate.js";
import { summarizeExtraction } from "./summarize.js";
import type { PipelineDependencies } from "./contracts.js";
import type { NormalizedMessage } from "./message.js";
import type { PipelineResult } from "./types.js";

export async function runPipelineOnMessage(
  message: NormalizedMessage,
  dependencies: PipelineDependencies
): Promise<PipelineResult> {
  const gate = shouldProcessMessage(message);
  if (!gate.shouldProcess) {
    return { status: "skipped", gate };
  }

  const suppression = await dependencies.suppressionEvaluator.evaluate({
    userId: dependencies.userId,
    message
  });
  if (suppression.suppressed && suppression.rule) {
    const storedAt = new Date().toISOString();

    await dependencies.suppressedMessageStore.saveSuppressed({
      userId: dependencies.userId,
      message,
      ruleId: suppression.rule.id,
      suppressionType: suppression.rule.type,
      reason: suppression.reason || "Matched suppression rule",
      similarity: suppression.similarity ?? null,
      keywords: suppression.keywords || suppression.rule.context.keywords || [],
      topic: suppression.topic || suppression.rule.context.topic || null,
      storedAt
    });

    return {
      status: "suppressed",
      gate,
      reason: suppression.reason || "Matched suppression rule",
      ruleId: suppression.rule.id,
      similarity: suppression.similarity
    };
  }

  const extracted = await extractMessageAssessment(message);
  const summary = summarizeExtraction(extracted);
  const preparedActions = await dependencies.toolExecutor.prepareActions({
    message,
    assessment: extracted,
    suggestedActions: extracted.actionItems
  });
  const storedAt = new Date().toISOString();

  await dependencies.messageStore.saveAssessment({
    message,
    assessment: extracted,
    summary,
    storedAt
  });

  await dependencies.actionStore.savePlannedActions({
    message,
    assessment: extracted,
    suggestedActions: extracted.actionItems,
    preparedActions,
    storedAt
  });

  return {
    status: "processed",
    gate,
    extracted,
    summary,
    actionItems: extracted.actionItems,
    preparedActions
  };
}
