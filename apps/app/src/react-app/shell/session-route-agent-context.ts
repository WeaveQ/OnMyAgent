import type { PendingAgentContext } from "../domains/shared/pending-agent-store";

export function resolvePendingAgentForPrompt(input: {
  currentAgent: PendingAgentContext | null;
  createdSession: boolean;
  sessionId: string;
}) {
  const pendingAgentSnapshot = input.createdSession ? input.currentAgent : null;
  const agentToolAccess =
    input.currentAgent &&
    (!input.currentAgent.boundSessionId || input.currentAgent.boundSessionId === input.sessionId)
      ? input.currentAgent.tools
      : undefined;
  return {
    pendingAgentSnapshot,
    agentToolAccess,
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

export function registerCreatedSessionAgentCategory(input: {
  sessionId: string;
  consumePendingAssistantTask: () => boolean;
  consumePendingExpertTask: () => boolean;
  addAssistantSession: (sessionId: string) => void;
  addExpertSession: (sessionId: string) => void;
}) {
  if (input.consumePendingAssistantTask()) {
    input.addAssistantSession(input.sessionId);
  }
  if (input.consumePendingExpertTask()) {
    input.addExpertSession(input.sessionId);
  }
}
