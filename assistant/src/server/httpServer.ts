import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import type { FeedbackStore, SuppressionRuleStore } from "../core/contracts.js";
import { FeedbackService } from "../core/feedbackService.js";
import type { EmbeddingProvider } from "../core/embeddingService.js";
import { OpenAIEmbeddingService } from "../core/embeddingService.js";
import { RuleCommandService } from "../core/ruleCommandService.js";
import {
  buildRuleSearchText,
  cosineSimilarity,
  type FeedbackMode,
  type SuppressionRule
} from "../core/suppression.js";
import { API_PORT, OPENAI_API_KEY } from "../config/env.js";
import { buildFeedbackStores } from "../runners/localPoll.js";

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_SUPPRESSION_PORT = API_PORT + 1;

export interface HttpServerDependencies {
  feedbackStore: FeedbackStore;
  suppressionRuleStore: SuppressionRuleStore;
  embeddingProvider: EmbeddingProvider | null;
}

function resolveHttpServerDependencies(
  dependencies?: Partial<HttpServerDependencies>
): HttpServerDependencies {
  const fallbackStores = buildFeedbackStores();

  return {
    feedbackStore: dependencies?.feedbackStore ?? fallbackStores.feedbackStore,
    suppressionRuleStore: dependencies?.suppressionRuleStore ?? fallbackStores.suppressionRuleStore,
    embeddingProvider:
      dependencies?.embeddingProvider ??
      (OPENAI_API_KEY ? new OpenAIEmbeddingService() : null)
  };
}

function parseMode(value: unknown): FeedbackMode {
  if (value === "SENDER_ONLY" || value === "SENDER_AND_CONTEXT" || value === "THREAD") {
    return value;
  }

  throw new Error("mode must be SENDER_ONLY, SENDER_AND_CONTEXT, or THREAD.");
}

function parseRouteId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] || "";
  }

  return value || "";
}

export function createSuppressionApiRouter(dependencies?: Partial<HttpServerDependencies>) {
  const resolved = resolveHttpServerDependencies(dependencies);
  const feedbackService = new FeedbackService(
    resolved.feedbackStore,
    resolved.suppressionRuleStore,
    resolved.embeddingProvider
  );
  const ruleCommandService = new RuleCommandService(
    resolved.suppressionRuleStore,
    resolved.embeddingProvider
  );
  const router = express.Router();

  async function searchRules(userId: string, query: string, includeInactive: boolean): Promise<Array<SuppressionRule & { searchScore: number }>> {
    const trimmed = query.trim();
    const rules = await resolved.suppressionRuleStore.listRules(userId);
    const filtered = includeInactive ? rules : rules.filter((rule) => rule.isActive);

    if (!trimmed) {
      return filtered.map((rule) => ({ ...rule, searchScore: 0 }));
    }

    const lower = trimmed.toLowerCase();
    const queryEmbedding =
      resolved.embeddingProvider && lower
        ? await resolved.embeddingProvider.embedText(trimmed)
        : null;

    return filtered
      .map((rule) => {
        let score = 0;
        const searchText = buildRuleSearchText(rule);
        if (searchText.includes(lower)) {
          score += 1;
        }

        for (const token of lower.split(/\s+/).filter(Boolean)) {
          if (searchText.includes(token)) {
            score += 0.25;
          }
        }

        if (queryEmbedding && rule.context.embedding?.length) {
          score += cosineSimilarity(queryEmbedding, rule.context.embedding);
        }

        return { ...rule, searchScore: score };
      })
      .filter((rule) => rule.searchScore > 0)
      .sort((left, right) => right.searchScore - left.searchScore || right.createdAt.localeCompare(left.createdAt));
  }

  router.post("/api/feedback/not-interested", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const body = (request.body || {}) as {
        userId?: string;
        messageId?: string;
        mode?: FeedbackMode;
        senderEmail?: string;
        threadId?: string;
        subject?: string;
        snippet?: string;
        bodyText?: string;
      };

      if (!body.userId || !body.messageId || !body.senderEmail) {
        response.status(400).json({ error: "userId, messageId, and senderEmail are required." });
        return;
      }

      let mode: FeedbackMode;
      try {
        mode = parseMode(body.mode);
      } catch (error) {
        response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }

      const result = await feedbackService.recordNotInterested({
        userId: body.userId,
        messageId: body.messageId,
        mode,
        senderEmail: body.senderEmail,
        threadId: body.threadId,
        subject: body.subject,
        snippet: body.snippet,
        bodyText: body.bodyText
      });

      response.status(200).json({ ok: true, ruleId: result.rule.id });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/rules", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const userId = typeof request.query.userId === "string" ? request.query.userId : "";
      if (!userId) {
        response.status(400).json({ error: "userId is required." });
        return;
      }

      const includeInactive = request.query.includeInactive === "true";
      const query = typeof request.query.q === "string" ? request.query.q : "";
      const rules = query.trim()
        ? await searchRules(userId, query, includeInactive)
        : (await resolved.suppressionRuleStore.listRules(userId))
            .filter((rule) => includeInactive || rule.isActive)
            .map((rule) => ({ ...rule, searchScore: 0 }));
      response.status(200).json({ items: rules });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/rules", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const body = (request.body || {}) as {
        userId?: string;
        prompt?: string;
        targetRuleId?: string;
      };

      if (!body.userId || !body.prompt) {
        response.status(400).json({ error: "userId and prompt are required." });
        return;
      }

      const result = await ruleCommandService.interpretAndApply({
        userId: body.userId,
        prompt: body.prompt,
        targetRuleId: body.targetRuleId
      });

      response.status(200).json({
        ok: true,
        operation: result.operation,
        item: result.rule,
        message: result.message
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/rules/:id", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const userId = typeof request.body?.userId === "string" ? request.body.userId : "";
      if (!userId) {
        response.status(400).json({ error: "userId is required." });
        return;
      }

      const nextRule = await resolved.suppressionRuleStore.updateRule(userId, parseRouteId(request.params.id), {
        isActive:
          typeof request.body?.isActive === "boolean" ? request.body.isActive : undefined,
        threshold:
          typeof request.body?.threshold === "number" ? request.body.threshold : undefined
      });

      if (!nextRule) {
        response.status(404).json({ error: "Rule not found." });
        return;
      }

      response.status(200).json({ ok: true, item: nextRule });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/rules/:id", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const userId = typeof request.query.userId === "string" ? request.query.userId : "";
      if (!userId) {
        response.status(400).json({ error: "userId is required." });
        return;
      }

      await resolved.suppressionRuleStore.deleteRule(userId, parseRouteId(request.params.id));
      response.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);
    response.status(500).json({ error: message });
  });

  return router;
}

export function createHttpServer(dependencies?: Partial<HttpServerDependencies>) {
  const app = express();

  app.use(express.json());
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (_request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }

    next();
  });

  app.get("/health", (_request: Request, response: Response) => {
    response.status(200).json({ ok: true });
  });

  app.use(createSuppressionApiRouter(dependencies));

  return app;
}

export function startHttpServer(port: number, dependencies?: Partial<HttpServerDependencies>): http.Server {
  const app = createHttpServer(dependencies);
  return app.listen(port, () => {
    console.log(`Assura suppression API listening on http://localhost:${port}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startHttpServer(DEFAULT_SUPPRESSION_PORT);
}
