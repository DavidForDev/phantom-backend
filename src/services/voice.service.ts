import WebSocket from "ws";
import Logger from "../lib/logger.js";
import { GeminiLiveSession } from "./gemini-live.session.js";

interface ClientToServer {
  type: "start" | "audio" | "stop" | "text";
  visitorId?: string;
  audio?: string;
  text?: string;
}

interface ServerToClient {
  type: "ready" | "audio" | "input_transcript" | "output_transcript" | "turn_complete" | "error";
  audio?: string;
  text?: string;
  message?: string;
}

export function handleVoiceConnection(client: WebSocket): void {
  let session: GeminiLiveSession | null = null;

  const sendToClient = (msg: ServerToClient) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  };

  client.on("message", (raw) => {
    let msg: ClientToServer;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "start") {
      if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
        sendToClient({ type: "error", message: "GOOGLE_GENERATIVE_AI_API_KEY not set" });
        client.close();
        return;
      }
      if (session) return;
      session = new GeminiLiveSession({
        visitorId: msg.visitorId,
        tag: "voice",
        onReady: () => sendToClient({ type: "ready" }),
        onAudio: (pcm) => sendToClient({ type: "audio", audio: pcm.toString("base64") }),
        onInputTranscript: (text) => sendToClient({ type: "input_transcript", text }),
        onOutputTranscript: (text) => sendToClient({ type: "output_transcript", text }),
        onTurnComplete: () => sendToClient({ type: "turn_complete" }),
        onError: (message) => sendToClient({ type: "error", message }),
        onClose: (code, reason) => {
          if (code !== 1000 && reason) {
            sendToClient({ type: "error", message: `Gemini: ${reason}` });
          }
          if (client.readyState === WebSocket.OPEN) client.close();
        },
      });
      return;
    }

    if (!session) return;

    if (msg.type === "audio" && msg.audio) {
      session.sendAudioBase64(msg.audio);
      return;
    }

    if (msg.type === "text" && msg.text) {
      session.sendText(msg.text);
      Logger.info(`[voice] text input forwarded: ${msg.text.slice(0, 60)}`);
      return;
    }

    if (msg.type === "stop") {
      session.close();
      session = null;
      return;
    }
  });

  client.on("close", () => {
    session?.close();
    session = null;
  });

  client.on("error", (err) => {
    Logger.error("[voice] client error", err);
    session?.close();
    session = null;
  });
}
