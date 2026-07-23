import { describe, expect, test } from "bun:test";
import {
  archiveSessionWatchVersion,
  archiveStatsVersion,
} from "../src/services/archive-sse-version.js";

describe("archive-sse-version (shipped)", () => {
  test("watch version is stable for equal scalars and changes when counts change", () => {
    const session = {
      id: "s1",
      message_count: 3,
      user_message_count: 1,
      started_at: "2026-01-01T00:00:00.000Z",
      ended_at: null,
      display_name: "hi",
      total_output_tokens: 10,
    };
    const timing = {
      total_duration_ms: 1000,
      tool_duration_ms: 200,
      turn_count: 2,
      tool_call_count: 4,
      subagent_count: 0,
      running: true,
      // large payload that must NOT be part of version key by reference
      turns: Array.from({ length: 50 }, (_, i) => ({ ordinal: i, calls: [{ tool_name: "x".repeat(200) }] })),
    };
    const a = archiveSessionWatchVersion(session, timing);
    const b = archiveSessionWatchVersion(
      { ...session, turns: undefined },
      { ...timing, turns: [] },
    );
    expect(a).toBe(b);
    expect(a.includes("\x1f")).toBe(true);
    // Must not embed bulk turn payloads
    expect(a.includes("x".repeat(50))).toBe(false);

    const c = archiveSessionWatchVersion(
      { ...session, message_count: 4 },
      timing,
    );
    expect(c).not.toBe(a);

    const d = archiveSessionWatchVersion(session, {
      ...timing,
      tool_call_count: 5,
    });
    expect(d).not.toBe(a);
  });

  test("stats version ignores extra fields and reacts to session_count", () => {
    const stats = {
      session_count: 2,
      message_count: 10,
      project_count: 1,
      machine_count: 1,
      earliest_session: "2026-01-01",
      extra_blob: { huge: "y".repeat(500) },
    };
    const a = archiveStatsVersion(stats);
    const b = archiveStatsVersion({
      session_count: 2,
      message_count: 10,
      project_count: 1,
      machine_count: 1,
      earliest_session: "2026-01-01",
    });
    expect(a).toBe(b);
    expect(a.includes("y".repeat(50))).toBe(false);
    expect(archiveStatsVersion({ ...stats, session_count: 3 })).not.toBe(a);
  });

  test("nullish inputs produce stable empty-ish tokens", () => {
    expect(archiveSessionWatchVersion(null, null)).toBe(
      archiveSessionWatchVersion(undefined, undefined),
    );
    expect(archiveStatsVersion(null)).toBe(archiveStatsVersion(undefined));
  });
});
