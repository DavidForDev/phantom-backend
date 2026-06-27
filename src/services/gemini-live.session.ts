import WebSocket from "ws";
import config from "../lib/config";
import Logger from "../lib/logger";
import { buildVoiceSystemPrompt } from "../prompts/voice.prompt";
import { getCatalog } from "./catalog.service";
import { appendMessage } from "./message.service";
import { MessageRole } from "../types/message.types";
import gmailService from "./gmail.service";

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

async function runGmailFunction(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    if (name === "gmail_search") {
      const query = typeof args.query === "string" ? args.query : undefined;
      const max = typeof args.max === "number" ? args.max : args.max ? Number(args.max) : 5;
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
    Logger.warn(`[gemini-live] gmail function ${name} failed`, err);
    return { error: (err as Error).message };
  }
}

function keepGeorgianOnly(text: string): string {
  let cleaned = text.replace(/[^Ⴀ-ჿⴀ-⴯0-9\s.,!?;:'"\-()₾]/gu, "");
  cleaned = cleaned.replace(/(\s*[,.!?;:'"\-()])(\s*[,.!?;:'"\-()])+/g, "$1");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
}

function stripNonGeorgianScripts(text: string): string {
  return text.replace(/[぀-ゟ゠-ヿㇰ-ㇿ一-鿿가-힯ᄀ-ᇿ㄰-㆏Ѐ-ӿ]/g, "");
}

export interface GeminiLiveSessionOptions {
  visitorId?: string;
  /** Called when Gemini's `setupComplete` arrives. */
  onReady: () => void;
  /** Called with each raw 24kHz mono s16le PCM audio chunk Gemini emits. */
  onAudio: (pcm24k: Buffer) => void;
  onInputTranscript?: (text: string) => void;
  onOutputTranscript?: (text: string) => void;
  onTurnComplete?: () => void;
  /** Called when upstream signals an error. */
  onError?: (message: string) => void;
  /** Called when upstream closes. `code === 1000` is a clean close. */
  onClose?: (code: number, reason: string) => void;
  /** Log tag for distinguishing concurrent sessions in logs. */
  tag?: string;
}

export class GeminiLiveSession {
  private upstream: WebSocket;
  private readonly opts: GeminiLiveSessionOptions;
  private readonly tag: string;
  private pendingInputTranscript = "";
  private pendingOutputTranscript = "";
  private audioChunksForwarded = 0;
  private closed = false;

  constructor(opts: GeminiLiveSessionOptions) {
    this.opts = opts;
    this.tag = opts.tag ?? "gemini-live";
    this.upstream = new WebSocket(GEMINI_LIVE_URL);
    this.upstream.on("open", () => this.handleOpen());
    this.upstream.on("message", (raw) => this.handleMessage(raw));
    this.upstream.on("error", (err) => {
      Logger.error(`[${this.tag}] upstream error`, err);
      this.opts.onError?.("Upstream connection error");
    });
    this.upstream.on("close", (code, reason) => this.handleClose(code, reason.toString()));
  }

  /** Forward a base64-encoded 16kHz mono s16le PCM chunk. */
  sendAudioBase64(base64: string): void {
    if (this.upstream.readyState !== WebSocket.OPEN) return;
    this.upstream.send(
      JSON.stringify({
        realtimeInput: { audio: { data: base64, mimeType: "audio/pcm;rate=16000" } },
      })
    );
  }

  /** Forward raw 16kHz mono s16le PCM. */
  sendAudio(pcm16k: Buffer): void {
    this.sendAudioBase64(pcm16k.toString("base64"));
  }

  /** Trigger a model turn with text input. */
  sendText(text: string): void {
    if (this.upstream.readyState !== WebSocket.OPEN) return;
    this.upstream.send(
      JSON.stringify({
        clientContent: {
          turns: [{ role: "user", parts: [{ text }] }],
          turnComplete: true,
        },
      })
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.upstream.readyState === WebSocket.OPEN || this.upstream.readyState === WebSocket.CONNECTING) {
      this.upstream.close();
    }
  }

  private handleOpen(): void {
    const setup = {
      setup: {
        model: `models/${config.GEMINI_LIVE_MODEL}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: config.GEMINI_LIVE_VOICE } },
          },
        },
        systemInstruction: { parts: [{ text: buildVoiceSystemPrompt(getCatalog()) }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: GMAIL_FUNCTION_DECLARATIONS }],
      },
    };
    this.upstream.send(JSON.stringify(setup));
    Logger.info(`[${this.tag}] upstream open, setup sent (voice=${config.GEMINI_LIVE_VOICE})`);
  }

  private handleMessage(raw: WebSocket.RawData): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      Logger.error(`[${this.tag}] failed to parse upstream message`, err);
      return;
    }

    if ((msg as { setupComplete?: unknown }).setupComplete) {
      this.opts.onReady();
      return;
    }

    const toolCall = (msg as { toolCall?: { functionCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }> } }).toolCall;
    if (toolCall?.functionCalls) {
      this.handleToolCalls(toolCall.functionCalls).catch((err) =>
        Logger.error(`[${this.tag}] tool call handler failed`, err)
      );
      return;
    }

    const sc = (msg as { serverContent?: Record<string, any> }).serverContent;
    if (!sc) return;

    if (sc.inputTranscription?.text) {
      const cleaned = keepGeorgianOnly(sc.inputTranscription.text);
      if (cleaned) {
        this.pendingInputTranscript += (this.pendingInputTranscript ? " " : "") + cleaned;
        this.opts.onInputTranscript?.(cleaned);
      }
    }

    if (sc.outputTranscription?.text) {
      const cleaned = stripNonGeorgianScripts(sc.outputTranscription.text);
      if (cleaned) {
        this.pendingOutputTranscript += cleaned;
        this.opts.onOutputTranscript?.(cleaned);
      }
    }

    const parts = sc.modelTurn?.parts as Array<{ inlineData?: { data: string } }> | undefined;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part.inlineData?.data) {
          this.audioChunksForwarded++;
          this.opts.onAudio(Buffer.from(part.inlineData.data, "base64"));
        }
      }
    }

    if (sc.turnComplete) {
      Logger.info(`[${this.tag}] turn complete — forwarded ${this.audioChunksForwarded} audio chunks`);
      this.audioChunksForwarded = 0;
      this.flushTranscripts().catch((err) => Logger.error(`[${this.tag}] flush error`, err));
      this.opts.onTurnComplete?.();
    }
  }

  private async handleToolCalls(
    calls: Array<{ id?: string; name: string; args?: Record<string, unknown> }>
  ): Promise<void> {
    const functionResponses = await Promise.all(
      calls.map(async (call) => {
        Logger.info(`[${this.tag}] tool call: ${call.name} args=${JSON.stringify(call.args ?? {})}`);
        const response = await runGmailFunction(call.name, call.args ?? {});
        return { id: call.id, name: call.name, response };
      })
    );
    if (this.upstream.readyState === WebSocket.OPEN) {
      this.upstream.send(JSON.stringify({ toolResponse: { functionResponses } }));
      Logger.info(`[${this.tag}] tool response sent for ${functionResponses.length} call(s)`);
    }
  }

  private async flushTranscripts(): Promise<void> {
    const userText = this.pendingInputTranscript.trim();
    const assistantText = this.pendingOutputTranscript.trim();
    this.pendingInputTranscript = "";
    this.pendingOutputTranscript = "";

    if (this.opts.visitorId && userText.length > 0) {
      await appendMessage(this.opts.visitorId, MessageRole.USER, userText);
    }
    if (this.opts.visitorId && assistantText.length > 0) {
      await appendMessage(this.opts.visitorId, MessageRole.ASSISTANT, assistantText);
    }
  }

  private handleClose(code: number, reason: string): void {
    Logger.info(`[${this.tag}] upstream closed (${code}): ${reason}`);
    this.flushTranscripts().catch(() => {});
    this.opts.onClose?.(code, reason);
  }
}
