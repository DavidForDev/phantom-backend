import express, { Router } from "express";
import Logger from "../lib/logger";

const router = Router();

// Twilio posts application/x-www-form-urlencoded for voice webhooks.
router.use(express.urlencoded({ extended: false }));

router.post("/voice", (req, res) => {
  const from = (req.body?.From as string | undefined) ?? "";
  // Twilio reaches us via a public URL (ngrok in dev, your domain in prod).
  // We mirror the host the request came in on, so no extra config is needed.
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers.host;
  const wsScheme = proto === "https" ? "wss" : "ws";
  const streamUrl = `${wsScheme}://${host}/twilio/stream`;

  Logger.info(`[twilio] incoming call from=${from || "unknown"} -> stream=${streamUrl}`);

  // <Connect><Stream> opens a bidirectional WebSocket to our backend.
  // <Parameter> values arrive in the stream's "start" event customParameters.
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default router;
