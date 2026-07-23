import { describe, expect, test } from "bun:test";

import {
  resolveControlSessionWorkspaceId,
  resolveCreateTaskWorkspaceNavigation,
  resolveSessionRouteModeSwitchPath,
  resolveSessionRouteRestoreNavigation,
  resolveWorkspaceSelectionSessionTarget,
  resolveWorkspaceSessionRoute,
  shouldRedirectSessionRouteToWelcome,
} from "../src/react-app/shell/session-route/control";
import { INITIAL_UI } from "../src/react-app/kernel/local-provider";
import type { SidebarSessionItem } from "../src/app/types";
import {
  buildSelectedWorkspaceRouteState,
  buildSettingsNavigationTarget,
} from "../src/react-app/shell/session-route/model";
import type { RouteWorkspace } from "../src/react-app/shell/session-route/model";

function session(id: string): SidebarSessionItem {
  return { id, title: id, version: "0.0.0", time: { created: 1, updated: 1 } };
}

function workspace(id: string, input: Partial<RouteWorkspace> = {}): RouteWorkspace {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    preset: "local",
    workspaceType: "local",
    displayNameResolved: id,
    ...input,
  };
}

function owns(input: { sessionId: string; sessions: SidebarSessionItem[] }) {
  return input.sessions.some((item) => item.id === input.sessionId);
}

describe("session route control", () => {
  test("defaults first safe local UI state to the assistant session surface", () => {
    expect(INITIAL_UI).toEqual({ view: "session", tab: "general" });
  });

  test("opens the settings account entry on overview for workspace routes", () => {
    expect(
      buildSettingsNavigationTarget({
        route: "/settings/general",
        workspaceId: "ws_a",
        activeWorkspaceId: "ws_a",
        selectedSessionId: "ses_a",
        pageMode: "assistant",
        returnTo: "/workspace/ws_a/assistant/ses_a?view=files",
        workspaceSettingsRoute: (workspaceId, tab) => `/workspace/${workspaceId}/settings/${tab}`,
      }),
    ).toEqual({
      target: "/workspace/ws_a/settings/general",
      state: {
        workspaceId: "ws_a",
        sessionId: "ses_a",
        pageMode: "assistant",
        returnTo: "/workspace/ws_a/assistant/ses_a?view=files",
      },
    });
  });

  test("settings navigation state captures expert mode for back-to-app", () => {
    expect(
      buildSettingsNavigationTarget({
        route: "/settings/ai",
        workspaceId: "ws_a",
        activeWorkspaceId: "ws_a",
        selectedSessionId: "ses_expert",
        pageMode: "expert",
        returnTo: "/workspace/ws_a/session/ses_expert",
        workspaceSettingsRoute: (workspaceId, tab) => `/workspace/${workspaceId}/settings/${tab}`,
      }).state.pageMode,
    ).toBe("expert");
  });

  test("uses selected session directory when no assistant workspace record exists", () => {
    expect(
      buildSelectedWorkspaceRouteState({
        selectedWorkspace: workspace("ws_a", { path: "/tmp/root" }),
        selectedSessionWorkspaceDirectory: "",
        selectedSessionDirectory: "/tmp/expert-code",
        selectedSessionId: "ses_expert",
        selectedWorkspaceId: "ws_a",
        routeWorkspaceId: "ws_a",
        loading: false,
        retryingWorkspaceIds: [],
        errorsByWorkspaceId: {},
        sessionsByWorkspaceId: { ws_a: [session("ses_expert")] },
      }).sessionWorkspaceRoot,
    ).toBe("/tmp/expert-code");
  });

  test("keeps assistant workspace record ahead of session directory", () => {
    expect(
      buildSelectedWorkspaceRouteState({
        selectedWorkspace: workspace("ws_a", { path: "/tmp/root" }),
        selectedSessionWorkspaceDirectory: "/tmp/assistant-record",
        selectedSessionDirectory: "/tmp/session-directory",
        selectedSessionId: "ses_assistant",
        selectedWorkspaceId: "ws_a",
        routeWorkspaceId: "ws_a",
        loading: false,
        retryingWorkspaceIds: [],
        errorsByWorkspaceId: {},
        sessionsByWorkspaceId: { ws_a: [session("ses_assistant")] },
      }).sessionWorkspaceRoot,
    ).toBe("/tmp/assistant-record");
  });

  test("resolves workspace-aware and legacy session routes", () => {
    expect(resolveWorkspaceSessionRoute({ assistantMode: false, workspaceId: " ws 1 ", sessionId: " ses/1 " }))
      .toBe("/workspace/ws%201/session/ses%2F1");
    expect(resolveWorkspaceSessionRoute({ assistantMode: true, workspaceId: "", sessionId: "assistant 1" }))
      .toBe("/assistant/assistant%201");
    expect(resolveWorkspaceSessionRoute({ assistantMode: false, workspaceId: "", sessionId: null }))
      .toBe("/session");
  });

  test("finds the workspace that owns a control target session", () => {
    expect(
      resolveControlSessionWorkspaceId({
        fallbackWorkspaceId: "fallback",
        sessionId: "ses_b",
        sessionsByWorkspaceId: { ws_a: [session("ses_a")], ws_b: [session("ses_b")] },
      }),
    ).toBe("ws_b");
    expect(
      resolveControlSessionWorkspaceId({
        fallbackWorkspaceId: "fallback",
        sessionId: "missing",
        sessionsByWorkspaceId: { ws_a: [session("ses_a")] },
      }),
    ).toBe("fallback");
  });

  test("blocks create-task navigation while loading or retrying workspace", () => {
    expect(
      resolveCreateTaskWorkspaceNavigation({
        loading: false,
        retryingWorkspaceIds: [],
        workspaceId: "ws_a",
        workspaces: [workspace("ws_a")],
      }),
    ).toEqual({ activeWorkspaceId: "ws_a", workspaceId: "ws_a" });
    expect(
      resolveCreateTaskWorkspaceNavigation({
        loading: true,
        retryingWorkspaceIds: [],
        workspaceId: "ws_a",
        workspaces: [workspace("ws_a")],
      }),
    ).toBeNull();
    expect(
      resolveCreateTaskWorkspaceNavigation({
        loading: false,
        retryingWorkspaceIds: ["ws_a"],
        workspaceId: "ws_a",
        workspaces: [workspace("ws_a")],
      }),
    ).toBeNull();
  });

  test("restores navigation to selected workspace when route workspace is missing", () => {
    expect(
      resolveSessionRouteRestoreNavigation({
        firstSessionIdForPageMode: () => null,
        legacySelectedWorkspaceId: "ws_fallback",
        loading: false,
        readLastSessionFor: () => null,
        routeWorkspaceId: "ws_missing",
        selectedSessionId: "ses_current",
        selectedWorkspaceId: "ws_selected",
        sessionMatchesPageMode: () => true,
        sessionListOwnsSession: owns,
        sessionsByWorkspaceId: {},
        suppressRestoreSession: false,
        workspaces: [workspace("ws_fallback"), workspace("ws_other")],
      }),
    ).toEqual({ type: "workspace", workspaceId: "ws_fallback", sessionId: "ses_current" });
  });

  test("keeps the selected session even when page-mode registry lags", () => {
    // Do not jump to firstSessionIdForPageMode — that stole focus from task #3 → #1.
    expect(
      resolveSessionRouteRestoreNavigation({
        firstSessionIdForPageMode: () => "ses_assistant",
        legacySelectedWorkspaceId: "ws_a",
        loading: false,
        readLastSessionFor: () => null,
        routeWorkspaceId: "ws_a",
        selectedSessionId: "ses_expert",
        selectedWorkspaceId: "ws_a",
        sessionMatchesPageMode: () => false,
        sessionListOwnsSession: owns,
        sessionsByWorkspaceId: { ws_a: [session("ses_expert")] },
        suppressRestoreSession: false,
        workspaces: [workspace("ws_a")],
      }),
    ).toEqual({ type: "reset-suppression" });
  });

  test("restores remembered session only when it belongs to current page mode", () => {
    expect(
      resolveSessionRouteRestoreNavigation({
        firstSessionIdForPageMode: () => null,
        legacySelectedWorkspaceId: "ws_a",
        loading: false,
        readLastSessionFor: () => "ses_remembered",
        routeWorkspaceId: "ws_a",
        selectedSessionId: null,
        selectedWorkspaceId: "ws_a",
        sessionMatchesPageMode: (id) => id === "ses_remembered",
        sessionListOwnsSession: owns,
        sessionsByWorkspaceId: { ws_a: [session("ses_remembered")] },
        suppressRestoreSession: false,
        workspaces: [workspace("ws_a")],
      }),
    ).toEqual({ type: "workspace", workspaceId: "ws_a", sessionId: "ses_remembered" });

    expect(
      resolveSessionRouteRestoreNavigation({
        firstSessionIdForPageMode: () => null,
        legacySelectedWorkspaceId: "ws_a",
        loading: false,
        readLastSessionFor: () => "ses_wrong",
        routeWorkspaceId: "ws_a",
        selectedSessionId: null,
        selectedWorkspaceId: "ws_a",
        sessionMatchesPageMode: () => false,
        sessionListOwnsSession: owns,
        sessionsByWorkspaceId: { ws_a: [session("ses_wrong")] },
        suppressRestoreSession: false,
        workspaces: [workspace("ws_a")],
      }),
    ).toEqual({ type: "none" });
  });

  test("does not restore remembered session while restoration is suppressed", () => {
    expect(
      resolveSessionRouteRestoreNavigation({
        firstSessionIdForPageMode: () => null,
        legacySelectedWorkspaceId: "ws_a",
        loading: false,
        readLastSessionFor: () => "assistant_remembered",
        routeWorkspaceId: "ws_a",
        selectedSessionId: null,
        selectedWorkspaceId: "ws_a",
        sessionMatchesPageMode: () => true,
        sessionListOwnsSession: owns,
        sessionsByWorkspaceId: { ws_a: [session("assistant_remembered")] },
        suppressRestoreSession: true,
        workspaces: [workspace("ws_a")],
      }),
    ).toEqual({ type: "none" });
  });

  test("redirects first-run users without workspaces to welcome", () => {
    expect(shouldRedirectSessionRouteToWelcome({ hasCompletedOnboarding: false, loading: false, workspaceCount: 0 }))
      .toBe(true);
    expect(shouldRedirectSessionRouteToWelcome({ hasCompletedOnboarding: true, loading: false, workspaceCount: 0 }))
      .toBe(false);
    expect(shouldRedirectSessionRouteToWelcome({ hasCompletedOnboarding: false, loading: true, workspaceCount: 0 }))
      .toBe(false);
  });

  test("switches expert mode to remembered expert session before first expert fallback", () => {
    expect(
      resolveSessionRouteModeSwitchPath({
        currentMode: "assistant",
        findFirstSessionIdMatching: () => "ses_first_expert",
        isExpertSession: (id) => id.startsWith("expert"),
        readLastSessionFor: (_ws, mode) =>
          mode === "expert" ? "expert_remembered" : null,
        sessionListOwnsSession: owns,
        sessionsByWorkspaceId: { ws_a: [session("expert_remembered"), session("ses_first_expert")] },
        targetMode: "expert",
        workspaceId: "ws_a",
      }),
    ).toBe("/workspace/ws_a/session/expert_remembered");
  });

  test("switches to assistant mode restoring remembered assistant session", () => {
    expect(
      resolveSessionRouteModeSwitchPath({
        currentMode: "expert",
        findFirstSessionIdMatching: (sessions, predicate) =>
          sessions.find((item) => predicate(item.id))?.id ?? null,
        isExpertSession: (id) => id.startsWith("expert"),
        readLastSessionFor: (_ws, mode) =>
          mode === "assistant" ? "assistant_remembered" : "expert_other",
        sessionListOwnsSession: owns,
        sessionsByWorkspaceId: {
          ws_a: [session("assistant_remembered"), session("assistant_first"), session("expert_1")],
        },
        targetMode: "assistant",
        workspaceId: "ws_a",
      }),
    ).toBe("/workspace/ws_a/assistant/assistant_remembered");
  });

  test("assistant mode switch falls back to first non-expert session when memory empty", () => {
    expect(
      resolveSessionRouteModeSwitchPath({
        currentMode: "expert",
        findFirstSessionIdMatching: (sessions, predicate) =>
          sessions.find((item) => predicate(item.id))?.id ?? null,
        isExpertSession: (id) => id.startsWith("expert"),
        readLastSessionFor: () => null,
        sessionListOwnsSession: owns,
        sessionsByWorkspaceId: {
          ws_a: [session("expert_1"), session("assistant_first")],
        },
        targetMode: "assistant",
        workspaceId: "ws_a",
      }),
    ).toBe("/workspace/ws_a/assistant/assistant_first");
  });

  test("mode-scoped memory: expert switch ignores last assistant session id", () => {
    expect(
      resolveSessionRouteModeSwitchPath({
        currentMode: "assistant",
        findFirstSessionIdMatching: () => "expert_first",
        isExpertSession: (id) => id.startsWith("expert"),
        // Legacy single-slot would return assistant id; mode-scoped returns expert.
        readLastSessionFor: (_ws, mode) =>
          mode === "expert" ? "expert_remembered" : "assistant_remembered",
        sessionListOwnsSession: owns,
        sessionsByWorkspaceId: {
          ws_a: [session("expert_remembered"), session("expert_first"), session("assistant_remembered")],
        },
        targetMode: "expert",
        workspaceId: "ws_a",
      }),
    ).toBe("/workspace/ws_a/session/expert_remembered");
  });

  test("selects remembered workspace session only when known and mode-compatible", () => {
    expect(
      resolveWorkspaceSelectionSessionTarget({
        firstSessionIdForPageMode: () => "ses_first",
        readLastSessionFor: () => "ses_remembered",
        selectedSessionId: "ses_current",
        sessionMatchesPageMode: () => true,
        sessionsByWorkspaceId: { ws_a: [session("ses_remembered")] },
        workspaceId: "ws_a",
      }),
    ).toBe("ses_remembered");
    expect(
      resolveWorkspaceSelectionSessionTarget({
        firstSessionIdForPageMode: () => "ses_first",
        readLastSessionFor: () => "ses_remembered",
        selectedSessionId: "ses_current",
        sessionMatchesPageMode: () => false,
        sessionsByWorkspaceId: { ws_a: [session("ses_remembered")] },
        workspaceId: "ws_a",
      }),
    ).toBe("ses_first");
  });
});
