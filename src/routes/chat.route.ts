import { Router } from "express";
import chatService from "../services/chat.service";
import messageService from "../services/message.service";
import { MessageRole, type ChatMessage } from "../types/message.types";
import AppError from "../lib/utils";
import Logger from "../lib/logger";

const router = Router();

router.post("/", async (req, res) => {
  const { messages, visitorId } = req.body as {
    messages?: ChatMessage[];
    visitorId?: string;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AppError("Missing messages in request body", 400);
  }

  if (visitorId) {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === MessageRole.USER);
    if (lastUserMessage) {
      await messageService.appendMessage(visitorId, MessageRole.USER, lastUserMessage.content);
    }
  }

  Logger.info(`[chat] ${messages.length} messages, streaming response...`);

  const result = chatService.streamChatResponse(messages);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (payload: Record<string, unknown>) =>
    res.write(`data: ${JSON.stringify(payload)}\n\n`);

  const toolLabels: Record<string, string> = {
    gmail_search: "📧 ვამოწმებ მეილებს",
    gmail_get_message: "📖 ვკითხულობ მეილის შინაარსს",
  };

  let total = "";
  let toolCallCount = 0;
  let toolResultCount = 0;

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta": {
        const delta = (part as { text?: string; textDelta?: string }).text
          ?? (part as { textDelta?: string }).textDelta
          ?? "";
        if (!delta) break;
        total += delta;
        send({ type: "text", text: delta });
        break;
      }
      case "tool-call": {
        toolCallCount++;
        const name = (part as { toolName?: string }).toolName ?? "tool";
        const label = toolLabels[name] ?? `🔧 ${name}`;
        const input = (part as { input?: unknown }).input;
        Logger.info(`[chat] tool-call: ${name} input=${JSON.stringify(input)}`);
        send({ type: "status", text: `${label}…` });
        break;
      }
      case "tool-result": {
        toolResultCount++;
        const name = (part as { toolName?: string }).toolName ?? "tool";
        const output = (part as { output?: unknown }).output;
        const count = Array.isArray((output as { messages?: unknown[] })?.messages)
          ? (output as { messages: unknown[] }).messages.length
          : undefined;
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
        const err = (part as { error?: unknown }).error;
        Logger.error("[chat] stream error part", err);
        send({ type: "status", text: "⚠️ შეცდომა მოხდა" });
        break;
      }
      default:
        break;
    }
  }

  if (visitorId && total.length > 0) {
    await messageService.appendMessage(visitorId, MessageRole.ASSISTANT, total);
  }

  Logger.info(
    `[chat] streamed ${total.length} chars, toolCalls=${toolCallCount}, toolResults=${toolResultCount}`
  );
  res.write("data: [DONE]\n\n");
  res.end();
});

export default router;
