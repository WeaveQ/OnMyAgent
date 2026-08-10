/**
 * Single expert chat surface mode.
 *
 * All of draftOnly / tab selection / bound-draft force-nav must read this —
 * do not keep a parallel `draftSessionActive` vs `isDraftSession` pair that
 * can disagree under first-send + tab switch.
 *
 * Derivation inputs (only):
 * - route `selectedSessionId`
 * - pending bind (`pendingBoundSessionId` + agent ids)
 * - `draftIntent` (user opened 新会话 / 去聊天; cleared on explicit real-tab open)
 */

export type ExpertSurfaceModeKind = "idle_draft" | "creating" | "real_session";

export type ExpertSurfaceMode = {
  kind: ExpertSurfaceModeKind;
  /** Session id SessionSurface binds to */
  sessionId: string;
  /** Disable snapshot/transcript for pure draft shell */
  draftOnly: boolean;
  /** Synthetic draft tab + draft agent chrome in the sidebar/tabs */
  showDraftChrome: boolean;
  /** Agent driving the conversation panel / tab strip scope */
  conversationAgentId: string | null;
  /** `draft:workspace:agent` when showDraftChrome */
  draftTabSessionId: string | null;
  /** In-flight first-send session (pending tab highlight) */
  creatingSessionId: string | null;
  /**
   * bound-draft may navigate route → bound session.
   * False when the user already selected a different real tab.
   */
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

export function resolveExpertSurfaceMode(input: {
  selectedSessionId: string | null | undefined;
  workspaceId: string;
  /** User activated new-session / open-chat / agent draft (intent, not surface mode). */
  draftIntent: boolean;
  draftAgentId: string | null;
  pendingAgentId: string | null;
  pendingBoundSessionId: string | null | undefined;
  /** Agent id of the route session when known */
  selectedSessionAgentId: string | null;
}): ExpertSurfaceMode {
  const routeReal = readRealSessionId(input.selectedSessionId);
  const bound = readRealSessionId(input.pendingBoundSessionId);
  const draftAgent =
    input.draftAgentId?.trim() ||
    input.pendingAgentId?.trim() ||
    null;
  const draftTabSessionId = buildExpertDraftTabSessionId(
    input.workspaceId,
    draftAgent,
  );
  const selectedAgent = input.selectedSessionAgentId?.trim() || null;

  // Route owns the surface when the user is on a real session that is not the
  // in-flight create target. Background create continues; never force-nav back.
  if (routeReal && bound && routeReal !== bound) {
    return {
      kind: "real_session",
      sessionId: routeReal,
      draftOnly: false,
      showDraftChrome: false,
      conversationAgentId: selectedAgent,
      draftTabSessionId: null,
      creatingSessionId: bound,
      mayForceNavToBound: false,
    };
  }

  // First send created a real session — surface is never draftOnly.
  if (bound && input.draftIntent) {
    if (routeReal === bound) {
      return {
        kind: "real_session",
        sessionId: bound,
        draftOnly: false,
        showDraftChrome: false,
        conversationAgentId: draftAgent ?? selectedAgent,
        draftTabSessionId: null,
        creatingSessionId: null,
        mayForceNavToBound: false,
      };
    }
    // Route not caught up yet (or still empty) → creating + allow force-nav.
    return {
      kind: "creating",
      sessionId: bound,
      draftOnly: false,
      showDraftChrome: false,
      conversationAgentId: draftAgent,
      draftTabSessionId: null,
      creatingSessionId: bound,
      mayForceNavToBound: true,
    };
  }

  // Unbound draft intent. Route always owns *paint* when it already has a real
  // session — otherwise a stuck draftIntent (tab-switch gap re-activate /
  // agent-selection keep) forces draftOnly and blanks the transcript.
  // Empty draft shell only when there is no real route (openFresh cleared it).
  if (input.draftIntent && !bound) {
    if (routeReal) {
      return {
        kind: "real_session",
        sessionId: routeReal,
        draftOnly: false,
        // Keep draft chip so 新会话/去聊天 chrome is still reachable; surface
        // shows the selected real tab so multi-switch never goes white.
        showDraftChrome: true,
        conversationAgentId: draftAgent ?? selectedAgent,
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
      conversationAgentId: draftAgent,
      draftTabSessionId,
      creatingSessionId: null,
      mayForceNavToBound: false,
    };
  }

  if (routeReal) {
    return {
      kind: "real_session",
      sessionId: routeReal,
      draftOnly: false,
      showDraftChrome: false,
      conversationAgentId: selectedAgent,
      draftTabSessionId: null,
      creatingSessionId: bound && bound !== routeReal ? bound : null,
      mayForceNavToBound: false,
    };
  }

  // Empty route, no draft intent — empty draft shell for cold expert home.
  return {
    kind: "idle_draft",
    sessionId: draftTabSessionId,
    draftOnly: true,
    showDraftChrome: false,
    conversationAgentId: selectedAgent ?? draftAgent,
    draftTabSessionId: null,
    creatingSessionId: null,
    mayForceNavToBound: false,
  };
}

/**
 * Auto-drop draft intent when route points at a real session that is not the
 * in-flight create target. Unbound drafts are NOT dropped on residual route
 * alone (agent-selection keep / openFresh lag) — explicit tab open clears
 * intent via handleOpenExpertSession.
 */
export function shouldDropDraftIntentForRoute(input: {
  draftIntent: boolean;
  selectedSessionId: string | null | undefined;
  pendingBoundSessionId: string | null | undefined;
}): boolean {
  if (!input.draftIntent) return false;
  const routeReal = readRealSessionId(input.selectedSessionId);
  if (!routeReal) return false;
  const bound = readRealSessionId(input.pendingBoundSessionId);
  if (!bound) return false;
  return routeReal !== bound;
}

/**
 * Whether the route session id is still a live expert session in inventory.
 * After hard-delete, the URL can still point at a removed ses_* for a tick
 * (or longer if navigate lags). Treating that as real_session loads a 404
 * snapshot and paints a blank middle — the "delete expert → white screen" bug.
 *
 * When inventory is not ready yet, keep the selection (avoid empty flash).
 */
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
