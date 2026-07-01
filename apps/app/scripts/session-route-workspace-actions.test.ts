import { describe, expect, test } from "bun:test";

import {
  resolveCreatedSessionWorkspaceId,
  resolveSessionWorkspaceCreateTargetId,
  resolveSelectedDesktopSessionWorkspaceId,
} from "../src/react-app/shell/session-route-workspace-actions";
import type { WorkspaceList } from "../src/app/lib/desktop";

function workspaceList(input: {
  active?: string | null;
  selected?: string | null;
  ids: string[];
}): WorkspaceList {
  return {
    selectedId: input.selected ?? undefined,
    activeId: input.active ?? null,
    workspaces: input.ids.map((id) => ({
      id,
      name: id,
      path: `/tmp/${id}`,
      preset: "local",
      workspaceType: "local",
    })),
  };
}

describe("session route workspace actions", () => {
  test("resolves selected desktop workspace ids from the desktop list", () => {
    const list = workspaceList({ selected: "ws_selected", ids: ["ws_a", "ws_selected"] });

    expect(resolveSelectedDesktopSessionWorkspaceId(list)).toBe("ws_selected");
  });

  test("falls back to the last desktop workspace when create does not mark a selection", () => {
    const list = workspaceList({ ids: ["ws_first", "ws_created"] });

    expect(resolveCreatedSessionWorkspaceId(list)).toBe("ws_created");
  });

  test("uses the active desktop workspace id when selected id is unavailable", () => {
    const list = workspaceList({ active: "ws_active", ids: ["ws_a", "ws_active"] });

    expect(resolveSelectedDesktopSessionWorkspaceId(list)).toBe("ws_active");
  });

  test("returns an empty id for empty desktop workspace lists", () => {
    const list = workspaceList({ ids: [] });

    expect(resolveCreatedSessionWorkspaceId(list)).toBe("");
  });

  test("returns empty ids for missing desktop workspace lists", () => {
    expect(resolveCreatedSessionWorkspaceId(null)).toBe("");
    expect(resolveSelectedDesktopSessionWorkspaceId(null)).toBe("");
  });

  test("ignores whitespace-only selected ids and falls back to created workspace", () => {
    const list = workspaceList({ selected: "   ", ids: ["ws_created"] });

    expect(resolveCreatedSessionWorkspaceId(list)).toBe("ws_created");
  });

  test("prefers the server-created workspace id when both desktop and server create succeed", () => {
    const desktopList = workspaceList({ selected: "desktop_ws", ids: ["desktop_ws"] });
    const serverList = workspaceList({ selected: "server_ws", ids: ["server_ws"] });

    expect(resolveSessionWorkspaceCreateTargetId({ desktopList, serverList })).toBe("server_ws");
  });

  test("keeps the desktop-created workspace id when server create fails", () => {
    const desktopList = workspaceList({ selected: "desktop_ws", ids: ["desktop_ws"] });

    expect(resolveSessionWorkspaceCreateTargetId({ desktopList, serverList: null })).toBe("desktop_ws");
  });

  test("falls back to the desktop-created workspace id when the server list is empty", () => {
    const desktopList = workspaceList({ selected: "desktop_ws", ids: ["desktop_ws"] });
    const serverList = workspaceList({ ids: [] });

    expect(resolveSessionWorkspaceCreateTargetId({ desktopList, serverList })).toBe("desktop_ws");
  });

  test("uses the server active workspace id before desktop fallback", () => {
    const desktopList = workspaceList({ selected: "desktop_ws", ids: ["desktop_ws"] });
    const serverList = workspaceList({ active: "server_active", ids: ["server_a", "server_active"] });

    expect(resolveSessionWorkspaceCreateTargetId({ desktopList, serverList })).toBe("server_active");
  });

  test("falls back to the server-created last workspace when server selected id is blank", () => {
    const desktopList = workspaceList({ selected: "desktop_ws", ids: ["desktop_ws"] });
    const serverList = workspaceList({ selected: "  ", ids: ["server_first", "server_created"] });

    expect(resolveSessionWorkspaceCreateTargetId({ desktopList, serverList })).toBe("server_created");
  });
});
