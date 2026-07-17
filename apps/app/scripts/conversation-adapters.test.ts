import { describe, expect, test } from "bun:test";

import {
  mapOpenCodeReasoningPartToItem,
  mapOpenCodeToolPartToItem,
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
      toolName: "read",
      toolStatus: "running",
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

  test("populates thinkingStatus, approvalId, and plan meta", () => {
    const items = toPersonalConversationItems({
      conversationMessages: [
        {
          id: "think-1",
          type: "thinking",
          role: "assistant",
          text: "pondering",
          createdAt: 1,
          status: "done",
          durationMs: 2500,
        },
        {
          id: "plan-1",
          type: "plan",
          role: "assistant",
          text: "Plan",
          createdAt: 2,
          entries: [{ id: "e1", title: "Step one", status: "completed" }],
        },
        {
          id: "appr-1",
          type: "permission",
          role: "system",
          text: "Allow shell?",
          createdAt: 3,
          approval: { id: "approval-9", title: "bash" },
        },
      ],
    });

    expect(items.map((item) => item.kind)).toEqual(["thinking", "plan", "approval"]);
    expect(items[0]).toMatchObject({
      kind: "thinking",
      thinkingStatus: "done",
      status: "done",
    });
    expect(items[0]?.meta?.durationMs).toBe(2500);
    expect(items[1]?.kind).toBe("plan");
    expect(items[1]?.meta?.entries).toEqual([
      { id: "e1", title: "Step one", status: "completed" },
    ]);
    expect(items[2]).toMatchObject({
      kind: "approval",
      approvalId: "approval-9",
      text: "Allow shell?",
    });
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

  test("maps tool-ish parts alongside text with structured fields", () => {
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
      toolName: "bash",
      toolStatus: "output-available",
    });
  });

  test("mapOpenCodeToolPartToItem bridges single tool parts", () => {
    const item = mapOpenCodeToolPartToItem(
      {
        type: "tool",
        tool: "read",
        toolCallId: "call-7",
        state: { status: "completed", input: { path: "a.ts" } },
      },
      { id: "call-7", createdAt: 5 },
    );
    expect(item).toMatchObject({
      id: "call-7",
      kind: "tool",
      toolName: "read",
      toolStatus: "completed",
      status: "completed",
    });
  });

  test("mapOpenCodeReasoningPartToItem bridges thinking parts", () => {
    const item = mapOpenCodeReasoningPartToItem(
      { type: "reasoning", text: "consider options" },
      { id: "r1", complete: false },
    );
    expect(item).toMatchObject({
      id: "r1",
      kind: "thinking",
      text: "consider options",
      thinkingStatus: "thinking",
    });
  });

  test("maps reasoning parts on messages to thinking items", () => {
    const items = toOpenCodeConversationItems([
      {
        id: "a3",
        role: "assistant",
        parts: [{ type: "reasoning", text: "hmm" }],
        createdAt: 30,
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "thinking",
      text: "hmm",
      thinkingStatus: "done",
    });
  });
});
