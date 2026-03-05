import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNormalizedMessage } from "../src/core/message.js";
import { TelegramClient } from "../src/telegram/telegramClient.js";
import { TelegramUiController } from "../src/telegram/telegramUi.js";
import { saveProcessedMessage } from "../src/storage/messageStore.js";
import type { PersistedState } from "../src/adapters/fileStateStore.js";

class FakeTelegramClient extends TelegramClient {
  readonly sentMessages: Array<{ chatId: string; text: string }> = [];

  constructor() {
    super({
      botToken: "test-token",
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 })
    });
  }

  override async sendMessage(chatId: string, text: string): Promise<void> {
    this.sentMessages.push({ chatId, text });
  }
}

async function createController(input?: { state?: PersistedState; withImportantRecord?: boolean }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "assura-telegram-ui-scope-"));
  const statePath = path.join(tempDir, "state.json");
  const processedMessagesStorePath = path.join(tempDir, "processed-messages.jsonl");
  const state =
    input?.state ??
    ({
      sources: {
        "gmail:primary": {
          cursor: { lastInternalDateMs: 0 },
          processed: {}
        }
      },
      ui: {
        telegram: {
          decisions: {}
        }
      },
      user: {
        lastUpdateAtBySource: {}
      }
    } satisfies PersistedState);

  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  if (input?.withImportantRecord) {
    await saveProcessedMessage({
      filePath: processedMessagesStorePath,
      message: createNormalizedMessage({
        source: "gmail",
        accountId: "primary",
        externalId: "msg-1",
        conversationId: "thread-1",
        senderId: "devops@example.com",
        senderName: "DevOps",
        subject: "Build failed",
        bodyText: "Pipeline failed in CI.",
        receivedAt: new Date("2026-03-04T11:00:00.000Z").toISOString()
      }),
      summary: "Pipeline failed in CI.",
      importance: "high",
      category: "ops"
    });
  }

  const client = new FakeTelegramClient();
  const controller = new TelegramUiController({
    client,
    state,
    statePath,
    processedMessagesStorePath
  });

  return { controller, client, state };
}

test("/start binds admin chat", async () => {
  const { controller, client, state } = await createController();

  await controller.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: 456 },
      from: { id: 456, first_name: "Owner" },
      date: 1_772_589_200,
      text: "/start"
    }
  });

  assert.equal(state.ui?.telegram?.adminChatId, "456");
  assert.match(client.sentMessages[0].text, /Assura connected/);
});

test("/update returns up-to-date with already viewed item when no new email", async () => {
  const { controller, client, state } = await createController({
    withImportantRecord: true,
    state: {
      sources: {
        "gmail:primary": { cursor: { lastInternalDateMs: 0 }, processed: {} }
      },
      ui: {
        telegram: { adminChatId: "456", decisions: {} }
      },
      user: {
        lastEmailUpdateAt: new Date("2026-03-04T12:00:00.000Z").toISOString(),
        lastUpdateAtBySource: { gmail: new Date("2026-03-04T12:00:00.000Z").toISOString() }
      }
    }
  });

  await controller.handleUpdate({
    update_id: 2,
    message: {
      message_id: 2,
      chat: { id: 456 },
      from: { id: 456, first_name: "Owner" },
      date: 1_772_589_210,
      text: "/update"
    }
  });

  const response = client.sentMessages[0]?.text || "";
  assert.match(response, /Assura is up to date/);
  assert.match(response, /already viewed/);
  assert.ok(state.user?.lastEmailUpdateAt);
});

test("automatic push forwards only important messages", async () => {
  const { controller, client } = await createController({
    state: {
      sources: {
        "gmail:primary": { cursor: { lastInternalDateMs: 0 }, processed: {} }
      },
      ui: {
        telegram: { adminChatId: "456", decisions: {} }
      },
      user: {
        lastUpdateAtBySource: {}
      }
    }
  });

  await controller.sendProcessedSummary({
    message: createNormalizedMessage({
      source: "gmail",
      accountId: "primary",
      externalId: "low",
      conversationId: "thread-low",
      senderId: "newsletter@example.com",
      senderName: "Newsletter",
      subject: "Weekly digest",
      bodyText: "Routine update.",
      receivedAt: new Date("2026-03-04T10:00:00.000Z").toISOString()
    }),
    result: {
      status: "processed",
      gate: { shouldProcess: true, reason: "ok" },
      extracted: {
        schemaVersion: 1,
        category: "newsletter",
        importance: "low",
        needsAction: false,
        summary: "Routine update.",
        actionSummary: null,
        keyDates: [],
        actionItems: [],
        facts: [],
        evidence: [],
        confidence: 0.8
      },
      summary: "Routine update.",
      actionItems: [],
      preparedActions: []
    }
  });

  await controller.sendProcessedSummary({
    message: createNormalizedMessage({
      source: "gmail",
      accountId: "primary",
      externalId: "high",
      conversationId: "thread-high",
      senderId: "devops@example.com",
      senderName: "DevOps",
      subject: "Build failed",
      bodyText: "Pipeline failed.",
      receivedAt: new Date("2026-03-04T11:00:00.000Z").toISOString()
    }),
    result: {
      status: "processed",
      gate: { shouldProcess: true, reason: "ok" },
      extracted: {
        schemaVersion: 1,
        category: "ops",
        importance: "high",
        needsAction: true,
        summary: "Pipeline failed.",
        actionSummary: null,
        keyDates: [],
        actionItems: [],
        facts: [],
        evidence: [],
        confidence: 0.95
      },
      summary: "Pipeline failed.",
      actionItems: [],
      preparedActions: []
    }
  });

  assert.equal(client.sentMessages.length, 1);
  assert.match(client.sentMessages[0].text, /Important GMAIL message/);
});
