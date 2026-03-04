import fs from "node:fs/promises";
import path from "node:path";
import type { StoredSuppressedMessage, SuppressedMessageStore } from "../core/contracts.js";

export class FileSuppressedMessageStore implements SuppressedMessageStore {
  constructor(private readonly filePath: string) {}

  async saveSuppressed(record: StoredSuppressedMessage): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
}
