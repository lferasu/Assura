import type { MessageStore, StoredMessageAssessment } from "../core/contracts.js";

export class CompositeMessageStore implements MessageStore {
  constructor(private readonly stores: MessageStore[]) {}

  async saveAssessment(record: StoredMessageAssessment): Promise<void> {
    for (const store of this.stores) {
      await store.saveAssessment(record);
    }
  }
}
