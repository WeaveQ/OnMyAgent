export type ExpertSurfaceRoute = {
  sessionId: string;
  agentId: string | null;
};

export type ExpertSurfaceDraft = {
  agentId: string;
  operationId: string;
  boundSessionId: string | null;
  navigation: "pending" | "requested";
};

/**
 * The single Expert surface lifecycle state.
 *
 * Route and draft are deliberately orthogonal: an unbound draft chip may stay
 * available while a real tab owns the painted transcript. Keeping both in one
 * reducer avoids the old parallel draft boolean / agent / pending-tab states.
 */
export type ExpertSurfaceState = {
  workspaceId: string;
  route: ExpertSurfaceRoute | null;
  draft: ExpertSurfaceDraft | null;
  pendingTabSessionId: string | null;
};

export type ExpertSurfaceEvent =
  | {
      type: "OPEN_DRAFT";
      workspaceId: string;
      agentId: string;
      operationId: string;
    }
  | {
      type: "CREATE_BOUND";
      operationId: string;
      sessionId: string;
    }
  | { type: "REQUEST_NAVIGATION"; operationId: string }
  | {
      type: "SYNC_ROUTE";
      workspaceId: string;
      agentId: string | null;
      sessionId: string | null;
    }
  | { type: "SET_PENDING_TAB"; sessionId: string | null }
  | { type: "CLEAR_DRAFT" }
  | { type: "CREATE_FAILED"; operationId: string }
  | { type: "RESET"; workspaceId: string };

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function realSessionId(value: string | null | undefined): string | null {
  const sessionId = clean(value);
  return sessionId && !sessionId.startsWith("draft:") ? sessionId : null;
}

export function createExpertSurfaceInitialState(
  workspaceId: string,
): ExpertSurfaceState {
  return {
    workspaceId: clean(workspaceId),
    route: null,
    draft: null,
    pendingTabSessionId: null,
  };
}

export function createExpertSurfaceOperationId(): string {
  return crypto.randomUUID();
}

export function reduceExpertSurface(
  state: ExpertSurfaceState,
  event: ExpertSurfaceEvent,
): ExpertSurfaceState {
  switch (event.type) {
    case "OPEN_DRAFT": {
      const workspaceId = clean(event.workspaceId);
      const agentId = clean(event.agentId);
      const operationId = clean(event.operationId);
      if (!workspaceId || !agentId || !operationId) return state;
      return {
        workspaceId,
        route: workspaceId === state.workspaceId ? state.route : null,
        draft: {
          agentId,
          operationId,
          boundSessionId: null,
          navigation: "pending",
        },
        pendingTabSessionId: null,
      };
    }
    case "CREATE_BOUND": {
      const operationId = clean(event.operationId);
      const sessionId = realSessionId(event.sessionId);
      if (
        !state.draft ||
        operationId !== state.draft.operationId ||
        !sessionId
      ) return state;
      return {
        ...state,
        draft: {
          ...state.draft,
          boundSessionId: sessionId,
          navigation: "pending",
        },
        pendingTabSessionId: sessionId,
      };
    }
    case "REQUEST_NAVIGATION": {
      if (
        !state.draft?.boundSessionId ||
        clean(event.operationId) !== state.draft.operationId ||
        state.draft.navigation === "requested"
      ) return state;
      return {
        ...state,
        draft: { ...state.draft, navigation: "requested" },
      };
    }
    case "SYNC_ROUTE": {
      const workspaceId = clean(event.workspaceId);
      if (!workspaceId) return state;
      const sessionId = realSessionId(event.sessionId);
      const route = sessionId
        ? { sessionId, agentId: clean(event.agentId) || null }
        : null;
      if (workspaceId !== state.workspaceId) {
        return {
          workspaceId,
          route,
          draft: null,
          pendingTabSessionId: null,
        };
      }
      if (
        state.route?.sessionId === route?.sessionId &&
        state.route?.agentId === route?.agentId
      ) return state;
      return {
        ...state,
        route,
        pendingTabSessionId:
          route && route.sessionId === state.pendingTabSessionId
            ? null
            : state.pendingTabSessionId,
      };
    }
    case "SET_PENDING_TAB": {
      const sessionId = realSessionId(event.sessionId);
      if (sessionId === state.pendingTabSessionId) return state;
      return { ...state, pendingTabSessionId: sessionId };
    }
    case "CLEAR_DRAFT": {
      if (!state.draft && !state.pendingTabSessionId) return state;
      const boundSessionId = state.draft?.boundSessionId ?? null;
      return {
        ...state,
        draft: null,
        pendingTabSessionId:
          state.pendingTabSessionId === boundSessionId
            ? null
            : state.pendingTabSessionId,
      };
    }
    case "CREATE_FAILED": {
      if (!state.draft || clean(event.operationId) !== state.draft.operationId) {
        return state;
      }
      return { ...state, draft: null, pendingTabSessionId: null };
    }
    case "RESET":
      return createExpertSurfaceInitialState(event.workspaceId);
  }
}

export function selectExpertSurfaceNavigation(
  state: ExpertSurfaceState,
): { operationId: string; sessionId: string } | null {
  return state.draft?.boundSessionId && state.draft.navigation === "pending"
    ? {
        operationId: state.draft.operationId,
        sessionId: state.draft.boundSessionId,
      }
    : null;
}

export function shouldDropExpertSurfaceDraft(
  state: ExpertSurfaceState,
): boolean {
  return Boolean(
    state.route &&
      state.draft?.boundSessionId &&
      state.route.sessionId !== state.draft.boundSessionId,
  );
}
