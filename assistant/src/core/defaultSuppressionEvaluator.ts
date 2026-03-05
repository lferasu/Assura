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

function senderMatches(rule: SuppressionRule, senderEmail: string): boolean {
  if (!rule.senderEmail) {
    return false;
  }

  return rule.senderEmail === "*" || rule.senderEmail === senderEmail;
}

function keywordOverlap(rule: SuppressionRule, messageKeywords: string[]): number {
  const ruleKeywords = rule.context.keywords || [];
  if (ruleKeywords.length === 0 || messageKeywords.length === 0) {
    return 0;
  }

  let matches = 0;
  for (const keyword of ruleKeywords) {
    if (messageKeywords.includes(keyword)) {
      matches += 1;
    }
  }

  return matches / Math.max(ruleKeywords.length, 1);
}

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

      if (!senderMatches(rule, senderEmail)) {
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

    const contextRules = rules.filter((rule) => {
      return rule.isActive && rule.type === "SENDER_AND_CONTEXT" && senderMatches(rule, senderEmail);
    });
    if (contextRules.length === 0) {
      return { suppressed: false };
    }

    const contextText = buildMessageContextText(input.message);
    const keywords = extractKeywords(contextText);
    const topic = inferTopic(contextText, keywords);
    const messageEmbedding = this.embeddingProvider
      ? await this.embeddingProvider.embedText(contextText)
      : null;

    for (const rule of contextRules) {
      const ruleEmbedding = rule.context.embedding;
      if (messageEmbedding && ruleEmbedding && ruleEmbedding.length > 0) {
        const similarity = cosineSimilarity(messageEmbedding, ruleEmbedding);
        if (similarity >= getSuppressionThreshold(rule)) {
          return {
            suppressed: true,
            rule,
            reason:
              rule.senderEmail === "*"
                ? "Matched muted content pattern"
                : `Matched muted sender context for ${senderEmail}`,
            similarity,
            keywords,
            topic
          };
        }
      }

      const overlap = keywordOverlap(rule, keywords);
      const topicMatches =
        Boolean(rule.context.topic && topic) &&
        topic!.toLowerCase().includes((rule.context.topic || "").toLowerCase());
      if (overlap >= 0.5 || topicMatches) {
        return {
          suppressed: true,
          rule,
          reason:
            rule.senderEmail === "*"
              ? "Matched muted content pattern"
              : `Matched muted sender context for ${senderEmail}`,
          similarity: overlap,
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
