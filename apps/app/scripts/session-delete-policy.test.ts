/**
 * Dirty/ghost session delete policy — pure helpers + page-view wiring.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SESSION_DELETE_REMOTE_BUDGET_MS,
  clearRecentlyDeletedSessionsForTests,
  filterRecentlyDeletedSessions,
  isSessionRecentlyDeleted,
  isTolerableSessionDeleteFailure,
  markSessionRecentlyDeleted,
  raceSessionDeleteRemote,
  resolveSessionDeleteDirectory,
  shouldContinueLocalSessionCleanupAfterRemoteDelete,
} from "../src/react-app/domains/session/sync/session-delete-policy";

const appRoot = join(import.meta.dir, "..");

afterEach(() => {
  clearRecentlyDeletedSessionsForTests();
});

describe("resolveSessionDeleteDirectory (shipped)", () => {
  test("prefers assistant directory, then session item, then workspace root", () => {
    expect(
      resolveSessionDeleteDirectory({
        assistantDirectory: "/a/assistant",
        sessionDirectory: "/a/session",
        workspaceRoot: "/a/ws",
      }),
    ).toBe("/a/assistant");
    expect(
      resolveSessionDeleteDirectory({
        assistantDirectory: "  ",
        sessionDirectory: "/a/session",
        workspaceRoot: "/a/ws",
      }),
    ).toBe("/a/session");
    expect(
      resolveSessionDeleteDirectory({
        assistantDirectory: null,
        sessionDirectory: undefined,
        workspaceRoot: "/a/ws",
      }),
    ).toBe("/a/ws");
    expect(
      resolveSessionDeleteDirectory({
        assistantDirectory: null,
        sessionDirectory: null,
        workspaceRoot: null,
      }),
    ).toBeUndefined();
  });
});

describe("isTolerableSessionDeleteFailure (shipped)", () => {
  test("tolerates ghost, empty upstream, timeout, and network failures", () => {
    expect(isTolerableSessionDeleteFailure({ status: 404 })).toBe(true);
    expect(isTolerableSessionDeleteFailure({ status: 410 })).toBe(true);
    expect(isTolerableSessionDeleteFailure({ status: 502 })).toBe(true);
    expect(isTolerableSessionDeleteFailure({ status: 504 })).toBe(true);
    expect(
      isTolerableSessionDeleteFailure({ code: "session_not_found" }),
    ).toBe(true);
    expect(
      isTolerableSessionDeleteFailure({ code: "opencode_empty_response" }),
    ).toBe(true);
    expect(
      isTolerableSessionDeleteFailure({ code: "opencode_request_failed" }),
    ).toBe(true);
    expect(
      isTolerableSessionDeleteFailure(new Error("Request timed out")),
    ).toBe(true);
    expect(
      isTolerableSessionDeleteFailure(new Error("Failed to fetch")),
    ).toBe(true);
    expect(
      isTolerableSessionDeleteFailure({ name: "AbortError", message: "aborted" }),
    ).toBe(true);
  });

  test("does not treat arbitrary 500 without known markers as tolerable by status alone when message is clean", () => {
    expect(
      isTolerableSessionDeleteFailure({
        status: 500,
        message: "internal server error only",
      }),
    ).toBe(false);
  });

  test("local cleanup continues after success or tolerable remote failure", () => {
    expect(shouldContinueLocalSessionCleanupAfterRemoteDelete(null)).toBe(true);
    expect(
      shouldContinueLocalSessionCleanupAfterRemoteDelete({ status: 404 }),
    ).toBe(true);
    expect(
      shouldContinueLocalSessionCleanupAfterRemoteDelete({
        status: 500,
        message: "internal server error only",
      }),
    ).toBe(false);
  });
});

describe("recently-deleted tombstones (shipped)", () => {
  test("filters ids within TTL and expires them", () => {
    const now = 1_000_000;
    markSessionRecentlyDeleted("ses_dirty", now, 1_000);
    expect(isSessionRecentlyDeleted("ses_dirty", now + 10)).toBe(true);
    expect(
      filterRecentlyDeletedSessions(
        [{ id: "ses_dirty" }, { id: "ses_keep" }],
        now + 10,
      ),
    ).toEqual([{ id: "ses_keep" }]);
    expect(isSessionRecentlyDeleted("ses_dirty", now + 1_001)).toBe(false);
    expect(
      filterRecentlyDeletedSessions([{ id: "ses_dirty" }], now + 1_001),
    ).toEqual([{ id: "ses_dirty" }]);
  });
});

describe("raceSessionDeleteRemote (shipped)", () => {
  test("resolves when remote is slow beyond budget", async () => {
    expect(SESSION_DELETE_REMOTE_BUDGET_MS).toBeLessThanOrEqual(5_000);
    const started = Date.now();
    let remoteSettled = false;
    const remote = new Promise<void>((resolve) => {
      setTimeout(() => {
        remoteSettled = true;
        resolve();
      }, 80);
    });
    await raceSessionDeleteRemote(remote, 15);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(70);
    expect(remoteSettled).toBe(false);
  });

  test("resolves when remote finishes first", async () => {
    const started = Date.now();
    await raceSessionDeleteRemote(Promise.resolve("ok"), 200);
    expect(Date.now() - started).toBeLessThan(100);
  });
});

describe("page-view + group delete wiring", () => {
  test("uses local-first budgeted remote delete and tombstones", () => {
    const pageView = readFileSync(
      join(appRoot, "src/react-app/shell/session-route/page-view.tsx"),
      "utf8",
    );
    expect(pageView).toContain("resolveSessionDeleteDirectory");
    expect(pageView).toContain("markSessionRecentlyDeleted");
    expect(pageView).toContain("raceSessionDeleteRemote");
    expect(pageView).toContain("SESSION_DELETE_REMOTE_BUDGET_MS");
    expect(pageView).toContain("writeCachedSidebarSessionsForWorkspace");
    expect(pageView).toContain("setSessionsByWorkspaceId");
    // Refresh must not block dialog close with a long await race.
    expect(pageView).toContain("void Promise.resolve(refreshRouteState())");
    expect(pageView).toContain("sessionDirectory: listedDirectory");
  });

  test("list merge filters recently deleted ids", () => {
    const sessions = readFileSync(
      join(appRoot, "src/react-app/shell/session-route/sessions.ts"),
      "utf8",
    );
    expect(sessions).toContain("filterRecentlyDeletedSessions");
  });

  test("expert and assistant group deletes run sessions in parallel", () => {
    const expert = readFileSync(
      join(appRoot, "src/react-app/domains/session/pages/expert.tsx"),
      "utf8",
    );
    const assistant = readFileSync(
      join(appRoot, "src/react-app/domains/session/pages/assistant.tsx"),
      "utf8",
    );
    expect(expert).toContain("Promise.allSettled");
    expect(assistant).toContain("Promise.allSettled");
  });
});
