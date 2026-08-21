import { describe, expect, test } from "bun:test";

import type { PersonalLocalAgentRunResult } from "../src/app/lib/desktop";
import { buildLocalAgentPresentation } from "../src/react-app/domains/local-agents/messages/local-agent-presentation-model";

function run(overrides: Partial<PersonalLocalAgentRunResult>): PersonalLocalAgentRunResult {
  return {
    ok: false,
    runId: "run-ui-only",
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

describe("Local Agent UI-only presentation model", () => {
  test("keeps ordered segments and stable ids while a tool is running", () => {
    const presentation = buildLocalAgentPresentation(run({
      conversationMessages: [
        { id: "user-1", type: "text", role: "user", text: "检查文件", createdAt: 1 },
        { id: "think-1", type: "thinking", role: "assistant", text: "先定位文件", createdAt: 2, status: "done" },
        {
          id: "tool-1",
          type: "tool",
          role: "tool",
          text: "读取 README.md",
          createdAt: 3,
          toolCall: { id: "tool-1", name: "read", status: "running", input: "README.md" },
        },
        { id: "body-1", type: "text", role: "assistant", text: "我正在检查。", createdAt: 4 },
      ],
    }));

    expect(presentation.segments.map((segment) => [segment.id, segment.kind])).toEqual([
      ["user-1", "user"],
      ["think-1", "thinking"],
      ["tool-1", "tool"],
      ["body-1", "assistant"],
    ]);
    expect(presentation.processSegments.map((segment) => segment.id)).toEqual(["think-1", "tool-1"]);
    expect(presentation.finalText).toBe("我正在检查。");
    expect(presentation.activity).toBe("tool");
    expect(presentation.terminal).toBe(false);
  });

  test("uses finish as the final answer and keeps terminal process visible", () => {
    const presentation = buildLocalAgentPresentation(run({
      ok: true,
      status: "completed",
      finishedAt: 5,
      conversationMessages: [
        { id: "body-1", type: "text", role: "assistant", text: "中间回答", createdAt: 2 },
        {
          id: "tool-1",
          type: "tool",
          role: "tool",
          text: "完成读取",
          createdAt: 3,
          status: "completed",
          toolCall: { id: "tool-1", name: "read", status: "completed", output: "ok" },
        },
        { id: "finish-1", type: "finish", role: "assistant", text: "最终答案", createdAt: 4, truncated: false },
      ],
    }));

    expect(presentation.finalSegment?.id).toBe("finish-1");
    expect(presentation.finalText).toBe("最终答案");
    expect(presentation.processSegments.map((segment) => segment.id)).toEqual(["tool-1"]);
    expect(presentation.activity).toBe("completed");
    expect(presentation.terminal).toBe(true);
  });

  test("approval outranks tool and thinking without inventing body text", () => {
    const presentation = buildLocalAgentPresentation(run({
      pendingApprovals: [{
        id: "approval-1",
        runId: "run-ui-only",
        provider: "codex",
        method: "item/commandExecution",
        kind: "command",
        title: "运行命令",
        summary: "需要确认",
        command: "pnpm test",
        createdAt: 4,
      }],
      conversationMessages: [
        { id: "think-1", type: "thinking", role: "assistant", text: "准备执行", createdAt: 1, status: "thinking" },
        {
          id: "tool-1",
          type: "tool",
          role: "tool",
          text: "执行 pnpm test",
          createdAt: 2,
          toolCall: { id: "tool-1", name: "bash", status: "running", input: "pnpm test" },
        },
      ],
    }));

    expect(presentation.activity).toBe("waiting-approval");
    expect(presentation.waitingForApproval).toBe(true);
    expect(presentation.finalText).toBe("");
    expect(presentation.finalText).not.toContain("等待审批");
  });

  test("maps terminal failure and cancellation without changing their facts", () => {
    expect(buildLocalAgentPresentation(run({ status: "failed", error: "命令失败" })).activity).toBe("failed");
    expect(buildLocalAgentPresentation(run({ status: "cancelled" })).activity).toBe("cancelled");
    expect(buildLocalAgentPresentation(run({ status: "missing" })).activity).toBe("missing");
  });

  test("keeps an unclassified running state generic instead of inventing a model phase", () => {
    const presentation = buildLocalAgentPresentation(run({ status: "running" }));
    expect(presentation.activity).toBe("running");
    expect(presentation.activity).not.toBe("model-requesting");
    expect(presentation.activity).not.toBe("retrying");
    expect(presentation.activity).not.toBe("compacting");
  });

  test("is stable when the same snapshot is rebuilt as a new object", () => {
    const source = run({
      conversationMessages: [
        { id: "tool-1", type: "tool", role: "tool", text: "读取", createdAt: 2, status: "completed" },
        { id: "finish-1", type: "finish", role: "assistant", text: "完成", createdAt: 3 },
      ],
    });
    const first = buildLocalAgentPresentation(source);
    const second = buildLocalAgentPresentation({ ...source, conversationMessages: [...source.conversationMessages!] });
    expect(second).toEqual(first);
  });
});
