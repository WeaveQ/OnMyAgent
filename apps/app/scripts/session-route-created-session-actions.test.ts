import { describe, expect, test } from "bun:test";

import {
  activateCreatedSessionRoute,
  bindExpertFreshIdleDraft,
} from "../src/react-app/shell/session-route/created-session-actions";
import type { PendingAgentContext } from "../src/react-app/domains/agents/pending-agent-store";

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

  test("bindExpertFreshIdleDraft opens idle draft without ses_* or startRun", () => {
    const opened: string[] = [];
    const stored: PendingAgentContext[] = [];
    const forceNew = { current: false };
    const snapshot: PendingAgentContext = {
      id: "agent-a",
      name: "Agent A",
      description: "desc",
      systemPrompt: "Be the expert",
      avatar: {
        avatarStyle: "robot",
        avatarOptionId: "test",
        customAvatarDataUrl: null,
        avatarUrl: null,
        avatarBackground: "#111",
      },
      boundSessionId: "ses_old",
    };
    const result = bindExpertFreshIdleDraft({
      workspaceId: "ws-1",
      forceNewSessionOnNextSendRef: forceNew,
      openIdleDraft: (workspaceId) => opened.push(workspaceId),
      pendingAgentSnapshot: snapshot,
      setAgent: (agent) => stored.push(agent),
      createOperationId: () => "op-1",
      nowMs: 42,
    });
    expect(forceNew.current).toBe(true);
    expect(opened).toEqual(["ws-1"]);
    expect(result?.id).toBe("agent-a");
    expect(result?.id.startsWith("ses_")).toBe(false);
    expect(result?.boundSessionId).toBeUndefined();
    expect(stored[0]?.boundSessionId).toBeUndefined();
  });

  test("bindExpertFreshIdleDraft does not invent a blank persona when snapshot is missing", () => {
    const stored: PendingAgentContext[] = [];
    const opened: string[] = [];
    const result = bindExpertFreshIdleDraft({
      workspaceId: "ws-1",
      forceNewSessionOnNextSendRef: { current: false },
      openIdleDraft: (workspaceId) => opened.push(workspaceId),
      pendingAgentSnapshot: null,
      setAgent: (agent) => stored.push(agent),
    });
    expect(opened).toEqual(["ws-1"]);
    expect(result).toBeNull();
    expect(stored).toEqual([]);
  });
});
