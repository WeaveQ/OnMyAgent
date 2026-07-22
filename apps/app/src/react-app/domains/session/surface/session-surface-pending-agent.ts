/**
 * Pending-agent restore + effective agent resolution for SessionSurface.
 * Keeps registry restore out of the host body without changing behavior.
 */
import { useEffect } from "react";

import {
  buildPendingAgentFromRecord,
  readCustomAgentIdForSession,
  useAgentRegistryStore,
  usePendingAgentStore,
  type PendingAgentContext,
} from "../../agents";

export type SessionSurfacePendingAgentInput = {
  personalAssistantHome?: boolean;
  sessionId: string;
  agentContext?: PendingAgentContext | null;
};

export function useSessionSurfacePendingAgent(
  input: SessionSurfacePendingAgentInput,
) {
  const pendingAgent = usePendingAgentStore((state) => state.agent);

  // Subscribe to the global registry store so we re-run the restore effect
  // after a hard reload (when the registry wasn't available on first mount).
  const registry = useAgentRegistryStore((state) => state.registry);

  // Restore the pending agent when a session is re-opened: read the cached
  // custom agent ID for this session from localStorage, look it up in the
  // global registry store, and rebuild a PendingAgentContext so the welcome
  // card and transcript avatar render correctly.
  useEffect(() => {
    if (input.personalAssistantHome) return;
    if (!input.sessionId || !registry) return;
    const current = usePendingAgentStore.getState().agent;
    // Already have the right agent for this session — nothing to do.
    if (current && current.boundSessionId === input.sessionId) {
      return;
    }
    const agentId = readCustomAgentIdForSession(input.sessionId);
    if (!agentId) return;
    // The current pending agent either doesn't match this session's agent
    // (navigation to a different agent) — overwrite with the correct agent.
    // This also fixes the "+ 新会话 -> switch agent" case where the pending
    // agent was set by handleCreateCurrentAgentSession (unbound) and the user
    // then navigated away to a different agent's session.
    if (current && current.id === agentId) {
      // Same agent, just bind it to this session (e.g. sending first message
      // in a draft navigates here) — keep other fields.
      usePendingAgentStore.getState().setAgent({
        ...current,
        boundSessionId: input.sessionId,
      });
      return;
    }
    // Different agent — look in BOTH custom agents AND templates to restore.
    const agent =
      registry.agents.find((a) => a.id === agentId) ??
      registry.templates.find((t) => t.id === agentId);
    if (!agent) return;
    const restored = buildPendingAgentFromRecord(agent, registry);
    if (restored) {
      usePendingAgentStore.getState().setAgent({
        ...restored,
        boundSessionId: input.sessionId,
      });
    }
  }, [input.sessionId, registry]);

  // Only use the pending agent if it's either unbound (draft-only state,
  // session doesn't exist yet) or bound to the session we're currently
  // viewing. This keeps the agent avatar/system prompt from bleeding into
  // unrelated sessions the user navigates to later.
  const effectiveAgent = input.personalAssistantHome
    ? null
    : input.agentContext
      ? input.agentContext
      : pendingAgent &&
          (!pendingAgent.boundSessionId ||
            pendingAgent.boundSessionId === input.sessionId)
        ? pendingAgent
        : null;

  return { pendingAgent, effectiveAgent };
}
