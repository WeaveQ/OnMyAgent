import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SIDEBAR_PREVIEW_SNAPSHOT_MAX,
  SIDEBAR_SESSION_LIST_LIMIT,
  isDraftSessionId,
  orderBackgroundSessionWorkspacesSelectedOnly,
  selectSidebarPreviewSessionIds,
} from "../src/react-app/domains/session/sync/sidebar-load-policy";
import { orderBackgroundSessionWorkspaces } from "../src/react-app/shell/session-route/model";

const appRoot = join(import.meta.dir, "..");

describe("sidebar load policy", () => {
  test("preview ids empty before defer and capped after", () => {
    const sessions = [
      { id: "ses_selected" },
      { id: "ses_a" },
      { id: "ses_b" },
      { id: "draft:x" },
      { id: "ses_c" },
      { id: "ses_d" },
      { id: "ses_e" },
      { id: "ses_f" },
    ];
    expect(
      selectSidebarPreviewSessionIds({
        sessions,
        selectedSessionId: "ses_selected",
        deferred: false,
      }).size,
    ).toBe(0);

    const after = selectSidebarPreviewSessionIds({
      sessions,
      selectedSessionId: "ses_selected",
      deferred: true,
    });
    expect(after.has("ses_selected")).toBe(false);
    expect(after.has("draft:x")).toBe(false);
    expect(after.size).toBe(SIDEBAR_PREVIEW_SNAPSHOT_MAX);
    expect([...after]).toEqual(["ses_a", "ses_b", "ses_c", "ses_d", "ses_e"]);
  });

  test("draft session id helper", () => {
    expect(isDraftSessionId("draft:abc")).toBe(true);
    expect(isDraftSessionId("ses_1")).toBe(false);
  });

  test("selected-only background workspace order", () => {
    const workspaces = [
      { id: "ws_a" },
      { id: "ws_b" },
      { id: "ws_c" },
    ];
    expect(
      orderBackgroundSessionWorkspacesSelectedOnly({
        workspaces,
        selectedWorkspaceId: "ws_b",
      }).map((w) => w.id),
    ).toEqual(["ws_b"]);

    expect(
      orderBackgroundSessionWorkspaces({
        workspaces: workspaces.map((w) => ({
          ...w,
          name: w.id,
          path: `/tmp/${w.id}`,
          preset: "local",
          workspaceType: "local",
          displayNameResolved: w.id,
        })),
        selectedWorkspaceId: "ws_b",
        alreadyLoadedWorkspaceIds: new Set(),
      }).map((w) => w.id),
    ).toEqual(["ws_b"]);

    expect(
      orderBackgroundSessionWorkspaces({
        workspaces: workspaces.map((w) => ({
          ...w,
          name: w.id,
          path: `/tmp/${w.id}`,
          preset: "local",
          workspaceType: "local",
          displayNameResolved: w.id,
        })),
        selectedWorkspaceId: "ws_b",
        alreadyLoadedWorkspaceIds: new Set(["ws_b"]),
        mode: "all-pending",
      }).map((w) => w.id),
    ).toEqual(["ws_b", "ws_a", "ws_c"]);
  });

  test("session list uses sidebar limit constant", () => {
    expect(SIDEBAR_SESSION_LIST_LIMIT).toBe(40);
    const sessionsSrc = readFileSync(
      join(
        appRoot,
        "src/react-app/shell/session-route/sessions.ts",
      ),
      "utf8",
    );
    expect(sessionsSrc).toContain("SIDEBAR_SESSION_LIST_LIMIT");
    expect(sessionsSrc).not.toMatch(/listSessions\([^)]*limit:\s*200/);
  });

  test("sidebar panels gate preview snapshots", () => {
    const panel = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/session/sidebar/agent-conversation-panel.tsx",
      ),
      "utf8",
    );
    expect(panel).toContain("useDeferredSidebarPreviews");
    expect(panel).toContain("assistantPreviewIds.has");
    expect(panel).toContain("expertPreviewIds.has");
    expect(panel).toContain("SIDEBAR_AUTOMATION_LIST_DEFER_MS");

    const tabs = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/session/sidebar/agent-session-tabs.tsx",
      ),
      "utf8",
    );
    // Tabs re-enable light title snapshots only for sessions that still need a
    // fallback title, gated by the same deferred/capped preview policy.
    expect(tabs).toContain("useDeferredSidebarPreviews");
    expect(tabs).toContain("sessionNeedsTabTitleFallback");
    expect(tabs).toContain("tabTitleSnapshotIds.has");
  });
});

