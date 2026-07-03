import { useEffect, useRef } from "react";

import { personalLocalAgentConversationWarmup, type PersonalLocalAgent, type PersonalLocalAgentApprovalMode } from "../../../../app/lib/desktop";

export function useAcpInitialMessage(input: {
  workspaceRoot: string;
  agent: PersonalLocalAgent | null | undefined;
  conversationId: string | null | undefined;
  approvalMode: PersonalLocalAgentApprovalMode;
  model?: string | null;
  disabled?: boolean;
  onWarmup?: (result: { ok: boolean; providerSessionId?: string | null; error?: string | null }) => void;
}) {
  const warmedRef = useRef(new Set<string>());
  useEffect(() => {
    const agent = input.agent;
    const conversationId = input.conversationId?.trim();
    if (input.disabled || !agent || !conversationId || agent.status !== "online" || !agent.capability?.supportsAcp) return;
    const key = [input.workspaceRoot, agent.id, conversationId, input.model ?? "", input.approvalMode].join("::");
    if (warmedRef.current.has(key)) return;
    warmedRef.current.add(key);
    let cancelled = false;
    void personalLocalAgentConversationWarmup({
      workspaceRoot: input.workspaceRoot,
      agent,
      conversationId,
      approvalMode: input.approvalMode,
      model: input.model ?? null,
    }).then((result) => {
      if (!cancelled) input.onWarmup?.({ ok: result.ok, providerSessionId: result.providerSessionId ?? result.conversation?.providerSessionId ?? null, error: result.error ?? null });
    }).catch((error) => {
      if (!cancelled) input.onWarmup?.({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      cancelled = true;
    };
  }, [input.agent, input.approvalMode, input.conversationId, input.disabled, input.model, input.onWarmup, input.workspaceRoot]);
}
