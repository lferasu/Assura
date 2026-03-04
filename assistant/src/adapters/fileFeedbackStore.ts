import fs from "node:fs/promises";
import path from "node:path";
import type { FeedbackStore } from "../core/contracts.js";
import type { FeedbackEvent } from "../core/suppression.js";

export class FileFeedbackStore implements FeedbackStore {
  constructor(private readonly filePath: string) {}

  async appendEvent(event: FeedbackEvent): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }
}
