import { Message, type IMessage } from "../models/message.model.js";
import type { MessageRole, ChatMessage } from "../types/message.types.js";
import Logger from "../lib/logger.js";

export const getMessagesByVisitorId = async (
  visitorId: string
): Promise<ChatMessage[]> => {
  const messages = await Message.find({ visitorId })
    .sort({ createdAt: 1 })
    .lean<Pick<IMessage, "role" | "content" | "createdAt">[]>();
  return messages.map((m) => ({ role: m.role, content: m.content }));
};

export const appendMessage = async (
  visitorId: string,
  role: MessageRole,
  content: string
): Promise<void> => {
  try {
    await Message.create({ visitorId, role, content });
  } catch (err) {
    Logger.error("Error appending message", err);
  }
};
