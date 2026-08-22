import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { setLocale } from "../src/i18n";
import type {
  PersonalLocalAgentConversationMessage,
  PersonalLocalAgentRunResult,
} from "../src/app/lib/desktop";

import {
  mapOpenCodeReasoningPartToItem,
  mapOpenCodeToolPartToItem,
  mapPersonalEventToMessages,
  mapPersonalRunToMessages,
  filterPersonalTimelineMessages,
  toOpenCodeConversationItems,
  toPersonalConversationItems,
  personalMessagesToConversationItems,
  type ConversationItemKind,
} from "../src/react-app/capabilities/conversation";
import {
  LocalAgentTimelineMessage,
} from "../src/react-app/domains/local-agents/messages/timeline-messages";
import { buildLocalAgentTurnPresentation } from "../src/react-app/domains/local-agents/messages/local-agent-turn-presentation";

function runWith(
  messages: PersonalLocalAgentConversationMessage[],
  status: PersonalLocalAgentRunResult["status"] = "completed",
): PersonalLocalAgentRunResult {
  return {
    ok: true,
    runId: "test-run",
    agentId: "codex",
    status,
    startedAt: 1,
    finishedAt: status === "running" ? null : 2,
    pid: null,
    command: "",
    output: "",
    error: null,
    events: [],
    conversationMessages: messages,
    logPath: null,
  };
}

function renderTimelineMessage(
  message: PersonalLocalAgentConversationMessage,
  runStatus: PersonalLocalAgentRunResult["status"] = "completed",
) {
  return renderToStaticMarkup(createElement(LocalAgentTimelineMessage, {
    message,
    streaming: runStatus === "running",
    runStatus,
  }));
}

describe("personal conversation adapter", () => {
  test("drops empty ACP tool groups and keeps raw Windows tool details", () => {
    const emptyGroup = {
      id: "empty-group",
      type: "tool_group" as const,
      role: "tool" as const,
      text: "",
      createdAt: 1,
      toolCalls: [
        {
          id: "empty-update",
          type: "acp_tool_call" as const,
          role: "tool" as const,
          text: "",
          createdAt: 1,
          update: {
            toolCallId: "empty",
            status: "completed",
            rawInput: {},
            rawOutput: {},
            content: [],
            locations: [],
          },
        },
      ],
    };
    const emptyMessages = mapPersonalRunToMessages({ conversationMessages: [emptyGroup] });
    expect(emptyMessages).toEqual([]);

    const windowsGroup: PersonalLocalAgentConversationMessage = {
      id: "windows-group",
      type: "tool_group",
      role: "tool",
      text: "PowerShell",
      createdAt: 2,
      toolCalls: [
        {
          id: "windows-update",
          type: "acp_tool_call",
          role: "tool",
          text: "PowerShell",
          createdAt: 2,
          update: {
            toolCallId: "windows",
            title: "PowerShell",
            kind: "execute",
            status: "completed",
            rawInput: { command: "Get-ChildItem" },
            rawOutput: "one\r\r\ntwo",
          },
        },
      ],
    };
    const turn = buildLocalAgentTurnPresentation(runWith([windowsGroup]), [], "");
    expect(turn.processSteps).toHaveLength(1);
    expect(turn.processSteps[0]?.message.type).toBe("acp_tool_call");
    expect(renderTimelineMessage(turn.processSteps[0]!.message)).toContain("Get-ChildItem");
  });

  test("keeps an ID-only failed ACP terminal update visible", () => {
    const failedGroup = {
      id: "failed-group",
      type: "tool_group" as const,
      role: "tool" as const,
      text: "",
      createdAt: 3,
      toolCalls: [{
        id: "failed-entry",
        type: "acp_tool_call" as const,
        role: "tool" as const,
        text: "",
        createdAt: 3,
        update: { toolCallId: "failed-tool-7", status: "failed" },
      }],
    };
    const timelineMessages = mapPersonalRunToMessages({ conversationMessages: [failedGroup] });
    expect(timelineMessages[0]?.text).toBe("");
    expect(timelineMessages[0]?.toolCalls?.[0]?.text).toBe("");
    const turn = buildLocalAgentTurnPresentation(runWith([failedGroup], "failed"), [], "");
    expect(turn.processSteps).toHaveLength(1);
    const html = renderTimelineMessage(turn.processSteps[0]!.message, "failed");
    expect(html).toContain("failed");
    expect(html).toContain("failed-tool-7");
  });

  test("keeps a long PowerShell command to one compact collapsed summary", () => {
    const command = `Get-ChildItem \\\\server\\${"deep\\".repeat(20)}report.txt\r\n| Select-Object FullName`;
    const message: PersonalLocalAgentConversationMessage = {
      id: "long-powershell",
      type: "acp_tool_call",
      role: "tool",
      text: command,
      createdAt: 1,
      update: {
        toolCallId: "powershell-long-path",
        title: command,
        kind: "execute",
        status: "completed",
        rawInput: { command },
        rawOutput: "done",
      },
    };
    const html = renderTimelineMessage(message);
    expect(html).toContain("Shell Command");
    expect(html).toContain("truncate font-mono text-xs");
    expect(html).toContain("…");
    expect(html).not.toContain(command);
  });

  test("keeps a running tool running when ACP sends an empty output placeholder", () => {
    const message: PersonalLocalAgentConversationMessage = {
      id: "running-powershell",
      type: "acp_tool_call",
      role: "tool",
      text: "PowerShell",
      createdAt: 1,
      status: "running",
      update: {
        toolCallId: "powershell-running",
        title: "PowerShell",
        kind: "execute",
        status: "running",
        rawInput: { command: "Start-Sleep 30" },
        rawOutput: {},
      },
    };
    setLocale("en");
    const html = renderTimelineMessage(message, "running");
    expect(html).toContain("Running");
    expect(html).not.toContain("Completed");
  });

  test("meaningful raw ACP aliases win over empty normalized placeholders", () => {
    const message: PersonalLocalAgentConversationMessage = {
      id: "mixed-aliases",
      type: "acp_tool_call",
      role: "tool",
      text: "",
      createdAt: 1,
      update: {
        toolCallId: "mixed-aliases",
        input: {},
        rawInput: { command: "Get-ChildItem" },
        output: "",
        rawOutput: "SUCCESS",
      },
    };
    setLocale("en");
    const html = renderTimelineMessage(message, "running");
    expect(html).toContain("Completed");
    expect(html).not.toBe("");
  });

  test("keeps adjacent ACP tools interleaved as separate production timeline steps", () => {
    const toolGroup = (id: string, title: string) => ({
      id: `group-${id}`,
      type: "tool_group" as const,
      role: "tool" as const,
      text: title,
      createdAt: 1,
      toolCalls: [{
        id,
        type: "acp_tool_call" as const,
        role: "tool" as const,
        text: title,
        createdAt: 1,
        update: { toolCallId: id, title, status: "completed" },
      }],
    });
    const first = toolGroup("tool-1", "PowerShell");
    const prefix = buildLocalAgentTurnPresentation(runWith([first]), [], "");
    const streamed = buildLocalAgentTurnPresentation(
      runWith([first, toolGroup("tool-2", "Read file")]),
      [],
      "",
    );
    expect(streamed.processSteps.map((step) => step.id)).toEqual(["tool-1", "tool-2"]);
    expect(streamed.processSteps.slice(0, prefix.processSteps.length).map((step) => step.id)).toEqual(
      prefix.processSteps.map((step) => step.id),
    );
  });

  test("assigns stable unique child keys when legacy tool IDs collide", () => {
    const message = (id: string) => ({
      id,
      type: "acp_tool_call" as const,
      role: "tool" as const,
      text: id,
      createdAt: 1,
      update: { toolCallId: id, title: id, status: "completed" },
    });
    const prefix = buildLocalAgentTurnPresentation(
      runWith([message("duplicate"), message("duplicate")]),
      [],
      "",
    );
    const streamed = buildLocalAgentTurnPresentation(
      runWith([message("duplicate"), message("duplicate"), message("duplicate#2")]),
      [],
      "",
    );
    const prefixKeys = prefix.processSteps.map((step) => step.id);
    const streamedKeys = streamed.processSteps.map((step) => step.id);
    expect(prefixKeys).toEqual(["duplicate", "duplicate#2"]);
    expect(streamedKeys).toEqual(["duplicate", "duplicate#2", "duplicate#2#2"]);
    expect(new Set(streamedKeys).size).toBe(streamedKeys.length);
    expect(streamedKeys.slice(0, prefixKeys.length)).toEqual(prefixKeys);
  });

  test("assigns stable unique keys to duplicate tools from separated legacy groups", () => {
    const toolGroup = (toolId: string) => ({
      id: "legacy-group",
      type: "tool_group" as const,
      role: "tool" as const,
      text: toolId,
      createdAt: 1,
      toolCalls: [{
        id: toolId,
        type: "acp_tool_call" as const,
        role: "tool" as const,
        text: toolId,
        createdAt: 1,
        update: { toolCallId: toolId, title: toolId, status: "completed" },
      }],
    });
    const prefix = buildLocalAgentTurnPresentation(runWith([toolGroup("duplicate")]), [], "");
    const streamed = buildLocalAgentTurnPresentation(
      runWith([toolGroup("duplicate"), toolGroup("duplicate")]),
      [],
      "",
    );
    expect(prefix.processSteps.map((step) => step.id)).toEqual(["duplicate"]);
    expect(streamed.processSteps.map((step) => step.id)).toEqual(["duplicate", "duplicate#2"]);
    expect(streamed.processSteps.slice(0, prefix.processSteps.length).map((step) => step.id)).toEqual(
      prefix.processSteps.map((step) => step.id),
    );
  });

  test("keeps snake-case ACP tool identifiers from the shared IPC contract", () => {
    const messages = filterPersonalTimelineMessages([{
      id: "snake-tool",
      type: "acp_tool_call",
      role: "tool",
      text: "PowerShell",
      createdAt: 1,
      update: { tool_call_id: "snake-id", title: "PowerShell" },
    }]);
    expect(messages).toHaveLength(1);
  });

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

describe("shared conversation kind contract", () => {
  const overlappingKinds = [
    "user_text",
    "assistant_text",
    "thinking",
    "tool",
    "plan",
    "approval",
    "error",
  ] as const satisfies readonly ConversationItemKind[];

  test("OpenCode and Personal adapters emit the same overlapping kinds", () => {
    const openCode = toOpenCodeConversationItems([
      { id: "u", role: "user", parts: [{ type: "text", text: "hi" }] },
      { id: "a", role: "assistant", parts: [{ type: "text", text: "yo" }] },
      {
        id: "t",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "think" },
          { type: "tool", toolName: "bash", toolCallId: "c1", state: "completed" },
        ],
      },
    ]);
    const personal = personalMessagesToConversationItems([
        { id: "u", type: "text", role: "user", text: "hi", createdAt: 1 },
        { id: "a", type: "text", role: "assistant", text: "yo", createdAt: 2 },
        { id: "th", type: "thinking", role: "assistant", text: "think", createdAt: 3 },
        {
          id: "tool",
          type: "tool",
          role: "tool",
          text: "bash",
          createdAt: 4,
          toolCall: { id: "c1", name: "bash", status: "completed" },
        },
        {
          id: "p",
          type: "plan",
          role: "assistant",
          text: "",
          createdAt: 5,
          entries: [{ id: "1", title: "do" }],
        },
        {
          id: "ap",
          type: "permission",
          role: "assistant",
          text: "Allow?",
          createdAt: 6,
          approval: { id: "ap1", title: "Allow?" },
        },
        { id: "e", type: "error", role: "assistant", text: "boom", createdAt: 7 },
    ]);

    const openKinds = new Set(openCode.map((item) => item.kind));
    const personalKinds = new Set(personal.map((item) => item.kind));
    for (const kind of overlappingKinds) {
      if (kind === "plan" || kind === "approval" || kind === "error") {
        expect(personalKinds.has(kind)).toBe(true);
        continue;
      }
      expect(openKinds.has(kind)).toBe(true);
      expect(personalKinds.has(kind)).toBe(true);
    }
  });
});
