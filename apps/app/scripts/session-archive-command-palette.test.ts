import { describe, expect, it } from "bun:test";

import { buildSessionArchiveCommandItems } from "../src/react-app/domains/session/chat/session-page-session-archive-model";
import type { OpenworkSessionArchiveSearchResponse, OpenworkSessionArchiveSession } from "../src/app/lib/onmyagent-server";

function session(id: string, agent = "codex"): OpenworkSessionArchiveSession {
  return {
    id,
    project: "project-a",
    machine: "local",
    agent,
    first_message: `first ${id}`,
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

function searchResult(sessionId: string): OpenworkSessionArchiveSearchResponse["results"][number] {
  return {
    session_id: sessionId,
    project: "project-b",
    agent: "claude",
    ordinal: 3,
    role: "assistant",
    name: "Matched session",
    snippet: "<mark>matched</mark> text",
    created_at: "2026-06-24T00:02:00.000Z",
  };
}

describe("session archive command palette view model", () => {
  it("builds archive actions, selected-session copy, search results, and recent sessions", () => {
    const calls: string[] = [];
    const items = buildSessionArchiveCommandItems({
      sessions: [session("recent-1"), session("recent-2", "hermes")],
      searchResults: [searchResult("search-1")],
      selectedSession: session("selected-1"),
      showTrash: false,
      trashCount: 2,
      labels: {
        sync: "Sync",
        archive: "Sessions",
        trash: "Trash",
        trashMeta: "Trash 2",
        settings: "Settings",
        copySessionId: "Copy session ID",
      },
      actions: {
        sync: () => calls.push("sync"),
        toggleArchiveTrash: () => calls.push("toggle"),
        openSettings: () => calls.push("settings"),
        copySessionId: (sessionId) => calls.push(`copy:${sessionId}`),
        selectSession: (sessionId) => calls.push(`select:${sessionId}`),
      },
    });

    expect(items.map((item) => item.id)).toEqual([
      "sync",
      "show-trash",
      "settings",
      "copy:selected-1",
      "search:search-1:3",
      "session:recent-1",
      "session:recent-2",
    ]);

    items.find((item) => item.id === "copy:selected-1")?.action();
    items.find((item) => item.id === "search:search-1:3")?.action();
    items.find((item) => item.id === "session:recent-2")?.action();

    expect(calls).toEqual(["copy:selected-1", "select:search-1", "select:recent-2"]);
  });

  it("switches the navigation action back to archive while trash is open", () => {
    const calls: string[] = [];
    const items = buildSessionArchiveCommandItems({
      sessions: [],
      searchResults: [],
      selectedSession: null,
      showTrash: true,
      trashCount: 0,
      labels: {
        sync: "Sync",
        archive: "Sessions",
        trash: "Trash",
        trashMeta: "Trash 0",
        settings: "Settings",
        copySessionId: "Copy session ID",
      },
      actions: {
        sync: () => calls.push("sync"),
        toggleArchiveTrash: () => calls.push("archive"),
        openSettings: () => calls.push("settings"),
        copySessionId: (sessionId) => calls.push(`copy:${sessionId}`),
        selectSession: (sessionId) => calls.push(`select:${sessionId}`),
      },
    });

    expect(items.map((item) => item.id)).toEqual(["sync", "show-archive", "settings"]);
    items.find((item) => item.id === "show-archive")?.action();
    expect(calls).toEqual(["archive"]);
  });
});
