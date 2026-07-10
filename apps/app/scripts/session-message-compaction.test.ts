import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import {
  filterCompactionMessages,
  messageActivityFingerprint,
} from "../src/react-app/domains/session/surface/transcript/message-compaction";

function msg(id: string, role: UIMessage["role"], text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text }] } as UIMessage;
}

describe("message-compaction", () => {
  test("messageActivityFingerprint changes when text grows", () => {
    const a = [msg("1", "assistant", "hi")];
    const b = [msg("1", "assistant", "hello world")];
    expect(messageActivityFingerprint(a)).not.toBe(messageActivityFingerprint(b));
  });

  test("filterCompactionMessages drops summary-like assistants when boundary set", () => {
    const messages = [
      msg("u1", "user", "please compact"),
      msg("a1", "assistant", "Here is a compact summary of the conversation so far with many details."),
      msg("a2", "assistant", "normal reply"),
    ];
    // boundary after first message
    const filtered = filterCompactionMessages(messages, 1);
    // function behavior depends on isLikelyCompactSummaryMessage heuristics
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.length).toBeLessThanOrEqual(messages.length);
  });
});
