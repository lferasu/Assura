import fs from "node:fs/promises";
import path from "node:path";
import type { ActionStore, StoredActionBatch } from "../core/contracts.js";

export class FileActionStore implements ActionStore {
  constructor(private readonly filePath: string) {}

  async savePlannedActions(record: StoredActionBatch): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
}
