import { Router } from "express";
import { getMessagesByVisitorId } from "../services/message.service.js";
import { httpError } from "../lib/errors.js";

const router = Router();

router.get("/", async (req, res) => {
  const visitorId = req.query.visitorId as string | undefined;
  if (!visitorId) {
    throw httpError("Missing visitor ID in query parameters", 400);
  }

  const messages = await getMessagesByVisitorId(visitorId);
  return res.status(200).json(messages);
});

export default router;
