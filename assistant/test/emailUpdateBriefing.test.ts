import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNormalizedMessage } from "../src/core/message.js";
import { generateEmailUpdate } from "../src/briefing/generateEmailUpdate.js";
import { saveProcessedMessage } from "../src/storage/messageStore.js";

test("generateEmailUpdate formats briefing text", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "assura-email-update-"));
  const filePath = path.join(tempDir, "processed-messages.jsonl");
  const receivedAt = new Date("2026-03-04T10:42:00.000Z").toISOString();

  await saveProcessedMessage({
    filePath,
    message: createNormalizedMessage({
      source: "gmail",
      accountId: "primary",
      externalId: "msg-1",
      conversationId: "thread-1",
      senderId: "kyle@example.com",
      senderName: "Kyle (Walgreens)",
      subject: "QA3 deploy blocked",
      bodyText: "Deployment failed due to missing env var in insuranceBilling config.",
      receivedAt
    }),
    summary: "Deployment failed due to missing env var in insuranceBilling config.",
    importance: "critical",
    category: "ops"
  });

  const result = await generateEmailUpdate({
    filePath,
    lastEmailUpdateAt: new Date("2026-03-04T09:00:00.000Z").toISOString(),
    now: new Date("2026-03-04T12:00:00.000Z")
  });

  assert.match(result.text, /Assura Update \(Email\)/);
  assert.match(result.text, /QA3 deploy blocked/);
  assert.match(result.text, /Since last check: 1 important emails/);
  assert.equal(result.newestReceivedAt, receivedAt);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("generateEmailUpdate returns up-to-date text when there are no records", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "assura-email-update-empty-"));
  const filePath = path.join(tempDir, "processed-messages.jsonl");

  const result = await generateEmailUpdate({
    filePath,
    lastEmailUpdateAt: new Date("2026-03-04T09:00:00.000Z").toISOString(),
    now: new Date("2026-03-04T12:00:00.000Z")
  });

  assert.match(result.text, /Assura is up to date/);
  assert.match(result.text, /No important emails have been reviewed yet/);
  assert.equal(result.count, 0);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("generateEmailUpdate returns latest reviewed emails when no new emails exist", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "assura-email-update-latest-"));
  const filePath = path.join(tempDir, "processed-messages.jsonl");
  const firstReceivedAt = new Date("2026-03-04T09:10:00.000Z").toISOString();
  const secondReceivedAt = new Date("2026-03-04T10:20:00.000Z").toISOString();

  await saveProcessedMessage({
    filePath,
    message: createNormalizedMessage({
      source: "gmail",
      accountId: "primary",
      externalId: "msg-a",
      conversationId: "thread-a",
      senderId: "team-a@example.com",
      senderName: "Team A",
      subject: "CI pipeline failed",
      bodyText: "Failure in release workflow.",
      receivedAt: firstReceivedAt
    }),
    summary: "Failure in release workflow.",
    importance: "high",
    category: "ops"
  });

  await saveProcessedMessage({
    filePath,
    message: createNormalizedMessage({
      source: "gmail",
      accountId: "primary",
      externalId: "msg-b",
      conversationId: "thread-b",
      senderId: "team-b@example.com",
      senderName: "Team B",
      subject: "Urgent incident update",
      bodyText: "Incident still active.",
      receivedAt: secondReceivedAt
    }),
    summary: "Incident still active.",
    importance: "critical",
    category: "incident"
  });

  const result = await generateEmailUpdate({
    filePath,
    lastEmailUpdateAt: new Date("2026-03-04T12:00:00.000Z").toISOString(),
    now: new Date("2026-03-04T12:30:00.000Z")
  });

  assert.match(result.text, /Assura is up to date/);
  assert.match(result.text, /No new important emails since your last check/);
  assert.match(result.text, /Latest important emails \(already reviewed\)/);
  assert.match(result.text, /Urgent incident update/);
  assert.match(result.text, /CI pipeline failed/);
  assert.equal(result.count, 0);

  await fs.rm(tempDir, { recursive: true, force: true });
});
