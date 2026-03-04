import type { Collection } from "mongodb";
import type { SuppressionRuleStore } from "../core/contracts.js";
import type { SuppressionRule } from "../core/suppression.js";
import { getMongoDb } from "./mongoClient.js";

export class MongoSuppressionRuleStore implements SuppressionRuleStore {
  private collectionPromise: Promise<Collection<SuppressionRule>> | null = null;

  private async getCollection(): Promise<Collection<SuppressionRule>> {
    if (!this.collectionPromise) {
      this.collectionPromise = (async () => {
        const db = await getMongoDb();
        const collection = db.collection<SuppressionRule>("suppression_rules");
        await Promise.all([
          collection.createIndex({ userId: 1, senderEmail: 1 }),
          collection.createIndex({ userId: 1, threadId: 1 }),
          collection.createIndex({ userId: 1, isActive: 1 })
        ]);
        return collection;
      })();
    }

    return this.collectionPromise;
  }

  async createRule(rule: SuppressionRule): Promise<SuppressionRule> {
    const collection = await this.getCollection();
    await collection.insertOne(rule);
    return rule;
  }

  async listRules(userId: string): Promise<SuppressionRule[]> {
    const collection = await this.getCollection();
    return collection.find({ userId }).sort({ createdAt: -1 }).toArray();
  }

  async getRuleById(userId: string, ruleId: string): Promise<SuppressionRule | null> {
    const collection = await this.getCollection();
    return collection.findOne({ userId, id: ruleId });
  }

  async updateRule(
    userId: string,
    ruleId: string,
    updates: Partial<Pick<SuppressionRule, "threshold" | "isActive" | "context">>
  ): Promise<SuppressionRule | null> {
    const collection = await this.getCollection();
    const nextUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined)
    );

    if (Object.keys(nextUpdates).length === 0) {
      return this.getRuleById(userId, ruleId);
    }

    const result = await collection.findOneAndUpdate(
      { userId, id: ruleId },
      { $set: nextUpdates },
      { returnDocument: "after" }
    );
    return result || null;
  }

  async deleteRule(userId: string, ruleId: string): Promise<void> {
    const collection = await this.getCollection();
    await collection.deleteOne({ userId, id: ruleId });
  }
}
