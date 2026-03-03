import { shouldProcessMessage } from "./gate.js";
import { extractScheduleJson } from "./extract.js";
import { summarizeExtraction } from "./summarize.js";
import type { NormalizedMessage, PipelineResult } from "./types.js";

export async function runPipelineOnMessage(message: NormalizedMessage): Promise<PipelineResult> {
  const gate = shouldProcessMessage(message);
  if (!gate.shouldProcess) {
    return { status: "skipped", gate };
  }

  const extracted = await extractScheduleJson(message);
  const summary = summarizeExtraction(extracted);

  return {
    status: "processed",
    gate,
    extracted,
    summary,
    calendarProposals: extracted.calendarProposals
  };
}
