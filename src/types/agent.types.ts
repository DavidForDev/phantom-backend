export type AgentActionKind = "click" | "type" | "scroll" | "ask_user" | "done";

export interface AgentAction {
  kind: AgentActionKind;
  ref?: number;
  text?: string;
  direction?: "up" | "down";
  question?: string;
  options?: string[];
  message?: string;
  thought?: string;
}

export interface AgentStep {
  elements: string;
  action: AgentAction;
  userAnswer?: string;
}

export interface AgentRequest {
  goal: string;
  elements: string;
  history?: AgentStep[];
}
