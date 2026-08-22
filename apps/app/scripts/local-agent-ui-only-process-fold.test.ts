import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { setLocale } from "../src/i18n";
import {
  LocalAgentTimelineMessage,
} from "../src/react-app/domains/local-agents/messages/timeline-messages";
import { LocalAgentPlanFold } from "../src/react-app/domains/local-agents/messages/local-agent-plan-fold";
import type { ConversationItemVM } from "../src/react-app/capabilities/conversation";
import type { PersonalLocalAgentConversationMessage } from "../src/app/lib/desktop";

const repoRoot = join(import.meta.dir, "../../..");

function toolMessage(
  id: string,
  title: string,
  status: "running" | "completed" | "failed" = "completed",
): PersonalLocalAgentConversationMessage {
  return {
    id,
    type: "acp_tool_call",
    role: "tool",
    text: title,
    createdAt: 1,
    update: {
      toolCallId: id,
      title,
      kind: "execute",
      status,
      rawInput: { command: title },
      rawOutput: status === "completed" ? "ok" : undefined,
    },
  };
}

function renderTools(
  messages: PersonalLocalAgentConversationMessage[],
  runStatus: "running" | "completed" | "failed" = "completed",
) {
  return renderToStaticMarkup(createElement(
    "div",
    null,
    ...messages.map((message, index) => createElement(LocalAgentTimelineMessage, {
      key: `${message.id}:${index}`,
      message,
      streaming: runStatus === "running",
      runStatus,
    })),
  ));
}

describe("Local Agent UI-only process fold", () => {
  test("does not pack tools into a process fold", () => {
    setLocale("en");
    const html = renderTools([
      toolMessage("tool-1", "pnpm test"),
      toolMessage("tool-2", "git status"),
    ]);

    expect(html).not.toContain('data-testid="local-agent-process-fold"');
    expect(html).not.toContain('data-testid="local-agent-tool-group"');
    expect(html).toContain("pnpm test");
    expect(html).toContain("git status");
  });

  test("keeps a running tool running without an English status enum badge", () => {
    setLocale("en");
    const html = renderTools(
      [toolMessage("tool-1", "Read README.md", "running")],
      "running",
    );

    expect(html).not.toContain('data-testid="local-agent-process-fold"');
    expect(html).toContain("Read README.md");
    expect(html).toContain("Running");
    expect(html).not.toContain(">running<");
    expect(html).not.toContain(">completed<");
    expect(html).not.toContain(">failed<");
    expect(html).not.toContain(">pending<");
  });

  test("preserves a failed tool identifier without packing it", () => {
    setLocale("en");
    const html = renderTools([{
        ...toolMessage("tool-7", "", "failed"),
        text: "",
        update: { toolCallId: "failed-tool-7", status: "failed" },
      }], "failed");

    expect(html).not.toContain('data-testid="local-agent-process-fold"');
    expect(html).toContain("failed-tool-7");
  });

  test("collapses terminal plans while keeping streaming plans open", () => {
    setLocale("en");
    const item: ConversationItemVM = {
      id: "plan-1",
      kind: "plan",
      role: "assistant",
      text: "Inspect workspace\nSummarize findings",
      createdAt: 1,
      meta: {
        entries: [
          { id: "step-1", title: "Inspect workspace", status: "completed" },
          { id: "step-2", title: "Summarize findings", status: "pending" },
        ],
      },
    };

    const terminalHtml = renderToStaticMarkup(createElement(LocalAgentPlanFold, { item }));
    expect(terminalHtml).toContain('data-plan-status="completed"');
    expect(terminalHtml).toContain('aria-expanded="false"');
    expect(terminalHtml).not.toContain('data-testid="local-agent-plan-fold-body"');
    expect(terminalHtml).toContain("focus-visible:ring-dls-focus");

    const streamingHtml = renderToStaticMarkup(createElement(LocalAgentPlanFold, {
      item,
      streaming: true,
    }));
    expect(streamingHtml).toContain('data-plan-status="running"');
    expect(streamingHtml).toContain('aria-expanded="true"');
    expect(streamingHtml).toContain('data-testid="local-agent-plan-fold-body"');
  });

  test("process-fold source is gone from the production tree", () => {
    const timeline = readFileSync(
      join(repoRoot, "apps/app/src/react-app/domains/local-agents/messages/timeline-messages.tsx"),
      "utf8",
    );
    expect(timeline).not.toContain("LocalAgentProcessFold");
    expect(timeline).not.toContain("local-agent-process-fold");
    expect(timeline).not.toContain("LocalAgentToolGroupSummary");
    expect(timeline).not.toContain("groupLocalAgentTimeline");
  });
});
