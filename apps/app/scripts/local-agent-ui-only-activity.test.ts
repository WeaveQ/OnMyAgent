import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { setLocale } from "../src/i18n";
import type {
  PersonalLocalAgentApprovalRequest,
  PersonalLocalAgentRunResult,
} from "../src/app/lib/desktop";
import { ChatBubble } from "../src/react-app/domains/local-agents/messages/chat-bubble";

function run(overrides: Partial<PersonalLocalAgentRunResult> = {}): PersonalLocalAgentRunResult {
  return {
    ok: false,
    runId: "activity-run",
    agentId: "codex",
    status: "running",
    startedAt: 1,
    finishedAt: null,
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

function assistant(runResult: PersonalLocalAgentRunResult, text = "") {
  return {
    id: "assistant-activity",
    role: "assistant" as const,
    text,
    createdAt: 1,
    run: runResult,
  };
}

describe("Local Agent UI-only activity presentation", () => {
  test("shows a live status row when no body or timeline exists", () => {
    setLocale("en");
    const html = renderToStaticMarkup(createElement(ChatBubble, {
      message: assistant(run()),
      workspaceRoot: "/tmp",
    }));

    expect(html).toContain('data-local-agent-activity="running"');
    expect(html).toContain('data-testid="local-agent-activity-row"');
    expect(html).toContain("local agent is running");
  });

  test("uses the existing finish snapshot as the final body without runtime writes", () => {
    setLocale("en");
    const html = renderToStaticMarkup(createElement(ChatBubble, {
      message: assistant(run({
        ok: true,
        status: "completed",
        finishedAt: 2,
        conversationMessages: [{
          id: "finish-1",
          type: "finish",
          role: "assistant",
          text: "Final answer from the run",
          createdAt: 2,
        }],
      })),
      workspaceRoot: "/tmp",
    }));

    expect(html).toContain("Final answer from the run");
    expect(html).toContain('data-local-agent-activity="completed"');
    expect(html).not.toContain('data-testid="local-agent-activity-row"');
  });

  test("keeps terminal facts visible when the snapshot has no body text", () => {
    setLocale("en");
    const failedHtml = renderToStaticMarkup(createElement(ChatBubble, {
      message: assistant(run({ status: "failed", error: "provider failed" })),
      workspaceRoot: "/tmp",
    }));
    const cancelledHtml = renderToStaticMarkup(createElement(ChatBubble, {
      message: assistant(run({ status: "cancelled" })),
      workspaceRoot: "/tmp",
    }));

    expect(failedHtml).toContain('data-local-agent-activity="failed"');
    expect(failedHtml).toContain('data-testid="local-agent-activity-row"');
    expect(cancelledHtml).toContain('data-local-agent-activity="cancelled"');
    expect(cancelledHtml).toContain('data-testid="local-agent-activity-row"');
  });

  test("keeps the final answer after the collapsed thought-duration row", () => {
    setLocale("en");
    const html = renderToStaticMarkup(createElement(ChatBubble, {
      message: assistant(run({
        ok: true,
        status: "completed",
        startedAt: 1_000,
        finishedAt: 13_000,
        conversationMessages: [
          {
            id: "tool-1",
            type: "tool",
            role: "tool",
            text: "Read README.md",
            createdAt: 2,
            toolCall: { id: "tool-1", name: "read", status: "completed", input: "README.md" },
          },
          {
            id: "finish-1",
            type: "finish",
            role: "assistant",
            text: "Final answer after the tool",
            createdAt: 3,
          },
        ],
      })),
      workspaceRoot: "/tmp",
    }));

    const statusIndex = html.indexOf('data-testid="local-agent-turn-status"');
    const finalIndex = html.indexOf("Final answer after the tool");
    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(html).toContain("Thought for 12s");
    expect(html).not.toContain("Completed 12s");
    expect(finalIndex).toBeGreaterThan(statusIndex);
    expect(html).not.toContain('data-testid="local-agent-timeline-body"');
  });

  test("keeps waiting approval visible as an activity state plus the existing card", () => {
    setLocale("en");
    const approval: PersonalLocalAgentApprovalRequest = {
      id: "approval-activity",
      runId: "activity-run",
      provider: "codex",
      method: "session/request_permission",
      kind: "command",
      title: "Run command",
      summary: "Needs approval",
      command: "pnpm test",
      createdAt: 2,
    };
    const html = renderToStaticMarkup(createElement(ChatBubble, {
      message: assistant(run({ pendingApprovals: [approval] })),
      workspaceRoot: "/tmp",
      onResolveApproval: () => undefined,
    }));

    expect(html).toContain('data-local-agent-activity="waiting-approval"');
    expect(html).not.toContain('data-testid="local-agent-activity-row"');
    expect(html).toContain('data-testid="local-agent-approval-card"');
    expect(html).toContain("Approval required to continue");
  });

  test("removes only the host-added waiting suffix from an existing assistant body", () => {
    setLocale("en");
    const approval: PersonalLocalAgentApprovalRequest = {
      id: "approval-suffix",
      runId: "activity-run",
      provider: "codex",
      method: "session/request_permission",
      kind: "command",
      title: "Run command",
      summary: "Needs approval",
      command: "pnpm test",
      createdAt: 2,
    };
    const html = renderToStaticMarkup(createElement(ChatBubble, {
      message: assistant(
        run({ pendingApprovals: [approval] }),
        "Partial answer\n\nThe local agent is waiting for your approval before continuing.",
      ),
      workspaceRoot: "/tmp",
      onResolveApproval: () => undefined,
    }));

    expect(html).toContain("Partial answer");
    expect(html).not.toContain("The local agent is waiting for your approval before continuing.");
  });
});
