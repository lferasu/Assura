import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { ChromaInboxRepository, type InboxRecord } from "../adapters/chromaInboxRepository.js";
import {
  acknowledgeExpectation,
  createExpectation,
  deleteExpectation,
  listExpectations
} from "../adapters/expectationStore.js";
import { API_PORT, CHROMA_ENABLED } from "../config/env.js";
import type { StoredMessageAssessment } from "../core/contracts.js";
import type { ImportanceLevel, SuggestedAction } from "../core/types.js";

interface InboxMessageStatus {
  done?: boolean;
  removed?: boolean;
  updatedAt: string;
}

type InboxStatusMap = Record<string, InboxMessageStatus>;

interface ApiSuggestedAction extends SuggestedAction {
  id: string;
}

interface InboxApiItem {
  id: string;
  subject: string;
  from: string;
  category: string;
  importance: ImportanceLevel;
  needsAction: boolean;
  summary: string;
  actionSummary: string | null;
  keyDates: { label: string; date: string }[];
  suggestedActions: ApiSuggestedAction[];
  storedAt: string;
  done: boolean;
  removed: boolean;
}

interface ExpectationAlert {
  id: string;
  expectationId: string;
  query: string;
  matchedMessageId: string;
  matchedAt: string;
  message: InboxApiItem;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const assessmentsPath = path.join(projectRoot, "data/message-assessments.jsonl");
const inboxStatusPath = path.join(projectRoot, "data/mobile-status.json");
const expectationsPath = path.join(projectRoot, "data/expectations.json");
const chromaInboxRepository = CHROMA_ENABLED ? new ChromaInboxRepository() : null;

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }
}

async function readInboxStatusMap(): Promise<InboxStatusMap> {
  try {
    const raw = await fs.readFile(inboxStatusPath, "utf8");
    const parsed = JSON.parse(raw) as InboxStatusMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return {};
    }

    return {};
  }
}

async function writeInboxStatusMap(statusMap: InboxStatusMap): Promise<void> {
  await fs.mkdir(path.dirname(inboxStatusPath), { recursive: true });
  await fs.writeFile(inboxStatusPath, `${JSON.stringify(statusMap, null, 2)}\n`, "utf8");
}

function toInboxApiItem(
  record: StoredMessageAssessment,
  statusMap: InboxStatusMap
): InboxApiItem {
  const status = statusMap[record.message.messageId] || { done: false, removed: false };

  return {
    id: record.message.messageId,
    subject: record.message.subject,
    from: record.message.from,
    category: record.assessment.category,
    importance: record.assessment.importance,
    needsAction: record.assessment.needsAction,
    summary: record.summary,
    actionSummary: record.assessment.actionSummary,
    keyDates: record.assessment.keyDates,
    suggestedActions: record.assessment.actionItems.map((action, index) => ({
      id: `${record.message.messageId}:${index}`,
      ...action
    })),
    storedAt: record.storedAt,
    done: Boolean(status.done),
    removed: Boolean(status.removed)
  };
}

function applyStatus(item: InboxRecord, statusMap: InboxStatusMap): InboxApiItem {
  const status = statusMap[item.id] || { done: false, removed: false };

  return {
    ...item,
    done: Boolean(status.done),
    removed: Boolean(status.removed)
  };
}

async function getInboxItems(limit: number, includeRemoved: boolean): Promise<InboxApiItem[]> {
  const [records, statusMap] = await Promise.all([
    readJsonLines<StoredMessageAssessment>(assessmentsPath),
    readInboxStatusMap()
  ]);

  return records
    .map((record) => toInboxApiItem(record, statusMap))
    .filter((item) => includeRemoved || !item.removed)
    .sort((a, b) => new Date(b.storedAt).getTime() - new Date(a.storedAt).getTime())
    .slice(0, limit);
}

async function getInboxItemsFromChroma(limit: number, includeRemoved: boolean): Promise<InboxApiItem[]> {
  if (!chromaInboxRepository) {
    return getInboxItems(limit, includeRemoved);
  }

  const [records, statusMap] = await Promise.all([
    chromaInboxRepository.listLatest(limit * 4),
    readInboxStatusMap()
  ]);

  return records
    .map((record) => applyStatus(record, statusMap))
    .filter((item) => includeRemoved || !item.removed)
    .slice(0, limit);
}

async function searchInboxItems(query: string, limit: number, includeRemoved: boolean): Promise<InboxApiItem[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return getInboxItemsFromChroma(limit, includeRemoved);
  }

  if (!chromaInboxRepository) {
    const items = await getInboxItems(limit * 4, includeRemoved);
    const needle = trimmed.toLowerCase();
    return items
      .filter((item) => {
        const haystack = [
          item.subject,
          item.from,
          item.summary,
          item.actionSummary || "",
          item.category
        ]
          .join("\n")
          .toLowerCase();

        return haystack.includes(needle);
      })
      .slice(0, limit);
  }

  const [records, statusMap] = await Promise.all([
    chromaInboxRepository.searchRelevant(trimmed, limit * 2),
    readInboxStatusMap()
  ]);

  return records
    .map((record) => applyStatus(record, statusMap))
    .filter((item) => includeRemoved || !item.removed)
    .slice(0, limit);
}

async function buildExpectationAlerts(): Promise<ExpectationAlert[]> {
  const expectations = await listExpectations(expectationsPath);
  if (expectations.length === 0) return [];

  const alerts: ExpectationAlert[] = [];

  for (const expectation of expectations) {
    const matches = await searchInboxItems(expectation.query, 5, false);
    const candidate = matches.find((item) => {
      if (new Date(item.storedAt).getTime() < new Date(expectation.createdAt).getTime()) {
        return false;
      }

      if (item.id === expectation.lastAcknowledgedMessageId) {
        return false;
      }

      return true;
    });

    if (!candidate) continue;

    alerts.push({
      id: `${expectation.id}:${candidate.id}`,
      expectationId: expectation.id,
      query: expectation.query,
      matchedMessageId: candidate.id,
      matchedAt: candidate.storedAt,
      message: candidate
    });
  }

  return alerts;
}

async function upsertInboxStatus(
  messageId: string,
  updates: Partial<Pick<InboxMessageStatus, "done" | "removed">>
): Promise<void> {
  const statusMap = await readInboxStatusMap();
  const current = statusMap[messageId] || { done: false, removed: false, updatedAt: "" };

  statusMap[messageId] = {
    done: updates.done ?? current.done ?? false,
    removed: updates.removed ?? current.removed ?? false,
    updatedAt: new Date().toISOString()
  };

  await writeInboxStatusMap(statusMap);
}

function parseLimit(value: unknown, fallback = 50): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

function parseRouteId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

const app = express();

app.use(express.json());

app.use((request: Request, response: Response, next: NextFunction) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, PATCH, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  next();
});

app.get("/health", (_request: Request, response: Response) => {
  response.status(200).json({ ok: true });
});

app.get("/api/expectations", async (_request: Request, response: Response, next: NextFunction) => {
  try {
    const expectations = await listExpectations(expectationsPath);
    response.status(200).json({ items: expectations });
  } catch (error) {
    next(error);
  }
});

app.post("/api/expectations", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const body = (request.body || {}) as { query?: string };
    const item = await createExpectation(expectationsPath, body.query || "");
    response.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});

app.get("/api/expectations/alerts", async (_request: Request, response: Response, next: NextFunction) => {
  try {
    const items = await buildExpectationAlerts();
    response.status(200).json({ items });
  } catch (error) {
    next(error);
  }
});

app.patch(
  "/api/expectations/:id/acknowledge",
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const expectationId = parseRouteId(request.params.id);
      const body = (request.body || {}) as { messageId?: string; matchedAt?: string };

      if (!body.messageId || !body.matchedAt) {
        response.status(400).json({ error: "messageId and matchedAt are required." });
        return;
      }

      await acknowledgeExpectation(expectationsPath, expectationId, body.messageId, body.matchedAt);
      response.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

app.delete("/api/expectations/:id", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const expectationId = parseRouteId(request.params.id);
    await deleteExpectation(expectationsPath, expectationId);
    response.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/messages", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const limit = parseLimit(request.query.limit);
    const includeRemoved = request.query.includeRemoved === "true";
    const query = typeof request.query.q === "string" ? request.query.q : "";
    const items = query.trim()
      ? await searchInboxItems(query, limit, includeRemoved)
      : await getInboxItemsFromChroma(limit, includeRemoved);

    response.status(200).json({ items });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/messages/:id", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const parsed = (request.body || {}) as { done?: boolean; removed?: boolean };
    const messageId = parseRouteId(request.params.id);

    await upsertInboxStatus(messageId, {
      done: parsed.done,
      removed: parsed.removed
    });

    response.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/messages/:id", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const messageId = parseRouteId(request.params.id);
    await upsertInboxStatus(messageId, { removed: true });
    response.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((_request: Request, response: Response) => {
  response.status(404).json({ error: "Route not found." });
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  response.status(500).json({ error: message });
});

app.listen(API_PORT, () => {
  console.log(`Assura API listening on http://localhost:${API_PORT}`);
});
