import { describe, expect, it } from "bun:test";

import { nextSessionArchiveSessionId } from "../src/react-app/domains/session/chat/session-page-session-archive-model";
import type { OpenworkSessionArchiveSession } from "../src/app/lib/onmyagent-server";

function session(id: string): OpenworkSessionArchiveSession {
  return {
    id,
    project: "project",
    machine: "local",
    agent: "codex",
    first_message: id,
    display_name: null,
    started_at: "2026-06-24T00:00:00.000Z",
    ended_at: "2026-06-24T00:01:00.000Z",
    message_count: 1,
    user_message_count: 1,
    total_output_tokens: 0,
    peak_context_tokens: 0,
    is_automated: false,
    created_at: "2026-06-24T00:00:00.000Z",
  };
}

describe("session archive keyboard navigation view model", () => {
  it("moves to the next and previous session with wraparound", () => {
    const sessions = [session("s-1"), session("s-2"), session("s-3")];

    expect(nextSessionArchiveSessionId(sessions, "s-1", 1)).toBe("s-2");
    expect(nextSessionArchiveSessionId(sessions, "s-1", -1)).toBe("s-3");
    expect(nextSessionArchiveSessionId(sessions, "s-3", 1)).toBe("s-1");
  });

  it("uses the first or last session when no active session is selected", () => {
    const sessions = [session("s-1"), session("s-2")];

    expect(nextSessionArchiveSessionId(sessions, null, 1)).toBe("s-1");
    expect(nextSessionArchiveSessionId(sessions, null, -1)).toBe("s-2");
  });

  it("returns null for an empty archive list", () => {
    expect(nextSessionArchiveSessionId([], null, 1)).toBeNull();
  });
});
