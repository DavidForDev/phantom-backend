import { Router } from "express";
import visitorRouter from "./visitor.route.js";
import messageRouter from "./message.route.js";
import chatRouter from "./chat.route.js";
import agentRouter from "./agent.route.js";
import catalogRouter from "./catalog.route.js";
import gmailRouter from "./gmail.route.js";
import twilioRouter from "./twilio.route.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

router.use("/visitors", visitorRouter);
router.use("/messages", messageRouter);
router.use("/chat", chatRouter);
router.use("/agent", agentRouter);
router.use("/catalog", catalogRouter);
router.use("/gmail", gmailRouter);
router.use("/twilio", twilioRouter);

export default router;
