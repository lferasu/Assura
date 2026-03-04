import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { ChromaInboxRepository, type InboxRecord } from "../adapters/chromaInboxRepository.js";
import { normalizeSuggestedActions } from "../core/actionSemantics.js";
import { shouldAllowInboxMessage } from "../../../shared/inboxPolicy.js";
import {
  acknowledgeExpectation,
  createExpectation,
  deleteExpectation,
  listExpectations
} from "../adapters/expectationStore.js";
import { API_PORT, CHROMA_ENABLED } from "../config/env.js";
import type { StoredMessageAssessment } from "../core/contracts.js";
import type { ImportanceLevel, MessageSource, SuggestedAction } from "../core/types.js";

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
  source: MessageSource;
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

interface MessageQueryOptions {
  hoursBack?: number;
  daysBack?: number;
  attentionOnly?: boolean;
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

function normalizeSummary(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed) return "";

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const summaryLine = lines.find((line) => line.toLowerCase().startsWith("summary:"));
  if (summaryLine) {
    return summaryLine.slice("summary:".length).trim();
  }

  const contentLine = lines.find((line) => {
    const lower = line.toLowerCase();
    return (
      !lower.startsWith("category:") &&
      !lower.startsWith("importance:") &&
      !lower.startsWith("needs action:") &&
      !lower.startsWith("suggested next step:") &&
      !lower.startsWith("key dates:") &&
      lower !== "action items:" &&
      !line.startsWith("- ")
    );
  });

  return contentLine || trimmed;
}

function toInboxApiItem(
  record: StoredMessageAssessment,
  statusMap: InboxStatusMap
): InboxApiItem {
  const status = statusMap[record.message.messageId] || { done: false, removed: false };

  return {
    id: record.message.messageId,
    source: record.message.source,
    subject: record.message.subject,
    from: record.message.from,
    category: record.assessment.category,
    importance: record.assessment.importance,
    needsAction: record.assessment.needsAction,
    summary: normalizeSummary(record.assessment.summary || record.summary),
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
    summary: normalizeSummary(item.summary),
    done: Boolean(status.done),
    removed: Boolean(status.removed)
  };
}

function isAttentionWorthy(item: InboxApiItem): boolean {
  return shouldAllowInboxMessage({
    category: item.category,
    subject: item.subject,
    from: item.from,
    summary: item.summary,
    actionSummary: item.actionSummary,
    hasToolCallableAction: normalizeSuggestedActions(item.suggestedActions).length > 0
  });
}

function filterByQueryOptions(items: InboxApiItem[], options: MessageQueryOptions): InboxApiItem[] {
  const now = Date.now();
  const hoursBackMs =
    typeof options.hoursBack === "number" && options.hoursBack > 0
      ? options.hoursBack * 60 * 60 * 1000
      : null;
  const daysBackMs =
    typeof options.daysBack === "number" && options.daysBack > 0
      ? options.daysBack * 24 * 60 * 60 * 1000
      : null;

  return items.filter((item) => {
    const storedAtMs = new Date(item.storedAt).getTime();
    if (!Number.isFinite(storedAtMs)) {
      return false;
    }

    if (hoursBackMs !== null && now - storedAtMs > hoursBackMs) {
      return false;
    }

    if (daysBackMs !== null && now - storedAtMs > daysBackMs) {
      return false;
    }

    if (options.attentionOnly && !isAttentionWorthy(item)) {
      return false;
    }

    return true;
  });
}

async function getInboxItems(
  limit: number,
  includeRemoved: boolean,
  options: MessageQueryOptions = {}
): Promise<InboxApiItem[]> {
  const [records, statusMap] = await Promise.all([
    readJsonLines<StoredMessageAssessment>(assessmentsPath),
    readInboxStatusMap()
  ]);

  return filterByQueryOptions(
    records
    .map((record) => toInboxApiItem(record, statusMap))
    .filter((item) => includeRemoved || !item.removed)
    .sort((a, b) => new Date(b.storedAt).getTime() - new Date(a.storedAt).getTime()),
    options
  ).slice(0, limit);
}

async function getInboxItemsFromChroma(
  limit: number,
  includeRemoved: boolean,
  options: MessageQueryOptions = {}
): Promise<InboxApiItem[]> {
  if (!chromaInboxRepository) {
    return getInboxItems(limit, includeRemoved, options);
  }

  const [records, statusMap] = await Promise.all([
    chromaInboxRepository.listLatest(limit * 8),
    readInboxStatusMap()
  ]);

  return filterByQueryOptions(
    records
    .map((record) => applyStatus(record, statusMap))
    .filter((item) => includeRemoved || !item.removed),
    options
  ).slice(0, limit);
}

async function searchInboxItems(
  query: string,
  limit: number,
  includeRemoved: boolean,
  options: MessageQueryOptions = {}
): Promise<InboxApiItem[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return getInboxItemsFromChroma(limit, includeRemoved, options);
  }

  if (!chromaInboxRepository) {
    const items = await getInboxItems(limit * 8, includeRemoved, options);
    const needle = trimmed.toLowerCase();
    return filterByQueryOptions(
      items
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
      }),
      options
    ).slice(0, limit);
  }

  const [records, statusMap] = await Promise.all([
    chromaInboxRepository.searchRelevant(trimmed, limit * 4),
    readInboxStatusMap()
  ]);

  return filterByQueryOptions(
    records
    .map((record) => applyStatus(record, statusMap))
    .filter((item) => includeRemoved || !item.removed),
    options
  ).slice(0, limit);
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

function parseOptionalPositiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
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
    const hoursBack = parseOptionalPositiveNumber(request.query.hoursBack);
    const daysBack = parseOptionalPositiveNumber(request.query.daysBack);
    const attentionOnly = request.query.attentionOnly === "true";
    const items = query.trim()
      ? await searchInboxItems(query, limit, includeRemoved, { hoursBack, daysBack, attentionOnly })
      : await getInboxItemsFromChroma(limit, includeRemoved, { hoursBack, daysBack, attentionOnly });

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
