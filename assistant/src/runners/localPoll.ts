import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileActionStore } from "../adapters/fileActionStore.js";
import { notifyProcessed, notifySkipped } from "../adapters/consoleNotifier.js";
import { FileMessageStore } from "../adapters/fileMessageStore.js";
import { fetchGmailMessages } from "../adapters/gmailSource.js";
import { isProcessed, loadState, markProcessed, saveState, updateCursor } from "../adapters/fileStateStore.js";
import { ManualReviewToolExecutor } from "../adapters/manualReviewToolExecutor.js";
import { GMAIL_MAX_MESSAGES, POLL_INTERVAL_SECONDS } from "../config/env.js";
import { runPipelineOnMessage } from "../core/pipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const statePath = path.join(projectRoot, "data/state.json");
const messageAssessmentsPath = path.join(projectRoot, "data/message-assessments.jsonl");
const actionItemsPath = path.join(projectRoot, "data/action-items.jsonl");
const pipelineDependencies = {
  messageStore: new FileMessageStore(messageAssessmentsPath),
  actionStore: new FileActionStore(actionItemsPath),
  toolExecutor: new ManualReviewToolExecutor()
};

async function pollOnce(): Promise<void> {
  const state = await loadState(statePath);
  const lastInternalDateMs = state.sources["gmail:primary"].cursor.lastInternalDateMs || 0;

  const messages = await fetchGmailMessages({
    projectRoot,
    maxMessages: GMAIL_MAX_MESSAGES,
    lastInternalDateMs
  });

  for (const message of messages) {
    if (isProcessed(state, message.messageId)) continue;

    const result = await runPipelineOnMessage(message, pipelineDependencies);

    if (result.status === "skipped") {
      notifySkipped({ message, reason: result.gate.reason });
      markProcessed(state, message.messageId, { skipped: true, reason: result.gate.reason });
      updateCursor(state, message.internalDateMs);
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
  }

  await saveState(statePath, state);
}

async function runForever(): Promise<void> {
  console.log("Starting Gmail local poller...");
  console.log(`Polling every ${POLL_INTERVAL_SECONDS} seconds`);

  // OAuth setup (one-time):
  // 1) In Google Cloud Console, enable Gmail API and create OAuth desktop credentials.
  // 2) Save credentials JSON to: assistant/credentials.json
  // 3) Run `npm run poll` once; if token.json is missing, an auth URL will be printed.
  // 4) Complete consent, capture auth code, exchange for token, and save token JSON to assistant/token.json.
  //    (Use Google OAuth playground or a short one-off script.)

  while (true) {
    try {
      await pollOnce();
      console.log(`Poll completed. Waiting ${POLL_INTERVAL_SECONDS} seconds before next poll...`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Poll error:", message);
    }
    await new Promise((resolve)=>{setTimeout(resolve, POLL_INTERVAL_SECONDS * 1000)})
  }
}

void runForever();
