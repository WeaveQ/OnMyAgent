import { useCallback, useLayoutEffect, useMemo, useReducer } from "react";

import type { PendingAgentContext } from "../../agents";
import {
  createExpertSurfaceInitialState,
  reduceExpertSurface,
  type ExpertSurfaceEvent,
} from "./expert-surface-machine";
import { selectExpertSurfaceMode } from "./expert-surface-mode";

export function useExpertSurfaceController(input: {
  workspaceId: string;
  selectedSessionId: string | null;
  selectedSessionAgentId: string | null;
}) {
  const [state, dispatch] = useReducer(
    reduceExpertSurface,
    input.workspaceId,
    createExpertSurfaceInitialState,
  );

  useLayoutEffect(() => {
    dispatch({
      type: "SYNC_ROUTE",
      workspaceId: input.workspaceId,
      sessionId: input.selectedSessionId,
      agentId: input.selectedSessionAgentId,
    });
  }, [input.selectedSessionAgentId, input.selectedSessionId, input.workspaceId]);

  const mode = useMemo(() => selectExpertSurfaceMode(state), [state]);
  const openDraft = useCallback(
    (agent: PendingAgentContext) => {
      const operationId = agent.operationId?.trim() ?? "";
      if (!operationId) return;
      dispatch({
        type: "OPEN_DRAFT",
        workspaceId: input.workspaceId,
        agentId: agent.id,
        operationId,
      });
    },
    [input.workspaceId],
  );
  const clearDraft = useCallback(() => {
    dispatch({ type: "CLEAR_DRAFT" });
  }, []);
  const setPendingTabSessionId = useCallback((sessionId: string | null) => {
    dispatch({ type: "SET_PENDING_TAB", sessionId });
  }, []);
  const send = useCallback((event: ExpertSurfaceEvent) => dispatch(event), []);

  return {
    state,
    mode,
    dispatch: send,
    openDraft,
    clearDraft,
    setPendingTabSessionId,
    draftSessionActive: state.draft !== null,
    draftAgentId: state.draft?.agentId ?? null,
    pendingTabSessionId: state.pendingTabSessionId,
  };
}
