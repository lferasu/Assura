import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { queryImportantEmailsSince, saveProcessedMessage } from "../src/storage/messageStore.js";
import { createNormalizedMessage } from "../src/core/message.js";

test("queryImportantEmailsSince returns only important gmail messages after watermark", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "assura-message-store-"));
  const filePath = path.join(tempDir, "processed-messages.jsonl");
  const base = new Date("2026-03-04T10:00:00.000Z");

  await saveProcessedMessage({
    filePath,
    message: createNormalizedMessage({
      source: "gmail",
      accountId: "primary",
      externalId: "gmail-1",
      conversationId: "thread-1",
      senderId: "kyle@example.com",
      senderName: "Kyle",
      subject: "Deploy blocked",
      bodyText: "Deployment blocked in QA3.",
      receivedAt: new Date(base.getTime() + 60_000).toISOString()
    }),
    summary: "Deployment blocked in QA3.",
    importance: "high",
    category: "ops"
  });

  await saveProcessedMessage({
    filePath,
    message: createNormalizedMessage({
      source: "telegram",
      accountId: "telegram:bot",
      externalId: "tg-1",
      conversationId: "chat-1",
      senderId: "123",
      senderName: "Random",
      subject: undefined,
      bodyText: "Chat message",
      receivedAt: new Date(base.getTime() + 120_000).toISOString()
    }),
    summary: "Chat message",
    importance: "critical",
    category: "chat"
  });

  await saveProcessedMessage({
    filePath,
    message: createNormalizedMessage({
      source: "gmail",
      accountId: "primary",
      externalId: "gmail-2",
      conversationId: "thread-2",
      senderId: "digest@example.com",
      senderName: "Digest",
      subject: "Weekly digest",
      bodyText: "Routine newsletter",
      receivedAt: new Date(base.getTime() + 180_000).toISOString()
    }),
    summary: "Routine newsletter",
    importance: "medium",
    category: "newsletter"
  });

  const results = await queryImportantEmailsSince({
    filePath,
    sinceIsoTimestamp: new Date(base.getTime() + 30_000).toISOString(),
    limit: 10
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].source, "gmail");
  assert.equal(results[0].subject, "Deploy blocked");

  await fs.rm(tempDir, { recursive: true, force: true });
});
