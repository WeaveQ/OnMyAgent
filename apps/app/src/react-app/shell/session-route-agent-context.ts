import type { SessionStartIntent } from "../../app/types";
import type { PendingAgentContext } from "../domains/agents";

export function resolvePendingAgentForPrompt(input: {
  currentAgent: PendingAgentContext | null;
  createdSession: boolean;
  draftRuntime?: PendingAgentContext["runtime"];
  persistedRuntime?: PendingAgentContext["runtime"];
  sessionId: string;
}) {
  const pendingAgentSnapshot = input.createdSession ? input.currentAgent : null;
  const sessionAgent =
    input.currentAgent &&
    (input.createdSession || input.currentAgent.boundSessionId === input.sessionId)
      ? input.currentAgent
      : null;
  const agentToolAccess =
    input.currentAgent &&
    (!input.currentAgent.boundSessionId || input.currentAgent.boundSessionId === input.sessionId)
      ? input.currentAgent.tools
      : undefined;
  return {
    pendingAgentSnapshot,
    agentToolAccess,
    agentRuntime:
      input.draftRuntime ?? sessionAgent?.runtime ?? input.persistedRuntime,
  };
}

export function bindPendingAgentToSession(input: {
  agent: PendingAgentContext;
  sessionId: string;
}) {
  return {
    ...input.agent,
    boundSessionId: input.sessionId,
  };
}

export function registerCreatedSessionStartIntent(input: {
  sessionId: string;
  intent?: SessionStartIntent;
  addAssistantSession: (sessionId: string) => void;
  addExpertSession: (sessionId: string) => void;
  writeAssistantSessionCategory: (
    sessionId: string,
    category: "code" | "office",
  ) => void;
}) {
  if (input.intent?.mode === "assistant") {
    input.addAssistantSession(input.sessionId);
    input.writeAssistantSessionCategory(
      input.sessionId,
      input.intent.assistantCategory,
    );
  }
  if (input.intent?.mode === "expert") {
    input.addExpertSession(input.sessionId);
  }
}
