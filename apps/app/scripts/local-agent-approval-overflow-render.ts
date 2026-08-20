import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { setLocale } from "../src/i18n";
import { ChatBubble } from "../src/react-app/domains/local-agents/messages/chat-bubble";
import type { ChatMessage } from "../src/react-app/domains/local-agents/messages/message-types";
import type {
  PersonalLocalAgentApprovalRequest,
  PersonalLocalAgentRunResult,
} from "../src/app/lib/desktop";

const LONG_COMMAND =
  "python3 /Users/huangchunan/Library/ApplicationSupport/OnMyAgent/workspaces/very-long-workspace-name/scripts/deploy.py --config=/Users/huangchunan/Library/ApplicationSupport/OnMyAgent/workspaces/very-long-workspace-name/config/production.generated.json --token=abcdefghijklmnopqrstuvwxyz0123456789";
const LONG_CWD =
  "/Users/huangchunan/Library/ApplicationSupport/OnMyAgent/workspaces/very-long-workspace-name/apps/app/src/react-app/domains/local-agents/messages";

const approval: PersonalLocalAgentApprovalRequest = {
  id: "approval-overflow",
  runId: "run-overflow",
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
};

const run: PersonalLocalAgentRunResult = {
  ok: false,
  runId: "run-overflow",
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
      text: approval.summary,
      at: 1,
      approval,
    },
  ],
  conversationMessages: [
    {
      id: "permission-overflow",
      type: "permission",
      role: "system",
      text: approval.summary,
      createdAt: 1,
      sourceEventType: "approval_request",
      approval,
    },
  ],
  logPath: null,
  pendingApprovals: [approval],
};

const message: ChatMessage = {
  id: "assistant-overflow",
  role: "assistant",
  text: "",
  createdAt: 1,
  run,
};

const longToken = "A".repeat(220);
const streamRun: PersonalLocalAgentRunResult = {
  ...run,
  runId: "run-stream-overflow",
  pendingApprovals: [],
  events: [
    {
      type: "assistant_chunk",
      text: `请查看 \`${longToken}\` 与 https://${longToken}.example`,
      at: 1,
    },
  ],
  conversationMessages: [],
};

const streamMessage: ChatMessage = {
  id: "assistant-stream-overflow",
  role: "assistant",
  text: `请查看 \`${longToken}\` 与 https://${longToken}.example`,
  createdAt: 1,
  run: streamRun,
};

setLocale("zh");
process.stdout.write(
  renderToStaticMarkup(
    createElement(
      "div",
      { "data-testid": "local-agent-overflow-fixtures" },
      createElement(ChatBubble, {
        message,
        workspaceRoot: LONG_CWD,
        onResolveApproval: () => undefined,
      }),
      createElement(ChatBubble, {
        message: streamMessage,
        workspaceRoot: LONG_CWD,
      }),
    ),
  ),
);
