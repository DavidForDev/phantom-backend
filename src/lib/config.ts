import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("4000"),
  MONGODB_URI: z.string(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GEMINI_CHAT_MODEL: z.string().default("gemini-3.1-pro-preview"),
  GEMINI_AGENT_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_LIVE_MODEL: z.string().default("gemini-2.5-flash-native-audio-preview-12-2025"),
  GEMINI_LIVE_VOICE: z.string().default("Gacrux"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REDIRECT_URI: z.string().default("http://localhost:4000/gmail/auth/callback"),
  GMAIL_TOKEN_PATH: z.string().default("./data/gmail-token.json"),
});

const config = EnvironmentSchema.parse(process.env);

export default config;
export const isProdEnvironment = config.NODE_ENV === "production";
export const isDevEnvironment = config.NODE_ENV === "development";
