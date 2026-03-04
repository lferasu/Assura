import type { NormalizedMessage } from "./message.js";
import type { GateResult } from "./types.js";

export function shouldProcessMessage(message: NormalizedMessage): GateResult {
  const subject = (message.subject || "").trim();
  const bodyText = (message.bodyText || "").trim();

  if (!subject && !bodyText) {
    return { shouldProcess: false, reason: "empty message content" };
  }

  return {
    shouldProcess: true,
    reason: "message contains content for classification"
  };
}
