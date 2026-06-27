import WebSocket from "ws";
import Logger from "../lib/logger.js";
import {
  mulawDecode,
  mulawEncode,
  upsample8to16,
  downsample24to8,
  chunkBuffer,
} from "../lib/audio.js";
import {
  createGeminiLiveSession,
  type GeminiLiveSession,
} from "./gemini-live.session.js";

interface TwilioInbound {
  event: string;
  start?: {
    streamSid: string;
    callSid?: string;
    customParameters?: Record<string, string>;
  };
  media?: { payload: string };
}

const TWILIO_MULAW_CHUNK_BYTES = 160;

const GREETING_TRIGGER =
  "მომხმარებელმა ახლა აიყვანა ტელეფონი. მიესალმე ქართულად მოკლედ და ჰკითხე როგორ შეგიძლია დაეხმარო.";

export const handleTwilioConnection = (client: WebSocket): void => {
  let session: GeminiLiveSession | null = null;
  let streamSid: string | null = null;
  let greeted = false;

  const sendToTwilio = (msg: Record<string, unknown>): void => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  };

  const sendAudioToTwilio = (mulaw: Buffer): void => {
    if (!streamSid) return;
    for (const chunk of chunkBuffer(mulaw, TWILIO_MULAW_CHUNK_BYTES)) {
      sendToTwilio({
        event: "media",
        streamSid,
        media: { payload: chunk.toString("base64") },
      });
    }
  };

  const forwardGeminiAudio = (pcm24k: Buffer): void => {
    const pcm8k = downsample24to8(pcm24k);
    const mulaw = mulawEncode(pcm8k);
    sendAudioToTwilio(mulaw);
  };

  const openGeminiSession = (visitorId: string | undefined): void => {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      Logger.error("[twilio] GOOGLE_GENERATIVE_AI_API_KEY missing — cannot start session");
      client.close();
      return;
    }

    session = createGeminiLiveSession({
      visitorId,
      tag: "twilio",
      onReady: () => {
        Logger.info(
          `[twilio] gemini ready, sending greeting trigger (visitorId=${visitorId ?? "anonymous"})`
        );
        if (!greeted) {
          greeted = true;
          session?.sendText(GREETING_TRIGGER);
        }
      },
      onAudio: forwardGeminiAudio,
      onTurnComplete: () => {
        if (streamSid) {
          sendToTwilio({ event: "mark", streamSid, mark: { name: "turn-complete" } });
        }
      },
      onError: (msg) => Logger.error(`[twilio] gemini error: ${msg}`),
      onClose: (code, reason) => {
        Logger.info(`[twilio] gemini session closed (${code}): ${reason}`);
        if (client.readyState === WebSocket.OPEN) client.close();
      },
    });
  };

  const closeSession = (): void => {
    session?.close();
    session = null;
  };

  client.on("message", (raw) => {
    let msg: TwilioInbound;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.event) {
      case "connected":
        Logger.info("[twilio] media stream connected");
        return;

      case "start": {
        streamSid = msg.start?.streamSid ?? null;
        const callerNumber = msg.start?.customParameters?.from;
        const visitorId = callerNumber ? `phone:${callerNumber}` : undefined;
        Logger.info(
          `[twilio] stream start streamSid=${streamSid} caller=${callerNumber ?? "unknown"}`
        );
        openGeminiSession(visitorId);
        return;
      }

      case "media": {
        if (!session || !msg.media?.payload) return;
        const mulaw = Buffer.from(msg.media.payload, "base64");
        const pcm8k = mulawDecode(mulaw);
        const pcm16k = upsample8to16(pcm8k);
        session.sendAudio(pcm16k);
        return;
      }

      case "stop":
        Logger.info("[twilio] media stream stop");
        closeSession();
        return;
    }
  });

  client.on("close", closeSession);

  client.on("error", (err) => {
    Logger.error("[twilio] client error", err);
    closeSession();
  });
};
