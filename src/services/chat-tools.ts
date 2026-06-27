import { tool } from "ai";
import { z } from "zod";
import gmailService from "./gmail.service";
import Logger from "../lib/logger";

export const chatTools = {
  gmail_search: tool({
    description:
      "Search or list the user's Gmail inbox. Returns recent message summaries (from, subject, date, snippet). " +
      "Use Gmail search syntax in `query` (e.g. 'from:apple.com', 'subject:invoice', 'is:unread', 'newer_than:7d'). " +
      "Leave `query` empty to get the most recent messages.",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe("Gmail search query, e.g. 'from:apple.com'. Omit for most recent messages."),
      max: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(5)
        .describe("How many messages to return (1-20)."),
    }),
    execute: async ({ query, max }) => {
      try {
        const messages = await gmailService.listMessages({ query, max });
        return { messages };
      } catch (err) {
        Logger.warn("[chat-tools] gmail_search failed", err);
        return { error: (err as Error).message, messages: [] };
      }
    },
  }),

  gmail_get_message: tool({
    description:
      "Fetch the full body of a specific Gmail message by id. Use this after `gmail_search` " +
      "when you need the full content to summarize or answer a question about it.",
    inputSchema: z.object({
      id: z.string().describe("Gmail message id returned from gmail_search."),
    }),
    execute: async ({ id }) => {
      try {
        const message = await gmailService.getMessage(id);
        return { message };
      } catch (err) {
        Logger.warn("[chat-tools] gmail_get_message failed", err);
        return { error: (err as Error).message };
      }
    },
  }),
};
