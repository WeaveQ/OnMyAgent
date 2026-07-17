import { describe, expect, test } from "bun:test";

import {
  mapPersonalEventToMessages,
  toOpenCodeConversationItems,
  toPersonalConversationItems,
} from "../src/react-app/capabilities/conversation";

describe("personal conversation adapter", () => {
  test("maps assistant_chunk, tool, and error events to items", () => {
    const items = toPersonalConversationItems({
      events: [
        {
          type: "assistant_chunk",
          text: "Hello from assistant",
          at: 1000,
        },
        {
          type: "tool",
          text: "read file",
          at: 1001,
          toolCall: {
            id: "tool-1",
            name: "read",
            status: "running",
          },
        },
        {
          type: "error",
          text: "boom",
          at: 1002,
        },
      ],
    });

    // assistant_chunk becomes type "text" which is filtered from the visible
    // personal timeline (folded into the chat bubble), so it does not appear
    // in ConversationItemVM output of the timeline pipeline.
    expect(items.map((item) => item.kind)).toEqual(["tool", "error"]);
    expect(items[0]).toMatchObject({
      id: "event-1",
      kind: "tool",
      role: "tool",
      text: "read file",
      status: "running",
    });
    expect(items[0]?.meta?.toolCall).toMatchObject({ id: "tool-1", name: "read" });
    expect(items[1]).toMatchObject({
      id: "event-2",
      kind: "error",
      role: "system",
      text: "boom",
    });
  });

  test("mapPersonalEventToMessages retains assistant_chunk before filter", () => {
    const mapped = mapPersonalEventToMessages(
      { type: "assistant_chunk", text: "partial", at: 42 },
      0,
    );
    expect(mapped).toEqual([
      {
        id: "event-0",
        type: "text",
        role: "assistant",
        text: "partial",
        createdAt: 42,
        sourceEventType: "assistant_chunk",
      },
    ]);
  });

  test("prefers conversationMessages when present", () => {
    const items = toPersonalConversationItems({
      conversationMessages: [
        {
          id: "msg-err",
          type: "error",
          role: "system",
          text: "from transcript",
          createdAt: 9,
        },
      ],
      events: [
        { type: "error", text: "from events", at: 1 },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe("from transcript");
  });
});

describe("opencode conversation adapter", () => {
  test("maps user + assistant text messages to items", () => {
    const items = toOpenCodeConversationItems([
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Hi there" }],
        createdAt: 10,
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello back" }],
        createdAt: 11,
      },
    ]);

    expect(items).toEqual([
      {
        id: "u1",
        kind: "user_text",
        role: "user",
        text: "Hi there",
        createdAt: 10,
        meta: { source: "opencode", part: "text" },
      },
      {
        id: "a1",
        kind: "assistant_text",
        role: "assistant",
        text: "Hello back",
        createdAt: 11,
        meta: { source: "opencode", part: "text" },
      },
    ]);
  });

  test("maps tool-ish parts alongside text", () => {
    const items = toOpenCodeConversationItems([
      {
        id: "a2",
        role: "assistant",
        parts: [
          { type: "text", text: "Working" },
          {
            type: "dynamic-tool",
            toolName: "bash",
            toolCallId: "tc-1",
            state: "output-available",
            input: { command: "ls" },
            output: "ok",
          },
        ],
        createdAt: 20,
      },
    ]);

    expect(items.map((item) => item.kind)).toEqual(["assistant_text", "tool"]);
    expect(items[1]).toMatchObject({
      id: "tc-1",
      kind: "tool",
      role: "tool",
      text: "bash",
      status: "output-available",
    });
  });
});
