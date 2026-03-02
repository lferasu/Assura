import fs from "node:fs/promises";

const DEFAULT_STATE = {
  sources: {
    "gmail:primary": {
      cursor: { lastInternalDateMs: 0 },
      processed: {}
    }
  }
};

export async function loadState(statePath) {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.sources?.["gmail:primary"]) return structuredClone(DEFAULT_STATE);
    return parsed;
  } catch {
    await saveState(statePath, DEFAULT_STATE);
    return structuredClone(DEFAULT_STATE);
  }
}

export async function saveState(statePath, state) {
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function isProcessed(state, messageId) {
  return Boolean(state.sources["gmail:primary"].processed[messageId]);
}

export function markProcessed(state, messageId, meta = {}) {
  state.sources["gmail:primary"].processed[messageId] = {
    processedAt: new Date().toISOString(),
    ...meta
  };
}

export function updateCursor(state, lastInternalDateMs) {
  const cursor = state.sources["gmail:primary"].cursor;
  cursor.lastInternalDateMs = Math.max(cursor.lastInternalDateMs || 0, lastInternalDateMs || 0);
}
