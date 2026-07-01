import { workspaceServerId } from "../../app/lib/workspace-endpoint";
import type { WorkspaceConnectionState, WorkspaceSessionGroup } from "../../app/types";
import { getWorkspaceTaskLoadErrorDisplay } from "../../app/utils";
import type { RouteWorkspace } from "./session-route-model";

export function buildSidebarSessionStatusById(input: {
  groups: WorkspaceSessionGroup[];
  activityByWorkspaceId: Record<string, Record<string, string>>;
}) {
  const next: Record<string, string> = {};
  for (const group of input.groups) {
    const serverId = workspaceServerId(group.workspace);
    const workspaceStatuses = {
      ...(input.activityByWorkspaceId[group.workspace.id] ?? {}),
      ...(serverId ? (input.activityByWorkspaceId[serverId] ?? {}) : {}),
    };
    for (const session of group.sessions) {
      const status = workspaceStatuses[session.id];
      if (status) next[session.id] = status;
    }
  }
  return next;
}

export function resolveSidebarActiveWorkspaceId(input: {
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  groups: WorkspaceSessionGroup[];
}) {
  const sessionId = input.selectedSessionId?.trim() ?? "";
  if (sessionId) {
    const owner = input.groups.find((group) =>
      group.sessions.some((session) => session.id === sessionId),
    );
    if (owner?.workspace.id) return owner.workspace.id;
  }
  return input.selectedWorkspaceId;
}

export function buildWorkspaceConnectionStateById(input: {
  workspaces: RouteWorkspace[];
  errorsByWorkspaceId: Record<string, string | null>;
  overrides: Record<string, WorkspaceConnectionState>;
}) {
  const next: Record<string, WorkspaceConnectionState> = {
    ...input.overrides,
  };
  for (const workspace of input.workspaces) {
    if (workspace.workspaceType !== "remote") continue;
    const error = input.errorsByWorkspaceId[workspace.id]?.trim();
    if (!error || next[workspace.id]?.status === "connecting") continue;
    next[workspace.id] ??= {
      status: "error",
      message: getWorkspaceTaskLoadErrorDisplay(workspace, error).message || error,
      checkedAt: null,
    };
  }
  return next;
}

export function pruneWorkspaceConnectionStateById(input: {
  states: Record<string, WorkspaceConnectionState>;
  activeWorkspaceIds: Set<string>;
}) {
  let changed = false;
  const next: Record<string, WorkspaceConnectionState> = {};
  for (const [workspaceId, state] of Object.entries(input.states)) {
    if (input.activeWorkspaceIds.has(workspaceId)) {
      next[workspaceId] = state;
    } else {
      changed = true;
    }
  }
  return changed ? next : input.states;
}

export function setWorkspaceConnectionStateById(input: {
  states: Record<string, WorkspaceConnectionState>;
  workspaceId: string;
  state: WorkspaceConnectionState;
}) {
  return {
    ...input.states,
    [input.workspaceId]: input.state,
  };
}

export function removeWorkspaceConnectionStateById(input: {
  states: Record<string, WorkspaceConnectionState>;
  workspaceId: string;
}) {
  if (!Object.prototype.hasOwnProperty.call(input.states, input.workspaceId)) return input.states;
  const next = { ...input.states };
  delete next[input.workspaceId];
  return next;
}

export function buildWorkspaceConnectionErrorState(input: {
  message: string;
  checkedAt: number;
}): WorkspaceConnectionState {
  return {
    status: "error",
    message: input.message,
    checkedAt: input.checkedAt,
  };
}

export function applyWorkspaceSessionMissingEndpointState(input: {
  checkedAt: number;
  message: string;
  states: Record<string, WorkspaceConnectionState>;
  workspaceId: string;
}) {
  return setWorkspaceConnectionStateById({
    states: input.states,
    workspaceId: input.workspaceId,
    state: buildWorkspaceConnectionErrorState({
      message: input.message,
      checkedAt: input.checkedAt,
    }),
  });
}

export function buildWorkspaceConnectionLoadingState(input: {
  message: string;
}): WorkspaceConnectionState {
  return {
    status: "connecting",
    message: input.message,
    checkedAt: null,
  };
}

export function applyWorkspaceSessionLoadingConnectionState(input: {
  message: string;
  states: Record<string, WorkspaceConnectionState>;
  workspaceId: string;
}) {
  return setWorkspaceConnectionStateById({
    states: input.states,
    workspaceId: input.workspaceId,
    state: buildWorkspaceConnectionLoadingState({
      message: input.message,
    }),
  });
}

export function buildWorkspaceConnectionLoadedState(input: {
  taskCount: number;
  checkedAt: number;
  loadedMessage: string;
  emptyMessage: string;
}): WorkspaceConnectionState {
  return {
    status: "connected",
    message: input.taskCount > 0 ? input.loadedMessage : input.emptyMessage,
    checkedAt: input.checkedAt,
  };
}

export function applyWorkspaceSessionLoadSuccessConnectionState(input: {
  checkedAt: number;
  emptyMessage: string;
  isRemoteOpenworkWorkspace: boolean;
  loadedMessage: string;
  states: Record<string, WorkspaceConnectionState>;
  taskCount: number;
  workspaceId: string;
}) {
  if (input.isRemoteOpenworkWorkspace) {
    return setWorkspaceConnectionStateById({
      states: input.states,
      workspaceId: input.workspaceId,
      state: buildWorkspaceConnectionLoadedState({
        taskCount: input.taskCount,
        checkedAt: input.checkedAt,
        loadedMessage: input.loadedMessage,
        emptyMessage: input.emptyMessage,
      }),
    });
  }
  if (input.states[input.workspaceId]?.status !== "error") return input.states;
  return removeWorkspaceConnectionStateById({
    states: input.states,
    workspaceId: input.workspaceId,
  });
}

export function buildWorkspaceConnectionDiagnosticPlan(input: {
  state: WorkspaceConnectionState;
  fallbackMessage: string;
}) {
  return {
    errorMessage: input.state.message ?? input.fallbackMessage,
    connectionState: input.state,
  };
}

export function applyWorkspaceConnectionDiagnosticPlan(input: {
  plan: ReturnType<typeof buildWorkspaceConnectionDiagnosticPlan>;
  states: Record<string, WorkspaceConnectionState>;
  workspaceId: string;
}) {
  return setWorkspaceConnectionStateById({
    states: input.states,
    workspaceId: input.workspaceId,
    state: input.plan.connectionState,
  });
}

export function isCurrentWorkspaceConnectionCheck(input: {
  activeRunByWorkspaceId: Record<string, string>;
  workspaceId: string;
  runId: string;
  currentWorkspace: RouteWorkspace | null | undefined;
  connectionKey: string;
  getConnectionKey: (workspace: RouteWorkspace) => string;
}) {
  return input.activeRunByWorkspaceId[input.workspaceId] === input.runId &&
    !!input.currentWorkspace &&
    input.getConnectionKey(input.currentWorkspace) === input.connectionKey;
}

export function clearWorkspaceConnectionCheckRun(input: {
  activeRunByWorkspaceId: Record<string, string>;
  workspaceId: string;
  runId: string;
}) {
  if (input.activeRunByWorkspaceId[input.workspaceId] === input.runId) {
    delete input.activeRunByWorkspaceId[input.workspaceId];
  }
}
