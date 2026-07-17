import { beforeEach, describe, expect, test } from "bun:test";

import type {
  OnMyAgentSessionMessage,
  OnMyAgentSessionSnapshot,
} from "../src/app/lib/onmyagent-server";
import { setLocale } from "../src/i18n";
import {
  formatConversationTime,
  normalizeTimestamp,
  snapshotConversationSummary,
} from "../src/react-app/domains/session/chat/session-page-conversation-model";
import {
  formatConversationTime as formatAssistantConversationTime,
} from "../src/react-app/domains/session/sidebar/conversation-model";

beforeEach(() => {
  setLocale("zh");
});

function message(input: {
  id: string;
  parts: OnMyAgentSessionMessage["parts"];
  created?: number;
  completed?: number;
}): OnMyAgentSessionMessage {
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
  } as OnMyAgentSessionMessage;
}

function snapshot(messages: OnMyAgentSessionMessage[], time = { created: 1_700_000_000, updated: 1_700_000_010 }): OnMyAgentSessionSnapshot {
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
  } as OnMyAgentSessionSnapshot;
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
    const older = today - 15 * 86_400_000;

    expect(formatConversationTime(today)).toBe("09:05");
    expect(formatConversationTime(yesterday)).toBe("1天前");
    expect(formatConversationTime(older)).toBe("15天前");
    expect(formatAssistantConversationTime(today)).toBe("09:05");
    expect(formatAssistantConversationTime(yesterday)).toBe("1天前");
    expect(formatAssistantConversationTime(older)).toBe("15天前");
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
