import fs from "node:fs/promises";

interface SourceState {
  cursor: {
    lastInternalDateMs: number;
  };
  processed: Record<string, { processedAt: string; skipped?: boolean; reason?: string }>;
}

export interface PersistedState {
  sources: {
    "gmail:primary": SourceState;
  };
}

const DEFAULT_STATE: PersistedState = {
  sources: {
    "gmail:primary": {
      cursor: { lastInternalDateMs: 0 },
      processed: {}
    }
  }
};

export async function loadState(statePath: string): Promise<PersistedState> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed.sources?.["gmail:primary"]) return structuredClone(DEFAULT_STATE);
    return parsed;
  } catch {
    await saveState(statePath, DEFAULT_STATE);
    return structuredClone(DEFAULT_STATE);
  }
}

export async function saveState(statePath: string, state: PersistedState): Promise<void> {
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function isProcessed(state: PersistedState, messageId: string): boolean {
  return Boolean(state.sources["gmail:primary"].processed[messageId]);
}

export function markProcessed(
  state: PersistedState,
  messageId: string,
  meta: { skipped?: boolean; reason?: string } = {}
): void {
  state.sources["gmail:primary"].processed[messageId] = {
    processedAt: new Date().toISOString(),
    ...meta
  };
}

export function updateCursor(state: PersistedState, lastInternalDateMs: number): void {
  const cursor = state.sources["gmail:primary"].cursor;
  cursor.lastInternalDateMs = Math.max(cursor.lastInternalDateMs || 0, lastInternalDateMs || 0);
}
