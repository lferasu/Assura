import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { logger } from "../observability/logger.js";

type OAuthConfig = {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
};
const oauthLogger = logger.child({ component: "oauth_token" });

function extractCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Missing authorization code. Pass the Google OAuth code or the full redirect URL.");
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    if (!code) {
      throw new Error("No 'code' query parameter found in the provided URL.");
    }
    return code;
  }

  return trimmed;
}

async function loadOAuthConfig(projectRoot: string): Promise<OAuthConfig> {
  const credentialsPath = path.join(projectRoot, "credentials.json");
  const credentialsRaw = await fs.readFile(credentialsPath, "utf8");
  const credentials = JSON.parse(credentialsRaw) as {
    installed?: OAuthConfig;
    web?: OAuthConfig;
  };

  const config = credentials.installed || credentials.web;
  if (!config) {
    throw new Error("credentials.json is missing installed/web OAuth client config.");
  }

  return config;
}

async function main(): Promise<void> {
  const input = process.argv.slice(2).join(" ");
  const code = extractCode(input);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "../../");

  const config = await loadOAuthConfig(projectRoot);
  const client = new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    config.redirect_uris[0]
  );

  const { tokens } = await client.getToken(code);
  const tokenPath = path.join(projectRoot, "token.json");

  await fs.writeFile(tokenPath, `${JSON.stringify(tokens, null, 2)}\n`, "utf8");

  oauthLogger.info("oauth.token_saved", "Saved OAuth token", { tokenPath });
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  oauthLogger.error("oauth.setup_failed", "OAuth setup failed", { error: message });
  process.exitCode = 1;
});
