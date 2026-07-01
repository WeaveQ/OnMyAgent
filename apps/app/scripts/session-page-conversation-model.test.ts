import { describe, expect, test } from "bun:test";

import type {
  OpenworkSessionMessage,
  OpenworkSessionSnapshot,
} from "../src/app/lib/onmyagent-server";
import {
  formatConversationTime,
  normalizeTimestamp,
  snapshotConversationSummary,
} from "../src/react-app/domains/session/chat/session-page-conversation-model";

function message(input: {
  id: string;
  parts: OpenworkSessionMessage["parts"];
  created?: number;
  completed?: number;
}): OpenworkSessionMessage {
  return {
    info: {
      id: input.id,
      role: "assistant",
      sessionID: "session-a",
      time: {
        created: input.created ?? 1,
        ...(input.completed === undefined ? {} : { completed: input.completed }),
      },
    },
    parts: input.parts,
  } as OpenworkSessionMessage;
}

function snapshot(messages: OpenworkSessionMessage[], time = { created: 1_700_000_000, updated: 1_700_000_010 }): OpenworkSessionSnapshot {
  return {
    session: {
      id: "session-a",
      parentID: undefined,
      title: "Session A",
      time,
      share: undefined,
      version: "0",
    },
    messages,
    todos: [],
    status: { type: "idle" },
  } as OpenworkSessionSnapshot;
}

describe("session page conversation model", () => {
  test("normalizes second and millisecond timestamps", () => {
    expect(normalizeTimestamp(1_700_000_000)).toBe(1_700_000_000_000);
    expect(normalizeTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(normalizeTimestamp(null)).toBeNull();
    expect(normalizeTimestamp(Number.NaN)).toBeNull();
  });

  test("formats invalid and recent conversation times", () => {
    expect(formatConversationTime(null)).toBe("");
    expect(formatConversationTime(Number.NaN)).toBe("");

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 5).getTime();
    const yesterday = today - 86_400_000;
    const older = new Date(now.getFullYear(), Math.max(0, now.getMonth() - 1), 3, 9, 5).getTime();

    expect(formatConversationTime(today)).toBe("09:05");
    expect(formatConversationTime(yesterday)).toBe("昨天");
    expect(formatConversationTime(older)).toMatch(/^\d{1,2}\/3$/);
  });

  test("summarizes the latest non-empty message preview", () => {
    const summary = snapshotConversationSummary(snapshot([
      message({ id: "msg-1", parts: [{ type: "text", text: "  ignored  ", synthetic: true }] }),
      message({ id: "msg-2", parts: [{ type: "tool", tool: "shell" }, { type: "file" }], completed: 1_700_000_020 }),
      message({ id: "msg-3", parts: [{ type: "agent", name: "Reviewer" }, { type: "reasoning", text: " checking " }], completed: 1_700_000_030 }),
    ]), null);

    expect(summary.preview).toBe("@Reviewer checking");
    expect(summary.time).not.toBe("");
  });

  test("falls back to new-session preview and session or fallback time", () => {
    expect(snapshotConversationSummary(undefined, 1_700_000_000)).toEqual({
      preview: "新建会话",
      time: formatConversationTime(1_700_000_000),
    });

    expect(snapshotConversationSummary(snapshot([
      message({ id: "msg-1", parts: [{ type: "text", text: "", ignored: true }] }),
    ], { created: 1_700_000_000, updated: 1_700_000_050 }), null)).toEqual({
      preview: "新建会话",
      time: formatConversationTime(1_700_000_050),
    });
  });
});
