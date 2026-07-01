import { describe, expect, it } from "bun:test";

import { sessionArchiveTranscriptMessages } from "../src/react-app/domains/session/chat/session-page-session-archive-model";
import type { OpenworkSessionArchiveMessagesResponse } from "../src/app/lib/onmyagent-server";

function message(ordinal: number): OpenworkSessionArchiveMessagesResponse["messages"][number] {
  return {
    session_id: "session-1",
    ordinal,
    role: ordinal % 2 === 0 ? "user" : "assistant",
    content: `message ${ordinal}`,
    timestamp: `2026-06-24T00:0${ordinal}:00.000Z`,
    source_type: "message",
  };
}

describe("session archive transcript controls view model", () => {
  it("keeps transcript order ascending by default", () => {
    const messages = [message(1), message(2), message(3)];
    expect(sessionArchiveTranscriptMessages(messages, false).map((item) => item.ordinal)).toEqual([1, 2, 3]);
  });

  it("reverses transcript order when newest-first is enabled without mutating input", () => {
    const messages = [message(1), message(2), message(3)];
    const ordered = sessionArchiveTranscriptMessages(messages, true);
    expect(ordered.map((item) => item.ordinal)).toEqual([3, 2, 1]);
    expect(messages.map((item) => item.ordinal)).toEqual([1, 2, 3]);
  });
});
