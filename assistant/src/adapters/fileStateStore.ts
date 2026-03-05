import fs from "node:fs/promises";
import type { SourceCursor } from "../sources/types.js";

interface SourceState {
  cursor: SourceCursor;
  processed: Record<string, { processedAt: string; skipped?: boolean; reason?: string }>;
}

interface TelegramUiState {
  adminChatId?: string;
  lastUiUpdateId?: number;
  decisions?: Record<string, "important" | "ignored">;
}

interface UserState {
  lastEmailUpdateAt?: string;
  lastUpdateAtBySource?: {
    gmail?: string;
  };
}

export interface PersistedState {
  sources: Record<string, SourceState>;
  ui?: {
    telegram?: TelegramUiState;
  };
  user?: UserState;
}

const DEFAULT_STATE: PersistedState = {
  sources: {
    "gmail:primary": {
      cursor: { lastInternalDateMs: 0 },
      processed: {}
    }
  },
  ui: {
    telegram: {
      decisions: {}
    }
  },
  user: {}
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
    sources: {},
    ui: {
      telegram: {
        decisions: {}
      }
    },
    user: {}
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

  const telegramUi = input?.ui?.telegram;
  if (telegramUi && typeof telegramUi === "object") {
    next.ui = {
      telegram: {
        adminChatId:
          typeof telegramUi.adminChatId === "string" && telegramUi.adminChatId.trim()
            ? telegramUi.adminChatId
            : undefined,
        lastUiUpdateId:
          typeof telegramUi.lastUiUpdateId === "number" && Number.isFinite(telegramUi.lastUiUpdateId)
            ? telegramUi.lastUiUpdateId
            : undefined,
        decisions:
          telegramUi.decisions && typeof telegramUi.decisions === "object"
            ? telegramUi.decisions
            : {}
      }
    };
  }

  const user = input?.user;
  if (user && typeof user === "object") {
    next.user = {
      lastEmailUpdateAt:
        typeof user.lastEmailUpdateAt === "string" && user.lastEmailUpdateAt.trim()
          ? user.lastEmailUpdateAt
          : undefined,
      lastUpdateAtBySource: {
        gmail:
          typeof user.lastUpdateAtBySource?.gmail === "string" && user.lastUpdateAtBySource.gmail.trim()
            ? user.lastUpdateAtBySource.gmail
            : undefined
      }
    };
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

function ensureTelegramUiState(state: PersistedState): TelegramUiState {
  if (!state.ui) {
    state.ui = {};
  }

  if (!state.ui.telegram) {
    state.ui.telegram = {
      decisions: {}
    };
  }

  if (!state.ui.telegram.decisions) {
    state.ui.telegram.decisions = {};
  }

  return state.ui.telegram;
}

export function getTelegramAdminChatId(state: PersistedState): string | null {
  return ensureTelegramUiState(state).adminChatId || null;
}

export function setTelegramAdminChatId(state: PersistedState, chatId: string): void {
  ensureTelegramUiState(state).adminChatId = chatId;
}

export function getTelegramUiCursor(state: PersistedState): number {
  const value = ensureTelegramUiState(state).lastUiUpdateId;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function setTelegramUiCursor(state: PersistedState, lastUpdateId: number): void {
  if (!Number.isFinite(lastUpdateId) || lastUpdateId < 0) {
    return;
  }

  const current = getTelegramUiCursor(state);
  ensureTelegramUiState(state).lastUiUpdateId = Math.max(current, lastUpdateId);
}

export function setTelegramDecision(
  state: PersistedState,
  messageId: string,
  decision: "important" | "ignored"
): void {
  ensureTelegramUiState(state).decisions![messageId] = decision;
}

export function getTelegramDecision(
  state: PersistedState,
  messageId: string
): "important" | "ignored" | null {
  return ensureTelegramUiState(state).decisions?.[messageId] || null;
}

function ensureUserState(state: PersistedState): UserState {
  if (!state.user) {
    state.user = {};
  }

  if (!state.user.lastUpdateAtBySource) {
    state.user.lastUpdateAtBySource = {};
  }

  return state.user;
}

export function getLastEmailUpdateAt(state: PersistedState): string | null {
  return ensureUserState(state).lastEmailUpdateAt || null;
}

export function setLastEmailUpdateAt(state: PersistedState, isoTimestamp: string): void {
  const user = ensureUserState(state);
  user.lastEmailUpdateAt = isoTimestamp;
  user.lastUpdateAtBySource = {
    ...(user.lastUpdateAtBySource || {}),
    gmail: isoTimestamp
  };
}
