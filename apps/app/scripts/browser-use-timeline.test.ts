import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { UIMessage } from "ai";

import type { BrowserUseAgentRunResult } from "../src/app/lib/desktop";
import { mergeBrowserUseTimeline } from "../src/react-app/domains/session/browser-use/browser-use-timeline";

const baseMessages: UIMessage[] = [{
  id: "message-user",
  role: "user",
  parts: [{ type: "text", text: "Open example.com" }],
}];

const run: BrowserUseAgentRunResult = {
  runId: "run-1",
  sessionId: "session-1",
  userMessageId: "message-user",
  ownerId: "expert:session-1",
  status: "completed",
  createdAt: 100,
  updatedAt: 900,
  pendingApprovals: [],
  events: [
    {
      id: "event-narration",
      runId: "run-1",
      sequence: 1,
      timestamp: 100,
      type: "narration",
      step: 1,
      text: "I will open the page first.",
      nextGoal: "Open the page",
    },
    {
      id: "event-model-update",
      runId: "run-1",
      sequence: 2,
      timestamp: 150,
      type: "model_update",
      step: 1,
      evaluation: "No previous action to evaluate",
      nextGoal: "Open the page",
      actions: [{ name: "go_to_url", params: { url: "https://example.com" } }],
      raw: {
        evaluationPreviousGoal: "No previous action to evaluate",
        nextGoal: "Open the page",
        actions: [{ name: "go_to_url", params: { url: "https://example.com" } }],
      },
    },
    {
      id: "event-operation-1",
      runId: "run-1",
      sequence: 2,
      timestamp: 200,
      type: "operation_started",
      operationId: "operation-1",
      step: 1,
      actions: [{ name: "go_to_url", params: { url: "https://example.com" } }],
      actionCount: 1,
      url: "about:blank",
      title: "New Tab",
    },
    {
      id: "event-operation-1-progress",
      runId: "run-1",
      sequence: 3,
      timestamp: 300,
      type: "operation_progress",
      operationId: "operation-1",
      step: 1,
      action: { name: "go_to_url", params: { url: "https://example.com" } },
      observationSource: "hybrid",
    },
    {
      id: "event-operation-1-complete",
      runId: "run-1",
      sequence: 4,
      timestamp: 400,
      type: "operation_completed",
      operationId: "operation-1",
      step: 1,
      results: [{ extractedContent: "Opened Example Domain" }],
      success: true,
      url: "https://example.com",
      title: "Example Domain",
      error: "",
    },
    {
      id: "event-narration-2",
      runId: "run-1",
      sequence: 6,
      timestamp: 500,
      type: "narration",
      step: 2,
      text: "Now I will inspect the visible content.",
      nextGoal: "Inspect content",
    },
    {
      id: "event-model-update-2",
      runId: "run-1",
      sequence: 5,
      timestamp: 450,
      type: "model_update",
      step: 2,
      evaluation: "The page opened successfully",
      nextGoal: "Inspect the visible content",
      actions: [{ name: "extract_structured_data", params: {} }],
      raw: {
        evaluationPreviousGoal: "The page opened successfully",
        nextGoal: "Inspect the visible content",
        actions: [{ name: "extract_structured_data", params: {} }],
      },
    },
    {
      id: "event-operation-2",
      runId: "run-1",
      sequence: 6,
      timestamp: 600,
      type: "operation_started",
      operationId: "operation-2",
      step: 2,
      actions: [{ name: "extract_structured_data", params: {} }],
      actionCount: 1,
      url: "https://example.com",
      title: "Example Domain",
    },
    {
      id: "event-operation-2-complete",
      runId: "run-1",
      sequence: 7,
      timestamp: 700,
      type: "operation_completed",
      operationId: "operation-2",
      step: 2,
      results: [{ extractedContent: "Example Domain body" }],
      success: true,
      url: "https://example.com",
      title: "Example Domain",
      error: "",
    },
    {
      id: "event-done",
      runId: "run-1",
      sequence: 8,
      timestamp: 800,
      type: "done",
      result: "The page contains the Example Domain heading and explanatory text.",
    },
  ],
};

describe("mergeBrowserUseTimeline", () => {
  test("keeps public model progress out of folded tool details", () => {
    const source = readFileSync(new URL(
      "../src/react-app/domains/session/surface/message-list.tsx",
      import.meta.url,
    ), "utf8");

    expect(source).not.toContain('t("session.browser_use_operation_evaluation")');
    expect(source).not.toContain('t("session.browser_use_operation_model_output")');
    expect(source).not.toContain("props.input?.modelUpdate");
  });

  test("renders every public model update as a normal assistant message", () => {
    const messages = mergeBrowserUseTimeline(baseMessages, [run]);

    expect(messages.map((message) => message.id)).toEqual([
      "message-user",
      "browser-use:event-model-update",
      "browser-use:operation:run-1:operation-1",
      "browser-use:event-model-update-2",
      "browser-use:operation:run-1:operation-2",
      "browser-use:event-done",
    ]);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "assistant",
      "assistant",
      "assistant",
      "assistant",
    ]);
    expect(messages[1]?.parts[0]).toMatchObject({
      type: "text",
      text: "Open the page",
    });
    expect(messages[2]?.parts[0]).toMatchObject({
      type: "dynamic-tool",
      toolName: "browser_use_operation",
      toolCallId: "operation-1",
      state: "output-available",
      input: {
        actionCount: 1,
        currentGoal: "I will open the page first.",
        keepExpanded: false,
      },
      output: { success: true, title: "Example Domain" },
    });
    expect(messages[3]?.parts[0]).toMatchObject({
      type: "text",
      text: "The page opened successfully\n\nInspect the visible content",
    });
    expect(messages[4]?.parts[0]).toMatchObject({
      toolCallId: "operation-2",
      input: {
        currentGoal: "Now I will inspect the visible content.",
        keepExpanded: false,
      },
    });
    expect(messages[5]?.parts[0]).toMatchObject({
      type: "text",
      text: "The page contains the Example Domain heading and explanatory text.",
    });
  });

  test("shows the ready observation phase as a normal assistant message", () => {
    const planningRun: BrowserUseAgentRunResult = {
      ...run,
      status: "running",
      events: [{
        id: "event-ready",
        runId: "run-1",
        sequence: 1,
        timestamp: 100,
        type: "ready",
        phase: "observing",
      }],
    };

    const messages = mergeBrowserUseTimeline(baseMessages, [planningRun]);

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      id: "browser-use:activity:run-1",
      role: "assistant",
      parts: [{
        type: "text",
        state: "streaming",
      }],
    });
    const activityPart = messages[1]?.parts[0];
    expect(activityPart?.type === "text" ? activityPart.text.length : 0).toBeGreaterThan(0);
  });

  test("keeps tool cards collapsed and shows a live activity after completed steps", () => {
    const runningEvents = run.events.filter((event) => event.type !== "done");
    const runningRun: BrowserUseAgentRunResult = {
      ...run,
      status: "running",
      events: [
        ...runningEvents,
        {
          id: "event-verifying",
          runId: "run-1",
          sequence: 8,
          timestamp: 750,
          type: "phase",
          phase: "verifying",
        },
      ],
    };

    const messages = mergeBrowserUseTimeline(baseMessages, [runningRun]);
    const firstPart = messages[2]?.parts[0];
    const secondPart = messages[4]?.parts[0];

    expect(firstPart?.type === "dynamic-tool" ? firstPart.input : null).toMatchObject({
      keepExpanded: false,
    });
    expect(secondPart?.type === "dynamic-tool" ? secondPart.input : null).toMatchObject({
      keepExpanded: false,
    });
    expect(messages.at(-1)).toMatchObject({
      id: "browser-use:activity:run-1",
      role: "assistant",
      parts: [{
        type: "text",
        state: "streaming",
      }],
    });
  });

  test("does not let stale OpenCode status keep a completed Browser Use run thinking", () => {
    const source = readFileSync(new URL(
      "../src/react-app/domains/session/surface/session-surface.tsx",
      import.meta.url,
    ), "utf8");

    expect(source).toContain("browserUseRunActive");
    expect(source).toContain('effectiveAgent?.runtime === "browser-use-agent"');
    expect(source).toContain(".setRunStatus(props.workspaceId, props.sessionId, { type: \"idle\" })");
  });

  test("does not duplicate a single Browser Use step title in the collapsed preview", () => {
    const source = readFileSync(new URL(
      "../src/react-app/domains/session/surface/message-list.tsx",
      import.meta.url,
    ), "utf8");

    expect(source).toContain("singleBrowserUseOperation");
    expect(source).toContain("singleBrowserUseOperation ? []");
  });

  test("is idempotent when the same persisted history is replayed", () => {
    const once = mergeBrowserUseTimeline(baseMessages, [run]);
    const twice = mergeBrowserUseTimeline(once, [run]);

    expect(twice.map((message) => message.id)).toEqual(once.map((message) => message.id));
  });

  test("always produces a readable terminal reply for empty and interrupted results", () => {
    const emptyDoneRun: BrowserUseAgentRunResult = {
      ...run,
      runId: "run-empty",
      events: [{
        id: "event-empty-done",
        runId: "run-empty",
        sequence: 1,
        timestamp: 100,
        type: "done",
        result: null,
      }],
    };
    const interruptedRun: BrowserUseAgentRunResult = {
      ...run,
      runId: "run-interrupted",
      status: "interrupted",
      events: [{
        id: "event-interrupted",
        runId: "run-interrupted",
        sequence: 1,
        timestamp: 100,
        type: "error",
        error: "",
        errorCode: "interrupted",
      }],
    };

    const emptyDoneMessages = mergeBrowserUseTimeline(baseMessages, [emptyDoneRun]);
    const interruptedMessages = mergeBrowserUseTimeline(baseMessages, [interruptedRun]);
    expect(emptyDoneMessages).toHaveLength(2);
    expect(interruptedMessages).toHaveLength(2);
    expect(emptyDoneMessages.at(-1)).toMatchObject({
      role: "assistant",
      parts: [{ type: "text" }],
    });
    expect(interruptedMessages.at(-1)).toMatchObject({
      role: "assistant",
      parts: [{ type: "text" }],
    });
    const emptyDonePart = emptyDoneMessages.at(-1)?.parts[0];
    const interruptedPart = interruptedMessages.at(-1)?.parts[0];
    expect(emptyDonePart?.type === "text" ? emptyDonePart.text.length : 0).toBeGreaterThan(0);
    expect(interruptedPart?.type === "text" ? interruptedPart.text.length : 0).toBeGreaterThan(0);
  });

  test("closes an unfinished operation card when its run is cancelled", () => {
    const cancelledRun: BrowserUseAgentRunResult = {
      ...run,
      runId: "run-cancelled",
      status: "cancelled",
      events: [
        {
          id: "event-cancelled-operation",
          runId: "run-cancelled",
          sequence: 1,
          timestamp: 100,
          type: "operation_started",
          operationId: "operation-cancelled",
          step: 1,
          actions: [{ name: "wait", params: { seconds: 10 } }],
          actionCount: 1,
          url: "https://example.com",
          title: "Example Domain",
        },
        {
          id: "event-cancelled",
          runId: "run-cancelled",
          sequence: 2,
          timestamp: 200,
          type: "cancelled",
        },
      ],
    };

    const messages = mergeBrowserUseTimeline(baseMessages, [cancelledRun]);
    expect(messages[1]?.parts[0]).toMatchObject({
      type: "dynamic-tool",
      state: "output-error",
      toolCallId: "operation-cancelled",
    });
    expect(messages[2]).toMatchObject({ role: "assistant" });
  });
});
