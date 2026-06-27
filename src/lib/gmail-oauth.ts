import { promises as fs } from "fs";
import path from "path";
import { google, type Auth } from "googleapis";
import config from "./config.js";
import Logger from "./logger.js";

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

function tokenPath() {
  return path.resolve(process.cwd(), config.GMAIL_TOKEN_PATH);
}

export function makeOAuthClient(): Auth.OAuth2Client {
  if (!config.GMAIL_CLIENT_ID || !config.GMAIL_CLIENT_SECRET) {
    throw new Error(
      "Gmail OAuth not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in backend/.env"
    );
  }
  // @ts-expect-error googleapis version mismatch between OAuth2Client types
  return new google.auth.OAuth2(
    config.GMAIL_CLIENT_ID,
    config.GMAIL_CLIENT_SECRET,
    config.GMAIL_REDIRECT_URI
  );
}

export async function saveToken(token: Auth.Credentials): Promise<void> {
  const p = tokenPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(token, null, 2), "utf8");
  Logger.info(`[gmail] token saved to ${p}`);
}

export async function loadToken(): Promise<Auth.Credentials | null> {
  try {
    const raw = await fs.readFile(tokenPath(), "utf8");
    return JSON.parse(raw) as Auth.Credentials;
  } catch {
    return null;
  }
}

export async function getAuthorizedClient(): Promise<Auth.OAuth2Client> {
  const token = await loadToken();
  if (!token) {
    throw new Error("Gmail not authorized. Visit /gmail/auth to connect your account.");
  }
  const client = makeOAuthClient();
  client.setCredentials(token);
  client.on("tokens", (next) => {
    saveToken({ ...token, ...next }).catch((e) =>
      Logger.warn("[gmail] failed to persist refreshed token", e)
    );
  });
  return client;
}
