import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { setLocale } from "../src/i18n";
import type { PersonalLocalAgentRunResult } from "../src/app/lib/desktop";
import { ChatBubble } from "../src/react-app/domains/local-agents/messages/chat-bubble";
import { visibleRunTimelineMessages } from "../src/react-app/domains/local-agents/messages/timeline-messages";
import { buildLocalAgentTurnPresentation } from "../src/react-app/domains/local-agents/messages/local-agent-turn-presentation";

function run(overrides: Partial<PersonalLocalAgentRunResult> = {}): PersonalLocalAgentRunResult {
  return {
    ok: true,
    runId: "turn-layer-run",
    agentId: "codex",
    status: "completed",
    startedAt: 1_000,
    finishedAt: 13_000,
    pid: 1,
    command: "codex acp",
    output: "",
    error: null,
    events: [],
    conversationMessages: [],
    logPath: null,
    ...overrides,
  };
}

describe("Local Agent turn layer UI-only", () => {
  test("keeps thinking and tools interleaved instead of packing tools into one fold", () => {
    const snapshot = run({
      conversationMessages: [
        { id: "think-1", type: "thinking", role: "assistant", text: "先定位文件", createdAt: 2, status: "done" },
        {
          id: "tool-1",
          type: "tool",
          role: "tool",
          text: "读取 README.md",
          createdAt: 3,
          toolCall: { id: "tool-1", name: "read", status: "completed", input: "README.md" },
        },
        { id: "think-2", type: "thinking", role: "assistant", text: "再跑检查", createdAt: 4, status: "done" },
        {
          id: "tool-2",
          type: "tool",
          role: "tool",
          text: "执行 pnpm test",
          createdAt: 5,
          toolCall: { id: "tool-2", name: "bash", status: "completed", input: "pnpm test" },
        },
        { id: "finish-1", type: "finish", role: "assistant", text: "检查完成", createdAt: 6 },
      ],
    });
    const turn = buildLocalAgentTurnPresentation(
      snapshot,
      visibleRunTimelineMessages(snapshot),
      "检查完成",
    );
    expect(turn.processSteps.map((step) => step.message.type)).toEqual([
      "thinking",
      "tool",
      "thinking",
      "tool",
    ]);
    expect(turn.collapseEligible).toBe(true);
    setLocale("en");
    expect(buildLocalAgentTurnPresentation(
      snapshot,
      visibleRunTimelineMessages(snapshot),
      "检查完成",
    ).durationLabel).toBe("12s");
    setLocale("zh");
    expect(buildLocalAgentTurnPresentation(
      snapshot,
      visibleRunTimelineMessages(snapshot),
      "检查完成",
    ).durationLabel).toBe("12 秒");
  });

  test("completed turns hide process by default and keep the final body under the status row", () => {
    setLocale("en");
    const html = renderToStaticMarkup(createElement(ChatBubble, {
      message: {
        id: "assistant-turn",
        role: "assistant",
        text: "Final answer after the tool",
        createdAt: 13_000,
        run: run({
          conversationMessages: [
            { id: "think-1", type: "thinking", role: "assistant", text: "先读文件", createdAt: 2, status: "done" },
            {
              id: "tool-1",
              type: "tool",
              role: "tool",
              text: "Read README.md",
              createdAt: 3,
              toolCall: { id: "tool-1", name: "read", status: "completed", input: "README.md" },
            },
            { id: "finish-1", type: "finish", role: "assistant", text: "Final answer after the tool", createdAt: 13_000 },
          ],
        }),
      },
      workspaceRoot: "/tmp",
    }));
    const statusIndex = html.indexOf('data-testid="local-agent-turn-status"');
    const bodyIndex = html.indexOf("Final answer after the tool");
    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(html).toContain("Completed 12s");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-testid="local-agent-timeline-body"');
    expect(html).not.toContain('data-testid="local-agent-process-fold"');
    expect(bodyIndex).toBeGreaterThan(statusIndex);
  });

  test("running turns keep interleaved process visible without a completed-time fold", () => {
    setLocale("en");
    const html = renderToStaticMarkup(createElement(ChatBubble, {
      message: {
        id: "assistant-running",
        role: "assistant",
        text: "",
        createdAt: 2,
        run: run({
          ok: false,
          status: "running",
          finishedAt: null,
          conversationMessages: [
            { id: "think-1", type: "thinking", role: "assistant", text: "先定位", createdAt: 2, status: "thinking" },
            {
              id: "tool-1",
              type: "tool",
              role: "tool",
              text: "Read README.md",
              createdAt: 3,
              toolCall: { id: "tool-1", name: "read", status: "running", input: "README.md" },
            },
          ],
        }),
      },
      workspaceRoot: "/tmp",
    }));
    expect(html).not.toContain('data-testid="local-agent-turn-status"');
    expect(html).toContain('data-testid="local-agent-timeline-body"');
    const thinkingIndex = html.indexOf("先定位");
    const toolIndex = html.indexOf("Read README.md");
    expect(thinkingIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeGreaterThan(thinkingIndex);
  });

  test("keeps a pending approval visible while the completed process is collapsed", () => {
    setLocale("en");
    const html = renderToStaticMarkup(createElement(ChatBubble, {
      message: {
        id: "assistant-approval",
        role: "assistant",
        text: "Partial answer",
        createdAt: 4,
        run: run({
          status: "running",
          finishedAt: null,
          pendingApprovals: [{
            id: "approval-1",
            runId: "turn-layer-run",
            provider: "codex",
            method: "session/request_permission",
            kind: "command",
            title: "Run command",
            summary: "Needs approval",
            command: "pnpm test",
            createdAt: 4,
          }],
          conversationMessages: [
            {
              id: "tool-1",
              type: "tool",
              role: "tool",
              text: "pnpm test",
              createdAt: 3,
              toolCall: { id: "tool-1", name: "bash", status: "running", input: "pnpm test" },
            },
          ],
        }),
      },
      workspaceRoot: "/tmp",
      onResolveApproval: () => undefined,
    }));
    expect(html).toContain('data-testid="local-agent-approval-card"');
    expect(html).toContain("Partial answer");
  });
});
