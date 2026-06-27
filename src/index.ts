import express, { type ErrorRequestHandler } from "express";
import { createServer } from "http";
import cors from "cors";
import { WebSocketServer } from "ws";
import config from "./lib/config.js";
import { connectDB, disconnectDB } from "./lib/db.js";
import Logger from "./lib/logger.js";
import AppError from "./lib/utils.js";
import indexRouter from "./routes/index.route.js";
import { handleVoiceConnection } from "./services/voice.service.js";
import { handleTwilioConnection } from "./services/twilio.service.js";

const app = express();

app.use(cors({ origin: config.CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

app.use("/", indexRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { message: err.message } });
    return;
  }
  Logger.error("Error in request", err);
  res.status(500).json({ error: { message: "Something went wrong" } });
};
app.use(errorHandler);

const server = createServer(app);

const voiceWss = new WebSocketServer({ noServer: true });
voiceWss.on("connection", handleVoiceConnection);

const twilioWss = new WebSocketServer({ noServer: true });
twilioWss.on("connection", handleTwilioConnection);

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/voice") {
    voiceWss.handleUpgrade(req, socket, head, (ws) => {
      voiceWss.emit("connection", ws, req);
    });
    return;
  }
  if (req.url === "/twilio/stream") {
    twilioWss.handleUpgrade(req, socket, head, (ws) => {
      twilioWss.emit("connection", ws, req);
    });
    return;
  }
  socket.destroy();
});

server.listen(Number(config.PORT), () => {
  Logger.info(`[phantom backend] listening on port ${config.PORT}`);
  connectDB().catch(() => {});
});

async function shutdown() {
  await disconnectDB();
  voiceWss.close();
  twilioWss.close();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

process.on("unhandledRejection", (reason) => {
  Logger.error("Unhandled Promise Rejection", reason);
});
