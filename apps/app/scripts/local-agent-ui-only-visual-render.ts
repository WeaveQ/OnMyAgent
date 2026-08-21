import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { setLocale } from "../src/i18n";
import type { PersonalLocalAgentRunResult } from "../src/app/lib/desktop";
import { ChatBubble } from "../src/react-app/domains/local-agents/messages/chat-bubble";

const run: PersonalLocalAgentRunResult = {
  ok: true,
  runId: "ui-only-visual-run",
  agentId: "codex",
  status: "completed",
  startedAt: 1_000,
  finishedAt: 13_000,
  pid: 1,
  command: "codex acp",
  output: "",
  error: null,
  events: [],
  conversationMessages: [
    {
      id: "thinking-1",
      type: "thinking",
      role: "assistant",
      text: "先检查工作区，再汇总结果。",
      createdAt: 2,
      status: "done",
    },
    {
      id: "plan-1",
      type: "plan",
      role: "assistant",
      text: "检查工作区\n汇总结果",
      createdAt: 2,
      entries: [
        { id: "step-1", title: "检查工作区", status: "completed" },
        { id: "step-2", title: "汇总结果", status: "completed" },
      ],
    },
    {
      id: "tool-1",
      type: "tool",
      role: "tool",
      text: "读取 package.json",
      createdAt: 3,
      toolCall: {
        id: "tool-1",
        name: "read",
        status: "completed",
        input: { file_path: "package.json" },
        output: "{\"name\": \"onmyagent\"}",
      },
    },
    {
      id: "tool-2",
      type: "tool",
      role: "tool",
      text: "执行 pnpm check",
      createdAt: 4,
      toolCall: {
        id: "tool-2",
        name: "execute",
        status: "completed",
        input: { command: "pnpm check" },
        output: "checks passed",
      },
    },
    {
      id: "finish-1",
      type: "finish",
      role: "assistant",
      text: "最终答案：检查完成，所有结果均可展示。",
      createdAt: 5,
    },
  ],
  logPath: null,
};

setLocale("zh");
process.stdout.write(renderToStaticMarkup(
  createElement(
    "div",
    { "data-testid": "local-agent-ui-only-visual-fixture" },
    createElement(ChatBubble, {
      message: {
        id: "ui-only-visual-assistant",
        role: "assistant",
        text: "最终答案：检查完成，所有结果均可展示。",
        createdAt: 5,
        run,
      },
      workspaceRoot: "/tmp/onmyagent-ui-only-visual",
    }),
  ),
));
