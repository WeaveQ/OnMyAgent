export type ExpertSurfaceState =
  | {
      kind: "idle_draft";
      workspaceId: string;
      agentId: string | null;
      operationId: string | null;
    }
  | {
      kind: "creating";
      workspaceId: string;
      agentId: string;
      operationId: string;
      sessionId: string;
      navigation: "pending" | "requested";
    }
  | {
      kind: "real_session";
      workspaceId: string;
      agentId: string | null;
      sessionId: string;
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
      type: "OPEN_REAL_SESSION";
      workspaceId: string;
      agentId: string | null;
      sessionId: string;
    }
  | { type: "CREATE_FAILED"; operationId: string }
  | { type: "RESET"; workspaceId: string };

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function createExpertSurfaceInitialState(
  workspaceId: string,
): ExpertSurfaceState {
  return {
    kind: "idle_draft",
    workspaceId: clean(workspaceId),
    agentId: null,
    operationId: null,
  };
}

export function createExpertSurfaceOperationId(): string {
  return crypto.randomUUID();
}

/**
 * Pure lifecycle reducer. Operation/session ids are supplied by the event
 * creator and remain stable across effects and rerenders.
 */
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
      return { kind: "idle_draft", workspaceId, agentId, operationId };
    }
    case "CREATE_BOUND": {
      if (state.kind !== "idle_draft") return state;
      const operationId = clean(event.operationId);
      const sessionId = clean(event.sessionId);
      if (
        !state.agentId ||
        !state.operationId ||
        operationId !== state.operationId ||
        !sessionId ||
        sessionId.startsWith("draft:")
      ) return state;
      return {
        kind: "creating",
        workspaceId: state.workspaceId,
        agentId: state.agentId,
        operationId,
        sessionId,
        navigation: "pending",
      };
    }
    case "REQUEST_NAVIGATION": {
      if (
        state.kind !== "creating" ||
        clean(event.operationId) !== state.operationId ||
        state.navigation === "requested"
      ) return state;
      return { ...state, navigation: "requested" };
    }
    case "OPEN_REAL_SESSION": {
      const workspaceId = clean(event.workspaceId);
      const sessionId = clean(event.sessionId);
      if (!workspaceId || !sessionId || sessionId.startsWith("draft:")) {
        return state;
      }
      return {
        kind: "real_session",
        workspaceId,
        agentId: clean(event.agentId) || null,
        sessionId,
      };
    }
    case "CREATE_FAILED": {
      if (
        (state.kind !== "idle_draft" && state.kind !== "creating") ||
        clean(event.operationId) !== state.operationId
      ) return state;
      return {
        kind: "idle_draft",
        workspaceId: state.workspaceId,
        agentId: state.agentId,
        operationId: null,
      };
    }
    case "RESET":
      return createExpertSurfaceInitialState(event.workspaceId);
  }
}

export function selectExpertSurfaceNavigation(
  state: ExpertSurfaceState,
): { operationId: string; sessionId: string } | null {
  return state.kind === "creating" && state.navigation === "pending"
    ? { operationId: state.operationId, sessionId: state.sessionId }
    : null;
}
