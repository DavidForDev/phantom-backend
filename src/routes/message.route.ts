import { Router } from "express";
import messageService from "../services/message.service.js";
import AppError from "../lib/utils.js";
import Logger from "../lib/logger.js";

const router = Router();

router.get("/", async (req, res) => {
  const visitorId = req.query.visitorId as string | undefined;

  if (!visitorId) {
    Logger.error("Missing visitor ID in query parameters");
    throw new AppError("Missing visitor ID in query parameters", 400);
  }

  const messages = await messageService.getMessagesByVisitorId(visitorId);
  return res.status(200).json(messages);
});

export default router;
