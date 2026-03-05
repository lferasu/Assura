# Assura Agent

Assura is a **Gmail polling agent** that watches incoming messages, detects school schedule-impacting announcements, extracts structured schedule data with an LLM, and sends updates to Telegram (plus local console logs).

## What this agent does

On a loop, the agent:

1. Reads previously saved state from `assistant/data/state.json`.
2. Pulls recent messages from Gmail using the Gmail API.
3. Filters each message with keyword/date gating logic.
4. Runs LLM extraction to produce strict schedule-impact JSON.
5. Generates a readable summary of schedule changes.
6. Logs either:
   - a processed schedule-impact result, or
   - a skip reason.
7. Sends schedule-impact notifications to Telegram when configured.
8. Marks each message as processed and updates the poll cursor so messages are not reprocessed.

## Project structure

- `assistant/src/runners/localPoll.js` – long-running local poll loop.
- `assistant/src/adapters/gmailSource.js` – Gmail OAuth + message fetch + text extraction.
- `assistant/src/core/gate.js` – lightweight schedule-impact gating logic.
- `assistant/src/core/extract.js` – LLM JSON extraction + schema validation.
- `assistant/src/core/summarize.js` – concise human-readable summary generation.
- `assistant/src/adapters/fileStateStore.js` – JSON state persistence.
- `assistant/src/adapters/consoleNotifier.js` – terminal output for processed/skipped messages.
- `assistant/src/adapters/telegramNotifier.js` – Telegram Bot API notifications for processed schedule impacts.

## Requirements

- Node.js 20+
- A Google Cloud project with Gmail API enabled
- OAuth client credentials (`Desktop app` works well)
- OpenAI API key (or compatible key for the configured model)
- Telegram bot token and target chat ID (for Telegram delivery)

## Environment variables

Copy and edit:

```bash
cp assistant/.env.example assistant/.env
```

Variables:

- `OPENAI_API_KEY` – required
- `OPENAI_MODEL` – defaults to `gpt-4.1-mini`
- `POLL_INTERVAL_SECONDS` – defaults to `120`
- `GMAIL_MAX_MESSAGES` – defaults to `15`
- `TELEGRAM_BOT_TOKEN` – Telegram bot token (optional but needed for chat delivery)
- `TELEGRAM_CHAT_ID` – Single chat ID where updates are posted
- `TELEGRAM_CHAT_IDS` – Optional comma-separated list of chat IDs

## Run locally

From repository root:

1. Install dependencies:

   ```bash
   cd assistant
   npm install
   ```

2. Add OAuth credentials file:

   - Place `credentials.json` in `assistant/`.

3. Generate OAuth token (`assistant/token.json`):

   - Run once:

     ```bash
     npm run poll
     ```

   - If `token.json` is missing, the app prints an authorization URL.
   - Complete consent, obtain token JSON, and save it to `assistant/token.json`.

4. Start polling:

   ```bash
   npm run poll
   ```

The process runs continuously and logs processed/ skipped messages to stdout.

If Telegram env vars are configured, each detected schedule-impacting email is pushed into Telegram immediately.


## Telegram troubleshooting

If you do not see schedule notifications in Telegram:

- Confirm `assistant/.env` contains `TELEGRAM_BOT_TOKEN` and either `TELEGRAM_CHAT_ID` or `TELEGRAM_CHAT_IDS`.
- Start the poller and verify startup logs show `Telegram delivery enabled for ... chat(s)`.
- If chat ID is not set, send `/start` to the bot, then restart poller (it auto-discovers chat IDs from Telegram updates).
- Ensure the bot is added to the target chat and allowed to post messages.

## Deploy

Because this agent is a long-running poller, it deploys well as a small worker service.

### Option A: VM/container with process manager (recommended)

1. Provision a host with Node.js 20+.
2. Copy the repo (or build artifact) to the host.
3. Place secret files and env:
   - `assistant/.env`
   - `assistant/credentials.json`
   - `assistant/token.json`
4. Install production deps:

   ```bash
   cd assistant
   npm ci --omit=dev
   ```

5. Run with a supervisor (`systemd`, `pm2`, or container restart policy).

`systemd` example `assura-agent.service`:

```ini
[Unit]
Description=Assura Gmail Poll Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/assura/assistant
ExecStart=/usr/bin/npm run poll
Restart=always
RestartSec=10
EnvironmentFile=/opt/assura/assistant/.env

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable assura-agent
sudo systemctl start assura-agent
sudo systemctl status assura-agent
```

### Option B: Scheduled/serverless execution

If your platform does not support long-lived processes, you can adapt the runner to execute a single poll pass (extract `pollOnce`) and trigger it on a schedule (e.g., every 1–5 minutes with Cloud Scheduler/Cron).

## Operational notes

- `assistant/data/state.json` tracks processed message IDs and last Gmail cursor.
- Keep `token.json` and `credentials.json` secret.
- If OAuth refresh tokens expire/revoke, regenerate `token.json`.
- Start with lower `GMAIL_MAX_MESSAGES` while validating behavior.

## Quick start

```bash
cp assistant/.env.example assistant/.env
cd assistant
npm install
npm run poll
```
