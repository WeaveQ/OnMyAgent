import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PersonalLocalAgentRunResult } from "../src/app/lib/desktop";
import {
  isAssistantBodyConversationMessage,
  messageTextForRun,
} from "../src/react-app/domains/local-agents/host/personal-local-agent-page-helpers";

function run(overrides: Partial<PersonalLocalAgentRunResult>): PersonalLocalAgentRunResult {
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
    events: [],
    conversationMessages: [],
    logPath: null,
    ...overrides,
  };
}

describe("assistant body vs thinking card", () => {
  test("does not treat thinking messages as the bubble body", () => {
    expect(isAssistantBodyConversationMessage({ role: "assistant", type: "thinking" })).toBe(false);
    expect(isAssistantBodyConversationMessage({ role: "assistant", type: "text" })).toBe(true);
    expect(isAssistantBodyConversationMessage({ role: "assistant", type: "finish" })).toBe(true);
  });

  test("keeps thinking text out of the running bubble so it does not race the thinking card", () => {
    const text = messageTextForRun(
      run({
        conversationMessages: [
          {
            id: "think-1",
            type: "thinking",
            role: "assistant",
            text: "先把问题拆开",
            createdAt: 1,
            status: "thinking",
          },
        ],
      }),
      "正在调用…",
    );
    expect(text).toBe("");
    expect(text).not.toContain("先把问题拆开");
  });

  test("uses real assistant text once it arrives after thinking", () => {
    const text = messageTextForRun(
      run({
        conversationMessages: [
          {
            id: "think-1",
            type: "thinking",
            role: "assistant",
            text: "先把问题拆开",
            createdAt: 1,
            status: "done",
          },
          {
            id: "body-1",
            type: "text",
            role: "assistant",
            text: "结论是可以。",
            createdAt: 2,
          },
        ],
      }),
      "正在调用…",
    );
    expect(text).toBe("结论是可以。");
  });

  test("falls through to assistant_chunk events when conversationMessages only has thinking", () => {
    const text = messageTextForRun(
      run({
        conversationMessages: [
          {
            id: "think-1",
            type: "thinking",
            role: "assistant",
            text: "先把问题拆开",
            createdAt: 1,
            status: "thinking",
          },
        ],
        events: [{ type: "assistant_chunk", text: "结论是可以。", at: 2 }],
      }),
      "正在调用…",
    );
    expect(text).toBe("结论是可以。");
  });
});

describe("thinking card collapse", () => {
  test("collapses when reasoning is done even if the turn is still streaming", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/react-app/capabilities/conversation/ui/thinking-block.tsx"),
      "utf8",
    );
    expect(source).toContain("if (done) setExpanded(false)");
    expect(source).not.toContain("if (props.defaultExpanded !== undefined) return");
  });
});
