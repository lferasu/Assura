import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChromaMessageStore } from "../adapters/chromaMessageStore.js";
import { CompositeMessageStore } from "../adapters/compositeMessageStore.js";
import { FileActionStore } from "../adapters/fileActionStore.js";
import { notifyProcessed, notifySkipped } from "../adapters/consoleNotifier.js";
import { FileMessageStore } from "../adapters/fileMessageStore.js";
import { fetchGmailMessages } from "../adapters/gmailSource.js";
import { isProcessed, loadState, markProcessed, saveState, updateCursor } from "../adapters/fileStateStore.js";
import { ManualReviewToolExecutor } from "../adapters/manualReviewToolExecutor.js";
import { CHROMA_ENABLED, GMAIL_MAX_MESSAGES, POLL_INTERVAL_SECONDS } from "../config/env.js";
import { runPipelineOnMessage } from "../core/pipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const statePath = path.join(projectRoot, "data/state.json");
const messageAssessmentsPath = path.join(projectRoot, "data/message-assessments.jsonl");
const actionItemsPath = path.join(projectRoot, "data/action-items.jsonl");
const messageStores = [
  new FileMessageStore(messageAssessmentsPath),
  ...(CHROMA_ENABLED ? [new ChromaMessageStore()] : [])
];
const pipelineDependencies = {
  messageStore: new CompositeMessageStore(messageStores),
  actionStore: new FileActionStore(actionItemsPath),
  toolExecutor: new ManualReviewToolExecutor()
};

async function pollOnce(): Promise<{
  fetched: number;
  alreadyProcessed: number;
  processed: number;
  skipped: number;
  failed: number;
}> {
  const state = await loadState(statePath);
  const lastInternalDateMs = state.sources["gmail:primary"].cursor.lastInternalDateMs || 0;

  const messages = await fetchGmailMessages({
    projectRoot,
    maxMessages: GMAIL_MAX_MESSAGES,
    lastInternalDateMs
  });

  let alreadyProcessed = 0;
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const message of messages) {
    if (isProcessed(state, message.messageId)) {
      alreadyProcessed += 1;
      continue;
    }

    try {
      const result = await runPipelineOnMessage(message, pipelineDependencies);

      if (result.status === "skipped") {
        notifySkipped({ message, reason: result.gate.reason });
        markProcessed(state, message.messageId, { skipped: true, reason: result.gate.reason });
        updateCursor(state, message.internalDateMs);
        skipped += 1;
        await saveState(statePath, state);
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
      await saveState(statePath, state);
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
    skipped,
    failed
  };
}

async function runForever(): Promise<void> {
  console.log("Starting Gmail local poller...");
  console.log(`Polling every ${POLL_INTERVAL_SECONDS} seconds`);
  console.log(`Chroma storage ${CHROMA_ENABLED ? "enabled" : "disabled"}`);

  // OAuth setup (one-time):
  // 1) In Google Cloud Console, enable Gmail API and create OAuth desktop credentials.
  // 2) Save credentials JSON to: assistant/credentials.json
  // 3) Run `npm run poll` once; if token.json is missing, an auth URL will be printed.
  // 4) Complete consent, capture auth code, exchange for token, and save token JSON to assistant/token.json.
  //    (Use Google OAuth playground or a short one-off script.)

  while (true) {
    try {
      const stats = await pollOnce();
      console.log(
        `Poll completed. fetched=${stats.fetched} processed=${stats.processed} skipped=${stats.skipped} failed=${stats.failed} alreadyProcessed=${stats.alreadyProcessed}`
      );
      console.log(`Waiting ${POLL_INTERVAL_SECONDS} seconds before next poll...`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Poll error:", message);
    }
    await new Promise((resolve)=>{setTimeout(resolve, POLL_INTERVAL_SECONDS * 1000)})
  }
}

void runForever();
