import { Router } from "express";
import {
  GMAIL_SCOPES,
  loadToken,
  makeOAuthClient,
  saveToken,
} from "../lib/gmail-oauth";
import gmailService from "../services/gmail.service";
import AppError from "../lib/utils";
import Logger from "../lib/logger";

const router = Router();

router.get("/auth", (_req, res) => {
  const client = makeOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
  });
  res.redirect(url);
});

router.get("/auth/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) throw new AppError("Missing ?code from Google", 400);

  const client = makeOAuthClient();
  const { tokens } = await client.getToken(code);
  await saveToken(tokens);
  Logger.info("[gmail] authorized successfully");
  res
    .status(200)
    .send("<h2>Gmail connected!</h2><p>You can close this tab.</p>");
});

router.get("/auth/status", async (_req, res) => {
  const token = await loadToken();
  res.json({ connected: !!token });
});

router.get("/messages", async (req, res) => {
  const query = (req.query.q as string | undefined) ?? undefined;
  const max = req.query.max ? Number(req.query.max) : 5;
  const messages = await gmailService.listMessages({ query, max });
  res.json({ messages });
});

router.get("/messages/:id", async (req, res) => {
  const message = await gmailService.getMessage(req.params.id);
  res.json({ message });
});

export default router;
