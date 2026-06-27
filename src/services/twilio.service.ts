import WebSocket from "ws";
import Logger from "../lib/logger";
import {
  mulawDecode,
  mulawEncode,
  upsample8to16,
  downsample24to8,
  chunkBuffer,
} from "../lib/audio";
import { GeminiLiveSession } from "./gemini-live.session";

// Twilio Media Streams protocol (https://www.twilio.com/docs/voice/media-streams/websocket-messages):
//   inbound events from Twilio:
//     { event: "connected", protocol: "Call", version: "1.0.0" }
//     { event: "start", start: { streamSid, callSid, customParameters?: {...}, ... } }
//     { event: "media", media: { track, chunk, timestamp, payload (base64 μ-law) } }
//     { event: "mark" | "stop" }
//   outbound events we can send back:
//     { event: "media", streamSid, media: { payload (base64 μ-law) } }
//     { event: "mark", streamSid, mark: { name } }
//     { event: "clear", streamSid }
//
// Twilio media payloads are 8kHz μ-law mono, ~20ms per chunk (160 bytes).

interface TwilioInbound {
  event: string;
  start?: {
    streamSid: string;
    callSid?: string;
    customParameters?: Record<string, string>;
  };
  media?: { payload: string };
}

const TWILIO_MULAW_CHUNK_BYTES = 160; // 20ms at 8kHz μ-law

export function handleTwilioConnection(client: WebSocket): void {
  let session: GeminiLiveSession | null = null;
  let streamSid: string | null = null;
  let callerNumber: string | undefined;
  let greeted = false;

  const sendToTwilio = (msg: Record<string, unknown>) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  };

  const sendAudioToTwilio = (mulaw: Buffer) => {
    if (!streamSid) return;
    for (const chunk of chunkBuffer(mulaw, TWILIO_MULAW_CHUNK_BYTES)) {
      sendToTwilio({
        event: "media",
        streamSid,
        media: { payload: chunk.toString("base64") },
      });
    }
  };

  const handleGeminiAudio = (pcm24k: Buffer) => {
    const pcm8k = downsample24to8(pcm24k);
    const mulaw = mulawEncode(pcm8k);
    sendAudioToTwilio(mulaw);
  };

  const openGeminiSession = (visitorId: string | undefined) => {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      Logger.error("[twilio] GOOGLE_GENERATIVE_AI_API_KEY missing — cannot start session");
      client.close();
      return;
    }

    session = new GeminiLiveSession({
      visitorId,
      tag: "twilio",
      onReady: () => {
        Logger.info(`[twilio] gemini ready, sending greeting trigger (visitorId=${visitorId ?? "anonymous"})`);
        if (!greeted) {
          greeted = true;
          // Trigger Gemini to greet the caller first, before they speak.
          // The voice prompt already tells it to use a warm Georgian greeting.
          session?.sendText(
            "მომხმარებელმა ახლა აიყვანა ტელეფონი. მიესალმე ქართულად მოკლედ და ჰკითხე როგორ შეგიძლია დაეხმარო."
          );
        }
      },
      onAudio: handleGeminiAudio,
      onTurnComplete: () => {
        // Send a mark so Twilio can ack when playback finishes — useful for debugging.
        if (streamSid) sendToTwilio({ event: "mark", streamSid, mark: { name: "turn-complete" } });
      },
      onError: (msg) => Logger.error(`[twilio] gemini error: ${msg}`),
      onClose: (code, reason) => {
        Logger.info(`[twilio] gemini session closed (${code}): ${reason}`);
        if (client.readyState === WebSocket.OPEN) client.close();
      },
    });
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
        callerNumber = msg.start?.customParameters?.from;
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
        session?.close();
        session = null;
        return;
    }
  });

  client.on("close", () => {
    session?.close();
    session = null;
  });

  client.on("error", (err) => {
    Logger.error("[twilio] client error", err);
    session?.close();
    session = null;
  });
}
