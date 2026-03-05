# Assura

Assura is a Telegram-first message assistant.

It polls connected sources, extracts actionable signal with an LLM pipeline, stores compact processed records, and interacts with users through a Telegram bot.

## Current Product Scope

- Source ingestion: Gmail and Telegram
- Processing pipeline: gate, extract, summarize, suppress
- Delivery:
  - automatic Telegram push for important messages
  - Telegram commands for on-demand updates
- Briefing:
  - `/update` and `/brief` return important email updates
  - if no new important emails exist, Assura still returns recent reviewed important emails

## Telegram Commands

- `/start` bind current chat as admin chat
- `/help` show command list
- `/update` return latest important email update
- `/brief` alias for `/update`

## Architecture

Assura keeps source adapters and UI controllers separate:

- source adapters normalize external input into internal `NormalizedMessage`
- pipeline processes normalized messages independently of UI
- UI controllers decide how to present results and handle commands

Telegram is the active UI today, but the codebase keeps a UI controller boundary for additional front ends later.

## Repository Layout

- `assistant/` core application
  - `src/adapters/` source/storage integrations
  - `src/core/` pipeline logic
  - `src/telegram/` Telegram client and UI controller
  - `src/ui/` UI contracts
  - `src/runners/localPoll.ts` long-running poller
  - `src/runners/oauthToken.ts` Gmail OAuth helper
  - `data/` runtime state and logs
- `shared/` shared rule/registry modules used by assistant
- `deploy/systemd/assura.service` production systemd template
- `start-assura.ps1` convenience launcher for local Windows usage

## Prerequisites

- Node.js 20+
- Telegram bot token
- OpenAI API key
- Gmail OAuth client credentials (for Gmail ingestion)

## Local Setup

```bash
cd assistant
npm install
cp .env.example .env
```

Required `.env` values:

- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`

Useful optional values:

- `POLL_INTERVAL_SECONDS` (default `120`)
- `TELEGRAM_UI_POLL_INTERVAL_SECONDS` (default `3`)
- `GMAIL_MAX_MESSAGES` (default `15`)
- `CHROMA_ENABLED`
- `MONGODB_URI`

Gmail auth files:

- place `assistant/credentials.json`
- generate `assistant/token.json`:

```bash
npm run auth
```

## Run

```bash
cd assistant
npm run poll
```

Then in Telegram:

1. send `/start`
2. use `/help`
3. use `/update` for latest briefing

## Testing

```bash
cd assistant
npm test
npm run typecheck
```

## Deployment

### Option A: Docker

Build from repo root:

```bash
docker build -f assistant/Dockerfile -t assura:latest .
```

Run:

```bash
docker run -d \
  --name assura \
  --restart unless-stopped \
  --env-file assistant/.env \
  -v %cd%/assistant/data:/app/assistant/data \
  -v %cd%/assistant/credentials.json:/app/assistant/credentials.json:ro \
  -v %cd%/assistant/token.json:/app/assistant/token.json:ro \
  assura:latest
```

On Linux/macOS, replace `%cd%` with `${PWD}`.

### Option B: systemd (Linux VM)

1. Copy repo to `/opt/assura`
2. Install production dependencies:

```bash
cd /opt/assura/assistant
npm ci --omit=dev
```

3. Copy service template:

```bash
sudo cp /opt/assura/deploy/systemd/assura.service /etc/systemd/system/assura.service
```

4. Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable assura
sudo systemctl start assura
sudo systemctl status assura
```

## Operational Notes

- Runtime files in `assistant/data/` are local state, not source code
- Keep `assistant/.env`, `assistant/credentials.json`, and `assistant/token.json` secret
- If Gmail token is revoked/expired, rerun `npm run auth`
