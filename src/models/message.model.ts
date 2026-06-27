import mongoose, { Schema, type Document } from "mongoose";
import { defaultConfig } from "./index.model";
import { MessageRole } from "../types/message.types";

export interface IMessage extends Document {
  visitorId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    visitorId: { type: String, required: true, index: true },
    role: { type: String, enum: Object.values(MessageRole), required: true },
    content: { type: String, required: true },
  },
  { ...defaultConfig }
);

MessageSchema.index({ visitorId: 1, createdAt: 1 });

export const Message = mongoose.model<IMessage>("Message", MessageSchema);
