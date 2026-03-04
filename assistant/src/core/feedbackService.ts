import { randomUUID } from "node:crypto";
import type { FeedbackStore, SuppressionRuleStore } from "./contracts.js";
import type { EmbeddingProvider } from "./embeddingService.js";
import {
  buildContextText,
  extractKeywords,
  inferTopic,
  normalizeSenderEmail,
  type FeedbackEvent,
  type FeedbackMode,
  type SuppressionRule
} from "./suppression.js";

export interface NotInterestedInput {
  userId: string;
  messageId: string;
  mode: FeedbackMode;
  senderEmail: string;
  threadId?: string;
  subject?: string;
  snippet?: string;
  bodyText?: string;
}

export class FeedbackService {
  constructor(
    private readonly feedbackStore: FeedbackStore,
    private readonly ruleStore: SuppressionRuleStore,
    private readonly embeddingProvider: EmbeddingProvider | null
  ) {}

  async recordNotInterested(input: NotInterestedInput): Promise<{
    event: FeedbackEvent;
    rule: SuppressionRule;
  }> {
    const senderEmail = normalizeSenderEmail(input.senderEmail);
    const createdAt = new Date().toISOString();
    const event: FeedbackEvent = {
      id: randomUUID(),
      userId: input.userId,
      messageId: input.messageId,
      action: "NOT_INTERESTED",
      mode: input.mode,
      senderEmail,
      threadId: input.threadId,
      subject: input.subject || "",
      snippet: input.snippet || "",
      createdAt
    };

    await this.feedbackStore.appendEvent(event);

    const existingRules = await this.ruleStore.listRules(input.userId);
    let rule: SuppressionRule;

    if (input.mode === "SENDER_ONLY") {
      const existing = existingRules.find(
        (item) => item.type === "SENDER" && item.senderEmail === senderEmail
      );

      if (existing) {
        rule =
          (await this.ruleStore.updateRule(input.userId, existing.id, { isActive: true })) || existing;
      } else {
        rule = await this.ruleStore.createRule({
          id: randomUUID(),
          userId: input.userId,
          type: "SENDER",
          senderEmail,
          context: {},
          isActive: true,
          createdAt
        });
      }

      return { event, rule };
    }

    if (input.mode === "THREAD") {
      if (!input.threadId) {
        throw new Error("threadId is required for THREAD feedback.");
      }

      const existing = existingRules.find(
        (item) => item.type === "THREAD" && item.threadId === input.threadId
      );

      if (existing) {
        rule =
          (await this.ruleStore.updateRule(input.userId, existing.id, { isActive: true })) || existing;
      } else {
        rule = await this.ruleStore.createRule({
          id: randomUUID(),
          userId: input.userId,
          type: "THREAD",
          threadId: input.threadId,
          context: {},
          isActive: true,
          createdAt
        });
      }

      return { event, rule };
    }

    const contextText = buildContextText({
      subject: input.subject,
      snippet: input.snippet,
      bodyText: input.bodyText
    });
    if (!this.embeddingProvider) {
      throw new Error("OPENAI_API_KEY is required for SENDER_AND_CONTEXT suppression.");
    }

    const keywords = extractKeywords(contextText);
    const topic = inferTopic(contextText, keywords);
    const embedding = contextText ? await this.embeddingProvider.embedText(contextText) : undefined;

    rule = await this.ruleStore.createRule({
      id: randomUUID(),
      userId: input.userId,
      type: "SENDER_AND_CONTEXT",
      senderEmail,
      context: {
        embedding,
        keywords,
        topic
      },
      threshold: 0.82,
      isActive: true,
      createdAt
    });

    return { event, rule };
  }
}
