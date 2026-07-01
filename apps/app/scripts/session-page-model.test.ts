import { describe, expect, test } from "bun:test";

import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  getSidebarInitialLoading,
  GLOBAL_VOICE_SIDE_PANEL_KEY,
  sessionTitleForId,
  STARTUP_SKELETON_ROWS,
  workspaceTaskStatus,
} from "../src/react-app/domains/session/chat/session-page-model";

const workspace = { id: "ws_a", name: "Workspace A", path: "/tmp/ws-a" };

function group(sessions: Array<{ id: string; title?: string | null }> = [], status: "idle" | "loading" | "ready" = "ready") {
  return {
    workspace,
    status,
    sessions: sessions.map((session) => ({
      id: session.id,
      title: session.title,
      time: { created: 1, updated: 2 },
    })),
  };
}

describe("session page model", () => {
  test("maps workspace task status by loading, connection, and server status", () => {
    expect(workspaceTaskStatus(true, "connected", true)).toEqual({
      label: "正在准备工作区",
      variant: "loading",
    });
    expect(workspaceTaskStatus(true, "connected", false)).toEqual({
      label: "可接受新任务",
      variant: "available",
    });
    expect(workspaceTaskStatus(false, "limited", false)).toEqual({
      label: "受限模式",
      variant: "limited",
    });
    expect(workspaceTaskStatus(false, "disconnected", false)).toEqual({
      label: "暂不可接受任务",
      variant: "offline",
    });
  });

  test("shows sidebar initial loading only before usable cached or ready sessions", () => {
    expect(getSidebarInitialLoading({
      workspaceSessionGroups: [],
      startupPhase: "booting",
    })).toBe(true);

    expect(getSidebarInitialLoading({
      workspaceSessionGroups: [],
      sidebarHydratedFromCache: true,
      startupPhase: "booting",
    })).toBe(false);

    expect(getSidebarInitialLoading({
      workspaceSessionGroups: [group([{ id: "session-a", title: "A" }], "loading")],
      startupPhase: "booting",
    })).toBe(false);

    expect(getSidebarInitialLoading({
      workspaceSessionGroups: [group([], "loading")],
      startupPhase: "ready",
    })).toBe(true);

    expect(getSidebarInitialLoading({
      workspaceSessionGroups: [group([], "ready")],
      startupPhase: "ready",
    })).toBe(false);
  });

  test("resolves display titles from session groups", () => {
    expect(sessionTitleForId([group([{ id: "session-a", title: "  Custom title  " }])], "session-a"))
      .toBe("Custom title");
    expect(sessionTitleForId([group([{ id: "session-a", title: "" }])], "session-a"))
      .toBe("New session");
    expect(sessionTitleForId([group([{ id: "session-a", title: "A" }])], "missing"))
      .toBe("");
    expect(sessionTitleForId([group([{ id: "session-a", title: "A" }])], null))
      .toBe("");
  });

  test("exports stable layout constants used by shared session pages", () => {
    expect(STARTUP_SKELETON_ROWS.map((row) => row.id)).toEqual(["intro", "middle", "final"]);
    expect(GLOBAL_VOICE_SIDE_PANEL_KEY).toBe("__onmyagent_voice__");
    expect(AGENT_PANEL_MIN_WIDTH).toBeLessThan(AGENT_PANEL_DEFAULT_WIDTH);
    expect(AGENT_PANEL_DEFAULT_WIDTH).toBeLessThan(AGENT_PANEL_MAX_WIDTH);
  });
});
