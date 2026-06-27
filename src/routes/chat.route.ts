import { Router } from "express";
import { streamChatResponse } from "../services/chat.service.js";
import { appendMessage } from "../services/message.service.js";
import { MessageRole, type ChatMessage } from "../types/message.types.js";
import { httpError } from "../lib/errors.js";
import Logger from "../lib/logger.js";

const router = Router();

const TOOL_LABELS: Record<string, string> = {
  gmail_search: "📧 ვამოწმებ მეილებს",
  gmail_get_message: "📖 ვკითხულობ მეილის შინაარსს",
};

router.post("/", async (req, res) => {
  const { messages, visitorId } = req.body as {
    messages?: ChatMessage[];
    visitorId?: string;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    throw httpError("Missing messages in request body", 400);
  }

  if (visitorId) {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === MessageRole.USER);
    if (lastUserMessage) {
      await appendMessage(visitorId, MessageRole.USER, lastUserMessage.content);
    }
  }

  Logger.info(`[chat] ${messages.length} messages, streaming response...`);

  const result = streamChatResponse(messages);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (payload: Record<string, unknown>): void => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let totalText = "";
  let toolCallCount = 0;
  let toolResultCount = 0;

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta": {
        const delta =
          (part as { text?: string; textDelta?: string }).text ??
          (part as { textDelta?: string }).textDelta ??
          "";
        if (!delta) break;
        totalText += delta;
        send({ type: "text", text: delta });
        break;
      }

      case "tool-call": {
        toolCallCount++;
        const name = (part as { toolName?: string }).toolName ?? "tool";
        const label = TOOL_LABELS[name] ?? `🔧 ${name}`;
        const input = (part as { input?: unknown }).input;
        Logger.info(`[chat] tool-call: ${name} input=${JSON.stringify(input)}`);
        send({ type: "status", text: `${label}…` });
        break;
      }

      case "tool-result": {
        toolResultCount++;
        const name = (part as { toolName?: string }).toolName ?? "tool";
        const output = (part as { output?: { messages?: unknown[] } }).output;
        const count = Array.isArray(output?.messages) ? output.messages.length : undefined;
        Logger.info(
          `[chat] tool-result: ${name} ${count !== undefined ? `(${count} items)` : ""}`
        );
        send({
          type: "status",
          text:
            name === "gmail_search" && count !== undefined
              ? `✓ მოვიდა ${count} მეილი`
              : `✓ ${name} დასრულდა`,
        });
        break;
      }

      case "error": {
        Logger.error("[chat] stream error part", (part as { error?: unknown }).error);
        send({ type: "status", text: "⚠️ შეცდომა მოხდა" });
        break;
      }

      default:
        break;
    }
  }

  if (visitorId && totalText.length > 0) {
    await appendMessage(visitorId, MessageRole.ASSISTANT, totalText);
  }

  Logger.info(
    `[chat] streamed ${totalText.length} chars, toolCalls=${toolCallCount}, toolResults=${toolResultCount}`
  );
  res.write("data: [DONE]\n\n");
  res.end();
});

export default router;
