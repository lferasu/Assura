import fs from "node:fs/promises";
import type { SourceCursor } from "../sources/types.js";

interface SourceState {
  cursor: SourceCursor;
  processed: Record<string, { processedAt: string; skipped?: boolean; reason?: string }>;
}

export interface PersistedState {
  sources: Record<string, SourceState>;
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
    return normalizeStateShape(parsed);
  } catch {
    await saveState(statePath, DEFAULT_STATE);
    return structuredClone(DEFAULT_STATE);
  }
}

export async function saveState(statePath: string, state: PersistedState): Promise<void> {
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function normalizeStateShape(input: PersistedState): PersistedState {
  const next: PersistedState = {
    sources: {}
  };

  const entries = Object.entries(input?.sources || {});
  for (const [key, value] of entries) {
    next.sources[key] = {
      cursor:
        value && typeof value.cursor === "object" && value.cursor !== null
          ? value.cursor
          : {},
      processed:
        value && typeof value.processed === "object" && value.processed !== null
          ? value.processed
          : {}
    };
  }

  if (!next.sources["gmail:primary"]) {
    next.sources["gmail:primary"] = structuredClone(DEFAULT_STATE.sources["gmail:primary"]);
  }

  return next;
}

function ensureSourceState(state: PersistedState, sourceKey: string): SourceState {
  if (!state.sources[sourceKey]) {
    state.sources[sourceKey] = {
      cursor: {},
      processed: {}
    };
  }

  return state.sources[sourceKey];
}

export function getSourceCursor(state: PersistedState, sourceKey: string): SourceCursor {
  return ensureSourceState(state, sourceKey).cursor;
}

export function setSourceCursor(state: PersistedState, sourceKey: string, cursor: SourceCursor): void {
  ensureSourceState(state, sourceKey).cursor = cursor;
}

export function isProcessed(state: PersistedState, sourceKey: string, externalId: string): boolean {
  return Boolean(ensureSourceState(state, sourceKey).processed[externalId]);
}

export function markProcessed(
  state: PersistedState,
  sourceKey: string,
  externalId: string,
  meta: { skipped?: boolean; reason?: string } = {}
): void {
  ensureSourceState(state, sourceKey).processed[externalId] = {
    processedAt: new Date().toISOString(),
    ...meta
  };
}
