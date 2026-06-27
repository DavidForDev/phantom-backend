import { Router } from "express";
import visitorService from "../services/visitor.service";
import AppError from "../lib/utils";
import Logger from "../lib/logger";

const router = Router();

router.post("/", async (_req, res) => {
  const visitor = await visitorService.createVisitor();
  return res.status(201).json(visitor);
});

router.get("/", async (req, res) => {
  const visitorId = req.query.visitorId as string | undefined;

  if (!visitorId) {
    Logger.error("Missing visitor ID in query parameters");
    throw new AppError("Missing visitor ID in query parameters", 400);
  }

  const visitor = await visitorService.findByVisitorId(visitorId);
  if (!visitor) {
    throw new AppError("Visitor not found", 404);
  }

  return res.status(200).json(visitor);
});

router.patch("/", async (req, res) => {
  const { visitorId, lastVisitedTimestamp, visitorInformation } = req.body ?? {};

  if (!visitorId) {
    Logger.error("Missing visitor ID in request body");
    throw new AppError("Missing visitor ID in request body", 400);
  }

  const updateData: {
    lastVisitedTimestamp?: Date;
    visitorInformation?: typeof visitorInformation;
  } = {};
  if (lastVisitedTimestamp !== undefined) {
    updateData.lastVisitedTimestamp = new Date(lastVisitedTimestamp);
  }
  if (
    visitorInformation !== undefined &&
    visitorInformation !== null &&
    Object.keys(visitorInformation).length > 0
  ) {
    updateData.visitorInformation = visitorInformation;
  }

  const visitor = await visitorService.updateVisitor(visitorId, updateData);
  if (!visitor) {
    throw new AppError("Visitor not found", 404);
  }

  return res.status(200).json(visitor);
});

export default router;
