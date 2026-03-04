import type { Collection } from "mongodb";
import type { StoredSuppressedMessage, SuppressedMessageStore } from "../core/contracts.js";
import { getMongoDb } from "./mongoClient.js";

export class MongoSuppressedMessageStore implements SuppressedMessageStore {
  private collectionPromise: Promise<Collection<StoredSuppressedMessage>> | null = null;

  private async getCollection(): Promise<Collection<StoredSuppressedMessage>> {
    if (!this.collectionPromise) {
      this.collectionPromise = (async () => {
        const db = await getMongoDb();
        const collection = db.collection<StoredSuppressedMessage>("suppressed_messages");
        await collection.createIndex({ userId: 1, storedAt: -1 });
        return collection;
      })();
    }

    return this.collectionPromise;
  }

  async saveSuppressed(record: StoredSuppressedMessage): Promise<void> {
    const collection = await this.getCollection();
    await collection.insertOne(record);
  }
}
