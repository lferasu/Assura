import fs from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";
import {
  createNormalizedMessage,
  type NormalizedMessage
} from "../core/message.js";
import type { MessageSourceAdapter } from "../sources/types.js";
import type { FetchResult, SourceCursor } from "../sources/types.js";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

type GmailHeader = { name?: string | null; value?: string | null };
type GmailPayload = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  headers?: GmailHeader[] | null;
  parts?: GmailPayload[] | null;
} | null;

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function extractSenderId(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/<([^>]+)>/);
  if (match?.[1]) {
    return match[1].trim();
  }

  return trimmed || "gmail:unknown";
}

function decodeBase64Url(input: string | null | undefined): string {
  if (!input) return "";
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTextFromPayload(payload: GmailPayload): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    return stripHtml(decodeBase64Url(payload.body.data));
  }

  for (const part of payload.parts || []) {
    const text = extractTextFromPayload(part);
    if (text) return text;
  }

  return "";
}

async function loadOAuthClient(projectRoot: string) {
  const credentialsPath = path.join(projectRoot, "credentials.json");
  const tokenPath = path.join(projectRoot, "token.json");

  const credentialsRaw = await fs.readFile(credentialsPath, "utf8");
  const credentials = JSON.parse(credentialsRaw) as {
    installed?: { client_id: string; client_secret: string; redirect_uris: string[] };
    web?: { client_id: string; client_secret: string; redirect_uris: string[] };
  };
  const config = credentials.installed || credentials.web;

  if (!config) {
    throw new Error("credentials.json is missing installed/web OAuth client config.");
  }

  const client = new google.auth.OAuth2(config.client_id, config.client_secret, config.redirect_uris[0]);

  try {
    const tokenRaw = await fs.readFile(tokenPath, "utf8");
    const parsed = JSON.parse(tokenRaw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("token.json must contain a JSON object.");
    }
    client.setCredentials(parsed);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      const authUrl = client.generateAuthUrl({ access_type: "offline", scope: SCOPES });
      console.log("Authorize this app by visiting this URL:", authUrl);
      throw new Error("token.json missing. Complete OAuth flow and save token.json in project root.");
    }

    if (error instanceof SyntaxError) {
      throw new Error("token.json is not valid JSON. Re-run OAuth setup and regenerate the token file.");
    }

    if (error instanceof Error) {
      throw new Error(`Unable to load token.json: ${error.message}`);
    }

    const authUrl = client.generateAuthUrl({ access_type: "offline", scope: SCOPES });
    console.log("Authorize this app by visiting this URL:", authUrl);
    throw new Error("Unable to load token.json.");
  }

  return client;
}

function asLastInternalDateMs(cursor: SourceCursor): number {
  const raw = cursor.lastInternalDateMs;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

export async function fetchGmailMessages({
  projectRoot,
  maxMessages,
  lastInternalDateMs
}: {
  projectRoot: string;
  maxMessages: number;
  lastInternalDateMs: number;
}): Promise<{ messages: NormalizedMessage[]; nextCursor: { lastInternalDateMs: number } }> {
  const auth = await loadOAuthClient(projectRoot);
  const gmail = google.gmail({ version: "v1", auth });

  const query = lastInternalDateMs > 0 ? `after:${Math.floor(lastInternalDateMs / 1000)}` : undefined;

  const listRes = await gmail.users.messages.list({
    userId: "me",
    maxResults: maxMessages,
    q: query
  });

  const messageRefs = listRes.data.messages || [];
  const out: Array<{ message: NormalizedMessage; internalDateMs: number }> = [];
  let maxInternalDateMs = lastInternalDateMs;

  for (const ref of messageRefs) {
    if (!ref.id) continue;

    const msgRes = await gmail.users.messages.get({
      userId: "me",
      id: ref.id,
      format: "full"
    });

    const msg = msgRes.data;
    const headers = (msg.payload?.headers as GmailHeader[] | undefined) || [];
    const bodyText = extractTextFromPayload(msg.payload as GmailPayload);

    if (!msg.id) continue;

    const internalDateMs = Number(msg.internalDate || 0);
    const senderName = getHeader(headers, "From");
    const threadId = msg.threadId || msg.id;

    out.push({
      message: createNormalizedMessage({
        source: "gmail",
        accountId: "primary",
        externalId: msg.id,
        conversationId: threadId,
        senderId: extractSenderId(senderName),
        senderName: senderName || undefined,
        subject: getHeader(headers, "Subject") || undefined,
        bodyText,
        receivedAt: new Date(Number(msg.internalDate || Date.now())).toISOString(),
        raw: msg
      }),
      internalDateMs
    });
    maxInternalDateMs = Math.max(maxInternalDateMs, internalDateMs);
  }

  out.sort((a, b) => a.internalDateMs - b.internalDateMs);
  return {
    messages: out.map((item) => item.message),
    nextCursor: { lastInternalDateMs: maxInternalDateMs }
  };
}

export class GmailSourceAdapter implements MessageSourceAdapter {
  constructor(
    private readonly input: {
      projectRoot: string;
      maxMessages: number;
    }
  ) {}

  key(): string {
    return "gmail:primary";
  }

  async fetchNew(cursor: SourceCursor): Promise<FetchResult> {
    return fetchGmailMessages({
      projectRoot: this.input.projectRoot,
      maxMessages: this.input.maxMessages,
      lastInternalDateMs: asLastInternalDateMs(cursor)
    });
  }
}
