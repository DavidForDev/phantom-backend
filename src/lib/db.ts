import mongoose from "mongoose";
import config from "./config.js";
import Logger from "./logger.js";

let connecting: Promise<void> | null = null;

export async function connectDB(): Promise<void> {
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      await mongoose.connect(config.MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
      });
      Logger.info("[mongo] connected");
    } catch (err) {
      connecting = null;
      Logger.error("[mongo] connection failed, retrying in 5s...", err);
      setTimeout(() => {
        connectDB().catch(() => {});
      }, 5000);
      throw err;
    }
  })();

  return connecting;
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect().catch(() => {});
}

export function isDBReady(): boolean {
  return mongoose.connection.readyState === 1;
}
