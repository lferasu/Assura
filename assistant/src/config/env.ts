import dotenv from "dotenv";

dotenv.config();

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function readRequiredEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function requireEnv(name: string): string {
  return readRequiredEnv(name);
}

function readNumberEnv(name: string, fallback: number): number {
  const value = readEnv(name);
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid number.`);
  }

  return parsed;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = readEnv(name);
  if (!value) return fallback;

  const normalized = value.toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;

  throw new Error(`Environment variable ${name} must be a boolean value.`);
}

export const OPENAI_API_KEY = readEnv("OPENAI_API_KEY") ?? "";
export const OPENAI_MODEL = readEnv("OPENAI_MODEL") ?? "gpt-4.1-mini";
export const EMBEDDING_MODEL = readEnv("EMBEDDING_MODEL") ?? "text-embedding-3-small";
export const POLL_INTERVAL_SECONDS = readNumberEnv("POLL_INTERVAL_SECONDS", 120);
export const TELEGRAM_UI_POLL_INTERVAL_SECONDS = readNumberEnv("TELEGRAM_UI_POLL_INTERVAL_SECONDS", 3);
export const GMAIL_MAX_MESSAGES = readNumberEnv("GMAIL_MAX_MESSAGES", 15);
export const API_PORT = readNumberEnv("API_PORT", 8787);
export const CHROMA_ENABLED = readBooleanEnv("CHROMA_ENABLED", false);
export const CHROMA_URL = readEnv("CHROMA_URL") ?? "http://127.0.0.1:8000";
export const CHROMA_COLLECTION = readEnv("CHROMA_COLLECTION") ?? "assura_messages";
export const CHROMA_EMBEDDING_MODEL = readEnv("CHROMA_EMBEDDING_MODEL") ?? "text-embedding-3-small";
export const MONGODB_URI = readEnv("MONGODB_URI");
export const TELEGRAM_BOT_TOKEN = readEnv("TELEGRAM_BOT_TOKEN");
