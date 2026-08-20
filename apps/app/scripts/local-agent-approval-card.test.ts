import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { setLocale } from "../src/i18n";
import { ChatBubble } from "../src/react-app/domains/local-agents/messages/chat-bubble";
import { LocalAgentApprovalCard } from "../src/react-app/domains/local-agents/messages/local-agent-approval-card";
import type { ChatMessage } from "../src/react-app/domains/local-agents/messages/message-types";
import type { PersonalLocalAgentApprovalRequest, PersonalLocalAgentRunResult } from "../src/app/lib/desktop";

const LONG_COMMAND =
  "python3 /Users/huangchunan/Library/ApplicationSupport/OnMyAgent/workspaces/very-long-workspace-name/scripts/deploy.py --config=/Users/huangchunan/Library/ApplicationSupport/OnMyAgent/workspaces/very-long-workspace-name/config/production.generated.json --token=abcdefghijklmnopqrstuvwxyz0123456789";
const LONG_CWD =
  "/Users/huangchunan/Library/ApplicationSupport/OnMyAgent/workspaces/very-long-workspace-name/apps/app/src/react-app/domains/local-agents/messages";

function approval(overrides: Partial<PersonalLocalAgentApprovalRequest> = {}): PersonalLocalAgentApprovalRequest {
  return {
    id: "approval-1",
    runId: "run-1",
    provider: "codex",
    method: "session/request_permission",
    kind: "command",
    title: "Run shell command",
    summary: "Run a long workspace command",
    command: LONG_COMMAND,
    cwd: LONG_CWD,
    readonly: false,
    params: {},
    createdAt: 1,
    ...overrides,
  };
}

function runningRun(overrides: Partial<PersonalLocalAgentRunResult> = {}): PersonalLocalAgentRunResult {
  const pending = approval();
  return {
    ok: false,
    runId: "run-1",
    agentId: "codex",
    status: "running",
    startedAt: 1,
    finishedAt: null,
    pid: 1,
    command: "codex acp",
    output: "",
    error: null,
    events: [
      {
        type: "approval_request",
        text: pending.summary,
        at: 1,
        approval: pending,
      },
    ],
    conversationMessages: [
      {
        id: "permission-1",
        type: "permission",
        role: "system",
        text: pending.summary,
        createdAt: 1,
        sourceEventType: "approval_request",
        approval: pending,
      },
    ],
    logPath: null,
    pendingApprovals: [pending],
    ...overrides,
  };
}

function assistantMessage(run: PersonalLocalAgentRunResult): ChatMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    text: "",
    createdAt: 1,
    run,
  };
}

describe("local agent approval card wrapping", () => {
  test("keeps long commands and paths inside a wrapping card", () => {
    setLocale("zh");
    const html = renderToStaticMarkup(
      createElement(LocalAgentApprovalCard, {
        approval: approval(),
        onResolve: () => undefined,
      }),
    );
    expect(html).toContain("data-testid=\"local-agent-approval-card\"");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("break-all");
    expect(html).toContain("min-w-0");
    expect(html).toContain(LONG_COMMAND);
    expect(html).toContain(LONG_CWD);
    expect(html).toContain("需要你审批后继续");
    expect(html).toContain("允许一次");
    expect(html).toContain("本次会话允许");
    expect(html).toContain("拒绝");
    expect(html).not.toContain("whitespace-pre-wrap break-words");
  });

  test("renders a pending approval once when it also appears in the timeline", () => {
    setLocale("zh");
    const html = renderToStaticMarkup(
      createElement(ChatBubble, {
        message: assistantMessage(runningRun()),
        workspaceRoot: LONG_CWD,
        onResolveApproval: () => undefined,
      }),
    );
    expect(html.split("data-testid=\"local-agent-approval-card\"").length - 1).toBe(1);
    expect(html).toContain(LONG_COMMAND);
    expect(html).toContain("允许一次");
  });

  test("still shows an orphan pending approval when the timeline dropped the permission row", () => {
    setLocale("zh");
    const pending = approval({ id: "orphan-1" });
    const html = renderToStaticMarkup(
      createElement(ChatBubble, {
        message: assistantMessage(
          runningRun({
            conversationMessages: [],
            events: [],
            pendingApprovals: [pending],
          }),
        ),
        workspaceRoot: LONG_CWD,
        onResolveApproval: () => undefined,
      }),
    );
    expect(html.split("data-testid=\"local-agent-approval-card\"").length - 1).toBe(1);
    expect(html).toContain(LONG_COMMAND);
  });
});
