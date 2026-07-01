import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import {
  assistantFallbackText,
  controlRecentMessageCount,
  controlTextArgument,
  DEFAULT_COMPOSER_CONTROL_TEXT,
  latestMessageControlResult,
  messageHasVisibleAssistantOutput,
  messageToReadableText,
  transcriptControlResult,
  transcriptToText,
} from "../src/react-app/domains/session/surface/session-surface-model";

function message(id: string, role: UIMessage["role"], parts: UIMessage["parts"]): UIMessage {
  return { id, role, parts };
}

describe("session surface model", () => {
  test("converts messages and transcripts into readable control text", () => {
    const messages = [
      message("user-1", "user", [{ type: "text", text: "Hello" }]),
      message("assistant-1", "assistant", [
        { type: "reasoning", text: "Thinking" },
        { type: "dynamic-tool", toolName: "shell", state: "output-available", input: { cmd: "pwd" }, output: { ok: true } },
      ]),
    ];

    expect(messageToReadableText(messages[0]!)).toBe("You\nHello");
    expect(messageToReadableText(messages[1]!)).toContain("OnMyAgent\nThinking");
    expect(messageToReadableText(messages[1]!)).toContain('[tool:shell] {"ok":true}');
    expect(transcriptToText(messages)).toContain("---");
  });

  test("normalizes control args and recent message count", () => {
    expect(controlTextArgument("  keep me  ")).toBe("  keep me  ");
    expect(controlTextArgument({ text: "from object" })).toBe("from object");
    expect(controlTextArgument({ text: 123 })).toBe(DEFAULT_COMPOSER_CONTROL_TEXT);

    expect(controlRecentMessageCount(null)).toBe(10);
    expect(controlRecentMessageCount({ count: -5 })).toBe(1);
    expect(controlRecentMessageCount({ count: 99 })).toBe(30);
    expect(controlRecentMessageCount({ count: 7 })).toBe(7);
  });

  test("builds latest-message and transcript control results", () => {
    const messages = [
      message("user-1", "user", [{ type: "text", text: "First" }]),
      message("assistant-1", "assistant", [{ type: "text", text: "Second" }]),
      message("assistant-2", "assistant", [{ type: "text", text: "Third" }]),
    ];

    expect(latestMessageControlResult({ messages: [], sessionId: "session-a" })).toBeNull();
    expect(latestMessageControlResult({ messages, sessionId: "session-a" })).toMatchObject({
      ok: true,
      sessionId: "session-a",
      index: 2,
      role: "assistant",
      text: "OnMyAgent\nThird",
    });

    expect(transcriptControlResult({ count: 2, messages, sessionId: "session-a" })).toMatchObject({
      ok: true,
      sessionId: "session-a",
      messageCount: 3,
      returned: 2,
      messages: [
        { index: 1, role: "assistant", text: "OnMyAgent\nSecond" },
        { index: 2, role: "assistant", text: "OnMyAgent\nThird" },
      ],
    });
    expect(transcriptControlResult({ count: 2, messages: [], sessionId: "session-a" })).toBeNull();
  });

  test("detects visible assistant output", () => {
    expect(messageHasVisibleAssistantOutput(message("user-1", "user", [{ type: "text", text: "Hi" }]))).toBe(false);
    expect(messageHasVisibleAssistantOutput(message("assistant-empty", "assistant", [{ type: "text", text: "  " }]))).toBe(false);
    expect(messageHasVisibleAssistantOutput(message("assistant-text", "assistant", [{ type: "text", text: "Done" }]))).toBe(true);
    expect(messageHasVisibleAssistantOutput(message("assistant-tool", "assistant", [{ type: "dynamic-tool", toolName: "shell", state: "input-available", input: { cmd: "pwd" } }]))).toBe(true);
  });

  test("builds assistant fallback text after a baseline", () => {
    const messages = [
      message("user-1", "user", [{ type: "text", text: "Prompt" }]),
      message("assistant-1", "assistant", [{ type: "text", text: "First" }]),
      message("assistant-2", "assistant", [
        { type: "dynamic-tool", toolName: "shell", state: "output-error", input: { cmd: "pwd" }, errorText: "failed" },
        { type: "file", mediaType: "text/plain", filename: "notes.txt", url: "file:///notes.txt" },
      ]),
    ];

    expect(assistantFallbackText(messages, 1)).toBe("First\n\n[tool:shell] failed\n\nnotes.txt");
  });
});
