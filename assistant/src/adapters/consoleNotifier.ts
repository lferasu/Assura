import type { MessageAssessment, NormalizedMessage, PreparedAction, SuggestedAction } from "../core/types.js";

function clip(text: string, n = 200): string {
  if (!text) return "";
  return text.length <= n ? text : `${text.slice(0, n)}...`;
}

export function notifyProcessed({
  message,
  summary,
  extracted,
  actionItems,
  preparedActions
}: {
  message: NormalizedMessage;
  summary: string;
  extracted: MessageAssessment;
  actionItems: SuggestedAction[];
  preparedActions: PreparedAction[];
}): void {
  console.log("\n=== Message Assessment ===");
  console.log(`From: ${message.from}`);
  console.log(`Subject: ${message.subject}`);
  console.log(`Sent: ${message.sentAt}`);
  console.log(`Preview: ${clip(message.bodyText, 200)}`);
  console.log("\n1) Summary");
  console.log(summary);
  console.log("\n2) Extracted JSON");
  console.log(JSON.stringify(extracted, null, 2));
  console.log("\n3) Suggested Actions JSON");
  console.log(JSON.stringify(actionItems, null, 2));
  console.log("\n4) Prepared Execution Plan JSON");
  console.log(JSON.stringify(preparedActions, null, 2));
}

export function notifySkipped({ message, reason }: { message: NormalizedMessage; reason: string }): void {
  console.log("\n--- Skipped message ---");
  console.log(`From: ${message.from}`);
  console.log(`Subject: ${message.subject}`);
  console.log(`Sent: ${message.sentAt}`);
  console.log(`Reason: ${reason}`);
}
