import { Router } from "express";
import agentService from "../services/agent.service";
import AppError from "../lib/utils";
import type { AgentRequest } from "../types/agent.types";

const router = Router();

router.post("/", async (req, res) => {
  const body = req.body as Partial<AgentRequest>;
  if (!body.goal || typeof body.elements !== "string") {
    throw new AppError("Missing goal or elements in request body", 400);
  }

  const action = await agentService.generateNextAction({
    goal: body.goal,
    elements: body.elements,
    history: body.history,
  });

  return res.status(200).json(action);
});

export default router;
