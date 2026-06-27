import express, { type ErrorRequestHandler } from "express";
import { createServer } from "http";
import cors from "cors";
import { WebSocketServer } from "ws";
import config from "./lib/config";
import { connectDB, disconnectDB } from "./lib/db";
import Logger from "./lib/logger";
import AppError from "./lib/utils";
import indexRouter from "./routes/index.route";
import { handleVoiceConnection } from "./services/voice.service";

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

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/voice") {
    voiceWss.handleUpgrade(req, socket, head, (ws) => {
      voiceWss.emit("connection", ws, req);
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
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

process.on("unhandledRejection", (reason) => {
  Logger.error("Unhandled Promise Rejection", reason);
});
