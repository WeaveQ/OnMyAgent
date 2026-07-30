/**
 * Dirty/ghost session delete policy — pure helpers + page-view wiring.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isTolerableSessionDeleteFailure,
  resolveSessionDeleteDirectory,
  shouldContinueLocalSessionCleanupAfterRemoteDelete,
} from "../src/react-app/domains/session/sync/session-delete-policy";

const appRoot = join(import.meta.dir, "..");

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
    // status 500 alone is not in the allowlist; message without markers fails.
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

describe("page-view delete wiring for dirty sessions", () => {
  test("uses shared policy, optimistic list remove, and bounded refresh", () => {
    const pageView = readFileSync(
      join(appRoot, "src/react-app/shell/session-route/page-view.tsx"),
      "utf8",
    );
    expect(pageView).toContain("resolveSessionDeleteDirectory");
    expect(pageView).toContain("isTolerableSessionDeleteFailure");
    expect(pageView).toContain("setSessionsByWorkspaceId");
    expect(pageView).toContain("local cleanup continues");
    expect(pageView).toContain("Promise.race");
    // Must consider sidebar session.directory (expert isolated roots).
    expect(pageView).toContain("sessionDirectory: listedDirectory");
    // Must not hard-require only assistant workspace directory.
    expect(pageView).not.toMatch(
      /deleteSession\(\s*endpoint\.workspaceId,\s*sessionId,\s*\{\s*directory:\s*assistantSessionWorkspace\?\.directory/,
    );
  });
});
