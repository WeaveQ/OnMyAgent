import { describe, expect, test } from "bun:test";

import type { WorkspaceConnectionState, WorkspaceSessionGroup } from "../src/app/types";
import type { RouteWorkspace } from "../src/react-app/shell/session-route/model";
import {
  applyWorkspaceSessionLoadSuccessConnectionState,
  applyWorkspaceSessionLoadingConnectionState,
  applyWorkspaceSessionMissingEndpointState,
  buildSidebarSessionStatusById,
  buildWorkspaceConnectionStateById,
  clearWorkspaceConnectionCheckRun,
  isCurrentWorkspaceConnectionCheck,
  pruneWorkspaceConnectionStateById,
  removeWorkspaceConnectionStateById,
  resolveSidebarActiveWorkspaceId,
} from "../src/react-app/shell/session-route/sidebar-model";

const localWorkspace = {
  id: "ws_local",
  name: "Local",
  path: "/tmp/local",
  workspaceType: "local",
  displayNameResolved: "Local",
} satisfies RouteWorkspace;

const remoteWorkspace = {
  id: "rem_server_remote",
  name: "Remote",
  path: "/tmp/remote",
  workspaceType: "remote",
  displayNameResolved: "Remote",
} satisfies RouteWorkspace;

const groups = [
  {
    workspace: localWorkspace,
    sessions: [{ id: "ses_local", title: "Local Session" }],
  },
  {
    workspace: remoteWorkspace,
    sessions: [{ id: "ses_remote", title: "Remote Session" }],
  },
] satisfies WorkspaceSessionGroup[];

describe("session route sidebar model", () => {
  test("uses server activity statuses for remote sidebar sessions", () => {
    expect(
      buildSidebarSessionStatusById({
        groups,
        activityByWorkspaceId: {
          ws_local: { ses_local: "running" },
          rem_server_remote: { ses_remote: "stale" },
          server_remote: { ses_remote: "streaming" },
        },
      }),
    ).toEqual({
      ses_local: "running",
      ses_remote: "streaming",
    });

    expect(
      buildSidebarSessionStatusById({
        groups,
        activityByWorkspaceId: {
          server_remote: { ses_remote: "streaming" },
        },
      }),
    ).toEqual({
      ses_remote: "streaming",
    });
  });

  test("resolves active workspace from the selected session owner", () => {
    expect(
      resolveSidebarActiveWorkspaceId({
        selectedSessionId: " ses_remote ",
        selectedWorkspaceId: "ws_local",
        groups,
      }),
    ).toBe("rem_server_remote");

    expect(
      resolveSidebarActiveWorkspaceId({
        selectedSessionId: "missing",
        selectedWorkspaceId: "ws_local",
        groups,
      }),
    ).toBe("ws_local");
  });

  test("builds remote workspace connection errors without overriding connecting states", () => {
    const states = buildWorkspaceConnectionStateById({
      workspaces: [localWorkspace, remoteWorkspace],
      errorsByWorkspaceId: {
        ws_local: "local ignored",
        rem_server_remote: " remote failed ",
      },
      overrides: {
        ws_connecting: { status: "connecting", message: "Checking", checkedAt: null },
      },
    });

    expect(states.rem_server_remote?.status).toBe("error");
    expect(states.rem_server_remote?.message).toContain("remote failed");
    expect(states.ws_connecting).toEqual({ status: "connecting", message: "Checking", checkedAt: null });
    expect(states.ws_local).toBeUndefined();

    const connecting = buildWorkspaceConnectionStateById({
      workspaces: [remoteWorkspace],
      errorsByWorkspaceId: { ws_remote: "still failing" },
      overrides: {
        rem_server_remote: { status: "connecting", message: "Checking", checkedAt: null },
      },
    });

    expect(connecting.rem_server_remote).toEqual({ status: "connecting", message: "Checking", checkedAt: null });
  });

  test("keeps connection state updates referentially stable where possible", () => {
    const states: Record<string, WorkspaceConnectionState> = {
      ws_local: { status: "error", message: "Local failed", checkedAt: 1 },
      ws_remote: { status: "connected", message: "Loaded", checkedAt: 2 },
    };

    expect(pruneWorkspaceConnectionStateById({ states, activeWorkspaceIds: new Set(["ws_local", "ws_remote"]) })).toBe(states);
    expect(removeWorkspaceConnectionStateById({ states, workspaceId: "missing" })).toBe(states);
    expect(
      pruneWorkspaceConnectionStateById({ states, activeWorkspaceIds: new Set(["ws_remote"]) }),
    ).toEqual({ ws_remote: states.ws_remote });
  });

  test("applies loading, missing endpoint, and load success transitions", () => {
    const loading = applyWorkspaceSessionLoadingConnectionState({
      states: {},
      workspaceId: "ws_remote",
      message: "Checking",
    });
    expect(loading.ws_remote).toEqual({ status: "connecting", message: "Checking", checkedAt: null });

    const missing = applyWorkspaceSessionMissingEndpointState({
      states: loading,
      workspaceId: "ws_remote",
      message: "No endpoint",
      checkedAt: 10,
    });
    expect(missing.ws_remote).toEqual({ status: "error", message: "No endpoint", checkedAt: 10 });

    const remoteLoaded = applyWorkspaceSessionLoadSuccessConnectionState({
      states: missing,
      workspaceId: "ws_remote",
      isRemoteOnMyAgentWorkspace: true,
      taskCount: 2,
      loadedMessage: "Loaded tasks",
      emptyMessage: "No tasks",
      checkedAt: 20,
    });
    expect(remoteLoaded.ws_remote).toEqual({ status: "connected", message: "Loaded tasks", checkedAt: 20 });

    const localRecovered = applyWorkspaceSessionLoadSuccessConnectionState({
      states: { ws_local: { status: "error", message: "Local failed", checkedAt: 1 } },
      workspaceId: "ws_local",
      isRemoteOnMyAgentWorkspace: false,
      taskCount: 0,
      loadedMessage: "Loaded",
      emptyMessage: "Empty",
      checkedAt: 30,
    });
    expect(localRecovered.ws_local).toBeUndefined();
  });

  test("guards stale workspace connection checks", () => {
    const activeRunByWorkspaceId = { ws_remote: "run_1" };
    expect(
      isCurrentWorkspaceConnectionCheck({
        activeRunByWorkspaceId,
        workspaceId: "ws_remote",
        runId: "run_1",
        currentWorkspace: remoteWorkspace,
        connectionKey: "rem_server_remote",
        getConnectionKey: (workspace) => workspace.id,
      }),
    ).toBe(true);
    expect(
      isCurrentWorkspaceConnectionCheck({
        activeRunByWorkspaceId,
        workspaceId: "ws_remote",
        runId: "run_2",
        currentWorkspace: remoteWorkspace,
        connectionKey: "rem_server_remote",
        getConnectionKey: (workspace) => workspace.id,
      }),
    ).toBe(false);

    clearWorkspaceConnectionCheckRun({ activeRunByWorkspaceId, workspaceId: "ws_remote", runId: "run_2" });
    expect(activeRunByWorkspaceId.ws_remote).toBe("run_1");
    clearWorkspaceConnectionCheckRun({ activeRunByWorkspaceId, workspaceId: "ws_remote", runId: "run_1" });
    expect(activeRunByWorkspaceId.ws_remote).toBeUndefined();
  });
});
