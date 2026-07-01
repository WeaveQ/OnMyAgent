import { describe, expect, it } from "bun:test";

import { buildSessionArchiveTreeItems, groupSessionArchiveSessions } from "../src/react-app/domains/session/chat/session-page-session-archive-model";
import type { OpenworkSessionArchiveSession } from "../src/app/lib/onmyagent-server";

function session(input: Partial<OpenworkSessionArchiveSession> & { id: string }): OpenworkSessionArchiveSession {
  return {
    project: "project-a",
    machine: "local",
    agent: "codex",
    first_message: input.id,
    display_name: null,
    started_at: "2026-06-24T00:00:00.000Z",
    ended_at: "2026-06-24T00:01:00.000Z",
    message_count: 1,
    user_message_count: 1,
    total_output_tokens: 0,
    peak_context_tokens: 0,
    is_automated: false,
    created_at: "2026-06-24T00:00:00.000Z",
    ...input,
  };
}

describe("session archive grouping view model", () => {
  it("groups by agent, project, or flat mode", () => {
    const items = [
      session({ id: "codex-a", agent: "codex", project: "project-a" }),
      session({ id: "claude-a", agent: "claude", project: "project-a" }),
      session({ id: "codex-b", agent: "codex", project: "project-b" }),
    ];

    expect(groupSessionArchiveSessions(items, "agent").map((group) => [group.label, group.sessions.length])).toEqual([
      ["claude", 1],
      ["codex", 2],
    ]);
    expect(groupSessionArchiveSessions(items, "project").map((group) => [group.label, group.sessions.length])).toEqual([
      ["project-a", 2],
      ["project-b", 1],
    ]);
    expect(groupSessionArchiveSessions(items, "none").map((group) => [group.label, group.sessions.length, group.treeItems.every((item) => item.depth === 0)])).toEqual([["", 3, true]]);
  });

  it("builds parent-child hierarchy with depth and child counts", () => {
    const items = [
      session({ id: "parent" }),
      session({ id: "child", parent_session_id: "parent", relationship_type: "subagent" }),
      session({ id: "grandchild", parent_session_id: "child", relationship_type: "continuation" }),
      session({ id: "orphan", parent_session_id: "missing", relationship_type: "subagent" }),
    ];

    const tree = buildSessionArchiveTreeItems(items);
    expect(tree.map((item) => [item.session.id, item.depth, item.childCount, item.relationshipType])).toEqual([
      ["parent", 0, 1, null],
      ["child", 1, 1, "subagent"],
      ["grandchild", 2, 0, "continuation"],
      ["orphan", 0, 0, "subagent"],
    ]);
  });
});
