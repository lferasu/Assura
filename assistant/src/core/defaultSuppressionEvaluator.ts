import type { SuppressionEvaluator, SuppressionRuleStore } from "./contracts.js";
import type { EmbeddingProvider } from "./embeddingService.js";
import type { NormalizedMessage } from "./message.js";
import {
  buildMessageContextText,
  cosineSimilarity,
  extractKeywords,
  getSuppressionThreshold,
  getMessageSenderAddress,
  inferTopic,
  normalizeSenderEmail,
  type SuppressionEvaluation,
  type SuppressionRule
} from "./suppression.js";

export class DefaultSuppressionEvaluator implements SuppressionEvaluator {
  constructor(
    private readonly ruleStore: SuppressionRuleStore,
    private readonly embeddingProvider: EmbeddingProvider | null
  ) {}

  async evaluate(input: {
    userId: string;
    message: NormalizedMessage;
  }): Promise<SuppressionEvaluation> {
    const rules = (await this.ruleStore.listRules(input.userId)).filter((rule) => rule.isActive);
    const senderEmail = normalizeSenderEmail(getMessageSenderAddress(input.message));

    for (const rule of rules) {
      if (rule.type === "THREAD" && rule.threadId && input.message.conversationId === rule.threadId) {
        return {
          suppressed: true,
          rule,
          reason: `Matched muted thread ${rule.threadId}`,
          similarity: 1
        };
      }

      if (!rule.senderEmail || rule.senderEmail !== senderEmail) {
        continue;
      }

      if (rule.type === "SENDER") {
        return {
          suppressed: true,
          rule,
          reason: `Matched muted sender ${senderEmail}`,
          similarity: 1
        };
      }
    }

    const contextRules = rules.filter(
      (rule) => rule.isActive && rule.type === "SENDER_AND_CONTEXT" && rule.senderEmail === senderEmail
    );
    if (contextRules.length === 0) {
      return { suppressed: false };
    }

    if (!this.embeddingProvider) {
      return { suppressed: false };
    }

    const contextText = buildMessageContextText(input.message);
    const messageEmbedding = await this.embeddingProvider.embedText(contextText);
    const keywords = extractKeywords(contextText);
    const topic = inferTopic(contextText, keywords);

    for (const rule of contextRules) {
      const ruleEmbedding = rule.context.embedding;
      if (!ruleEmbedding || ruleEmbedding.length === 0) {
        continue;
      }

      const similarity = cosineSimilarity(messageEmbedding, ruleEmbedding);
      if (similarity >= getSuppressionThreshold(rule)) {
        return {
          suppressed: true,
          rule,
          reason: `Matched muted sender context for ${senderEmail}`,
          similarity,
          keywords,
          topic
        };
      }
    }

    return { suppressed: false };
  }
}

export class NoopSuppressionEvaluator implements SuppressionEvaluator {
  async evaluate(_input: {
    userId: string;
    message: NormalizedMessage;
  }): Promise<SuppressionEvaluation> {
    return { suppressed: false };
  }
}
