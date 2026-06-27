import { streamText, stepCountIs } from "ai";
import { google } from "@ai-sdk/google";
import { buildChatSystemPrompt } from "../prompts/chat.prompt.js";
import { getCatalog } from "./catalog.service.js";
import { chatTools } from "./chat-tools.js";
import config from "../lib/config.js";
import Logger from "../lib/logger.js";
import type { ChatMessage } from "../types/message.types.js";

export const streamChatResponse = (messages: ChatMessage[]) => {
  const system = buildChatSystemPrompt(getCatalog());

  return streamText({
    model: google(config.GEMINI_CHAT_MODEL),
    system,
    messages,
    tools: chatTools,
    stopWhen: stepCountIs(5),
    onStepFinish: ({ toolCalls, finishReason }) => {
      if (toolCalls?.length) {
        Logger.info(
          `[chat] step finished, tool calls: ${toolCalls
            .map((c) => c.toolName)
            .join(", ")} (finishReason: ${finishReason})`
        );
      } else {
        Logger.info(`[chat] step finished, no tool calls (finishReason: ${finishReason})`);
      }
    },
  });
};

export default {
  streamChatResponse,
};
