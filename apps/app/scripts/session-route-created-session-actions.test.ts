import { describe, expect, test } from "bun:test";

import { activateCreatedSessionRoute } from "../src/react-app/shell/session-route/created-session-actions";

describe("session route created-session actions", () => {
  test("activates a newly created workspace session and suppresses restore", () => {
    const calls: string[] = [];
    const suppressRestoreSessionRef = { current: false };

    activateCreatedSessionRoute({
      focusPromptSoon: () => calls.push("focus"),
      navigateToWorkspaceSession: (workspaceId, sessionId) => calls.push(`navigate:${workspaceId}:${sessionId}`),
      rememberPendingCreatedSession: (workspaceId, sessionId) => calls.push(`remember:${workspaceId}:${sessionId}`),
      selectedWorkspaceId: "ws_1",
      sessionId: "ses_1",
      setAssistantDraftWorkspaceRoot: (value) => calls.push(`draft-root:${value}`),
      setLegacySelectedWorkspaceId: (workspaceId) => calls.push(`legacy:${workspaceId}`),
      suppressRestoreSessionRef,
      writeActiveWorkspaceId: (workspaceId) => calls.push(`active:${workspaceId ?? "null"}`),
      writeLastSessionFor: (workspaceId, sessionId) => calls.push(`last:${workspaceId}:${sessionId}`),
    });

    expect(suppressRestoreSessionRef.current).toBe(true);
    expect(calls).toEqual([
      "legacy:ws_1",
      "active:ws_1",
      "last:ws_1:ses_1",
      "remember:ws_1:ses_1",
      "navigate:ws_1:ses_1",
      "draft-root:",
      "focus",
    ]);
  });

  test("clears active workspace when created session has no selected workspace", () => {
    const calls: string[] = [];
    const suppressRestoreSessionRef = { current: false };

    activateCreatedSessionRoute({
      focusPromptSoon: () => calls.push("focus"),
      navigateToWorkspaceSession: (workspaceId, sessionId) => calls.push(`navigate:${workspaceId}:${sessionId}`),
      rememberPendingCreatedSession: (workspaceId, sessionId) => calls.push(`remember:${workspaceId}:${sessionId}`),
      selectedWorkspaceId: "",
      sessionId: "ses_1",
      setAssistantDraftWorkspaceRoot: (value) => calls.push(`draft-root:${value}`),
      setLegacySelectedWorkspaceId: (workspaceId) => calls.push(`legacy:${workspaceId}`),
      suppressRestoreSessionRef,
      writeActiveWorkspaceId: (workspaceId) => calls.push(`active:${workspaceId ?? "null"}`),
      writeLastSessionFor: (workspaceId, sessionId) => calls.push(`last:${workspaceId}:${sessionId}`),
    });

    expect(suppressRestoreSessionRef.current).toBe(true);
    expect(calls).toContain("active:null");
    expect(calls).toContain("navigate::ses_1");
  });
});
