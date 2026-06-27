import WebSocket from "ws";
import config from "../lib/config";
import Logger from "../lib/logger";
import { buildVoiceSystemPrompt } from "../prompts/voice.prompt";
import { getCatalog } from "./catalog.service";
import { appendMessage } from "./message.service";
import { MessageRole } from "../types/message.types";
import gmailService from "./gmail.service";

const GMAIL_FUNCTION_DECLARATIONS = [
  {
    name: "gmail_search",
    description:
      "Search or list the user's Gmail inbox. Returns recent message summaries " +
      "(from, subject, date, snippet). Use Gmail search syntax in `query` (e.g. " +
      "'from:apple.com', 'subject:invoice', 'is:unread'). Leave `query` empty for most recent messages.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Gmail search query, e.g. 'from:mongodb'. Omit for most recent messages.",
        },
        max: {
          type: "integer",
          description: "How many messages to return (1-20). Default 5.",
        },
      },
    },
  },
  {
    name: "gmail_get_message",
    description:
      "Fetch the full body of a specific Gmail message by id. Use this after gmail_search " +
      "when you need the full content to summarize or answer a question about it.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Gmail message id returned from gmail_search.",
        },
      },
      required: ["id"],
    },
  },
];

async function runGmailFunction(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  try {
    if (name === "gmail_search") {
      const query = typeof args.query === "string" ? args.query : undefined;
      const max =
        typeof args.max === "number" ? args.max : args.max ? Number(args.max) : 5;
      const messages = await gmailService.listMessages({ query, max });
      return { messages };
    }
    if (name === "gmail_get_message") {
      const id = String(args.id ?? "");
      if (!id) return { error: "missing id" };
      const message = await gmailService.getMessage(id);
      return { message };
    }
    return { error: `unknown function: ${name}` };
  } catch (err) {
    Logger.warn(`[voice] gmail function ${name} failed`, err);
    return { error: (err as Error).message };
  }
}

const GEMINI_LIVE_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? ""
}`;

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

// Keep only Georgian (Mkhedruli + Supplement), digits, whitespace, and common
// punctuation. Used on the INPUT transcript since the user only speaks Georgian —
// any Latin / Hangul / CJK / Cyrillic token is a mis-hearing.
function keepGeorgianOnly(text: string): string {
  let cleaned = text.replace(
    /[^Ⴀ-ჿⴀ-⴯0-9\s.,!?;:'"\-()₾]/gu,
    ""
  );
  // Collapse runs of punctuation+whitespace left behind by stripping
  cleaned = cleaned.replace(/(\s*[,.!?;:'"\-()])(\s*[,.!?;:'"\-()])+/g, "$1");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
}

// Strip only the obviously-wrong scripts (Hangul, Hiragana, Katakana, CJK,
// Cyrillic). Used on the OUTPUT transcript so Latin brand names like "MacBook"
// survive while drift to Asian scripts is removed.
function stripNonGeorgianScripts(text: string): string {
  return text.replace(
    /[぀-ゟ゠-ヿㇰ-ㇿ一-鿿가-힯ᄀ-ᇿ㄰-㆏Ѐ-ӿ]/g,
    ""
  );
}

export function handleVoiceConnection(client: WebSocket): void {
  let upstream: WebSocket | null = null;
  let visitorId: string | undefined;
  let pendingInputTranscript = "";
  let pendingOutputTranscript = "";
  let audioChunksForwarded = 0;

  const sendToClient = (msg: ServerToClient) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  };

  const flushTranscripts = async () => {
    const userText = pendingInputTranscript.trim();
    const assistantText = pendingOutputTranscript.trim();
    pendingInputTranscript = "";
    pendingOutputTranscript = "";

    if (visitorId && userText.length > 0) {
      await appendMessage(visitorId, MessageRole.USER, userText);
    }
    if (visitorId && assistantText.length > 0) {
      await appendMessage(visitorId, MessageRole.ASSISTANT, assistantText);
    }
  };

  const openUpstream = (sessionVisitorId?: string) => {
    visitorId = sessionVisitorId;
    upstream = new WebSocket(GEMINI_LIVE_URL);

    upstream.on("open", () => {
      const setup = {
        setup: {
          model: `models/${config.GEMINI_LIVE_MODEL}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: config.GEMINI_LIVE_VOICE },
              },
            },
          },
          systemInstruction: {
            parts: [{ text: buildVoiceSystemPrompt(getCatalog()) }],
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: GMAIL_FUNCTION_DECLARATIONS }],
        },
      };
      upstream?.send(JSON.stringify(setup));
      Logger.info(`[voice] upstream open, setup sent (voice=${config.GEMINI_LIVE_VOICE})`);
    });

    upstream.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.setupComplete) {
          sendToClient({ type: "ready" });
          return;
        }

        if (msg.toolCall?.functionCalls) {
          (async () => {
            const calls = msg.toolCall.functionCalls as Array<{
              id?: string;
              name: string;
              args?: Record<string, unknown>;
            }>;
            const functionResponses = await Promise.all(
              calls.map(async (call) => {
                Logger.info(
                  `[voice] tool call: ${call.name} args=${JSON.stringify(call.args ?? {})}`
                );
                const response = await runGmailFunction(call.name, call.args ?? {});
                return {
                  id: call.id,
                  name: call.name,
                  response,
                };
              })
            );
            if (upstream?.readyState === WebSocket.OPEN) {
              upstream.send(JSON.stringify({ toolResponse: { functionResponses } }));
              Logger.info(`[voice] tool response sent for ${functionResponses.length} call(s)`);
            }
          })().catch((err) => Logger.error("[voice] toolCall handler failed", err));
          return;
        }

        const sc = msg.serverContent;
        if (!sc) return;

        if (sc.inputTranscription?.text) {
          const cleaned = keepGeorgianOnly(sc.inputTranscription.text);
          if (cleaned.length > 0) {
            pendingInputTranscript += (pendingInputTranscript ? " " : "") + cleaned;
            sendToClient({ type: "input_transcript", text: cleaned });
          }
        }
        if (sc.outputTranscription?.text) {
          const cleaned = stripNonGeorgianScripts(sc.outputTranscription.text);
          if (cleaned.length > 0) {
            pendingOutputTranscript += cleaned;
            sendToClient({ type: "output_transcript", text: cleaned });
          }
        }

        const parts = sc.modelTurn?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (part.inlineData?.data) {
              audioChunksForwarded++;
              sendToClient({ type: "audio", audio: part.inlineData.data });
            }
          }
        }

        if (sc.turnComplete) {
          Logger.info(`[voice] turn complete — forwarded ${audioChunksForwarded} audio chunks`);
          audioChunksForwarded = 0;
          sendToClient({ type: "turn_complete" });
          flushTranscripts().catch((err) => Logger.error("[voice] flush error", err));
        }
      } catch (err) {
        Logger.error("[voice] failed to parse upstream message", err);
      }
    });

    upstream.on("error", (err) => {
      Logger.error("[voice] upstream error", err);
      sendToClient({ type: "error", message: "Upstream connection error" });
    });

    upstream.on("close", (code, reason) => {
      const reasonText = reason.toString();
      Logger.info(`[voice] upstream closed (${code}): ${reasonText}`);
      flushTranscripts().catch(() => {});
      if (client.readyState === WebSocket.OPEN) {
        if (code !== 1000 && reasonText) {
          sendToClient({ type: "error", message: `Gemini: ${reasonText}` });
        }
        client.close();
      }
    });
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
      openUpstream(msg.visitorId);
      return;
    }

    if (msg.type === "audio" && msg.audio && upstream?.readyState === WebSocket.OPEN) {
      upstream.send(
        JSON.stringify({
          realtimeInput: {
            audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" },
          },
        })
      );
      return;
    }

    if (msg.type === "text" && msg.text && upstream?.readyState === WebSocket.OPEN) {
      upstream.send(
        JSON.stringify({
          clientContent: {
            turns: [{ role: "user", parts: [{ text: msg.text }] }],
            turnComplete: true,
          },
        })
      );
      Logger.info(`[voice] text input forwarded: ${msg.text.slice(0, 60)}`);
      return;
    }

    if (msg.type === "stop") {
      upstream?.close();
      return;
    }
  });

  client.on("close", () => {
    upstream?.close();
  });

  client.on("error", (err) => {
    Logger.error("[voice] client error", err);
    upstream?.close();
  });
}
