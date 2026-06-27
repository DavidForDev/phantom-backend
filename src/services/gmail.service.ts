import { google, type gmail_v1 } from "googleapis";
import { getAuthorizedClient } from "../lib/gmail-oauth";
import type { GmailMessageFull, GmailMessageSummary } from "../types/gmail.types";

async function client(): Promise<gmail_v1.Gmail> {
  const auth = await getAuthorizedClient();
  // @ts-expect-error googleapis version mismatch between OAuth2Client types
  return google.gmail({ version: "v1", auth });
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  const h = headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  // Prefer text/plain, fall back to text/html, then any nested part.
  const findPart = (
    part: gmail_v1.Schema$MessagePart,
    mime: string
  ): gmail_v1.Schema$MessagePart | undefined => {
    if (part.mimeType === mime && part.body?.data) return part;
    for (const sub of part.parts ?? []) {
      const found = findPart(sub, mime);
      if (found) return found;
    }
    return undefined;
  };

  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);

  const html = findPart(payload, "text/html");
  if (html?.body?.data) {
    return decodeBase64Url(html.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}

function toSummary(msg: gmail_v1.Schema$Message): GmailMessageSummary {
  const headers = msg.payload?.headers;
  return {
    id: msg.id ?? "",
    threadId: msg.threadId ?? "",
    from: header(headers, "From"),
    to: header(headers, "To"),
    subject: header(headers, "Subject"),
    date: header(headers, "Date"),
    snippet: msg.snippet ?? "",
  };
}

export async function listMessages(opts: {
  query?: string;
  max?: number;
}): Promise<GmailMessageSummary[]> {
  const gmail = await client();
  const maxResults = Math.min(Math.max(opts.max ?? 5, 1), 25);

  const list = await gmail.users.messages.list({
    userId: "me",
    q: opts.query,
    maxResults,
  });

  const ids = list.data.messages?.map((m) => m.id).filter((x): x is string => !!x) ?? [];
  if (ids.length === 0) return [];

  const fetched = await Promise.all(
    ids.map((id) =>
      gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      })
    )
  );

  return fetched.map((r) => toSummary(r.data));
}

export async function getMessage(id: string): Promise<GmailMessageFull> {
  const gmail = await client();
  const res = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
  });
  const summary = toSummary(res.data);
  const body = extractBody(res.data.payload ?? undefined);
  return { ...summary, body: body.slice(0, 8000) };
}

export default { listMessages, getMessage };
