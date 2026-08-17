/**
 * Focused session snapshot query key + prefetch contract.
 * Drives shipped helpers and structural wiring for surface + page-view.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SESSION_SNAPSHOT_STALE_TIME_MS } from "../src/react-app/domains/session/sync/session-poll-policy";
import {
  SESSION_SNAPSHOT_MESSAGE_LIMIT,
  buildSessionSnapshotPrefetchSpec,
  sessionSnapshotFetchOptions,
  sessionSnapshotQueryKey,
} from "../src/react-app/domains/session/sync/session-snapshot-query-policy";

const appRoot = join(import.meta.dir, "..");

describe("sessionSnapshotQueryKey (shipped)", () => {
  test("matches the react-session-snapshot triple SessionSurface uses", () => {
    const key = sessionSnapshotQueryKey("ws_1", "ses_2");
    expect(key).toEqual(["react-session-snapshot", "ws_1", "ses_2"]);
    expect(key[0]).toBe("react-session-snapshot");
    expect(key[1]).toBe("ws_1");
    expect(key[2]).toBe("ses_2");
  });
});

describe("sessionSnapshotFetchOptions (shipped)", () => {
  test("uses the product message limit and directory contract", () => {
    expect(SESSION_SNAPSHOT_MESSAGE_LIMIT).toBe(140);
    expect(sessionSnapshotFetchOptions("/path/to/ws")).toEqual({
      limit: SESSION_SNAPSHOT_MESSAGE_LIMIT,
      directory: "/path/to/ws",
    });
    expect(sessionSnapshotFetchOptions(undefined)).toEqual({
      limit: SESSION_SNAPSHOT_MESSAGE_LIMIT,
      directory: undefined,
    });
  });
});

describe("buildSessionSnapshotPrefetchSpec (shipped)", () => {
  test("builds the same key + options surface will read after open", () => {
    const spec = buildSessionSnapshotPrefetchSpec({
      workspaceId: "ws_server",
      sessionId: "ses_abc",
      directory: "/ws/root",
      staleTimeMs: SESSION_SNAPSHOT_STALE_TIME_MS,
    });
    expect(spec.queryKey).toEqual(
      sessionSnapshotQueryKey("ws_server", "ses_abc"),
    );
    expect(spec.staleTime).toBe(SESSION_SNAPSHOT_STALE_TIME_MS);
    expect(spec.staleTime).toBeGreaterThanOrEqual(30_000);
    expect(spec.fetchOptions).toEqual(
      sessionSnapshotFetchOptions("/ws/root"),
    );
    expect(spec.fetchOptions.limit).toBe(SESSION_SNAPSHOT_MESSAGE_LIMIT);
  });
});

describe("surface + page-view snapshot prefetch wiring", () => {
  test("SessionSurface uses shared key/options helpers and shared staleTime", () => {
    const surface = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/session/surface/session-surface-snapshot.ts",
      ),
      "utf8",
    );
    expect(surface).toContain("sessionSnapshotQueryKey");
    expect(surface).toContain("sessionSnapshotFetchOptions");
    expect(surface).toContain("SESSION_SNAPSHOT_STALE_TIME_MS");
    expect(surface).not.toMatch(/staleTime:\s*500\b/);
    expect(surface).not.toMatch(/staleTime:\s*5_?000\b/);
    expect(surface).not.toMatch(/limit:\s*140/);
    expect(surface).not.toMatch(
      /\["react-session-snapshot",\s*props\.workspaceId,\s*props\.sessionId\]/,
    );
  });

  test("page-view onPrefetchSession is not an empty stub and seeds RQ cache", () => {
    const pageView = readFileSync(
      join(appRoot, "src/react-app/shell/session-route/page-view.tsx"),
      "utf8",
    );
    expect(pageView).toContain("onPrefetchSession:");
    expect(pageView).not.toMatch(/onPrefetchSession:\s*\(\)\s*=>\s*\{\s*\}/);
    expect(pageView).toContain("buildSessionSnapshotPrefetchSpec");
    expect(pageView).toContain("getReactQueryClient");
    expect(pageView).toContain("prefetchQuery");
    expect(pageView).toContain("getSessionSnapshot");
    expect(pageView).toContain("SESSION_SNAPSHOT_STALE_TIME_MS");
    // Prefetch must use server-side workspace id (endpoint.workspaceId).
    expect(pageView).toContain("endpoint.workspaceId");
  });

  test("sidebar hover/focus still invokes onPrefetchSession", () => {
    const sidebar = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/session/sidebar/app-sidebar.tsx",
      ),
      "utf8",
    );
    expect(sidebar).toContain("onPrefetchSession");
    expect(sidebar).toContain("onPointerEnter");
    expect(sidebar).toContain("onFocus");
    expect(sidebar).toMatch(/onPrefetchSession\?\.\(/);

    const expertItem = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/session/sidebar/agent-conversation-item.tsx",
      ),
      "utf8",
    );
    expect(expertItem).toContain("onPrefetchSession");
  });
});
