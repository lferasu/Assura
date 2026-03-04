import { randomUUID } from "node:crypto";

export type MessageSource = "gmail" | "telegram";

export interface NormalizedMessage {
  id: string;
  source: MessageSource;
  accountId: string;
  externalId: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  subject?: string;
  bodyText: string;
  receivedAt: string;
  raw?: unknown;
}

export function createNormalizedMessage(
  input: Omit<NormalizedMessage, "id">
): NormalizedMessage {
  return {
    id: randomUUID(),
    ...input
  };
}

export function formatMessageSender(message: Pick<NormalizedMessage, "senderName" | "senderId">): string {
  const name = (message.senderName || "").trim();
  if (name) {
    return name;
  }

  return message.senderId;
}

export function getStableMessageKey(
  message: Pick<NormalizedMessage, "source" | "accountId" | "externalId">
): string {
  return `${message.source}:${message.accountId}:${message.externalId}`;
}
