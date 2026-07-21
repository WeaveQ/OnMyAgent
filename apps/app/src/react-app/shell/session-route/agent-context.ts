import type { SessionStartIntent } from "../../../app/types";
import type { PendingAgentContext } from "../../domains/agents";
import {
  readCustomAgentIdForSession,
  readSessionAgentSnapshot,
} from "../../domains/agents";

/**
 * Rebuild a pending agent from a prior session's local expert binding.
 * Used when force-new / idle auto-new / 新会话 creates a session but the
 * in-memory pending agent store is empty (refresh, navigation race, etc.).
 */
export function inheritPendingAgentFromSession(
  sessionId: string | null | undefined,
): PendingAgentContext | null {
  const id = sessionId?.trim() ?? "";
  if (!id || id.startsWith("draft:")) return null;

  const agentId = readCustomAgentIdForSession(id);
  if (!agentId) return null;

  const snapshot = readSessionAgentSnapshot(id);
  if (snapshot) {
    return {
      id: snapshot.id,
      name: snapshot.name,
      description: snapshot.description,
      systemPrompt: snapshot.systemPrompt,
      avatar: {
        avatarStyle: "robot",
        avatarOptionId: "inherited-session",
        customAvatarDataUrl: null,
        avatarUrl: snapshot.avatarUrl,
        avatarBackground: snapshot.avatarBackground,
      },
    };
  }

  // Id-only fallback: still binds the new session to the expert so the list
  // groups correctly and the header can restore from registry/marketplace.
  return {
    id: agentId,
    name: agentId,
    description: "",
    systemPrompt: "",
    avatar: {
      avatarStyle: "robot",
      avatarOptionId: "inherited-session",
      customAvatarDataUrl: null,
      avatarUrl: null,
      avatarBackground: "var(--ow-primary-light)",
    },
  };
}

export function resolvePendingAgentForPrompt(input: {
  currentAgent: PendingAgentContext | null;
  createdSession: boolean;
  sessionId: string;
  /**
   * Session the user was on before this create (force-new / idle-new).
   * When the pending store is empty, inherit that session's expert binding
   * so the new chat does not fall back to "默认智能体".
   */
  inheritFromSessionId?: string | null;
}) {
  let pendingAgentSnapshot: PendingAgentContext | null = input.createdSession
    ? input.currentAgent
    : null;

  if (
    input.createdSession &&
    !pendingAgentSnapshot &&
    input.inheritFromSessionId
  ) {
    pendingAgentSnapshot = inheritPendingAgentFromSession(
      input.inheritFromSessionId,
    );
  }

  const agentToolAccess =
    input.currentAgent &&
    (!input.currentAgent.boundSessionId ||
      input.currentAgent.boundSessionId === input.sessionId)
      ? input.currentAgent.tools
      : pendingAgentSnapshot?.tools;
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

export function registerCreatedSessionStartIntent(input: {
  sessionId: string;
  intent?: SessionStartIntent;
  /**
   * Fallback when intent is missing (legacy callers / force-new without stamp).
   * Prefer always passing intent from the page wrapper.
   */
  pageMode?: "assistant" | "expert";
  addAssistantSession: (sessionId: string) => void;
  addExpertSession: (sessionId: string) => void;
  writeAssistantSessionCategory: (
    sessionId: string,
    category: "code" | "office",
  ) => void;
}) {
  const mode =
    input.intent?.mode ??
    (input.pageMode === "assistant" || input.pageMode === "expert"
      ? input.pageMode
      : undefined);

  if (mode === "assistant") {
    input.addAssistantSession(input.sessionId);
    input.writeAssistantSessionCategory(
      input.sessionId,
      input.intent?.mode === "assistant"
        ? input.intent.assistantCategory
        : "office",
    );
  }
  if (mode === "expert") {
    input.addExpertSession(input.sessionId);
  }
}
