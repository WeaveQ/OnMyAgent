import { beforeEach, describe, expect, test } from "bun:test";

import {
  getSessionActivityStatusLabel,
  useSessionActivityStore,
  type SessionActivityStatus,
} from "../src/react-app/domains/session/status/session-activity-store";

beforeEach(() => {
  useSessionActivityStore.setState({
    recordsByWorkspaceId: {},
    statusesByWorkspaceId: {},
  });
});

describe("session activity store", () => {
  test("derives thinking and responding from run status and assistant output", () => {
    const store = useSessionActivityStore.getState();

    expect(store.getStatus("ws_1", "ses_1")).toBe("idle");

    store.seedSessionRun(" ws_1 ", " ses_1 ", "running", false);
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("thinking");

    useSessionActivityStore.getState().markMessageRole("ws_1", "ses_1", "msg_user", "user");
    useSessionActivityStore.getState().markAssistantOutput("ws_1", "ses_1", "msg_user");
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("thinking");

    useSessionActivityStore.getState().markMessageRole("ws_1", "ses_1", "msg_assistant", "assistant");
    useSessionActivityStore.getState().markAssistantOutput("ws_1", "ses_1", "msg_assistant");
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("responding");
  });

  test("prioritizes waiting, compacting, and error states over active runs", () => {
    useSessionActivityStore.getState().seedSessionRun("ws_1", "ses_1", "running", true);
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("responding");

    useSessionActivityStore.getState().setCompacting("ws_1", "ses_1", true);
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("compacting");

    useSessionActivityStore.getState().setWaitingRequest("ws_1", "ses_1", "permission", "perm_1", true);
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("waiting");

    useSessionActivityStore.getState().setError("ws_1", "ses_1", " failed ");
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("error");
    expect(useSessionActivityStore.getState().getErrorMessage("ws_1", "ses_1")).toBe("failed");

    useSessionActivityStore.getState().clearError("ws_1", "ses_1");
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("waiting");
  });

  test("dedupes and replaces waiting request ids", () => {
    useSessionActivityStore.getState().replaceWaitingRequests("ws_1", "ses_1", "question", [
      " q_1 ",
      "q_1",
      "",
      "q_2",
    ]);
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("waiting");

    const record = useSessionActivityStore.getState().recordsByWorkspaceId.ws_1?.ses_1;
    expect(record?.waitingQuestionIds).toEqual(["q_1", "q_2"]);

    useSessionActivityStore.getState().setWaitingRequest("ws_1", "ses_1", "question", "q_1", false);
    expect(useSessionActivityStore.getState().recordsByWorkspaceId.ws_1?.ses_1?.waitingQuestionIds).toEqual(["q_2"]);
  });

  test("seedWorkspaceSessions clears assistant output while preserving waiting requests", () => {
    useSessionActivityStore.getState().seedSessionRun("ws_1", "ses_1", "running", true);
    useSessionActivityStore.getState().setWaitingRequest("ws_1", "ses_1", "permission", "perm_1", true);
    useSessionActivityStore.getState().seedWorkspaceSessions("ws_1", [{ id: "ses_1", status: "idle" }]);

    const state = useSessionActivityStore.getState();
    expect(state.getStatus("ws_1", "ses_1")).toBe("waiting");
    expect(state.recordsByWorkspaceId.ws_1?.ses_1?.waitingPermissionIds).toEqual(["perm_1"]);
    expect(state.recordsByWorkspaceId.ws_1?.ses_1?.assistantOutput).toBe(false);
  });

  test("keeps a locally stopped session idle when a stale running snapshot arrives", () => {
    useSessionActivityStore.getState().startRun("ws_1", "ses_1");
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("thinking");

    useSessionActivityStore.getState().markRunStopped("ws_1", "ses_1");
    expect(useSessionActivityStore.getState().getStopRequested("ws_1", "ses_1")).toBe(true);
    useSessionActivityStore
      .getState()
      .seedWorkspaceSessions("ws_1", [{ id: "ses_1", status: "busy" }]);

    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("idle");
    expect(useSessionActivityStore.getState().getStopRequested("ws_1", "ses_1")).toBe(true);

    useSessionActivityStore.getState().startRun("ws_1", "ses_1");
    expect(useSessionActivityStore.getState().getStopRequested("ws_1", "ses_1")).toBe(false);
  });

  test("keeps a stable identity for local and backend-originated runs", () => {
    useSessionActivityStore
      .getState()
      .startRun("ws_1", "ses_1", { runKey: "ses_1:100", runStartedAt: 100 });
    expect(useSessionActivityStore.getState().getRunIdentity("ws_1", "ses_1")).toEqual({
      runKey: "ses_1:100",
      runStartedAt: 100,
    });

    useSessionActivityStore.getState().setRunStatus("ws_1", "ses_1", "idle");
    useSessionActivityStore.getState().setRunStatus("ws_1", "ses_1", "running");
    const remoteIdentity = useSessionActivityStore
      .getState()
      .getRunIdentity("ws_1", "ses_1");
    expect(remoteIdentity?.runKey).not.toBe("ses_1:100");
    expect(remoteIdentity?.runStartedAt).toBeNumber();

    useSessionActivityStore.getState().setError("ws_1", "ses_1", "cancelled");
    expect(useSessionActivityStore.getState().getRunIdentity("ws_1", "ses_1")).toEqual(
      remoteIdentity,
    );
  });

  test("removes sessions from records and status maps", () => {
    useSessionActivityStore.getState().seedSessionRun("ws_1", "ses_1", { type: "busy" }, false);
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("thinking");

    useSessionActivityStore.getState().removeSession("ws_1", "ses_1");
    expect(useSessionActivityStore.getState().getStatus("ws_1", "ses_1")).toBe("idle");
    expect(useSessionActivityStore.getState().recordsByWorkspaceId.ws_1?.ses_1).toBeUndefined();
  });

  test("exposes labels for every activity status", () => {
    const statuses = ["idle", "thinking", "responding", "error", "compacting", "waiting"] satisfies SessionActivityStatus[];

    for (const status of statuses) {
      expect(getSessionActivityStatusLabel(status)).toBeString();
      expect(getSessionActivityStatusLabel(status).length).toBeGreaterThan(0);
    }
  });
});
