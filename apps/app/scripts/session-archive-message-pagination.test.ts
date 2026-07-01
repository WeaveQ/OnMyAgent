import { describe, expect, it } from "bun:test";

import {
  SESSION_ARCHIVE_ARCHIVE_MESSAGE_LIMIT,
  normalizeLatestSessionArchiveMessages,
  prependOlderSessionArchiveMessages,
} from "../src/react-app/domains/session/chat/session-page-session-archive-model";
import type { OpenworkSessionArchiveMessagesResponse } from "../src/app/lib/onmyagent-server";

function page(ordinals: number[]): OpenworkSessionArchiveMessagesResponse {
  return {
    count: ordinals.length,
    messages: ordinals.map((ordinal) => ({
      id: ordinal,
      session_id: "session-1",
      ordinal,
      role: ordinal % 2 === 0 ? "user" : "assistant",
      content: `message-${ordinal}`,
      timestamp: "2026-06-24T00:00:00.000Z",
      is_system: false,
      has_tool_use: false,
      has_thinking: false,
      token_usage: null,
      created_at: "2026-06-24T00:00:00.000Z",
    })),
  };
}

describe("session archive message pagination view model", () => {
  it("hydrates latest descending API results in normal ascending transcript order", () => {
    const state = normalizeLatestSessionArchiveMessages(page([4, 3, 2]), 3);

    expect(state.messages.messages.map((message) => message.ordinal)).toEqual([2, 3, 4]);
    expect(state.hasOlder).toBe(true);
  });

  it("prepends older pages without duplicating overlapping messages", () => {
    const current = page([2, 3, 4]);
    const state = prependOlderSessionArchiveMessages(current, page([2, 1, 0]), 3);

    expect(state.messages.messages.map((message) => message.ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(state.messages.count).toBe(5);
    expect(state.hasOlder).toBe(false);
  });

  it("keeps the message page limit below the old fixed 500-message transcript cap", () => {
    expect(SESSION_ARCHIVE_ARCHIVE_MESSAGE_LIMIT).toBeLessThanOrEqual(500);
  });
});
