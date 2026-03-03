import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChromaClient } from "chromadb";
import { ChromaMessageStore } from "../adapters/chromaMessageStore.js";
import { CHROMA_COLLECTION, CHROMA_URL } from "../config/env.js";
import type { StoredMessageAssessment } from "../core/contracts.js";

function createChromaClient(): ChromaClient {
  const url = new URL(CHROMA_URL);
  const isHttps = url.protocol === "https:";
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80;

  return new ChromaClient({
    host: url.hostname,
    port,
    ssl: isHttps
  });
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
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

async function removeSmokeTestRecord(): Promise<void> {
  const client = createChromaClient();
  const collection = await client.getOrCreateCollection({ name: CHROMA_COLLECTION });
  await collection.delete({
    ids: ["codex-smoke-test"]
  });
}

async function main(): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "../../");
  const assessmentsPath = path.join(projectRoot, "data/message-assessments.jsonl");

  const records = await readJsonLines<StoredMessageAssessment>(assessmentsPath);
  if (records.length === 0) {
    console.log("No stored message assessments found to backfill.");
    return;
  }

  await removeSmokeTestRecord();

  const store = new ChromaMessageStore();
  for (const record of records) {
    await store.saveAssessment(record);
  }

  console.log(`Backfilled ${records.length} record(s) into Chroma collection '${CHROMA_COLLECTION}'.`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Chroma backfill failed:", message);
  process.exitCode = 1;
});
