import { Router } from "express";
import { generateNextAction } from "../services/agent.service.js";
import { httpError } from "../lib/errors.js";
import type { AgentRequest } from "../types/agent.types.js";

const router = Router();

router.post("/", async (req, res) => {
  const body = req.body as Partial<AgentRequest>;
  if (!body.goal || typeof body.elements !== "string") {
    throw httpError("Missing goal or elements in request body", 400);
  }

  const action = await generateNextAction({
    goal: body.goal,
    elements: body.elements,
    history: body.history,
  });

  return res.status(200).json(action);
});

export default router;
