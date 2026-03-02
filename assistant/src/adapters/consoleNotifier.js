function clip(text, n = 200) {
  if (!text) return "";
  return text.length <= n ? text : `${text.slice(0, n)}...`;
}

export function notifyProcessed({ message, summary, extracted, calendarProposals }) {
  console.log("\n=== Schedule Impact Detected ===");
  console.log(`From: ${message.from}`);
  console.log(`Subject: ${message.subject}`);
  console.log(`Sent: ${message.sentAt}`);
  console.log(`Preview: ${clip(message.bodyText, 200)}`);
  console.log("\n1) Summary");
  console.log(summary);
  console.log("\n2) Extracted JSON");
  console.log(JSON.stringify(extracted, null, 2));
  console.log("\n3) Calendar Proposals JSON");
  console.log(JSON.stringify(calendarProposals, null, 2));
}

export function notifySkipped({ message, reason }) {
  console.log("\n--- Skipped message ---");
  console.log(`From: ${message.from}`);
  console.log(`Subject: ${message.subject}`);
  console.log(`Sent: ${message.sentAt}`);
  console.log(`Reason: ${reason}`);
}
