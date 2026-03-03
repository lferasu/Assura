import { extractMessageAssessment } from "./extract.js";
import { shouldProcessMessage } from "./gate.js";
import { summarizeExtraction } from "./summarize.js";
import type { PipelineDependencies } from "./contracts.js";
import type { NormalizedMessage, PipelineResult } from "./types.js";

export async function runPipelineOnMessage(
  message: NormalizedMessage,
  dependencies: PipelineDependencies
): Promise<PipelineResult> {
  const gate = shouldProcessMessage(message);
  if (!gate.shouldProcess) {
    return { status: "skipped", gate };
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
