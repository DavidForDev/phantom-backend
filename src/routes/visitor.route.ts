import { Router } from "express";
import {
  createVisitor,
  findByVisitorId,
  updateVisitor,
  type UpdateVisitorPayload,
} from "../services/visitor.service.js";
import { httpError } from "../lib/errors.js";

const router = Router();

router.post("/", async (_req, res) => {
  const visitor = await createVisitor();
  return res.status(201).json(visitor);
});

router.get("/", async (req, res) => {
  const visitorId = req.query.visitorId as string | undefined;
  if (!visitorId) {
    throw httpError("Missing visitor ID in query parameters", 400);
  }

  const visitor = await findByVisitorId(visitorId);
  if (!visitor) {
    throw httpError("Visitor not found", 404);
  }

  return res.status(200).json(visitor);
});

router.patch("/", async (req, res) => {
  const { visitorId, lastVisitedTimestamp, visitorInformation } = req.body ?? {};
  if (!visitorId) {
    throw httpError("Missing visitor ID in request body", 400);
  }

  const updateData: UpdateVisitorPayload = {};
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

  const visitor = await updateVisitor(visitorId, updateData);
  if (!visitor) {
    throw httpError("Visitor not found", 404);
  }

  return res.status(200).json(visitor);
});

export default router;
