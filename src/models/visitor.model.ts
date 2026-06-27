import mongoose, { Schema, type Document } from "mongoose";
import { defaultConfig } from "./index.model";
import { VisitorChannel, type IVisitorInformation } from "../types/visitor.types";

export interface IVisitor extends Document {
  visitorId: string;
  channel: VisitorChannel;
  lastVisitedTimestamp?: Date | null;
  visitorInformation?: IVisitorInformation | null;
  createdAt: Date;
  updatedAt: Date;
}

const VisitorSchema = new Schema<IVisitor>(
  {
    visitorId: { type: String, required: true, unique: true },
    channel: {
      type: String,
      enum: Object.values(VisitorChannel),
      default: VisitorChannel.WIDGET,
    },
    lastVisitedTimestamp: { type: Date, default: null },
    visitorInformation: { type: Object, default: null },
  },
  { ...defaultConfig }
);

VisitorSchema.index({ createdAt: -1 });

export const Visitor = mongoose.model<IVisitor>("Visitor", VisitorSchema);
