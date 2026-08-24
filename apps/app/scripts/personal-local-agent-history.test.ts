import { describe, expect, test } from "bun:test";

import type { PersonalLocalAgentConversationStatusResult } from "../src/app/lib/desktop";
import {
  conversationStatusToChatMessages,
  mergeHydratedChatMessages,
} from "../src/react-app/domains/local-agents/hooks/personal-local-agent-history";
import { localAgentFinalBodyFromEvents } from "../src/react-app/domains/local-agents/messages/local-agent-turn-event-timeline";
import { buildLocalAgentTurnPresentation } from "../src/react-app/domains/local-agents/messages/local-agent-turn-presentation";
import { visibleRunTimelineMessages } from "../src/react-app/domains/local-agents/messages/timeline-messages";

describe("Personal Local Agent canonical conversation hydration", () => {
  test("keeps structured timeline messages while using only assistant body text for the bubble", () => {
    const result = {
      conversation: null,
      activeRun: null,
      running: false,
      status: "completed",
      conversationMessages: [
        { id: "u1", type: "text", role: "user", text: "inspect", createdAt: 1 },
        { id: "think1", type: "thinking", role: "assistant", text: "reasoning", createdAt: 2 },
        { id: "tool1", type: "tool", role: "tool", text: "rg", createdAt: 3, status: "completed" },
        { id: "permission1", type: "permission", role: "system", text: "approve", createdAt: 4 },
        { id: "final1", type: "finish", role: "assistant", text: "done", createdAt: 5 },
        { id: "usage1", type: "context_usage", role: "system", text: "usage", createdAt: 5.5, contextUsage: { used: 10, total: 100 } },
        { id: "u2", type: "text", role: "user", text: "next", createdAt: 6 },
        { id: "final2", type: "content", role: "assistant", text: "second", createdAt: 7 },
      ],
    } satisfies PersonalLocalAgentConversationStatusResult;

    const messages = conversationStatusToChatMessages("codex::conversation", result);
    expect(messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "inspect"],
      ["assistant", "done"],
      ["user", "next"],
      ["assistant", "second"],
    ]);
    expect(messages[1]?.run?.conversationMessages?.map((message) => message.type)).toEqual([
      "thinking",
      "tool",
      "permission",
      "finish",
      "context_usage",
    ]);
    expect(messages[1]?.run?.conversationMessages?.at(-1)?.contextUsage).toEqual({ used: 10, total: 100 });
  });

  test("keeps a pending approval on the active turn instead of leaking it into history", () => {
    const approval = {
      id: "approval-active",
      runId: "run-active",
      provider: "codex" as const,
      method: "item/commandExecution",
      kind: "command" as const,
      title: "Run command",
      summary: "Approve the active turn",
      command: "pnpm test",
      createdAt: 7,
    };
    const result = {
      conversation: null,
      running: true,
      status: "running",
      events: [],
      conversationMessages: [
        { id: "u1", type: "text", role: "user", text: "first", createdAt: 1 },
        { id: "a1", type: "finish", role: "assistant", text: "done", createdAt: 2 },
        { id: "u2", type: "text", role: "user", text: "second", createdAt: 5 },
        { id: "a2", type: "thinking", role: "assistant", text: "working", createdAt: 6 },
      ],
      activeRun: {
        ok: false,
        runId: "run-active",
        agentId: "codex",
        status: "running" as const,
        startedAt: 5,
        finishedAt: null,
        pid: null,
        command: "codex",
        output: "",
        error: null,
        events: [],
        eventRevision: 0,
        conversationMessages: [],
        logPath: null,
        pendingApprovals: [approval],
      },
    } satisfies PersonalLocalAgentConversationStatusResult;

    const assistantRuns = conversationStatusToChatMessages("codex::approvals", result)
      .filter((message) => message.role === "assistant")
      .map((message) => message.run);

    expect(assistantRuns).toHaveLength(2);
    expect(assistantRuns[0]?.pendingApprovals).toEqual([]);
    expect(assistantRuns[1]?.pendingApprovals).toEqual([approval]);
  });

  test("hydrates a running assistant row before the first visible provider message", () => {
    const activeRun = {
      ok: false,
      runId: "run-starting",
      agentId: "codex",
      status: "running" as const,
      startedAt: 10,
      finishedAt: null,
      pid: null,
      command: "codex",
      output: "",
      error: null,
      events: [
        { eventId: "start-user", type: "user" as const, text: "start now", at: 10 },
        { eventId: "start-status", type: "status" as const, text: "ACP flow started", at: 11 },
      ],
      eventRevision: 2,
      conversationMessages: [],
      logPath: null,
      pendingApprovals: [],
    };
    const result = {
      conversation: null,
      activeRun,
      running: true,
      status: "running",
      events: activeRun.events,
      conversationMessages: [
        { id: "start-user-message", type: "text", role: "user", text: "start now", createdAt: 10 },
        { id: "start-status-message", type: "agent_status", role: "system", text: "ACP flow started", createdAt: 11 },
      ],
    } satisfies PersonalLocalAgentConversationStatusResult;

    const messages = conversationStatusToChatMessages("codex::starting", result);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.run?.runId).toBe("run-starting");
    expect(messages[1]?.run?.status).toBe("running");
  });

  test("does not drop a prompt entered while history is hydrating", () => {
    const current = [
      { id: "welcome-codex", role: "assistant", text: "Welcome", createdAt: 1 },
      { id: "user-live", role: "user", text: "new prompt", createdAt: 10_000 },
      { id: "assistant-live", role: "assistant", text: "Calling", createdAt: 10_001, run: null },
    ] as const;
    const canonical = [
      { id: "history-old-user", role: "user", text: "old prompt", createdAt: 2 },
      { id: "history-old-assistant", role: "assistant", text: "old reply", createdAt: 3 },
    ] as const;

    expect(mergeHydratedChatMessages([...current], [...canonical], null).map((message) => message.text)).toEqual([
      "Welcome",
      "old prompt",
      "old reply",
      "new prompt",
      "Calling",
    ]);
  });

  test("keeps each historical turn's raw event order for process hydration", () => {
    const result = {
      conversation: null,
      activeRun: null,
      running: false,
      status: "completed",
      events: [
        { eventId: "u1-event", type: "user", text: "inspect", at: 1 },
        { eventId: "think-event", type: "thinking", text: "reasoning", status: "done", msgId: "reason-1", at: 2 },
        { eventId: "tool-1-event", type: "tool", text: "rg", at: 3, toolCall: { id: "tool-1", name: "rg", status: "completed", output: "one" } },
        { eventId: "mid-event", type: "assistant_chunk", text: "checkpoint", at: 4 },
        { eventId: "tool-2-event", type: "tool", text: "read", at: 5, toolCall: { id: "tool-2", name: "read", status: "completed", output: "two" } },
        { eventId: "final-chunk-event", type: "assistant_chunk", text: "done", at: 6 },
        { eventId: "finish-event", type: "assistant", text: "checkpointdone", at: 7 },
        { eventId: "u2-event", type: "user", text: "next", at: 8 },
        { eventId: "second-chunk-event", type: "assistant_chunk", text: "second", at: 9 },
        { eventId: "second-finish-event", type: "assistant", text: "second", at: 10 },
      ],
      conversationMessages: [
        { id: "u1", type: "text", role: "user", text: "inspect", createdAt: 1 },
        { id: "first-compacted", type: "text", role: "assistant", text: "checkpointdone", createdAt: 4, sourceEventType: "assistant_chunk" },
        { id: "first-finish", type: "finish", role: "assistant", text: "checkpointdone", createdAt: 7 },
        { id: "u2", type: "text", role: "user", text: "next", createdAt: 8 },
        { id: "second-finish", type: "finish", role: "assistant", text: "second", createdAt: 10 },
      ],
    } satisfies PersonalLocalAgentConversationStatusResult;

    const messages = conversationStatusToChatMessages("codex::history-order", result);
    const firstRun = messages[1]?.run;
    const secondRun = messages[3]?.run;
    expect(firstRun?.events.map((event) => event.eventId)).toEqual([
      "u1-event",
      "think-event",
      "tool-1-event",
      "mid-event",
      "tool-2-event",
      "final-chunk-event",
      "finish-event",
    ]);
    expect(secondRun?.events.map((event) => event.eventId)).toEqual([
      "u2-event",
      "second-chunk-event",
      "second-finish-event",
    ]);
    expect(firstRun).toBeDefined();
    if (!firstRun) return;
    const finalBody = localAgentFinalBodyFromEvents(firstRun.events) ?? "";
    const turn = buildLocalAgentTurnPresentation(
      firstRun,
      visibleRunTimelineMessages(firstRun),
      finalBody,
    );
    expect(finalBody).toBe("done");
    expect(turn.processSteps.map((step) => step.message.text)).toEqual([
      "reasoning",
      "rg",
      "checkpoint",
      "read",
    ]);
  });

  test("does not attach new runtime events to archive-only turns", () => {
    const result = {
      conversation: null,
      activeRun: null,
      running: false,
      status: "completed",
      events: [
        { eventId: "new-user-event", type: "user", text: "new prompt", at: 10 },
        { eventId: "new-thinking-event", type: "thinking", text: "new reasoning", at: 11, status: "done" },
        { eventId: "new-tool-event", type: "tool", text: "read", at: 12, toolCall: { id: "new-tool", name: "read", status: "completed" } },
        { eventId: "new-finish-event", type: "finish", text: "new answer", at: 13 },
      ],
      conversationMessages: [
        { id: "archive-user", type: "text", role: "user", text: "archived prompt", createdAt: 1 },
        { id: "archive-assistant", type: "text", role: "assistant", text: "archived answer", createdAt: 2 },
        { id: "new-user", type: "text", role: "user", text: "new prompt", createdAt: 10 },
        { id: "new-thinking", type: "thinking", role: "assistant", text: "new reasoning", createdAt: 11, status: "done" },
        { id: "new-tool", type: "tool", role: "tool", text: "read", createdAt: 12, toolCall: { id: "new-tool", name: "read", status: "completed" } },
        { id: "new-finish", type: "finish", role: "assistant", text: "new answer", createdAt: 13 },
      ],
    } satisfies PersonalLocalAgentConversationStatusResult;

    const messages = conversationStatusToChatMessages("codex::archive-events", result);
    expect(messages[1]?.run?.events).toEqual([]);
    expect(messages[3]?.run?.events.map((event) => event.eventId)).toEqual([
      "new-user-event",
      "new-thinking-event",
      "new-tool-event",
      "new-finish-event",
    ]);
  });

  test("keeps the renderer-newer active run instead of a stale status copy", () => {
    const activeRun = {
      ok: false,
      runId: "run-live",
      agentId: "codex",
      status: "running" as const,
      startedAt: 10,
      finishedAt: null,
      pid: null,
      command: "codex",
      output: "newer",
      error: null,
      events: [],
      conversationMessages: [],
      logPath: null,
    };
    const current = [{ id: "live", role: "assistant" as const, text: "newer", createdAt: 10, run: activeRun }];
    const canonical = [{ id: "history-live", role: "assistant" as const, text: "older", createdAt: 10, run: { ...activeRun, output: "older" } }];

    const merged = mergeHydratedChatMessages(current, canonical, "run-live");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe("newer");
  });

  test("does not roll a renderer-terminal run back to a stale hydrating snapshot", () => {
    const running = {
      ok: false,
      runId: "run-race",
      agentId: "codex",
      status: "running" as const,
      startedAt: 10,
      finishedAt: null,
      pid: null,
      command: "codex",
      output: "older",
      error: null,
      events: [],
      conversationMessages: [],
      logPath: null,
    };
    const terminal = {
      ...running,
      ok: true,
      status: "completed" as const,
      finishedAt: 20,
      output: "newer terminal",
    };
    const current = [{ id: "live-terminal", role: "assistant" as const, text: "newer terminal", createdAt: 10, run: terminal }];
    const canonical = [{ id: "history-race", role: "assistant" as const, text: "older", createdAt: 10, run: running }];

    const merged = mergeHydratedChatMessages(current, canonical, "run-race");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.run?.status).toBe("completed");
    expect(merged[0]?.text).toBe("newer terminal");
  });

  test("replaces a compact terminal renderer row with canonical thought and tool events", () => {
    const current = [{
      id: "live-terminal",
      role: "assistant" as const,
      text: "final answer",
      createdAt: 10,
      run: {
        ok: true,
        runId: "run-terminal",
        agentId: "codex",
        status: "completed" as const,
        startedAt: 10,
        finishedAt: 20,
        pid: null,
        command: "codex",
        output: "final answer",
        error: null,
        events: [],
        eventRevision: 0,
        conversationMessages: [],
        logPath: null,
      },
    }];
    const result = {
      conversation: null,
      activeRun: null,
      running: false,
      status: "completed",
      events: [
        { eventId: "user-event", type: "user", text: "research", at: 9 },
        { eventId: "thinking-event", type: "thinking", text: "reasoning", status: "done", at: 11 },
        { eventId: "tool-event", type: "tool", text: "search", at: 12, toolCall: { id: "search-1", name: "search", status: "completed" } },
        { eventId: "finish-event", type: "finish", text: "final answer", at: 20 },
      ],
      conversationMessages: [
        { id: "user", type: "text", role: "user", text: "research", createdAt: 9 },
        { id: "thinking", type: "thinking", role: "assistant", text: "reasoning", createdAt: 11 },
        { id: "tool", type: "tool", role: "tool", text: "search", createdAt: 12 },
        { id: "finish", type: "finish", role: "assistant", text: "final answer", createdAt: 20 },
      ],
    } satisfies PersonalLocalAgentConversationStatusResult;

    const canonical = conversationStatusToChatMessages("codex::terminal", result);
    const merged = mergeHydratedChatMessages(current, canonical, null);
    const assistant = merged.find((message) => message.role === "assistant");
    expect(assistant?.id.startsWith("history-")).toBe(true);
    expect(assistant?.run).toBeDefined();
    if (!assistant?.run) return;
    const turn = buildLocalAgentTurnPresentation(
      assistant.run,
      visibleRunTimelineMessages(assistant.run),
      localAgentFinalBodyFromEvents(assistant.run.events) ?? assistant.text,
    );
    expect(turn.collapseEligible).toBe(true);
    expect(turn.processSteps.map((step) => step.message.type)).toEqual(["thinking", "tool"]);
  });
});
