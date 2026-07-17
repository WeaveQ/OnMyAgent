import { describe, expect, test } from "bun:test";

import {
  emptyModelBehaviorOptions,
  emptyPendingPermissions,
  emptyPendingQuestions,
  emptyTodos,
  getSessionStatus,
  isActiveSessionStatus,
  permissionQueryKeyForSession,
  questionQueryKeyForSession,
  reloadAfterOrgOnboardingKey,
  requiredPermissionQueryKey,
  requiredQuestionQueryKey,
  todoQueryKeyForSession,
} from "../src/react-app/shell/session-route/state";

describe("session route state", () => {
  test("builds nullable query keys for session-scoped sync state", () => {
    expect(permissionQueryKeyForSession("ws_1", "ses_1")).toEqual(["react-session-permissions", "ws_1", "ses_1"]);
    expect(questionQueryKeyForSession("ws_1", "ses_1")).toEqual(["react-session-questions", "ws_1", "ses_1"]);
    expect(todoQueryKeyForSession("ws_1", "ses_1")).toEqual(["react-session-todos", "ws_1", "ses_1"]);
    expect(permissionQueryKeyForSession("", "ses_1")).toBeNull();
    expect(questionQueryKeyForSession("ws_1", null)).toBeNull();
    expect(todoQueryKeyForSession("ws_1", null)).toBeNull();
  });

  test("builds required query keys without nullable guards", () => {
    expect(requiredPermissionQueryKey("ws_1", "ses_1")).toEqual(["react-session-permissions", "ws_1", "ses_1"]);
    expect(requiredQuestionQueryKey("ws_1", "ses_1")).toEqual(["react-session-questions", "ws_1", "ses_1"]);
  });

  test("classifies active session statuses used by reload blockers", () => {
    expect(isActiveSessionStatus("running")).toBe(true);
    expect(isActiveSessionStatus("retry")).toBe(true);
    expect(isActiveSessionStatus("busy")).toBe(true);
    expect(isActiveSessionStatus("streaming")).toBe(true);
    expect(isActiveSessionStatus("done")).toBe(false);
    expect(isActiveSessionStatus(null)).toBe(false);
  });

  test("normalizes session status from status, state, and runStatus fields", () => {
    expect(getSessionStatus({ status: "running", state: "idle", runStatus: "busy" })).toBe("running");
    expect(getSessionStatus({ state: "retry", runStatus: "busy" })).toBe("retry");
    expect(getSessionStatus({ runStatus: "busy" })).toBe("busy");
    expect(getSessionStatus({ status: 42 })).toBe("idle");
    expect(getSessionStatus(null)).toBe("idle");
  });

  test("exports stable empty fallback arrays and reload flag key", () => {
    expect(emptyPendingPermissions).toEqual([]);
    expect(emptyPendingQuestions).toEqual([]);
    expect(emptyTodos).toEqual([]);
    expect(emptyModelBehaviorOptions).toEqual([]);
    expect(reloadAfterOrgOnboardingKey).toBe("onmyagent.reloadAfterOrgOnboarding");
  });
});
