import type { NormalizedMessage } from "../core/message.js";
import type { PipelineProcessedResult } from "../core/types.js";

export interface AssistantUiController {
  sendProcessedSummary(input: {
    message: NormalizedMessage;
    result: PipelineProcessedResult;
  }): Promise<void>;
}
