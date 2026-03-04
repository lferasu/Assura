import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileFeedbackStore } from "../src/adapters/fileFeedbackStore.js";
import { FileSuppressionRuleStore } from "../src/adapters/fileSuppressionRuleStore.js";
import { DefaultSuppressionEvaluator } from "../src/core/defaultSuppressionEvaluator.js";
import type {
  ActionStore,
  MessageStore,
  StoredActionBatch,
  StoredMessageAssessment,
  StoredSuppressedMessage,
  SuppressedMessageStore,
  ToolExecutor
} from "../src/core/contracts.js";
import type { EmbeddingProvider } from "../src/core/embeddingService.js";
import { createHttpServer } from "../src/server/httpServer.js";
import { pollOnceWithSource } from "../src/runners/localPoll.js";
import type { MessageSourceAdapter } from "../src/sources/types.js";
import { createNormalizedMessage } from "../src/core/message.js";

class FakeEmbeddingProvider implements EmbeddingProvider {
  async embedText(text: string): Promise<number[]> {
    if (text.toLowerCase().includes("newsletter")) {
      return [1, 0];
    }

    return [0, 1];
  }
}

class InMemoryMessageStore implements MessageStore {
  public readonly records: StoredMessageAssessment[] = [];

  async saveAssessment(record: StoredMessageAssessment): Promise<void> {
    this.records.push(record);
  }
}

class InMemoryActionStore implements ActionStore {
  public readonly records: StoredActionBatch[] = [];

  async savePlannedActions(record: StoredActionBatch): Promise<void> {
    this.records.push(record);
  }
}

class InMemorySuppressedMessageStore implements SuppressedMessageStore {
  public readonly records: StoredSuppressedMessage[] = [];

  async saveSuppressed(record: StoredSuppressedMessage): Promise<void> {
    this.records.push(record);
  }
}

class NoopToolExecutor implements ToolExecutor {
  async prepareActions(): Promise<[]> {
    return [];
  }
}

class FakeGmailAdapter implements MessageSourceAdapter {
  constructor(
    private readonly messages: ReturnType<typeof createNormalizedMessage>[]
  ) {}

  key(): string {
    return "gmail:primary";
  }

  async fetchNew(_cursor: Record<string, unknown>): Promise<{
    messages: ReturnType<typeof createNormalizedMessage>[];
    nextCursor: { lastInternalDateMs: number };
  }> {
    return {
      messages: this.messages,
      nextCursor: { lastInternalDateMs: Date.now() }
    };
  }
}

test("POST feedback creates a rule and the next ingest suppresses a matching email", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "assura-feedback-"));
  const feedbackPath = path.join(tempDir, "feedback-events.jsonl");
  const rulesPath = path.join(tempDir, "suppression-rules.jsonl");
  const statePath = path.join(tempDir, "state.json");
  const feedbackStore = new FileFeedbackStore(feedbackPath);
  const ruleStore = new FileSuppressionRuleStore(rulesPath);
  const embeddingProvider = new FakeEmbeddingProvider();
  const app = createHttpServer({
    feedbackStore,
    suppressionRuleStore: ruleStore,
    embeddingProvider
  });
  const server = app.listen(0);

  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP port.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${baseUrl}/api/feedback/not-interested`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      userId: "local-user",
      messageId: "msg-1",
      mode: "SENDER_AND_CONTEXT",
      senderEmail: "Digest <digest@example.com>",
      threadId: "thread-1",
      subject: "Weekly newsletter",
      snippet: "The newsletter keeps repeating"
    })
  });

  assert.equal(response.status, 200);
  const payload = (await response.json()) as { ok: boolean; ruleId: string };
  assert.equal(payload.ok, true);
  assert.ok(payload.ruleId);

  const rules = await ruleStore.listRules("local-user");
  assert.equal(rules.length, 1);

  const messageStore = new InMemoryMessageStore();
  const actionStore = new InMemoryActionStore();
  const suppressedStore = new InMemorySuppressedMessageStore();
  const stats = await pollOnceWithSource({
    statePath,
    projectRoot: tempDir,
    dependencies: {
      userId: "local-user",
      messageStore,
      actionStore,
      toolExecutor: new NoopToolExecutor(),
      suppressionEvaluator: new DefaultSuppressionEvaluator(ruleStore, embeddingProvider),
      suppressedMessageStore: suppressedStore
    },
    adapters: [
      new FakeGmailAdapter([
        createNormalizedMessage({
          source: "gmail",
          accountId: "primary",
          externalId: "msg-2",
          conversationId: "thread-22",
          senderId: "digest@example.com",
          senderName: "Digest <digest@example.com>",
          subject: "Weekly newsletter",
          bodyText: "This newsletter keeps repeating with the same context.",
          receivedAt: new Date().toISOString()
        })
      ])
    ]
  });

  assert.equal(stats.suppressed, 1);
  assert.equal(stats.processed, 0);
  assert.equal(messageStore.records.length, 0);
  assert.equal(actionStore.records.length, 0);
  assert.equal(suppressedStore.records.length, 1);

  const stateRaw = await fs.readFile(statePath, "utf8");
  assert.match(stateRaw, /suppressed:/);
});
