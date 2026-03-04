import fs from "node:fs/promises";
import path from "node:path";
import type { SuppressionRuleStore } from "../core/contracts.js";
import type { SuppressionRule } from "../core/suppression.js";

async function readRules(filePath: string): Promise<SuppressionRule[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SuppressionRule);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }
}

async function writeRules(filePath: string, rules: SuppressionRule[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lines = rules.map((rule) => JSON.stringify(rule)).join("\n");
  await fs.writeFile(filePath, lines ? `${lines}\n` : "", "utf8");
}

export class FileSuppressionRuleStore implements SuppressionRuleStore {
  constructor(private readonly filePath: string) {}

  async createRule(rule: SuppressionRule): Promise<SuppressionRule> {
    const rules = await readRules(this.filePath);
    rules.push(rule);
    await writeRules(this.filePath, rules);
    return rule;
  }

  async listRules(userId: string): Promise<SuppressionRule[]> {
    const rules = await readRules(this.filePath);
    return rules
      .filter((rule) => rule.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getRuleById(userId: string, ruleId: string): Promise<SuppressionRule | null> {
    const rules = await readRules(this.filePath);
    return rules.find((rule) => rule.userId === userId && rule.id === ruleId) || null;
  }

  async updateRule(
    userId: string,
    ruleId: string,
    updates: Partial<Pick<SuppressionRule, "threshold" | "isActive" | "context">>
  ): Promise<SuppressionRule | null> {
    const rules = await readRules(this.filePath);
    let updatedRule: SuppressionRule | null = null;

    const next = rules.map((rule) => {
      if (rule.userId !== userId || rule.id !== ruleId) {
        return rule;
      }

      updatedRule = {
        ...rule,
        ...("threshold" in updates ? { threshold: updates.threshold } : {}),
        ...("isActive" in updates ? { isActive: updates.isActive ?? rule.isActive } : {}),
        ...("context" in updates ? { context: updates.context ?? rule.context } : {})
      };

      return updatedRule;
    });

    await writeRules(this.filePath, next);
    return updatedRule;
  }

  async deleteRule(userId: string, ruleId: string): Promise<void> {
    const rules = await readRules(this.filePath);
    await writeRules(
      this.filePath,
      rules.filter((rule) => !(rule.userId === userId && rule.id === ruleId))
    );
  }
}
