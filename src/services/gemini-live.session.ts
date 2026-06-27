import WebSocket from "ws";
import config from "../lib/config.js";
import Logger from "../lib/logger.js";
import { buildVoiceSystemPrompt } from "../prompts/voice.prompt.js";
import { appendMessage } from "./message.service.js";
import { MessageRole } from "../types/message.types.js";
import { listMessages, getMessage } from "./gmail.service.js";

const GEMINI_LIVE_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? ""
}`;

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
        query: { type: "string", description: "Gmail search query, e.g. 'from:mongodb'. Omit for most recent messages." },
        max: { type: "integer", description: "How many messages to return (1-20). Default 5." },
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
        id: { type: "string", description: "Gmail message id returned from gmail_search." },
      },
      required: ["id"],
    },
  },
];

const runGmailFunction = async (
  name: string,
  args: Record<string, unknown>,
  tag: string
): Promise<unknown> => {
  try {
    if (name === "gmail_search") {
      const query = typeof args.query === "string" ? args.query : undefined;
      const max =
        typeof args.max === "number" ? args.max : args.max ? Number(args.max) : 5;
      const messages = await listMessages({ query, max });
      return { messages };
    }
    if (name === "gmail_get_message") {
      const id = String(args.id ?? "");
      if (!id) return { error: "missing id" };
      const message = await getMessage(id);
      return { message };
    }
    return { error: `unknown function: ${name}` };
  } catch (err) {
    Logger.warn(`[${tag}] gmail function ${name} failed`, err);
    return { error: (err as Error).message };
  }
};

const GEORGIAN_KEEP_REGEX = /[^Ⴀ-ჿⴀ-⴯0-9\s.,!?;:'"\-()₾]/gu;
const PUNCTUATION_RUN_REGEX = /(\s*[,.!?;:'"\-()])(\s*[,.!?;:'"\-()])+/g;
const NON_GEORGIAN_SCRIPTS_REGEX = /[぀-ゟ゠-ヿㇰ-ㇿ一-鿿가-힯ᄀ-ᇿ㄰-㆏Ѐ-ӿ]/g;
const CONTROL_TOKEN_REGEX = /<\/?ctrl\d+>|<\/?(?:eos|bos|pad|sep|cls|mask|audio|turn_complete)[^>]*>/gi;

const stripControlTokens = (text: string): string =>
  text.replace(CONTROL_TOKEN_REGEX, "");

const keepGeorgianOnly = (text: string): string =>
  stripControlTokens(text)
    .replace(GEORGIAN_KEEP_REGEX, "")
    .replace(PUNCTUATION_RUN_REGEX, "$1")
    .replace(/\s+/g, " ")
    .trim();

const stripNonGeorgianScripts = (text: string): string =>
  stripControlTokens(text).replace(NON_GEORGIAN_SCRIPTS_REGEX, "");

export interface GeminiLiveSessionOptions {
  visitorId?: string;
  onReady: () => void;
  onAudio: (pcm24k: Buffer) => void;
  onInputTranscript?: (text: string) => void;
  onOutputTranscript?: (text: string) => void;
  onTurnComplete?: () => void;
  onError?: (message: string) => void;
  onClose?: (code: number, reason: string) => void;
  tag?: string;
}

export interface GeminiLiveSession {
  sendAudioBase64: (base64: string) => void;
  sendAudio: (pcm16k: Buffer) => void;
  sendText: (text: string) => void;
  close: () => void;
}

interface ToolCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export const createGeminiLiveSession = (
  opts: GeminiLiveSessionOptions
): GeminiLiveSession => {
  const tag = opts.tag ?? "gemini-live";
  const upstream = new WebSocket(GEMINI_LIVE_URL);

  let pendingInputTranscript = "";
  let pendingOutputTranscript = "";
  let audioChunksForwarded = 0;
  let closed = false;

  const flushTranscripts = async (): Promise<void> => {
    const userText = pendingInputTranscript.trim();
    const assistantText = pendingOutputTranscript.trim();
    pendingInputTranscript = "";
    pendingOutputTranscript = "";

    if (opts.visitorId && userText.length > 0) {
      await appendMessage(opts.visitorId, MessageRole.USER, userText);
    }
    if (opts.visitorId && assistantText.length > 0) {
      await appendMessage(opts.visitorId, MessageRole.ASSISTANT, assistantText);
    }
  };

  const sendSetup = (): void => {
    const setup = {
      setup: {
        model: `models/${config.GEMINI_LIVE_MODEL}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: config.GEMINI_LIVE_VOICE } },
          },
        },
        systemInstruction: { parts: [{ text: buildVoiceSystemPrompt() }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: GMAIL_FUNCTION_DECLARATIONS }],
      },
    };
    upstream.send(JSON.stringify(setup));
    Logger.info(`[${tag}] upstream open, setup sent (voice=${config.GEMINI_LIVE_VOICE})`);
  };

  const handleToolCalls = async (calls: ToolCall[]): Promise<void> => {
    const functionResponses = await Promise.all(
      calls.map(async (call) => {
        Logger.info(`[${tag}] tool call: ${call.name} args=${JSON.stringify(call.args ?? {})}`);
        const response = await runGmailFunction(call.name, call.args ?? {}, tag);
        return { id: call.id, name: call.name, response };
      })
    );
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(JSON.stringify({ toolResponse: { functionResponses } }));
      Logger.info(`[${tag}] tool response sent for ${functionResponses.length} call(s)`);
    }
  };

  const handleMessage = (raw: WebSocket.RawData): void => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      Logger.error(`[${tag}] failed to parse upstream message`, err);
      return;
    }

    if ((msg as { setupComplete?: unknown }).setupComplete) {
      opts.onReady();
      return;
    }

    const toolCall = (msg as { toolCall?: { functionCalls?: ToolCall[] } }).toolCall;
    if (toolCall?.functionCalls) {
      handleToolCalls(toolCall.functionCalls).catch((err) =>
        Logger.error(`[${tag}] tool call handler failed`, err)
      );
      return;
    }

    const sc = (msg as { serverContent?: Record<string, any> }).serverContent;
    if (!sc) return;

    if (sc.inputTranscription?.text) {
      const cleaned = keepGeorgianOnly(sc.inputTranscription.text);
      if (cleaned) {
        pendingInputTranscript += (pendingInputTranscript ? " " : "") + cleaned;
        opts.onInputTranscript?.(cleaned);
      }
    }

    if (sc.outputTranscription?.text) {
      const cleaned = stripNonGeorgianScripts(sc.outputTranscription.text);
      if (cleaned) {
        pendingOutputTranscript += cleaned;
        opts.onOutputTranscript?.(cleaned);
      }
    }

    const parts = sc.modelTurn?.parts as Array<{ inlineData?: { data: string } }> | undefined;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part.inlineData?.data) {
          audioChunksForwarded++;
          opts.onAudio(Buffer.from(part.inlineData.data, "base64"));
        }
      }
    }

    if (sc.turnComplete) {
      const hadText = pendingOutputTranscript.trim().length > 0;
      if (audioChunksForwarded === 0 && hadText) {
        Logger.warn(
          `[${tag}] turn complete with text but ZERO audio chunks — model returned text-only output`
        );
      } else {
        Logger.info(
          `[${tag}] turn complete — forwarded ${audioChunksForwarded} audio chunks`
        );
      }
      audioChunksForwarded = 0;
      flushTranscripts().catch((err) => Logger.error(`[${tag}] flush error`, err));
      opts.onTurnComplete?.();
    }
  };

  upstream.on("open", sendSetup);
  upstream.on("message", handleMessage);
  upstream.on("error", (err) => {
    Logger.error(`[${tag}] upstream error`, err);
    opts.onError?.("Upstream connection error");
  });
  upstream.on("close", (code, reason) => {
    const reasonText = reason.toString();
    Logger.info(`[${tag}] upstream closed (${code}): ${reasonText}`);
    flushTranscripts().catch(() => {});
    opts.onClose?.(code, reasonText);
  });

  const sendAudioBase64 = (base64: string): void => {
    if (upstream.readyState !== WebSocket.OPEN) return;
    upstream.send(
      JSON.stringify({
        realtimeInput: { audio: { data: base64, mimeType: "audio/pcm;rate=16000" } },
      })
    );
  };

  const sendAudio = (pcm16k: Buffer): void => sendAudioBase64(pcm16k.toString("base64"));

  const sendText = (text: string): void => {
    if (upstream.readyState !== WebSocket.OPEN) return;
    upstream.send(
      JSON.stringify({
        clientContent: {
          turns: [{ role: "user", parts: [{ text }] }],
          turnComplete: true,
        },
      })
    );
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  };

  return { sendAudioBase64, sendAudio, sendText, close };
};
