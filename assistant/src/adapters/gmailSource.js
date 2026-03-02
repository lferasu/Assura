import fs from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

function getHeader(headers, name) {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodeBase64Url(input) {
  if (!input) return "";
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function stripHtml(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTextFromPayload(payload) {
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

async function loadOAuthClient(projectRoot) {
  const credentialsPath = path.join(projectRoot, "credentials.json");
  const tokenPath = path.join(projectRoot, "token.json");

  const credentialsRaw = await fs.readFile(credentialsPath, "utf8");
  const credentials = JSON.parse(credentialsRaw);
  const config = credentials.installed || credentials.web;

  const client = new google.auth.OAuth2(config.client_id, config.client_secret, config.redirect_uris[0]);

  try {
    const tokenRaw = await fs.readFile(tokenPath, "utf8");
    client.setCredentials(JSON.parse(tokenRaw));
  } catch {
    const authUrl = client.generateAuthUrl({ access_type: "offline", scope: SCOPES });
    console.log("Authorize this app by visiting this URL:", authUrl);
    throw new Error("token.json missing. Complete OAuth flow and save token.json in project root.");
  }

  return client;
}

export async function fetchGmailMessages({ projectRoot, maxMessages, lastInternalDateMs }) {
  const auth = await loadOAuthClient(projectRoot);
  const gmail = google.gmail({ version: "v1", auth });

  const query = lastInternalDateMs > 0 ? `after:${Math.floor(lastInternalDateMs / 1000)}` : undefined;

  const listRes = await gmail.users.messages.list({
    userId: "me",
    maxResults: maxMessages,
    q: query
  });

  const messageRefs = listRes.data.messages || [];
  const out = [];

  for (const ref of messageRefs) {
    const msgRes = await gmail.users.messages.get({
      userId: "me",
      id: ref.id,
      format: "full"
    });

    const msg = msgRes.data;
    const headers = msg.payload?.headers || [];
    const bodyText = extractTextFromPayload(msg.payload);

    out.push({
      source: "gmail",
      accountId: "primary",
      messageId: msg.id,
      threadId: msg.threadId || null,
      from: getHeader(headers, "From"),
      subject: getHeader(headers, "Subject"),
      sentAt: new Date(Number(msg.internalDate || Date.now())).toISOString(),
      bodyText,
      internalDateMs: Number(msg.internalDate || 0)
    });
  }

  out.sort((a, b) => a.internalDateMs - b.internalDateMs);
  return out;
}
