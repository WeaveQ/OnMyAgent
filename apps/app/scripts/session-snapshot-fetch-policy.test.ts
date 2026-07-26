import { describe, expect, test } from "bun:test";
import {
  isSessionSnapshotNotFoundError,
  markSessionSnapshotNotFound,
  shouldRetrySessionSnapshotQuery,
  shouldSkipSnapshotForNotFoundCooldown,
  SESSION_SNAPSHOT_NOT_FOUND_COOLDOWN_MS,
} from "../src/react-app/domains/session/sync/session-snapshot-fetch-policy";

describe("session-snapshot-fetch-policy", () => {
  test("product sidebar wires not-found cooldown into snapshot queries", async () => {
    const panel = await Bun.file(
      new URL(
        "../src/react-app/domains/session/sidebar/agent-conversation-panel.tsx",
        import.meta.url,
      ),
    ).text();
    expect(panel).toContain("markSessionSnapshotNotFound");
    expect(panel).toContain("shouldSkipSnapshotForNotFoundCooldown");
    expect(panel).toContain("snapshotNotFoundUntilBySessionId");
  });

  test("detects 404 / session_not_found", () => {
    expect(isSessionSnapshotNotFoundError({ status: 404 })).toBe(true);
    expect(isSessionSnapshotNotFoundError({ code: "session_not_found" })).toBe(
      true,
    );
    expect(isSessionSnapshotNotFoundError({ message: "Session not found" })).toBe(
      true,
    );
    expect(isSessionSnapshotNotFoundError({ status: 500 })).toBe(false);
  });

  test("never retries not-found", () => {
    expect(
      shouldRetrySessionSnapshotQuery(0, { status: 404 }),
    ).toBe(false);
    expect(shouldRetrySessionSnapshotQuery(0, { status: 500 })).toBe(true);
  });

  test("cooldown skips remount storms", () => {
    const map = new Map<string, number>();
    const now = 1_000_000;
    markSessionSnapshotNotFound({
      sessionId: "ses_1",
      notFoundUntilBySessionId: map,
      nowMs: now,
    });
    expect(
      shouldSkipSnapshotForNotFoundCooldown({
        sessionId: "ses_1",
        notFoundUntilBySessionId: map,
        nowMs: now + 10,
      }),
    ).toBe(true);
    expect(
      shouldSkipSnapshotForNotFoundCooldown({
        sessionId: "ses_1",
        notFoundUntilBySessionId: map,
        nowMs: now + SESSION_SNAPSHOT_NOT_FOUND_COOLDOWN_MS + 1,
      }),
    ).toBe(false);
  });
});
