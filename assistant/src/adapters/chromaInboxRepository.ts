import { OpenAIEmbeddingFunction } from "@chroma-core/openai";
import { ChromaClient, type Collection } from "chromadb";
import {
  CHROMA_COLLECTION,
  CHROMA_EMBEDDING_MODEL,
  CHROMA_URL,
  OPENAI_API_KEY
} from "../config/env.js";
import type { ImportanceLevel, MessageSource, SuggestedAction } from "../core/types.js";

export interface InboxRecord {
  id: string;
  source: MessageSource;
  subject: string;
  from: string;
  category: string;
  importance: ImportanceLevel;
  needsAction: boolean;
  summary: string;
  actionSummary: string | null;
  keyDates: { label: string; date: string }[];
  suggestedActions: Array<SuggestedAction & { id: string }>;
  storedAt: string;
}

type ChromaMetadataValue = string | number | boolean | null;
type ChromaMetadata = Record<string, ChromaMetadataValue>;

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

function asString(value: ChromaMetadataValue, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: ChromaMetadataValue, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseJsonArray<T>(value: ChromaMetadataValue): T[] {
  if (typeof value !== "string" || value.trim() === "") return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function toInboxRecord(id: string, metadata: ChromaMetadata | null | undefined): InboxRecord | null {
  if (!metadata) return null;

  const keyDates = parseJsonArray<{ label: string; date: string }>(metadata.keyDatesJson ?? null);
  const actionItems = parseJsonArray<SuggestedAction>(metadata.actionItemsJson ?? null).map(
    (action, index) => ({
      ...action,
      id: `${id}:${index}`
    })
  );

  return {
    id,
    source: asString(metadata.source, "gmail") as MessageSource,
    subject: asString(metadata.subject),
    from: asString(metadata.from),
    category: asString(metadata.category, "other"),
    importance: asString(metadata.importance, "low") as ImportanceLevel,
    needsAction: asBoolean(metadata.needsAction),
    summary: asString(metadata.summary),
    actionSummary:
      metadata.actionSummary === null ? null : asString(metadata.actionSummary, null as never),
    keyDates,
    suggestedActions: actionItems,
    storedAt: asString(metadata.storedAt)
  };
}

export class ChromaInboxRepository {
  private readonly client = createChromaClient();
  private readonly embeddingFunction = new OpenAIEmbeddingFunction({
    apiKey: OPENAI_API_KEY,
    modelName: CHROMA_EMBEDDING_MODEL
  });
  private collectionPromise: Promise<Collection> | null = null;

  private async getCollection(): Promise<Collection> {
    if (!this.collectionPromise) {
      this.collectionPromise = this.client.getOrCreateCollection({
        name: CHROMA_COLLECTION,
        embeddingFunction: this.embeddingFunction
      });
    }

    return this.collectionPromise;
  }

  async listLatest(limit: number): Promise<InboxRecord[]> {
    const collection = await this.getCollection();
    const result = await collection.get({
      include: ["metadatas"]
    });

    const ids = Array.isArray(result.ids) ? result.ids : [];
    const metadatas = Array.isArray(result.metadatas) ? result.metadatas : [];

    return ids
      .map((id, index) => toInboxRecord(id, (metadatas[index] as ChromaMetadata | undefined) ?? null))
      .filter((item): item is InboxRecord => Boolean(item))
      .sort((a, b) => new Date(b.storedAt).getTime() - new Date(a.storedAt).getTime())
      .slice(0, limit);
  }

  async searchRelevant(query: string, limit: number): Promise<InboxRecord[]> {
    const collection = await this.getCollection();
    const result = await collection.query({
      queryTexts: [query],
      nResults: limit,
      include: ["metadatas"]
    });

    const ids = Array.isArray(result.ids?.[0]) ? result.ids[0] : [];
    const metadatas = Array.isArray(result.metadatas?.[0]) ? result.metadatas[0] : [];

    return ids
      .map((id, index) => toInboxRecord(id, (metadatas[index] as ChromaMetadata | undefined) ?? null))
      .filter((item): item is InboxRecord => Boolean(item));
  }
}
