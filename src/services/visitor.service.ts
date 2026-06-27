import { v4 as uuidv4 } from "uuid";
import { Visitor, type IVisitor } from "../models/visitor.model.js";
import { VisitorChannel, type IVisitorInformation } from "../types/visitor.types.js";
import Logger from "../lib/logger.js";

export interface UpdateVisitorPayload {
  lastVisitedTimestamp?: Date;
  visitorInformation?: IVisitorInformation;
}

export const createVisitor = async (): Promise<IVisitor> => {
  try {
    const visitor = await Visitor.create({
      visitorId: uuidv4(),
      channel: VisitorChannel.WIDGET,
    });
    return visitor.toObject();
  } catch (err) {
    Logger.error("Error creating visitor", err);
    throw err;
  }
};

export const findByVisitorId = async (
  visitorId: string
): Promise<IVisitor | null> => {
  const visitor = await Visitor.findOne({ visitorId });
  return visitor ? visitor.toObject() : null;
};

export const updateVisitor = async (
  visitorId: string,
  updateData: UpdateVisitorPayload
): Promise<IVisitor | null> => {
  try {
    const visitor = await Visitor.findOneAndUpdate(
      { visitorId },
      updateData,
      { new: true }
    );
    return visitor ? visitor.toObject() : null;
  } catch (err) {
    Logger.error("Error updating visitor", err);
    throw err;
  }
};
