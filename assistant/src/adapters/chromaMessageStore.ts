import { OpenAIEmbeddingFunction } from "@chroma-core/openai";
import { ChromaClient, type Collection } from "chromadb";
import {
  CHROMA_COLLECTION,
  CHROMA_EMBEDDING_MODEL,
  CHROMA_URL,
  OPENAI_API_KEY
} from "../config/env.js";
import { formatMessageSender, getStableMessageKey } from "../core/message.js";
import type { MessageStore, StoredMessageAssessment } from "../core/contracts.js";

type ChromaMetadata = Record<string, string | number | boolean | null>;

function buildDocument(record: StoredMessageAssessment): string {
  const keyDates =
    record.assessment.keyDates.length > 0
      ? `Key dates: ${record.assessment.keyDates.map((item) => `${item.label} (${item.date})`).join(", ")}`
      : "Key dates: none";

  const actions =
    record.assessment.actionItems.length > 0
      ? `Suggested actions: ${record.assessment.actionItems
          .map((item) => `${item.kind}: ${item.title}${item.dueDate ? ` [due ${item.dueDate}]` : ""}`)
          .join(" | ")}`
      : "Suggested actions: none";

  const facts =
    record.assessment.facts.length > 0
      ? `Facts: ${record.assessment.facts.map((item) => `${item.label}: ${item.value}`).join(" | ")}`
      : "Facts: none";

  return [
    `Source: ${record.message.source}`,
    `Subject: ${record.message.subject || ""}`,
    `From: ${formatMessageSender(record.message)}`,
    `Received: ${record.message.receivedAt}`,
    `Category: ${record.assessment.category}`,
    `Importance: ${record.assessment.importance}`,
    `Needs action: ${record.assessment.needsAction ? "yes" : "no"}`,
    `Summary: ${record.summary}`,
    record.assessment.actionSummary ? `Action summary: ${record.assessment.actionSummary}` : null,
    keyDates,
    actions,
    facts,
    `Body: ${record.message.bodyText}`
  ]
    .filter(Boolean)
    .join("\n");
}

function buildMetadata(record: StoredMessageAssessment): ChromaMetadata {
  return {
    source: record.message.source,
    accountId: record.message.accountId,
    externalId: record.message.externalId,
    conversationId: record.message.conversationId,
    senderId: record.message.senderId,
    senderName: record.message.senderName || null,
    from: formatMessageSender(record.message),
    subject: record.message.subject || null,
    receivedAt: record.message.receivedAt,
    storedAt: record.storedAt,
    category: record.assessment.category,
    importance: record.assessment.importance,
    needsAction: record.assessment.needsAction,
    confidence: record.assessment.confidence,
    summary: record.summary,
    actionSummary: record.assessment.actionSummary,
    keyDatesJson: JSON.stringify(record.assessment.keyDates),
    actionItemsJson: JSON.stringify(record.assessment.actionItems)
  };
}

function createChromaClient(): ChromaClient {
  const url = new URL(CHROMA_URL);
  const isHttps = url.protocol === "https:";
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80;

  return new ChromaClient({
    host: url.hostname,
    port,
    ssl: isHttps
  });
}

export class ChromaMessageStore implements MessageStore {
  private readonly client = createChromaClient();
  private readonly embeddingFunction = (() => {
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required when CHROMA_ENABLED is true.");
    }

    return new OpenAIEmbeddingFunction({
      apiKey: OPENAI_API_KEY,
      modelName: CHROMA_EMBEDDING_MODEL
    });
  })();
  private collectionPromise: Promise<Collection> | null = null;

  private async getCollection(): Promise<Collection> {
    if (!this.collectionPromise) {
      this.collectionPromise = this.client.getOrCreateCollection({
        name: CHROMA_COLLECTION,
        embeddingFunction: this.embeddingFunction,
        metadata: {
          app: "assura",
          purpose: "gmail_message_assessments"
        }
      });
    }

    return this.collectionPromise;
  }

  async saveAssessment(record: StoredMessageAssessment): Promise<void> {
    const collection = await this.getCollection();

    await collection.upsert({
      ids: [getStableMessageKey(record.message)],
      documents: [buildDocument(record)],
      metadatas: [buildMetadata(record)]
    });
  }
}
