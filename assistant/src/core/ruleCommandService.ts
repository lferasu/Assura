import { randomUUID } from "node:crypto";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import type { SuppressionRuleStore } from "./contracts.js";
import type { EmbeddingProvider } from "./embeddingService.js";
import { OPENAI_API_KEY, OPENAI_MODEL } from "../config/env.js";
import {
  buildContextText,
  extractKeywords,
  inferTopic,
  normalizeSenderEmail,
  type SuppressionRule
} from "./suppression.js";

type RuleOperation = "CREATE" | "UPDATE" | "DELETE";

interface ParsedRuleCommand {
  operation: RuleOperation;
  targetRuleId?: string | null;
  create?: {
    type: SuppressionRule["type"];
    senderEmail?: string | null;
    threadId?: string | null;
    topic?: string | null;
    keywords?: string[];
    threshold?: number | null;
  };
  update?: {
    isActive?: boolean | null;
    threshold?: number | null;
    topic?: string | null;
    keywords?: string[];
  };
  reason?: string;
}

export class RuleCommandService {
  constructor(
    private readonly ruleStore: SuppressionRuleStore,
    private readonly embeddingProvider: EmbeddingProvider | null
  ) {}

  async interpretAndApply(input: {
    userId: string;
    prompt: string;
    targetRuleId?: string;
  }): Promise<{
    operation: "created" | "updated" | "deleted";
    rule: SuppressionRule | null;
    message: string;
  }> {
    const trimmedPrompt = input.prompt.trim();
    if (!trimmedPrompt) {
      throw new Error("prompt is required.");
    }

    const rules = await this.ruleStore.listRules(input.userId);
    const parsed = await this.parseRuleCommand({
      prompt: trimmedPrompt,
      rules,
      targetRuleId: input.targetRuleId
    });

    if (parsed.operation === "DELETE") {
      const rule = this.resolveTargetRule(rules, parsed, input.targetRuleId, trimmedPrompt);
      if (!rule) {
        throw new Error("No matching rule found to delete.");
      }

      await this.ruleStore.deleteRule(input.userId, rule.id);
      return {
        operation: "deleted",
        rule: null,
        message: parsed.reason || `Deleted suppression rule ${rule.id}.`
      };
    }

    if (parsed.operation === "UPDATE") {
      const rule = this.resolveTargetRule(rules, parsed, input.targetRuleId, trimmedPrompt);
      if (!rule) {
        throw new Error("No matching rule found to update.");
      }

      const nextContext = { ...rule.context };
      if (parsed.update?.topic !== undefined && parsed.update.topic !== null) {
        nextContext.topic = parsed.update.topic;
      }
      if (parsed.update?.keywords && parsed.update.keywords.length > 0) {
        nextContext.keywords = parsed.update.keywords;
      }
      if (
        rule.type === "SENDER_AND_CONTEXT" &&
        this.embeddingProvider &&
        (parsed.update?.topic !== undefined || parsed.update?.keywords !== undefined)
      ) {
        const text = buildContextText({
          subject: nextContext.topic || "",
          snippet: (nextContext.keywords || []).join(" ")
        });
        if (text) {
          nextContext.embedding = await this.embeddingProvider.embedText(text);
        }
      }

      const updated = await this.ruleStore.updateRule(input.userId, rule.id, {
        isActive:
          parsed.update?.isActive !== undefined && parsed.update?.isActive !== null
            ? parsed.update.isActive
            : undefined,
        threshold:
          parsed.update?.threshold !== undefined && parsed.update?.threshold !== null
            ? parsed.update.threshold
            : undefined,
        context:
          nextContext.topic !== rule.context.topic ||
          JSON.stringify(nextContext.keywords || []) !== JSON.stringify(rule.context.keywords || []) ||
          nextContext.embedding !== rule.context.embedding
            ? nextContext
            : undefined
      });

      if (!updated) {
        throw new Error("Failed to update suppression rule.");
      }

      return {
        operation: "updated",
        rule: updated,
        message: parsed.reason || `Updated suppression rule ${updated.id}.`
      };
    }

    const create = parsed.create;
    if (!create) {
      throw new Error("Natural-language instruction did not produce a rule to create.");
    }

    if (create.type === "THREAD" && !create.threadId) {
      throw new Error("Thread rules require a threadId.");
    }

    if ((create.type === "SENDER" || create.type === "SENDER_AND_CONTEXT") && !create.senderEmail) {
      throw new Error("Sender-based rules require a sender email.");
    }

    const context = {
      topic: create.topic || undefined,
      keywords: create.keywords?.length ? create.keywords : undefined,
      embedding: undefined as number[] | undefined
    };

    if (create.type === "SENDER_AND_CONTEXT") {
      if (!this.embeddingProvider) {
        throw new Error("OPENAI_API_KEY is required for semantic suppression rules.");
      }

      const contextText = buildContextText({
        subject: create.topic || "",
        snippet: (create.keywords || []).join(" ")
      });
      if (contextText) {
        context.embedding = await this.embeddingProvider.embedText(contextText);
      }
    }

    const rule = await this.ruleStore.createRule({
      id: randomUUID(),
      userId: input.userId,
      type: create.type,
      senderEmail: create.senderEmail ? normalizeSenderEmail(create.senderEmail) : undefined,
      threadId: create.threadId || undefined,
      context,
      threshold:
        create.threshold !== undefined && create.threshold !== null ? create.threshold : undefined,
      isActive: true,
      createdAt: new Date().toISOString()
    });

    return {
      operation: "created",
      rule,
      message: parsed.reason || `Created suppression rule ${rule.id}.`
    };
  }

  private async parseRuleCommand(input: {
    prompt: string;
    rules: SuppressionRule[];
    targetRuleId?: string;
  }): Promise<ParsedRuleCommand> {
    if (OPENAI_API_KEY) {
      try {
        return await this.parseWithModel(input);
      } catch {
        return this.parseWithHeuristic(input.prompt, input.rules, input.targetRuleId);
      }
    }

    return this.parseWithHeuristic(input.prompt, input.rules, input.targetRuleId);
  }

  private async parseWithModel(input: {
    prompt: string;
    rules: SuppressionRule[];
    targetRuleId?: string;
  }): Promise<ParsedRuleCommand> {
    const model = new ChatOpenAI({
      apiKey: OPENAI_API_KEY,
      model: OPENAI_MODEL,
      temperature: 0
    });

    const ruleSummary = input.rules.slice(0, 25).map((rule) => ({
      id: rule.id,
      type: rule.type,
      senderEmail: rule.senderEmail || null,
      threadId: rule.threadId || null,
      topic: rule.context.topic || null,
      keywords: rule.context.keywords || [],
      isActive: rule.isActive,
      threshold: rule.threshold ?? null
    }));

    const response = await model.invoke([
      new SystemMessage(
        "You convert user suppression-rule instructions into strict JSON. Return only JSON."
      ),
      new HumanMessage(
        `Interpret this suppression rule instruction.\n` +
          `User prompt: ${input.prompt}\n` +
          `Selected rule id: ${input.targetRuleId || "none"}\n` +
          `Existing rules: ${JSON.stringify(ruleSummary)}\n\n` +
          `Return JSON with shape:\n` +
          `{"operation":"CREATE"|"UPDATE"|"DELETE","targetRuleId":string|null,"create":{"type":"SENDER"|"SENDER_AND_CONTEXT"|"THREAD","senderEmail":string|null,"threadId":string|null,"topic":string|null,"keywords":string[],"threshold":number|null}|null,"update":{"isActive":boolean|null,"threshold":number|null,"topic":string|null,"keywords":string[]}|null,"reason":string}`
      )
    ]);

    const text =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content.map((part) => (typeof part === "string" ? part : (part as { text?: string }).text || "")).join("\n")
          : String(response.content || "");

    return JSON.parse(text.trim()) as ParsedRuleCommand;
  }

  private parseWithHeuristic(
    prompt: string,
    rules: SuppressionRule[],
    targetRuleId?: string
  ): ParsedRuleCommand {
    const lower = prompt.toLowerCase();
    const email = prompt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null;
    const thresholdMatch = lower.match(/\b0?\.\d+\b/);
    const threshold = thresholdMatch ? Number(thresholdMatch[0]) : null;
    const keywords = extractKeywords(prompt);
    const topic = inferTopic(prompt, keywords) || null;

    if (lower.includes("delete") || lower.includes("remove")) {
      return {
        operation: "DELETE",
        targetRuleId: targetRuleId || this.findRuleIdByPrompt(rules, prompt, email),
        reason: "Deleted rule from natural-language instruction."
      };
    }

    if (
      lower.includes("disable") ||
      lower.includes("turn off") ||
      lower.includes("pause") ||
      lower.includes("enable") ||
      lower.includes("turn on") ||
      lower.includes("reactivate") ||
      threshold !== null ||
      targetRuleId
    ) {
      return {
        operation: "UPDATE",
        targetRuleId: targetRuleId || this.findRuleIdByPrompt(rules, prompt, email),
        update: {
          isActive:
            lower.includes("disable") || lower.includes("turn off") || lower.includes("pause")
              ? false
              : lower.includes("enable") || lower.includes("turn on") || lower.includes("reactivate")
                ? true
                : null,
          threshold,
          topic,
          keywords
        },
        reason: "Updated rule from natural-language instruction."
      };
    }

    return {
      operation: "CREATE",
      create: {
        type:
          lower.includes("all from") || lower.includes("sender only")
            ? "SENDER"
            : "SENDER_AND_CONTEXT",
        senderEmail: email,
        topic,
        keywords,
        threshold: lower.includes("strict") ? 0.9 : null
      },
      reason: "Created rule from natural-language instruction."
    };
  }

  private findRuleIdByPrompt(
    rules: SuppressionRule[],
    prompt: string,
    email: string | null
  ): string | null {
    if (email) {
      const bySender = rules.find((rule) => rule.senderEmail === normalizeSenderEmail(email));
      if (bySender) {
        return bySender.id;
      }
    }

    const lower = prompt.toLowerCase();
    const byTopic = rules.find((rule) => {
      const haystack = [
        rule.context.topic || "",
        ...(rule.context.keywords || []),
        rule.senderEmail || "",
        rule.threadId || ""
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(lower) || lower.includes(haystack);
    });

    return byTopic?.id || null;
  }

  private resolveTargetRule(
    rules: SuppressionRule[],
    parsed: ParsedRuleCommand,
    explicitTargetRuleId: string | undefined,
    prompt: string
  ): SuppressionRule | null {
    const targetRuleId = explicitTargetRuleId || parsed.targetRuleId || null;
    if (targetRuleId) {
      return rules.find((rule) => rule.id === targetRuleId) || null;
    }

    const email = prompt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null;
    const fallbackId = this.findRuleIdByPrompt(rules, prompt, email);
    return fallbackId ? rules.find((rule) => rule.id === fallbackId) || null : null;
  }
}
