import fs from "node:fs/promises";
import path from "node:path";
import type { MessageStore, StoredMessageAssessment } from "../core/contracts.js";

export class FileMessageStore implements MessageStore {
  constructor(private readonly filePath: string) {}

  async saveAssessment(record: StoredMessageAssessment): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
}
