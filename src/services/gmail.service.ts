import { google, type gmail_v1 } from "googleapis";
import { getAuthorizedClient } from "../lib/gmail-oauth.js";
import type { GmailMessageFull, GmailMessageSummary } from "../types/gmail.types.js";

const MAX_BODY_CHARS = 8000;
const MIN_RESULTS = 1;
const MAX_RESULTS = 25;
const DEFAULT_RESULTS = 5;

const gmailClient = async (): Promise<gmail_v1.Gmail> => {
  const auth = await getAuthorizedClient();
  // @ts-expect-error googleapis version mismatch between OAuth2Client types
  return google.gmail({ version: "v1", auth });
};

const headerValue = (
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string => {
  const found = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? "";
};

const decodeBase64Url = (data: string): string =>
  Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

const findPart = (
  part: gmail_v1.Schema$MessagePart,
  mimeType: string
): gmail_v1.Schema$MessagePart | undefined => {
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const sub of part.parts ?? []) {
    const match = findPart(sub, mimeType);
    if (match) return match;
  }
  return undefined;
};

const stripHtml = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractBody = (payload: gmail_v1.Schema$MessagePart | undefined): string => {
  if (!payload) return "";

  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);

  const html = findPart(payload, "text/html");
  if (html?.body?.data) return stripHtml(decodeBase64Url(html.body.data));

  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return "";
};

const toSummary = (msg: gmail_v1.Schema$Message): GmailMessageSummary => {
  const headers = msg.payload?.headers;
  return {
    id: msg.id ?? "",
    threadId: msg.threadId ?? "",
    from: headerValue(headers, "From"),
    to: headerValue(headers, "To"),
    subject: headerValue(headers, "Subject"),
    date: headerValue(headers, "Date"),
    snippet: msg.snippet ?? "",
  };
};

export interface ListMessagesOptions {
  query?: string;
  max?: number;
}

export const listMessages = async (
  opts: ListMessagesOptions
): Promise<GmailMessageSummary[]> => {
  const gmail = await gmailClient();
  const maxResults = Math.min(
    Math.max(opts.max ?? DEFAULT_RESULTS, MIN_RESULTS),
    MAX_RESULTS
  );

  const list = await gmail.users.messages.list({
    userId: "me",
    q: opts.query,
    maxResults,
  });

  const ids = list.data.messages?.map((m) => m.id).filter((id): id is string => !!id) ?? [];
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

  return fetched.map((res) => toSummary(res.data));
};

export const getMessage = async (id: string): Promise<GmailMessageFull> => {
  const gmail = await gmailClient();
  const res = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
  });
  const summary = toSummary(res.data);
  const body = extractBody(res.data.payload ?? undefined);
  return { ...summary, body: body.slice(0, MAX_BODY_CHARS) };
};
