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
import { fetchGmailMessages } from "../adapters/gmailSource.js";
import {
  isProcessed,
  loadState,
  markProcessed,
  saveState,
  updateCursor,
  type PersistedState
} from "../adapters/fileStateStore.js";
import { ManualReviewToolExecutor } from "../adapters/manualReviewToolExecutor.js";
import {
  CHROMA_ENABLED,
  GMAIL_MAX_MESSAGES,
  MONGODB_URI,
  OPENAI_API_KEY,
  POLL_INTERVAL_SECONDS
} from "../config/env.js";
import { DefaultSuppressionEvaluator } from "../core/defaultSuppressionEvaluator.js";
import { OpenAIEmbeddingService, type EmbeddingProvider } from "../core/embeddingService.js";
import type { PipelineDependencies } from "../core/contracts.js";
import type { GmailMessage } from "../core/types.js";
import { runPipelineOnMessage } from "../core/pipeline.js";

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

type FetchGmailMessagesFn = typeof fetchGmailMessages;

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
  messages: GmailMessage[],
  dependencies: PipelineDependencies,
  targetStatePath: string
): Promise<PollStats> {
  let alreadyProcessed = 0;
  let processed = 0;
  let suppressed = 0;
  let skipped = 0;
  let failed = 0;

  for (const message of messages) {
    if (isProcessed(state, message.messageId)) {
      alreadyProcessed += 1;
      continue;
    }

    try {
      const result = await runPipelineOnMessage(message, dependencies);

      if (result.status === "skipped") {
        notifySkipped({ message, reason: result.gate.reason });
        markProcessed(state, message.messageId, { skipped: true, reason: result.gate.reason });
        updateCursor(state, message.internalDateMs);
        skipped += 1;
        await saveState(targetStatePath, state);
        continue;
      }

      if (result.status === "suppressed") {
        markProcessed(state, message.messageId, {
          skipped: true,
          reason: `suppressed:${result.ruleId}`
        });
        updateCursor(state, message.internalDateMs);
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

      markProcessed(state, message.messageId, { skipped: false });
      updateCursor(state, message.internalDateMs);
      processed += 1;
      await saveState(targetStatePath, state);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      failed += 1;
      console.error(`Message processing failed for ${message.messageId}: ${messageText}`);
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

export async function pollOnceWithSource(options?: {
  userId?: string;
  projectRoot?: string;
  statePath?: string;
  fetchMessages?: FetchGmailMessagesFn;
  dependencies?: PipelineDependencies;
}): Promise<PollStats> {
  const currentProjectRoot = options?.projectRoot ?? projectRoot;
  const currentStatePath = options?.statePath ?? statePath;
  const state = await loadState(currentStatePath);
  const lastInternalDateMs = state.sources["gmail:primary"].cursor.lastInternalDateMs || 0;
  const fetchMessages = options?.fetchMessages ?? fetchGmailMessages;
  const dependencies = options?.dependencies ?? buildPipelineDependencies(options?.userId);

  const messages = await fetchMessages({
    projectRoot: currentProjectRoot,
    maxMessages: GMAIL_MAX_MESSAGES,
    lastInternalDateMs
  });

  return processMessages(state, messages, dependencies, currentStatePath);
}

async function runForever(): Promise<void> {
  console.log("Starting Gmail local poller...");
  console.log(`Polling every ${POLL_INTERVAL_SECONDS} seconds`);
  console.log(`Chroma storage ${CHROMA_ENABLED ? "enabled" : "disabled"}`);
  console.log(`Suppression storage ${MONGODB_URI ? "mongo" : "file"}`);

  while (true) {
    try {
      const stats = await pollOnceWithSource();
      console.log(
        `Poll completed. fetched=${stats.fetched} processed=${stats.processed} suppressed=${stats.suppressed} skipped=${stats.skipped} failed=${stats.failed} alreadyProcessed=${stats.alreadyProcessed}`
      );
      console.log(`Waiting ${POLL_INTERVAL_SECONDS} seconds before next poll...`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Poll error:", message);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_SECONDS * 1000);
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void runForever();
}
