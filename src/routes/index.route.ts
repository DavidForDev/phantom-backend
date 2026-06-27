import { Router } from "express";
import visitorRouter from "./visitor.route";
import messageRouter from "./message.route";
import chatRouter from "./chat.route";
import agentRouter from "./agent.route";
import catalogRouter from "./catalog.route";
import gmailRouter from "./gmail.route";
import twilioRouter from "./twilio.route";

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
