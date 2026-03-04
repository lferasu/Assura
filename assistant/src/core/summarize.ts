import type { MessageAssessment } from "./types.js";

export function summarizeExtraction(extracted: MessageAssessment): string {
  return extracted.summary.trim();
}
