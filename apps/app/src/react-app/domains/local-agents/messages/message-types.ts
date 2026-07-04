import type { PersonalLocalAgentRunResult } from "../../../../app/lib/desktop";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  createdAt: number;
  run?: PersonalLocalAgentRunResult | null;
};
