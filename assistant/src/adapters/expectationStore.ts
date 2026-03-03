import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

export interface Expectation {
  id: string;
  query: string;
  createdAt: string;
  lastAcknowledgedMessageId: string | null;
  lastAcknowledgedAt: string | null;
}

async function readExpectationFile(filePath: string): Promise<Expectation[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Expectation[]) : [];
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

async function writeExpectationFile(filePath: string, expectations: Expectation[]): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(expectations, null, 2)}\n`, "utf8");
}

export async function listExpectations(filePath: string): Promise<Expectation[]> {
  const expectations = await readExpectationFile(filePath);
  return expectations.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createExpectation(filePath: string, query: string): Promise<Expectation> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Expectation query is required.");
  }

  const expectations = await readExpectationFile(filePath);
  const record: Expectation = {
    id: randomUUID(),
    query: trimmed,
    createdAt: new Date().toISOString(),
    lastAcknowledgedMessageId: null,
    lastAcknowledgedAt: null
  };

  expectations.push(record);
  await writeExpectationFile(filePath, expectations);
  return record;
}

export async function deleteExpectation(filePath: string, expectationId: string): Promise<void> {
  const expectations = await readExpectationFile(filePath);
  await writeExpectationFile(
    filePath,
    expectations.filter((item) => item.id !== expectationId)
  );
}

export async function acknowledgeExpectation(
  filePath: string,
  expectationId: string,
  messageId: string,
  matchedAt: string
): Promise<void> {
  const expectations = await readExpectationFile(filePath);
  const next = expectations.map((item) =>
    item.id === expectationId
      ? {
          ...item,
          lastAcknowledgedMessageId: messageId,
          lastAcknowledgedAt: matchedAt
        }
      : item
  );

  await writeExpectationFile(filePath, next);
}
