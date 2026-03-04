# Assura

Assura is a Gmail-based personal assistant that polls incoming email, classifies each message, estimates importance, identifies whether follow-up is needed, and produces structured action suggestions for things like calendar changes, to-do updates, or manual review.

It now also supports a user-driven "Not interested in this kind of message" loop. The mobile client can send suppression feedback to a lightweight API, and future poll cycles can mute similar messages before they are summarized or surfaced as actionable items.

The current implementation is intentionally conservative: it extracts and stores recommendations, but it does not execute external tool actions yet. Suggested actions are routed into a manual-review execution plan so real integrations can be added safely later.

## What It Does

On each poll cycle, Assura:

1. Reads local processing state from `assistant/data/state.json`.
2. Pulls recent messages from Gmail using the Gmail API.
3. Skips only empty messages.
4. Uses an LLM to produce a structured message assessment.
5. Generates a readable summary of category, importance, and suggested next steps.
6. Stores the processed assessment and planned actions as JSONL records.
7. Prints the assessment and execution plan to the terminal.
8. Marks the Gmail message as processed and advances the cursor.
9. Applies active suppression rules before summarization and stores muted messages in a separate suppressed log.

## Current Architecture

The code is organized so future storage and tool integrations can be added without rewriting the core flow.

- `assistant/src/runners/localPoll.ts`: long-running local poll loop.
- `assistant/src/adapters/gmailSource.ts`: Gmail OAuth, fetch, and normalization.
- `assistant/src/core/extract.ts`: LLM-based message classification and structured extraction.
- `assistant/src/core/summarize.ts`: readable summaries for processed messages.
- `assistant/src/core/pipeline.ts`: orchestration of extraction, storage, and action preparation.
- `assistant/src/core/contracts.ts`: extension interfaces for message storage, suppression, feedback, and tool execution.
- `assistant/src/core/suppression.ts`: suppression rule models, keyword extraction, and cosine similarity helpers.
- `assistant/src/core/defaultSuppressionEvaluator.ts`: suppression matching logic (sender, thread, sender + semantic context).
- `assistant/src/core/feedbackService.ts`: converts mobile "not interested" feedback into stored suppression rules.
- `assistant/src/adapters/fileMessageStore.ts`: append-only JSONL storage for assessments.
- `assistant/src/adapters/fileActionStore.ts`: append-only JSONL storage for planned actions.
- `assistant/src/adapters/fileSuppressionRuleStore.ts`: append-only JSONL suppression rule storage for local mode.
- `assistant/src/adapters/fileFeedbackStore.ts`: append-only JSONL feedback event storage for local mode.
- `assistant/src/adapters/fileSuppressedMessageStore.ts`: append-only JSONL muted message storage for local mode.
- `assistant/src/adapters/mongoFeedbackStore.ts`: MongoDB feedback event storage.
- `assistant/src/adapters/mongoSuppressionRuleStore.ts`: MongoDB suppression rule storage.
- `assistant/src/adapters/mongoSuppressedMessageStore.ts`: MongoDB muted message storage.
- `assistant/src/adapters/manualReviewToolExecutor.ts`: default executor that marks actions for manual review.
- `assistant/src/adapters/fileStateStore.ts`: JSON state persistence for poll cursor and processed IDs.
- `assistant/src/adapters/consoleNotifier.ts`: terminal output for processed and skipped messages.
- `assistant/src/config/env.ts`: centralized environment loading and validation.
- `assistant/src/server/httpServer.ts`: lightweight suppression feedback API for the mobile app.
- `mobile/`: Expo-based React Native client for browsing summaries and suggested actions.

## Mobile App

The repository also includes a React Native client in `mobile/`.

It currently provides:

- an inbox-style view of message summaries
- suggested action cards
- category filtering
- importance filtering
- an action-required toggle

The mobile app currently uses local mock data shaped like the assistant output. It is intended to be wired to a real API or persisted store next.

Run it with:

```bash
cd mobile
npm install
npm run start
```

## Extracted Output Model

Each processed email is converted into a structured assessment with:

- `category`
- `importance` (`low`, `medium`, `high`, `critical`)
- `needsAction`
- `summary`
- `actionSummary`
- `keyDates`
- `actionItems`
- `facts`
- `evidence`
- `confidence`

The pipeline also generates a `PreparedAction[]` execution plan. Right now those actions are marked as `manual_review`, but this is the handoff point for future calendar, to-do, or document tools.

## Requirements

- Node.js 20+
- A Google Cloud project with Gmail API enabled
- OAuth client credentials (`Desktop app` works well)
- OpenAI API key

## Environment Variables

Copy and edit:

```bash
cp assistant/.env.example assistant/.env
```

Variables:

- `OPENAI_API_KEY`: required
- `OPENAI_MODEL`: defaults to `gpt-4.1-mini`
- `EMBEDDING_MODEL`: defaults to `text-embedding-3-small`
- `POLL_INTERVAL_SECONDS`: defaults to `120`
- `GMAIL_MAX_MESSAGES`: defaults to `15`
- `MONGODB_URI`: optional. If set, suppression feedback, rules, and muted message records use MongoDB.

## Local Setup

From the repository root:

1. Install dependencies:

```bash
cd assistant
npm install
```

2. Add OAuth credentials:

- Place `credentials.json` in `assistant/`.

3. Generate OAuth token (`assistant/token.json`):

- Run `npm run poll`.
- If `token.json` is missing, the app will print an authorization URL.
- Complete consent and save the resulting token JSON to `assistant/token.json`.

4. Start polling:

```bash
npm run poll
```

5. Start the suppression API (used by the mobile "Not interested" action):

```bash
npm run server
```

By default it listens on `API_PORT + 1` (for example, `8788` when `API_PORT=8787`) so it can run beside the existing inbox API.

6. Optional: start the existing inbox API used by the current mobile app:

```bash
npm run api
```

Run both the poller and suppression API together in separate terminals, or use `start-assura.ps1` from the repo root to launch the poller, inbox API, suppression API, and mobile app windows.

## Not Interested Feedback

The mobile app can send feedback when a message is not useful. Assura stores the feedback event and creates a suppression rule for one of three scopes:

- `SENDER_ONLY`: mute all future messages from the sender
- `THREAD`: mute the current thread only
- `SENDER_AND_CONTEXT`: mute future messages from the same sender when the semantic context is similar

For `SENDER_AND_CONTEXT`, Assura stores:

- an embedding for `subject + snippet + limited body text`
- lightweight keywords
- a short topic string for explainability

During polling, suppression is evaluated before extraction and notifications. Suppressed messages are marked processed, skipped from the normal action pipeline, and appended to a muted message store for a future "Muted" view.

### Example Requests

Create a not-interested rule:

```bash
curl -X POST http://localhost:8788/api/feedback/not-interested \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "local-user",
    "messageId": "gmail-message-id",
    "mode": "SENDER_AND_CONTEXT",
    "senderEmail": "news@example.com",
    "threadId": "thread-id",
    "subject": "Weekly newsletter",
    "snippet": "The same recurring newsletter"
  }'
```

List active rules:

```bash
curl "http://localhost:8788/api/rules?userId=local-user"
```

Disable a rule:

```bash
curl -X PATCH http://localhost:8788/api/rules/<rule-id> \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "local-user",
    "isActive": false
  }'
```

Delete a rule:

```bash
curl -X DELETE "http://localhost:8788/api/rules/<rule-id>?userId=local-user"
```

## Type Checking

```bash
cd assistant
npm run typecheck
npm run test
```

## VS Code Debugging

A launch configuration is included at `.vscode/launch.json`.

Use the `Assura: Poll Runner` debug target to run `npm run poll` from the `assistant` directory with `assistant/.env` loaded automatically.

## Data Files

The poller uses these local files:

- `assistant/data/state.json`: processed message IDs and Gmail cursor
- `assistant/data/message-assessments.jsonl`: stored message assessments
- `assistant/data/action-items.jsonl`: stored suggested actions plus prepared execution plans
- `assistant/data/feedback-events.jsonl`: local feedback event log when MongoDB is not configured
- `assistant/data/suppression-rules.jsonl`: local suppression rules when MongoDB is not configured
- `assistant/data/suppressed-messages.jsonl`: muted messages stored during polling when MongoDB is not configured

These are runtime artifacts and should not be committed.

## Git Hygiene

The repository includes a root `.gitignore` that ignores:

- `assistant/node_modules/`
- `assistant/.env`
- `assistant/credentials.json`
- `assistant/token.json`
- generated JSONL runtime files
- most `.vscode` files except the committed debug config

## Deployment

Assura currently runs best as a long-lived worker process.

### Option A: VM or Container

1. Provision a host with Node.js 20+.
2. Copy the repo to the host.
3. Add the required secret files:
- `assistant/.env`
- `assistant/credentials.json`
- `assistant/token.json`
4. Install dependencies:

```bash
cd assistant
npm ci
```

5. Run with a supervisor such as `systemd`, `pm2`, or a container restart policy.

Example `systemd` unit:

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

### Option B: Scheduled Execution

If you prefer scheduled runs instead of a long-lived poller, refactor the runner so a single poll pass can be invoked on a timer, then trigger it from cron or a scheduler.

## Next Extension Points

The current architecture is designed for these next steps:

1. Replace `ManualReviewToolExecutor` with real calendar, task, or document integrations.
2. Replace the file-backed stores with a database-backed `MessageStore` and `ActionStore`.
3. Add attachment and document ingestion without changing the core extraction contract.
