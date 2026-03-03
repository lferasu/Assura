import type { GateResult, NormalizedMessage } from "./types.js";

const KEYWORDS = [
  "calendar update",
  "no school",
  "closed",
  "closure",
  "staff work day",
  "make-up day",
  "early dismissal",
  "delayed opening",
  "polling",
  "election",
  "schedule change"
];

const MONTH_PATTERN = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const NUMERIC_DATE_PATTERN = /\b(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})\b/;

export function shouldProcessMessage(message: NormalizedMessage): GateResult {
  const haystack = `${message.subject || ""}\n${message.bodyText || ""}`.toLowerCase();
  const matchedKeyword = KEYWORDS.find((keyword) => haystack.includes(keyword));
  const hasMonth = MONTH_PATTERN.test(haystack);
  const hasNumericDate = NUMERIC_DATE_PATTERN.test(haystack);

  if (matchedKeyword && (hasMonth || hasNumericDate)) {
    return {
      shouldProcess: true,
      reason: `matched keyword '${matchedKeyword}' and date pattern`
    };
  }

  if (matchedKeyword) {
    return { shouldProcess: true, reason: `matched keyword '${matchedKeyword}'` };
  }

  if (hasMonth || hasNumericDate) {
    return { shouldProcess: true, reason: "matched date pattern" };
  }

  return { shouldProcess: false, reason: "no schedule keyword or date pattern" };
}
