import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchGmailMessages } from "../adapters/gmailSource.js";
import { isProcessed, loadState, markProcessed, saveState, updateCursor } from "../adapters/fileStateStore.js";
import { notifyProcessed, notifySkipped } from "../adapters/consoleNotifier.js";
import { notifyTelegramProcessed, resolveTelegramChatIds } from "../adapters/telegramNotifier.js";
import { runPipelineOnMessage } from "../core/pipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const statePath = path.join(projectRoot, "data/state.json");

dotenv.config({ path: path.join(projectRoot, ".env") });

const POLL_INTERVAL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS || 120);
const GMAIL_MAX_MESSAGES = Number(process.env.GMAIL_MAX_MESSAGES || 15);

async function pollOnce() {
  const state = await loadState(statePath);
  const lastInternalDateMs = state.sources["gmail:primary"].cursor.lastInternalDateMs || 0;

  const messages = await fetchGmailMessages({
    projectRoot,
    maxMessages: GMAIL_MAX_MESSAGES,
    lastInternalDateMs
  });

  for (const message of messages) {
    if (isProcessed(state, message.messageId)) continue;

    const result = await runPipelineOnMessage(message);

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
      calendarProposals: result.calendarProposals
    });

    try {
      const telegramResult = await notifyTelegramProcessed({
        message,
        summary: result.summary,
        calendarProposals: result.calendarProposals
      });

      if (!telegramResult.sent) {
        console.warn("Telegram notify skipped:", telegramResult.reason);
      }
    } catch (error) {
      console.error("Telegram notify error:", error.message);
    }

    markProcessed(state, message.messageId, { skipped: false });
    updateCursor(state, message.internalDateMs);
  }

  await saveState(statePath, state);
}

async function logTelegramConfigStatus() {
  const result = await resolveTelegramChatIds();

  if (result.tokenMissing) {
    console.warn("Telegram delivery disabled. Set TELEGRAM_BOT_TOKEN in assistant/.env");
    return;
  }

  if (!result.chatIds.length) {
    console.warn("Telegram has no known target chat yet. Set TELEGRAM_CHAT_ID (or TELEGRAM_CHAT_IDS) or send /start to your bot and retry.");
    return;
  }

  console.log(`Telegram delivery enabled for ${result.chatIds.length} chat(s) via ${result.source}.`);
}

async function runForever() {
  console.log("Starting Gmail local poller...");
  console.log(`Polling every ${POLL_INTERVAL_SECONDS} seconds`);
  await logTelegramConfigStatus();

  // OAuth setup (one-time):
  // 1) In Google Cloud Console, enable Gmail API and create OAuth desktop credentials.
  // 2) Save credentials JSON to: assistant/credentials.json
  // 3) Run `npm run poll` once; if token.json is missing, an auth URL will be printed.
  // 4) Complete consent, capture auth code, exchange for token, and save token JSON to assistant/token.json.
  //    (Use Google OAuth playground or a short one-off script.)

  while (true) {
    try {
      await pollOnce();
    } catch (error) {
      console.error("Poll error:", error.message);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_SECONDS * 1000));
  }
}

runForever();
