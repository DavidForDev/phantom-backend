import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { AGENT_SYSTEM_PROMPT, AGENT_FALLBACK_ACTION } from "../prompts/agent.prompt";
import type { AgentAction, AgentRequest } from "../types/agent.types";
import config from "../lib/config";
import Logger from "../lib/logger";

const VALID_KINDS = new Set(["click", "type", "scroll", "ask_user", "done"]);

function parseAction(raw: string): AgentAction {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  const parsed = JSON.parse(cleaned);

  if (!parsed.kind || !VALID_KINDS.has(parsed.kind)) {
    throw new Error(`Invalid kind: ${parsed.kind}`);
  }
  return parsed as AgentAction;
}

export const generateNextAction = async (
  request: AgentRequest
): Promise<AgentAction> => {
  const { goal, elements, history } = request;

  try {
    const messages: { role: "user" | "assistant"; content: string }[] = [];

    if (history && Array.isArray(history)) {
      for (const step of history) {
        messages.push({
          role: "user",
          content: `Page elements:\n${step.elements}\n\nGoal: ${goal}`,
        });
        messages.push({ role: "assistant", content: JSON.stringify(step.action) });
        if (step.userAnswer) {
          messages.push({ role: "user", content: `User tapped: "${step.userAnswer}"` });
        }
      }
    }

    messages.push({
      role: "user",
      content: `Page elements:\n${elements}\n\nGoal: ${goal}`,
    });

    const result = await generateText({
      model: google(config.GEMINI_AGENT_MODEL),
      system: AGENT_SYSTEM_PROMPT,
      messages,
    });

    Logger.debug(`[agent] raw response: ${result.text.slice(0, 300)}`);
    const action = parseAction(result.text);
    Logger.debug("[agent] parsed action", action);
    return action;
  } catch (error) {
    Logger.error("[agent] generation failed, using fallback", error);
    return AGENT_FALLBACK_ACTION;
  }
};

export default {
  generateNextAction,
};
