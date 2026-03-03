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

function readNumberEnv(name: string, fallback: number): number {
  const value = readEnv(name);
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid number.`);
  }

  return parsed;
}

export const OPENAI_API_KEY = readRequiredEnv("OPENAI_API_KEY");
export const OPENAI_MODEL = readEnv("OPENAI_MODEL") ?? "gpt-4.1-mini";
export const POLL_INTERVAL_SECONDS = readNumberEnv("POLL_INTERVAL_SECONDS", 120);
export const GMAIL_MAX_MESSAGES = readNumberEnv("GMAIL_MAX_MESSAGES", 15);

