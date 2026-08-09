/**
 * Dirty/ghost session delete policy — pure helpers + page-view wiring.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SESSION_DELETE_REMOTE_BUDGET_MS,
  SESSION_PENDING_DELETE_MAX_ATTEMPTS,
  clearRecentlyDeletedSessionsForTests,
  executePendingSessionDelete,
  filterPendingDeletedSessions,
  filterRecentlyDeletedSessions,
  getPendingSessionDeleteForTests,
  isSessionPendingDelete,
  isSessionRecentlyDeleted,
  isTolerableSessionDeleteFailure,
  markSessionRecentlyDeleted,
  raceSessionDeleteRemote,
  registerPendingSessionDelete,
  resetPendingDeleteRetryBudgetForTests,
  retryPendingSessionDeletesForWorkspace,
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

describe("persistent pending delete tombstones", () => {
  test("filters by workspace until remote deletion confirms success", async () => {
    registerPendingSessionDelete({
      workspaceId: "ws_a",
      sessionId: "ses_deleted",
      directory: "/tmp/expert",
      nowMs: 1,
    });
    expect(isSessionPendingDelete("ws_a", "ses_deleted")).toBe(true);
    expect(
      filterPendingDeletedSessions({
        workspaceId: "ws_a",
        items: [{ id: "ses_deleted" }, { id: "ses_keep" }],
      }),
    ).toEqual([{ id: "ses_keep" }]);
    expect(
      filterPendingDeletedSessions({
        workspaceId: "ws_b",
        items: [{ id: "ses_deleted" }],
      }),
    ).toEqual([{ id: "ses_deleted" }]);

    const calls: Array<{ workspaceId: string; sessionId: string; directory?: string }> = [];
    await executePendingSessionDelete({
      workspaceId: "ws_a",
      remoteWorkspaceId: "runtime_ws_a",
      sessionId: "ses_deleted",
      client: {
        deleteSession: async (workspaceId, sessionId, options) => {
          calls.push({ workspaceId, sessionId, directory: options?.directory });
        },
      },
    });
    expect(calls).toEqual([
      {
        workspaceId: "runtime_ws_a",
        sessionId: "ses_deleted",
        directory: "/tmp/expert",
      },
    ]);
    expect(isSessionPendingDelete("ws_a", "ses_deleted")).toBe(false);
  });

  test("404 confirms deletion while transient failure keeps an attempted tombstone", async () => {
    registerPendingSessionDelete({ workspaceId: "ws", sessionId: "ses_missing" });
    await executePendingSessionDelete({
      workspaceId: "ws",
      remoteWorkspaceId: "runtime_ws",
      sessionId: "ses_missing",
      client: { deleteSession: async () => Promise.reject({ status: 404 }) },
    });
    expect(isSessionPendingDelete("ws", "ses_missing")).toBe(false);

    registerPendingSessionDelete({ workspaceId: "ws", sessionId: "ses_timeout" });
    await expect(
      executePendingSessionDelete({
        workspaceId: "ws",
        remoteWorkspaceId: "runtime_ws",
        sessionId: "ses_timeout",
        client: { deleteSession: async () => Promise.reject(new Error("timeout")) },
      }),
    ).rejects.toThrow("timeout");
    expect(getPendingSessionDeleteForTests("ws", "ses_timeout")?.attempt).toBe(1);
    expect(SESSION_PENDING_DELETE_MAX_ATTEMPTS).toBeGreaterThan(1);
  });

  test("retries pending deletes once per workspace with at most two requests", async () => {
    for (const sessionId of ["ses_1", "ses_2", "ses_3"]) {
      registerPendingSessionDelete({ workspaceId: "ws", sessionId });
    }
    let concurrent = 0;
    let maximumConcurrent = 0;
    const client = {
      deleteSession: async () => {
        concurrent += 1;
        maximumConcurrent = Math.max(maximumConcurrent, concurrent);
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        concurrent -= 1;
      },
    };
    const first = retryPendingSessionDeletesForWorkspace({
      workspaceId: "ws",
      remoteWorkspaceId: "runtime_ws",
      client,
    });
    const second = retryPendingSessionDeletesForWorkspace({
      workspaceId: "ws",
      remoteWorkspaceId: "runtime_ws",
      client,
    });
    expect(second).toBe(first);
    await first;
    expect(maximumConcurrent).toBe(2);
    expect(isSessionPendingDelete("ws", "ses_1")).toBe(false);
    expect(isSessionPendingDelete("ws", "ses_2")).toBe(false);
    expect(isSessionPendingDelete("ws", "ses_3")).toBe(false);
  });

  test("caps automatic retries per process and resumes with a fresh restart budget", async () => {
    registerPendingSessionDelete({ workspaceId: "ws", sessionId: "ses_retry" });
    let calls = 0;
    const failingClient = {
      deleteSession: async () => {
        calls += 1;
        throw new Error("still offline");
      },
    };
    for (let attempt = 0; attempt < SESSION_PENDING_DELETE_MAX_ATTEMPTS; attempt += 1) {
      await retryPendingSessionDeletesForWorkspace({
        workspaceId: "ws",
        remoteWorkspaceId: "runtime_ws",
        client: failingClient,
      });
    }
    expect(calls).toBe(SESSION_PENDING_DELETE_MAX_ATTEMPTS);
    await retryPendingSessionDeletesForWorkspace({
      workspaceId: "ws",
      remoteWorkspaceId: "runtime_ws",
      client: failingClient,
    });
    expect(calls).toBe(SESSION_PENDING_DELETE_MAX_ATTEMPTS);

    resetPendingDeleteRetryBudgetForTests();
    await retryPendingSessionDeletesForWorkspace({
      workspaceId: "ws",
      remoteWorkspaceId: "runtime_ws",
      client: { deleteSession: async () => undefined },
    });
    expect(isSessionPendingDelete("ws", "ses_retry")).toBe(false);
  }, 15_000);
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
    expect(pageView).toContain("registerPendingSessionDelete");
    expect(pageView).toContain("executePendingSessionDelete");
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
    expect(sessions).toContain("filterPendingDeletedSessions");
  });

  test("expert and assistant group deletes run sessions in parallel", () => {
    const expertDelete = readFileSync(
      join(appRoot, "src/react-app/domains/session/pages/use-expert-session-delete.ts"),
      "utf8",
    );
    const assistant = readFileSync(
      join(appRoot, "src/react-app/domains/session/pages/assistant.tsx"),
      "utf8",
    );
    expect(expertDelete).toContain("Promise.allSettled");
    expect(assistant).toContain("Promise.allSettled");
  });
});
