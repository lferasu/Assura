import { formatMessageSender, type NormalizedMessage } from "../core/message.js";
import type { MessageAssessment, PreparedAction, SuggestedAction } from "../core/types.js";
import { logger } from "../observability/logger.js";

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
  logger.info("message.processed", "Processed message", {
    source: message.source,
    externalId: message.externalId,
    conversationId: message.conversationId,
    from: formatMessageSender(message),
    subject: message.subject || "(none)",
    receivedAt: message.receivedAt,
    preview: clip(message.bodyText, 200),
    summary,
    extracted,
    actionItems,
    preparedActions
  });
}

export function notifySkipped({ message, reason }: { message: NormalizedMessage; reason: string }): void {
  logger.info("message.skipped", "Skipped message", {
    source: message.source,
    externalId: message.externalId,
    conversationId: message.conversationId,
    from: formatMessageSender(message),
    subject: message.subject || "(none)",
    receivedAt: message.receivedAt,
    reason
  });
}
