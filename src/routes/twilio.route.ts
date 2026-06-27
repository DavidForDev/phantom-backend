import express, { Router } from "express";
import Logger from "../lib/logger.js";

const router = Router();

router.use(express.urlencoded({ extended: false }));

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

router.post("/voice", (req, res) => {
  const from = (req.body?.From as string | undefined) ?? "";
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers.host;
  const wsScheme = proto === "https" ? "wss" : "ws";
  const streamUrl = `${wsScheme}://${host}/twilio/stream`;

  Logger.info(`[twilio] incoming call from=${from || "unknown"} -> stream=${streamUrl}`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="from" value="${escapeXml(from)}" />
    </Stream>
  </Connect>
</Response>`;

  res.type("text/xml").send(twiml);
});

export default router;
