import { describe, expect, it } from "bun:test";

import {
  SESSION_ARCHIVE_ARCHIVE_PAGE_LIMIT,
  mergeSessionArchiveSessionPage,
  type SessionArchiveSessionPageState,
} from "../src/react-app/domains/session/chat/session-page-session-archive-model";
import type { OpenworkSessionArchiveSession } from "../src/app/lib/onmyagent-server";

const emptyState: SessionArchiveSessionPageState = {
  sessions: [],
  total: 0,
  nextCursor: null,
  agentCounts: [],
};

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

describe("session archive pagination view model", () => {
  it("uses a hydrated first page instead of the old fixed 1000-session batch", () => {
    expect(SESSION_ARCHIVE_ARCHIVE_PAGE_LIMIT).toBeLessThan(1000);
  });

  it("replaces the list with first-page sessions and stores the signed cursor", () => {
    const state = mergeSessionArchiveSessionPage(emptyState, {
      sessions: [session("s-1"), session("s-2")],
      total: 3,
      next_cursor: "signed-cursor-1",
      agent_counts: [{ agent: "codex", count: 3 }],
    }, "replace");

    expect(state.sessions.map((item) => item.id)).toEqual(["s-1", "s-2"]);
    expect(state.total).toBe(3);
    expect(state.nextCursor).toBe("signed-cursor-1");
    expect(state.agentCounts).toEqual([{ agent: "codex", count: 3 }]);
  });

  it("appends later pages without duplicating already hydrated sessions", () => {
    const state = mergeSessionArchiveSessionPage({
      sessions: [session("s-1"), session("s-2")],
      total: 4,
      nextCursor: "signed-cursor-1",
      agentCounts: [{ agent: "codex", count: 4 }],
    }, {
      sessions: [session("s-2"), session("s-3")],
      total: 4,
      next_cursor: "signed-cursor-2",
    }, "append");

    expect(state.sessions.map((item) => item.id)).toEqual(["s-1", "s-2", "s-3"]);
    expect(state.nextCursor).toBe("signed-cursor-2");
    expect(state.agentCounts).toEqual([{ agent: "codex", count: 4 }]);
  });
});
