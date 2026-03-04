import assert from "node:assert/strict";
import test from "node:test";
import { DefaultSuppressionEvaluator } from "../src/core/defaultSuppressionEvaluator.js";
import { createNormalizedMessage } from "../src/core/message.js";
import { cosineSimilarity, type SuppressionRule } from "../src/core/suppression.js";
import type { SuppressionRuleStore } from "../src/core/contracts.js";
import type { EmbeddingProvider } from "../src/core/embeddingService.js";

class InMemoryRuleStore implements SuppressionRuleStore {
  constructor(private rules: SuppressionRule[]) {}

  async createRule(rule: SuppressionRule): Promise<SuppressionRule> {
    this.rules.push(rule);
    return rule;
  }

  async listRules(userId: string): Promise<SuppressionRule[]> {
    return this.rules.filter((rule) => rule.userId === userId);
  }

  async getRuleById(userId: string, ruleId: string): Promise<SuppressionRule | null> {
    return this.rules.find((rule) => rule.userId === userId && rule.id === ruleId) || null;
  }

  async updateRule(): Promise<SuppressionRule | null> {
    return null;
  }

  async deleteRule(): Promise<void> {}
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  async embedText(text: string): Promise<number[]> {
    if (text.toLowerCase().includes("newsletter")) {
      return [1, 0];
    }

    return [0, 1];
  }
}

test("cosineSimilarity returns 1 for identical vectors and 0 for orthogonal vectors", () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("suppression evaluator matches sender, thread, and sender+context rules", async () => {
  const rules: SuppressionRule[] = [
    {
      id: "sender-rule",
      userId: "user-1",
      type: "SENDER",
      senderEmail: "alerts@example.com",
      context: {},
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "thread-rule",
      userId: "user-1",
      type: "THREAD",
      threadId: "thread-7",
      context: {},
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: "context-rule",
      userId: "user-1",
      type: "SENDER_AND_CONTEXT",
      senderEmail: "digest@example.com",
      context: { embedding: [1, 0], keywords: ["newsletter"], topic: "newsletter" },
      threshold: 0.82,
      isActive: true,
      createdAt: new Date().toISOString()
    }
  ];

  const evaluator = new DefaultSuppressionEvaluator(
    new InMemoryRuleStore(rules),
    new FakeEmbeddingProvider()
  );

  const senderMatch = await evaluator.evaluate({
    userId: "user-1",
    message: createNormalizedMessage({
      source: "gmail",
      accountId: "primary",
      externalId: "msg-1",
      conversationId: "thread-1",
      senderId: "alerts@example.com",
      senderName: "Alerts <alerts@example.com>",
      subject: "Heads up",
      bodyText: "This should be muted.",
      receivedAt: new Date().toISOString()
    })
  });
  assert.equal(senderMatch.suppressed, true);
  assert.equal(senderMatch.rule?.id, "sender-rule");

  const threadMatch = await evaluator.evaluate({
    userId: "user-1",
    message: createNormalizedMessage({
      source: "gmail",
      accountId: "primary",
      externalId: "msg-2",
      conversationId: "thread-7",
      senderId: "anyone@example.com",
      senderName: "anyone@example.com",
      subject: "Same thread",
      bodyText: "Thread mute applies first.",
      receivedAt: new Date().toISOString()
    })
  });
  assert.equal(threadMatch.suppressed, true);
  assert.equal(threadMatch.rule?.id, "thread-rule");

  const contextMatch = await evaluator.evaluate({
    userId: "user-1",
    message: createNormalizedMessage({
      source: "gmail",
      accountId: "primary",
      externalId: "msg-3",
      conversationId: "thread-9",
      senderId: "digest@example.com",
      senderName: "Digest <digest@example.com>",
      subject: "Weekly newsletter",
      bodyText: "This newsletter keeps repeating.",
      receivedAt: new Date().toISOString()
    })
  });
  assert.equal(contextMatch.suppressed, true);
  assert.equal(contextMatch.rule?.id, "context-rule");
  assert.ok((contextMatch.similarity || 0) >= 0.82);
});
