import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChromaMessageStore } from "../adapters/chromaMessageStore.js";
import { CompositeMessageStore } from "../adapters/compositeMessageStore.js";
import { FileActionStore } from "../adapters/fileActionStore.js";
import { FileFeedbackStore } from "../adapters/fileFeedbackStore.js";
import { FileMessageStore } from "../adapters/fileMessageStore.js";
import { FileSuppressedMessageStore } from "../adapters/fileSuppressedMessageStore.js";
import { FileSuppressionRuleStore } from "../adapters/fileSuppressionRuleStore.js";
import { MongoFeedbackStore } from "../adapters/mongoFeedbackStore.js";
import { MongoSuppressedMessageStore } from "../adapters/mongoSuppressedMessageStore.js";
import { MongoSuppressionRuleStore } from "../adapters/mongoSuppressionRuleStore.js";
import { notifyProcessed, notifySkipped } from "../adapters/consoleNotifier.js";
import { GmailSourceAdapter } from "../adapters/gmailSource.js";
import {
  getTelegramAdminChatId,
  getTelegramUiCursor,
  getSourceCursor,
  isProcessed,
  loadState,
  markProcessed,
  saveState,
  setTelegramUiCursor,
  setSourceCursor,
  type PersistedState
} from "../adapters/fileStateStore.js";
import { ManualReviewToolExecutor } from "../adapters/manualReviewToolExecutor.js";
import {
  CHROMA_ENABLED,
  GMAIL_MAX_MESSAGES,
  MONGODB_URI,
  OPENAI_API_KEY,
  POLL_INTERVAL_SECONDS,
  TELEGRAM_UI_POLL_INTERVAL_SECONDS,
  TELEGRAM_BOT_TOKEN
} from "../config/env.js";
import { getStableMessageKey, type NormalizedMessage } from "../core/message.js";
import { DefaultSuppressionEvaluator } from "../core/defaultSuppressionEvaluator.js";
import { OpenAIEmbeddingService, type EmbeddingProvider } from "../core/embeddingService.js";
import type { PipelineDependencies } from "../core/contracts.js";
import { runPipelineOnMessage } from "../core/pipeline.js";
import { saveProcessedMessage } from "../storage/messageStore.js";
import { logger } from "../observability/logger.js";
import {
  getLastTelegramUpdateId,
  TelegramClient,
  type TelegramUpdate
} from "../telegram/telegramClient.js";
import {
  TelegramUiController
} from "../telegram/telegramUi.js";
import type { AssistantUiController } from "../ui/contracts.js";
import {
  isTelegramCommandMessage,
  mapTelegramUpdateToNormalizedMessage
} from "../sources/telegramAdapter.js";
import type { MessageSourceAdapter } from "../sources/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const statePath = path.join(projectRoot, "data/state.json");
const messageAssessmentsPath = path.join(projectRoot, "data/message-assessments.jsonl");
const actionItemsPath = path.join(projectRoot, "data/action-items.jsonl");
const feedbackEventsPath = path.join(projectRoot, "data/feedback-events.jsonl");
const suppressionRulesPath = path.join(projectRoot, "data/suppression-rules.jsonl");
const suppressedMessagesPath = path.join(projectRoot, "data/suppressed-messages.jsonl");
const DEFAULT_USER_ID = "local-user";
const pollLogger = logger.child({ component: "poller" });

interface PollStats {
  fetched: number;
  alreadyProcessed: number;
  processed: number;
  suppressed: number;
  skipped: number;
  failed: number;
}

export function buildPipelineDependencies(userId = DEFAULT_USER_ID): PipelineDependencies {
  const messageStores = [
    new FileMessageStore(messageAssessmentsPath),
    ...(CHROMA_ENABLED ? [new ChromaMessageStore()] : [])
  ];
  const embeddingProvider: EmbeddingProvider | null = OPENAI_API_KEY ? new OpenAIEmbeddingService() : null;

  const suppressionRuleStore = MONGODB_URI
    ? new MongoSuppressionRuleStore()
    : new FileSuppressionRuleStore(suppressionRulesPath);

  const suppressedMessageStore = MONGODB_URI
    ? new MongoSuppressedMessageStore()
    : new FileSuppressedMessageStore(suppressedMessagesPath);

  return {
    userId,
    messageStore: new CompositeMessageStore(messageStores),
    actionStore: new FileActionStore(actionItemsPath),
    toolExecutor: new ManualReviewToolExecutor(),
    suppressionEvaluator: new DefaultSuppressionEvaluator(suppressionRuleStore, embeddingProvider),
    suppressedMessageStore
  };
}

export function buildFeedbackStores() {
  return {
    feedbackStore: MONGODB_URI ? new MongoFeedbackStore() : new FileFeedbackStore(feedbackEventsPath),
    suppressionRuleStore: MONGODB_URI
      ? new MongoSuppressionRuleStore()
      : new FileSuppressionRuleStore(suppressionRulesPath)
  };
}

async function processMessages(
  state: PersistedState,
  sourceKey: string,
  messages: NormalizedMessage[],
  dependencies: PipelineDependencies,
  targetStatePath: string,
  processedMessagesStorePath: string,
  uiController?: AssistantUiController
): Promise<PollStats> {
  let alreadyProcessed = 0;
  let processed = 0;
  let suppressed = 0;
  let skipped = 0;
  let failed = 0;

  for (const message of messages) {
    if (isProcessed(state, sourceKey, message.externalId)) {
      alreadyProcessed += 1;
      continue;
    }

    try {
      const result = await runPipelineOnMessage(message, dependencies);

      if (result.status === "skipped") {
        notifySkipped({ message, reason: result.gate.reason });
        markProcessed(state, sourceKey, message.externalId, {
          skipped: true,
          reason: result.gate.reason
        });
        skipped += 1;
        await saveState(targetStatePath, state);
        continue;
      }

      if (result.status === "suppressed") {
        markProcessed(state, sourceKey, message.externalId, {
          skipped: true,
          reason: `suppressed:${result.ruleId}`
        });
        suppressed += 1;
        await saveState(targetStatePath, state);
        continue;
      }

      notifyProcessed({
        message,
        summary: result.summary,
        extracted: result.extracted,
        actionItems: result.actionItems,
        preparedActions: result.preparedActions
      });
      await saveProcessedMessage({
        filePath: processedMessagesStorePath,
        message,
        summary: result.summary,
        importance: result.extracted.importance,
        category: result.extracted.category
      });
      if (uiController) {
        await uiController.sendProcessedSummary({ message, result });
      }

      markProcessed(state, sourceKey, message.externalId, { skipped: false });
      processed += 1;
      await saveState(targetStatePath, state);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      failed += 1;
      pollLogger.error("message.processing_failed", "Message processing failed", {
        sourceKey,
        stableMessageKey: getStableMessageKey(message),
        error: messageText
      });
    }
  }

  return {
    fetched: messages.length,
    alreadyProcessed,
    processed,
    suppressed,
    skipped,
    failed
  };
}

function asLastUpdateId(cursor: Record<string, unknown>): number {
  const raw = cursor.lastUpdateId;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function getSharedTelegramOffset(sourceLastUpdateId: number, uiLastUpdateId: number): number | undefined {
  const candidates = [sourceLastUpdateId, uiLastUpdateId]
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => value + 1);

  if (candidates.length === 0) {
    return undefined;
  }

  return Math.min(...candidates);
}

async function pollTelegramSourceAndUi(input: {
  state: PersistedState;
  statePath: string;
  dependencies: PipelineDependencies;
  projectRoot: string;
  telegramUi?: TelegramUiController;
}): Promise<PollStats> {
  if (!TELEGRAM_BOT_TOKEN) {
    return {
      fetched: 0,
      alreadyProcessed: 0,
      processed: 0,
      suppressed: 0,
      skipped: 0,
      failed: 0
    };
  }

  const sourceKey = "telegram:bot";
  const sourceLastUpdateId = asLastUpdateId(getSourceCursor(input.state, sourceKey));
  const uiLastUpdateId = getTelegramUiCursor(input.state);
  const client = new TelegramClient();
  const updates = await client.getUpdates({
    offset: getSharedTelegramOffset(sourceLastUpdateId, uiLastUpdateId)
  });

  const adminChatId = getTelegramAdminChatId(input.state);
  const sourceUpdates = updates.filter((update) => {
    if (typeof update.update_id !== "number" || update.update_id <= sourceLastUpdateId) {
      return false;
    }

    if (!update.message || isTelegramCommandMessage(update.message)) {
      return false;
    }

    if (adminChatId && String(update.message.chat?.id || "") === adminChatId) {
      return false;
    }

    return true;
  });

  const sourceMessages = sourceUpdates
    .map((update) => mapTelegramUpdateToNormalizedMessage(update))
    .filter((message): message is NormalizedMessage => Boolean(message));

  const telegramUi =
    input.telegramUi ??
    new TelegramUiController({
      client,
      state: input.state,
      statePath: input.statePath,
      processedMessagesStorePath: path.join(input.projectRoot, "data/processed-messages.jsonl")
    });

  const stats = await processMessages(
    input.state,
    sourceKey,
    sourceMessages,
    input.dependencies,
    input.statePath,
    path.join(input.projectRoot, "data/processed-messages.jsonl"),
    telegramUi
  );

  const uiUpdates = updates.filter(
    (update) => typeof update.update_id === "number" && update.update_id > uiLastUpdateId
  );
  await telegramUi.handleUpdates(uiUpdates);

  if (stats.failed === 0) {
    setSourceCursor(input.state, sourceKey, {
      lastUpdateId: getLastTelegramUpdateId(updates, sourceLastUpdateId)
    });
  }

  setTelegramUiCursor(input.state, getLastTelegramUpdateId(uiUpdates, uiLastUpdateId));
  await saveState(input.statePath, input.state);

  return stats;
}

export async function pollTelegramOnlyWithSource(options?: {
  userId?: string;
  projectRoot?: string;
  statePath?: string;
  dependencies?: PipelineDependencies;
}): Promise<PollStats> {
  if (!TELEGRAM_BOT_TOKEN) {
    return {
      fetched: 0,
      alreadyProcessed: 0,
      processed: 0,
      suppressed: 0,
      skipped: 0,
      failed: 0
    };
  }

  const currentProjectRoot = options?.projectRoot ?? projectRoot;
  const currentStatePath = options?.statePath ?? statePath;
  const state = await loadState(currentStatePath);
  const dependencies = options?.dependencies ?? buildPipelineDependencies(options?.userId);

  return pollTelegramSourceAndUi({
    state,
    statePath: currentStatePath,
    dependencies,
    projectRoot: currentProjectRoot
  });
}

export async function pollOnceWithSource(options?: {
  userId?: string;
  projectRoot?: string;
  statePath?: string;
  adapters?: MessageSourceAdapter[];
  dependencies?: PipelineDependencies;
}): Promise<PollStats> {
  const currentProjectRoot = options?.projectRoot ?? projectRoot;
  const currentStatePath = options?.statePath ?? statePath;
  const state = await loadState(currentStatePath);
  const dependencies = options?.dependencies ?? buildPipelineDependencies(options?.userId);
  const telegramUi =
    TELEGRAM_BOT_TOKEN && !options?.adapters
      ? new TelegramUiController({
          client: new TelegramClient(),
          state,
          statePath: currentStatePath,
          processedMessagesStorePath: path.join(currentProjectRoot, "data/processed-messages.jsonl")
        })
      : undefined;
  const adapters =
    options?.adapters ??
    [
      new GmailSourceAdapter({
        projectRoot: currentProjectRoot,
        maxMessages: GMAIL_MAX_MESSAGES
      })
    ];

  const totals: PollStats = {
    fetched: 0,
    alreadyProcessed: 0,
    processed: 0,
    suppressed: 0,
    skipped: 0,
    failed: 0
  };

  for (const adapter of adapters) {
    const sourceKey = adapter.key();
    const currentCursor = getSourceCursor(state, sourceKey);
    const result = await adapter.fetchNew(currentCursor);

    const stats = await processMessages(
      state,
      sourceKey,
      result.messages,
      dependencies,
      currentStatePath,
      path.join(currentProjectRoot, "data/processed-messages.jsonl"),
      telegramUi
    );

    if (stats.failed === 0) {
      setSourceCursor(state, sourceKey, result.nextCursor);
      await saveState(currentStatePath, state);
    }

    totals.fetched += stats.fetched;
    totals.alreadyProcessed += stats.alreadyProcessed;
    totals.processed += stats.processed;
    totals.suppressed += stats.suppressed;
    totals.skipped += stats.skipped;
    totals.failed += stats.failed;
  }

  if (TELEGRAM_BOT_TOKEN && !options?.adapters) {
    const telegramStats = await pollTelegramSourceAndUi({
      state,
      statePath: currentStatePath,
      dependencies,
      projectRoot: currentProjectRoot,
      telegramUi
    });

    totals.fetched += telegramStats.fetched;
    totals.alreadyProcessed += telegramStats.alreadyProcessed;
    totals.processed += telegramStats.processed;
    totals.suppressed += telegramStats.suppressed;
    totals.skipped += telegramStats.skipped;
    totals.failed += telegramStats.failed;
  }

  await saveState(currentStatePath, state);

  return totals;
}

async function runForever(): Promise<void> {
  pollLogger.info("poller.starting", "Starting source-agnostic local poller", {
    pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    telegramUiPollIntervalSeconds: TELEGRAM_UI_POLL_INTERVAL_SECONDS,
    chromaEnabled: CHROMA_ENABLED,
    suppressionStorage: MONGODB_URI ? "mongo" : "file"
  });
  if (!TELEGRAM_BOT_TOKEN) {
    pollLogger.warn("poller.telegram_disabled", "Telegram disabled because TELEGRAM_BOT_TOKEN is missing");
  }
  const fastPollDependencies = TELEGRAM_BOT_TOKEN ? buildPipelineDependencies() : undefined;

  while (true) {
    const cycleStartedAt = Date.now();

    try {
      const stats = await pollOnceWithSource();
      pollLogger.info("poller.cycle_completed", "Poll cycle completed", { ...stats });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pollLogger.error("poller.cycle_failed", "Poll cycle failed", { error: message });
    }

    const cycleEndsAt = cycleStartedAt + POLL_INTERVAL_SECONDS * 1000;
    const telegramTickMs = Math.max(1, TELEGRAM_UI_POLL_INTERVAL_SECONDS) * 1000;

    if (!TELEGRAM_BOT_TOKEN) {
      const sleepMs = Math.max(0, cycleEndsAt - Date.now());
      pollLogger.debug("poller.sleep", "Waiting before next poll cycle", {
        sleepSeconds: Math.ceil(sleepMs / 1000)
      });
      await new Promise((resolve) => {
        setTimeout(resolve, sleepMs);
      });
      continue;
    }

    pollLogger.debug("poller.waiting_with_fast_telegram", "Waiting before next full poll", {
      secondsToNextFullPoll: Math.ceil(Math.max(0, cycleEndsAt - Date.now()) / 1000),
      telegramUiPollEverySeconds: Math.max(1, TELEGRAM_UI_POLL_INTERVAL_SECONDS)
    });

    while (Date.now() < cycleEndsAt) {
      const remainingMs = cycleEndsAt - Date.now();
      const sleepMs = Math.min(telegramTickMs, remainingMs);
      await new Promise((resolve) => {
        setTimeout(resolve, Math.max(0, sleepMs));
      });

      if (Date.now() >= cycleEndsAt) {
        break;
      }

      try {
        await pollTelegramOnlyWithSource({ dependencies: fastPollDependencies });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pollLogger.error("poller.telegram_fast_poll_failed", "Telegram fast poll failed", {
          error: message
        });
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void runForever();
}
