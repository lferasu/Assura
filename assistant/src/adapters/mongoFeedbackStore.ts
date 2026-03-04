import type { Collection } from "mongodb";
import type { FeedbackStore } from "../core/contracts.js";
import type { FeedbackEvent } from "../core/suppression.js";
import { getMongoDb } from "./mongoClient.js";

export class MongoFeedbackStore implements FeedbackStore {
  private collectionPromise: Promise<Collection<FeedbackEvent>> | null = null;

  private async getCollection(): Promise<Collection<FeedbackEvent>> {
    if (!this.collectionPromise) {
      this.collectionPromise = (async () => {
        const db = await getMongoDb();
        const collection = db.collection<FeedbackEvent>("feedback_events");
        await collection.createIndex({ userId: 1, createdAt: -1 });
        return collection;
      })();
    }

    return this.collectionPromise;
  }

  async appendEvent(event: FeedbackEvent): Promise<void> {
    const collection = await this.getCollection();
    await collection.insertOne(event);
  }
}
