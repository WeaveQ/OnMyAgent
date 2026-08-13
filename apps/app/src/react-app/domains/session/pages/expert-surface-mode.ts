import type { ExpertSurfaceState } from "./expert-surface-machine";

export type ExpertSurfaceModeKind = "idle_draft" | "creating" | "real_session";

export type ExpertSurfaceMode = {
  kind: ExpertSurfaceModeKind;
  sessionId: string;
  draftOnly: boolean;
  showDraftChrome: boolean;
  conversationAgentId: string | null;
  draftTabSessionId: string | null;
  creatingSessionId: string | null;
  mayForceNavToBound: boolean;
};

export function readRealSessionId(
  sessionId: string | null | undefined,
): string | null {
  const id = sessionId?.trim() ?? "";
  if (!id || id.startsWith("draft:")) return null;
  return id;
}

export function buildExpertDraftTabSessionId(
  workspaceId: string,
  draftAgentId: string | null | undefined,
): string {
  const workspace = workspaceId.trim() || "workspace";
  const agent = draftAgentId?.trim() ?? "";
  return agent ? `draft:${workspace}:${agent}` : `draft:${workspace}`;
}

/** The only projection from lifecycle state to painted Expert surface mode. */
export function selectExpertSurfaceMode(
  state: ExpertSurfaceState,
): ExpertSurfaceMode {
  const route = state.route;
  const draft = state.draft;
  const boundSessionId = draft?.boundSessionId ?? null;
  const draftTabSessionId = buildExpertDraftTabSessionId(
    state.workspaceId,
    draft?.agentId,
  );

  if (
    route &&
    boundSessionId &&
    route.sessionId !== boundSessionId &&
    route.sessionId !== draft?.sourceRouteSessionId
  ) {
    return {
      kind: "real_session",
      sessionId: route.sessionId,
      draftOnly: false,
      showDraftChrome: false,
      conversationAgentId: route.agentId,
      draftTabSessionId: null,
      creatingSessionId: boundSessionId,
      mayForceNavToBound: false,
    };
  }

  if (draft && boundSessionId) {
    if (route?.sessionId === boundSessionId) {
      return {
        kind: "real_session",
        sessionId: boundSessionId,
        draftOnly: false,
        showDraftChrome: false,
        conversationAgentId: draft.agentId,
        draftTabSessionId: null,
        creatingSessionId: null,
        mayForceNavToBound: false,
      };
    }
    return {
      kind: "creating",
      sessionId: boundSessionId,
      draftOnly: false,
      showDraftChrome: false,
      conversationAgentId: draft.agentId,
      draftTabSessionId: null,
      creatingSessionId: boundSessionId,
      mayForceNavToBound: true,
    };
  }

  if (draft) {
    if (route) {
      return {
        kind: "real_session",
        sessionId: route.sessionId,
        draftOnly: false,
        showDraftChrome: true,
        conversationAgentId: draft.agentId,
        draftTabSessionId,
        creatingSessionId: null,
        mayForceNavToBound: false,
      };
    }
    return {
      kind: "idle_draft",
      sessionId: draftTabSessionId,
      draftOnly: true,
      showDraftChrome: true,
      conversationAgentId: draft.agentId,
      draftTabSessionId,
      creatingSessionId: null,
      mayForceNavToBound: false,
    };
  }

  if (route) {
    return {
      kind: "real_session",
      sessionId: route.sessionId,
      draftOnly: false,
      showDraftChrome: false,
      conversationAgentId: route.agentId,
      draftTabSessionId: null,
      creatingSessionId: null,
      mayForceNavToBound: false,
    };
  }

  return {
    kind: "idle_draft",
    sessionId: draftTabSessionId,
    draftOnly: true,
    showDraftChrome: false,
    conversationAgentId: null,
    draftTabSessionId: null,
    creatingSessionId: null,
    mayForceNavToBound: false,
  };
}

export function isLiveExpertSessionSelection(input: {
  selectedSessionId: string | null | undefined;
  liveSessionIds: readonly string[];
  inventoryReady: boolean;
}): boolean {
  const id = readRealSessionId(input.selectedSessionId);
  if (!id) return false;
  if (!input.inventoryReady) return true;
  return input.liveSessionIds.some((sessionId) => sessionId.trim() === id);
}
