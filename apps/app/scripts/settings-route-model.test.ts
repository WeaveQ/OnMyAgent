import { describe, expect, test } from "bun:test";

import {
  buildSettingsEnvironmentWorkspacePaths,
  buildSettingsFailedWorkspaceSessionEntry,
  buildSettingsLoadedWorkspaceSessionEntry,
  buildSettingsSessionMaps,
  buildSettingsSkippedWorkspaceSessionEntry,
  folderNameFromPath,
  mergeRouteWorkspaces,
  parseSettingsPath,
  readNavigationSessionId,
  readNavigationWorkspaceId,
  reconcileSelectedWorkspaceId,
  resolveSettingsFallbackWorkspaceId,
  resolveSettingsPreferredWorkspaceId,
  resolveCreatedSettingsWorkspaceId,
  resolveSettingsWorkspaceIdAfterRemoval,
  settingsPathForRoute,
  updateSettingsWorkspaceConnectionOverrides,
  type RouteWorkspace,
} from "../src/react-app/shell/settings-route/model";
import type { WorkspaceInfo, WorkspaceList } from "../src/app/lib/desktop";

function desktopWorkspace(input: {
  id: string;
  path?: string;
  workspaceType?: "local" | "remote";
}): WorkspaceInfo {
  return {
    id: input.id,
    name: input.id,
    path: input.path ?? `/tmp/${input.id}`,
    preset: "local",
    workspaceType: input.workspaceType ?? "local",
  };
}

function routeWorkspace(input: {
  id: string;
  path?: string;
  workspaceType?: "local" | "remote";
}): RouteWorkspace {
  return {
    id: input.id,
    name: input.id,
    path: input.path ?? `/tmp/${input.id}`,
    preset: "local",
    workspaceType: input.workspaceType ?? "local",
    displayNameResolved: input.id,
  };
}

function workspaceList(input: {
  active?: string | null;
  selected?: string | null;
  workspaces: WorkspaceInfo[];
}): WorkspaceList {
  return {
    activeId: input.active ?? null,
    selectedId: input.selected ?? undefined,
    workspaces: input.workspaces,
  };
}

describe("settings route workspace model", () => {
  test("resolves folder names from posix and windows paths", () => {
    expect(folderNameFromPath("/Users/me/project/")).toBe("project");
    expect(folderNameFromPath("C:\\Users\\me\\Project")).toBe("Project");
    expect(folderNameFromPath("///")).toBe("workspace");
  });

  test("prefers selected workspace id when resolving newly created settings workspace", () => {
    expect(
      resolveCreatedSettingsWorkspaceId(
        workspaceList({
          selected: "ws_selected",
          workspaces: [desktopWorkspace({ id: "ws_first" }), desktopWorkspace({ id: "ws_selected" })],
        }),
      ),
    ).toBe("ws_selected");
  });

  test("falls back to newest desktop workspace when create result has no selected id", () => {
    expect(
      resolveCreatedSettingsWorkspaceId(
        workspaceList({
          workspaces: [desktopWorkspace({ id: "ws_first" }), desktopWorkspace({ id: "ws_created" })],
        }),
      ),
    ).toBe("ws_created");
  });

  test("keeps current selection after removing a different workspace", () => {
    expect(
      resolveSettingsWorkspaceIdAfterRemoval({
        removedWorkspaceId: "ws_removed",
        selectedWorkspaceId: "ws_selected",
        workspaces: [routeWorkspace({ id: "ws_selected" })],
      }),
    ).toBe("ws_selected");
  });

  test("moves selection to the first remaining workspace after removing selected workspace", () => {
    expect(
      resolveSettingsWorkspaceIdAfterRemoval({
        removedWorkspaceId: "ws_removed",
        selectedWorkspaceId: "ws_removed",
        workspaces: [routeWorkspace({ id: "ws_removed" }), routeWorkspace({ id: "ws_next" })],
      }),
    ).toBe("ws_next");
  });

  test("reconciles desktop-selected workspace to merged server workspace by normalized path", () => {
    expect(
      reconcileSelectedWorkspaceId(
        "",
        { activeId: "server_active" },
        workspaceList({
          selected: "desktop_ws",
          workspaces: [desktopWorkspace({ id: "desktop_ws", path: "/tmp/project/" })],
        }),
        [routeWorkspace({ id: "server_ws", path: "/tmp/project" })],
      ),
    ).toBe("server_ws");
  });

  test("falls back to server active id before desktop selected id", () => {
    expect(
      reconcileSelectedWorkspaceId(
        "missing",
        { activeId: "server_active" },
        workspaceList({
          selected: "desktop_ws",
          workspaces: [desktopWorkspace({ id: "desktop_ws", path: "/tmp/other" })],
        }),
        [routeWorkspace({ id: "server_ws", path: "/tmp/project" })],
      ),
    ).toBe("server_active");
  });

  test("builds environment workspace paths from local workspaces and selected root", () => {
    expect(
      buildSettingsEnvironmentWorkspacePaths({
        selectedWorkspaceRoot: "/tmp/selected",
        workspaces: [
          routeWorkspace({ id: "remote", workspaceType: "remote", path: "/tmp/remote" }),
          routeWorkspace({ id: "local_a", path: "/tmp/a" }),
          routeWorkspace({ id: "local_b", path: "/tmp/a" }),
        ],
      }),
    ).toEqual(["/tmp/selected", "/tmp/a"]);
  });

  test("merges server workspaces with desktop metadata by id and normalized path", () => {
    const merged = mergeRouteWorkspaces(
      [
        { id: "ws_same", name: "Server Same", path: "/tmp/same", workspaceType: "local", preset: "local" },
        { id: "ws_server", name: "Server Path", path: "/tmp/project", workspaceType: "local", preset: "local" },
      ],
      [
        { ...routeWorkspace({ id: "ws_same", path: "/tmp/same" }), name: "Desktop Same", displayName: "Desktop Display" },
        { ...routeWorkspace({ id: "desktop_path", path: "/tmp/project/" }), name: "Desktop Path" },
        routeWorkspace({ id: "desktop_only", path: "/tmp/desktop-only" }),
      ],
    );

    expect(merged.map((workspace) => workspace.id)).toEqual(["ws_same", "ws_server", "desktop_only"]);
    expect(merged[0].displayNameResolved).toBe("Desktop Display");
    expect(merged[1].name).toBe("Desktop Path");
  });

  test("parses canonical, legacy, and extension settings paths", () => {
    expect(parseSettingsPath("/settings")).toEqual({ tab: "general", redirectPath: "general" });
    expect(parseSettingsPath("/workspace/ws_1/settings/extensions/plugins")).toEqual({
      tab: "extensions",
      redirectPath: null,
      extensionsSection: "plugins",
    });
    expect(parseSettingsPath("/settings/extensions/skills")).toEqual({
      tab: "extensions",
      redirectPath: null,
      extensionsSection: "all",
    });
    expect(parseSettingsPath("/settings/den")).toEqual({ tab: "cloud-workers", redirectPath: "cloud-workers" });
    expect(parseSettingsPath("/settings/archived-tasks")).toEqual({
      tab: "archived-tasks",
      redirectPath: null,
    });
    expect(parseSettingsPath("/settings/nope")).toEqual({ tab: "general", redirectPath: "general" });
    expect(settingsPathForRoute({ tab: "extensions", redirectPath: null, extensionsSection: "mcp" })).toBe(
      "extensions/mcp",
    );
  });

  test("resolves preferred settings workspace from route, session, navigation, current, and persisted ids", () => {
    const sessionEntries = [
      { workspaceId: "ws_session", sessions: [{ id: "ses_1", title: "One" }], error: null },
    ];

    expect(readNavigationWorkspaceId({ workspaceId: " ws_nav " })).toBe("ws_nav");
    expect(readNavigationSessionId({ sessionId: " ses_1 " })).toBe("ses_1");
    expect(
      resolveSettingsPreferredWorkspaceId({
        routeWorkspaceId: "ws_route",
        navigationSessionId: "ses_1",
        navigationWorkspaceId: "ws_nav",
        currentWorkspaceId: "ws_current",
        persistedWorkspaceId: "ws_persisted",
        sessionEntries,
      }),
    ).toBe("ws_route");
    expect(
      resolveSettingsPreferredWorkspaceId({
        routeWorkspaceId: "",
        navigationSessionId: "ses_1",
        navigationWorkspaceId: "ws_nav",
        currentWorkspaceId: "ws_current",
        persistedWorkspaceId: "ws_persisted",
        sessionEntries,
      }),
    ).toBe("ws_session");
    expect(
      resolveSettingsFallbackWorkspaceId({
        currentWorkspaceId: "",
        persistedWorkspaceId: "ws_persisted",
        desktopSelectedId: "ws_desktop",
        workspaces: [routeWorkspace({ id: "ws_first" })],
      }),
    ).toBe("ws_persisted");
  });

  test("builds settings session maps and updates connection overrides", () => {
    const loaded = buildSettingsLoadedWorkspaceSessionEntry({
      workspaceId: "ws_loaded",
      sessions: [{ id: "ses_loaded", title: "Loaded" }],
    });
    const skipped = buildSettingsSkippedWorkspaceSessionEntry({ workspaceId: "ws_skipped" });
    const failed = buildSettingsFailedWorkspaceSessionEntry({
      workspaceId: "ws_failed",
      error: "fallback error",
      connectionState: { status: "error", message: "connection error", checkedAt: 1 },
    });

    expect(buildSettingsSessionMaps([loaded, skipped, failed])).toEqual({
      errorsByWorkspaceId: {
        ws_loaded: null,
        ws_skipped: null,
        ws_failed: "connection error",
      },
      sessionsByWorkspaceId: {
        ws_loaded: [{ id: "ses_loaded", title: "Loaded" }],
        ws_skipped: [],
        ws_failed: [],
      },
    });
    expect(
      updateSettingsWorkspaceConnectionOverrides({
        current: {
          ws_failed: { status: "connecting", message: "old", checkedAt: null },
          ws_cleared: { status: "error", message: "clear me", checkedAt: 0 },
        },
        entries: [failed, buildSettingsLoadedWorkspaceSessionEntry({ workspaceId: "ws_cleared", sessions: [] })],
      }),
    ).toEqual({
      ws_failed: { status: "error", message: "connection error", checkedAt: 1 },
    });
  });
});
