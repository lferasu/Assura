<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
# Assura (Telegram-First, Assistant Mode)

Assura is a local assistant that ingests messages from pluggable sources and pushes important items to a Telegram bot chat.

Current product scope:
- ingest from Gmail and Telegram source adapters
- process/score message importance
- push important messages to Telegram automatically
- support `/update` and `/brief` for Gmail briefing since last check

Out of scope in this trimmed version:
- mobile UI workflows
- HTTP API gateway workflows
- rule-management UX in Telegram

The architecture keeps extension points for:
- adding new message sources through source adapters
- connecting additional UIs/notifiers later

## Core Flow

On each poll cycle:
1. Load local state from `assistant/data/state.json`.
2. Pull new messages from configured source adapters.
3. Process messages through the existing extraction pipeline.
4. Persist processed message projections to `assistant/data/processed-messages.jsonl`.
5. Push important processed messages to the bound Telegram admin chat.
6. Handle Telegram commands (`/start`, `/help`, `/update`, `/brief`).

## Telegram Commands

- `/start`: bind current chat as admin chat
- `/help`: show command list
- `/update`: return important Gmail emails since last update
- `/brief`: alias for `/update`

`/update` behavior:
- Returns top important Gmail emails since `user.lastEmailUpdateAt`.
- Advances `lastEmailUpdateAt` after response.
- If no new important email exists, returns:
  - `Assura is up to date`
  - plus the last important email marked as already viewed (if any).

## Setup

From repo root:

```bash
cd assistant
npm install
```

Configure env:

```bash
cp .env.example .env
```

Required:
- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`

Recommended:
- `GMAIL_MAX_MESSAGES`
- `POLL_INTERVAL_SECONDS`

Gmail OAuth:
- Place `credentials.json` in `assistant/`.
- Run `npm run poll` once and complete token flow to create `token.json`.

Start:

```bash
npm run poll
```

Then in Telegram:
1. Send `/start` to your bot.
2. Wait for poll cycle or send new messages to sources.
3. Receive automatic important-message pushes.
4. Use `/update` anytime for latest Gmail briefing.

## Data Files

- `assistant/data/state.json`: source cursors + Telegram admin chat binding + update watermark
- `assistant/data/message-assessments.jsonl`: full processed assessments
- `assistant/data/processed-messages.jsonl`: compact records used by `/update`

## Developer Commands

```bash
npm run poll
npm run typecheck
npm test
=======
=======
>>>>>>> theirs
=======
>>>>>>> theirs
# Assura Agent

Assura is a **Gmail polling agent** that watches incoming messages, detects school schedule-impacting announcements, extracts structured schedule data with an LLM, and prints a human-readable summary plus JSON calendar proposals.

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
7. Marks each message as processed and updates the poll cursor so messages are not reprocessed.

## Project structure

- `assistant/src/runners/localPoll.js` – long-running local poll loop.
- `assistant/src/adapters/gmailSource.js` – Gmail OAuth + message fetch + text extraction.
- `assistant/src/core/gate.js` – lightweight schedule-impact gating logic.
- `assistant/src/core/extract.js` – LLM JSON extraction + schema validation.
- `assistant/src/core/summarize.js` – concise human-readable summary generation.
- `assistant/src/adapters/fileStateStore.js` – JSON state persistence.
- `assistant/src/adapters/consoleNotifier.js` – terminal output for processed/skipped messages.

## Requirements

- Node.js 20+
- A Google Cloud project with Gmail API enabled
- OAuth client credentials (`Desktop app` works well)
- OpenAI API key (or compatible key for the configured model)

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
<<<<<<< ours
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
```
