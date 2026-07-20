import { describe, expect, test } from "bun:test";
import type { Part } from "@opencode-ai/sdk/v2/client";

import {
  canMergeStepClusters,
  mergeLeadingAssistantStepClusters,
  processFoldChipMeta,
  resolveDisplayedPastedText,
  shouldFoldStepGroups,
  shouldUseSemanticProcessFold,
  summarizeStepCluster,
} from "../src/react-app/domains/session/surface/message-list";
import { groupMessageParts, summarizeStep } from "../src/app/utils";
import { setLocale } from "../src/i18n";

type MergeBlock = Parameters<typeof canMergeStepClusters>[1];
type TimelineBlock = Parameters<typeof mergeLeadingAssistantStepClusters>[0][number];

function toolPart(id: string, tool: string): Part {
  return {
    id,
    type: "tool",
    sessionID: "session",
    messageID: `message-${id}`,
    callID: `call-${id}`,
    tool,
    state: {
      status: "completed",
      input: tool === "bash" ? { command: "git status --short" } : { filePath: `${id}.ts` },
      metadata: {},
      time: { start: 1, end: 2 },
    },
  };
}

function stepBlock(id: string, tool: string): MergeBlock {
  return {
    kind: "steps-cluster",
    id,
    isUser: false,
    messageIds: [`message-${id}`],
    stepGroups: [
      {
        id,
        mode: "exploration",
        parts: [toolPart(id, tool)],
      },
    ],
  };
}

function messageBlock(id: string, role: "assistant" | "user"): TimelineBlock {
  return {
    kind: "message",
    message: {
      id,
      role,
      parts: [{ type: "text", text: "done" }],
    },
    renderableParts: [{ id: `${id}:text`, type: "text", text: "done" }],
    attachments: [],
    groups: [
      {
        kind: "text",
        part: { id: `${id}:text`, type: "text", text: "done" },
        segment: "response",
      },
    ],
    isUser: role === "user",
    messageId: id,
  };
}

describe("session process summary", () => {
  test("uses WorkBuddy tool semantics when reasoning precedes a completed skill", () => {
    setLocale("en");
    const meta = processFoldChipMeta([
      {
        messageId: "message-reasoning",
        partIndex: 0,
        index: 0,
        part: { type: "reasoning", text: "I should load the browser skill." },
      },
      {
        messageId: "message-skill",
        partIndex: 1,
        index: 1,
        part: {
          type: "dynamic-tool",
          toolName: "skill",
          toolCallId: "call-skill",
          input: { name: "browser-automation" },
          output: "loaded",
          state: "output-available",
        },
      },
    ], true);

    expect(meta).toEqual({
      label: "Load skill browser-automation",
      category: "skill",
      variant: "tool-chip",
      running: false,
    });
  });

  test("translates browser navigation into WorkBuddy web semantics", () => {
    setLocale("en");
    const meta = processFoldChipMeta([
      {
        messageId: "message-browser",
        partIndex: 0,
        index: 0,
        part: {
          type: "dynamic-tool",
          toolName: "onmyagent_browser_node_repl",
          toolCallId: "call-browser",
          input: { code: 'await tab.goto("https://example.com/report")' },
          output: "https://example.com",
          state: "output-available",
        },
      },
    ], true);

    expect(meta).toEqual({
      label: "Read web page example.com",
      category: "web",
      variant: "summary",
      running: false,
    });
  });

  test("keeps an opaque browser operation semantic when reasoning precedes it", () => {
    setLocale("en");
    const meta = processFoldChipMeta([
      {
        messageId: "message-reasoning",
        partIndex: 0,
        index: 0,
        part: { type: "reasoning", text: "PRIVATE browser plan" },
      },
      {
        messageId: "message-browser",
        partIndex: 0,
        index: 1,
        part: {
          type: "dynamic-tool",
          toolName: "onmyagent_browser_node_repl",
          toolCallId: "call-browser",
          input: { code: "opaque provider operation" },
          output: "ok",
          state: "output-available",
        },
      },
    ], false);

    expect(meta).toEqual({
      label: "Browser action",
      category: "browser",
      variant: "summary",
      running: false,
    });
  });

  test("distinguishes browser inspection, interaction, snapshot, and waiting operations", () => {
    setLocale("en");
    const cases = [
      {
        code: "return await tab.playwright.evaluate(() => document.body.textContent)",
        label: "Inspect page content",
        category: "read",
      },
      {
        code: "await tab.playwright.locator('a.cover').first().click()",
        label: "Interact with page",
        category: "browser",
      },
      {
        code: "const shot = await tab.screenshot({ format: 'jpeg' })",
        label: "Capture page snapshot",
        category: "image",
      },
      {
        code: "await tab.playwright.waitForTimeout(4000)",
        label: "Wait for page response",
        category: "browser",
      },
      {
        code: "await tab.playwright.evaluate(() => window.scrollBy(0, 700))",
        label: "Browse page",
        category: "browser",
      },
      {
        code: "const browser = await agent.browsers.getDefault(); return browser.tabs.list()",
        label: "Prepare browser",
        category: "browser",
      },
    ] as const;

    for (const [index, item] of cases.entries()) {
      const meta = processFoldChipMeta([
        {
          messageId: `message-browser-${index}`,
          partIndex: 0,
          index: 0,
          part: {
            type: "dynamic-tool",
            toolName: "onmyagent_browser_node_repl",
            toolCallId: `call-browser-${index}`,
            input: { code: item.code },
            output: "ok",
            state: "output-available",
          },
        },
      ], true);

      expect(meta).toEqual({
        label: item.label,
        category: item.category,
        variant: "summary",
        running: false,
      });
    }
  });

  test("uses WorkBuddy command naming without leaking command text", () => {
    setLocale("en");
    const meta = processFoldChipMeta([
      {
        messageId: "message-command",
        partIndex: 0,
        index: 0,
        part: {
          type: "dynamic-tool",
          toolName: "bash",
          toolCallId: "call-command",
          input: { command: "pnpm check:type" },
          output: "ok",
          state: "output-available",
        },
      },
    ], false);

    expect(meta).toEqual({
      label: "Run command",
      category: "terminal",
      variant: "tool-chip",
      running: false,
    });
  });

  test("routes opaque browser, skill, and command singletons through semantic folds", () => {
    expect(shouldUseSemanticProcessFold(toolPart("browser", "onmyagent_browser_node_repl"))).toBe(true);
    expect(shouldUseSemanticProcessFold(toolPart("skill", "skill"))).toBe(true);
    expect(shouldUseSemanticProcessFold(toolPart("command", "bash"))).toBe(true);
    expect(shouldUseSemanticProcessFold(toolPart("read", "read"))).toBe(false);
  });

  test("uses WorkBuddy multi-stage wording and the file topic", () => {
    setLocale("en");
    const meta = processFoldChipMeta([
      {
        messageId: "message-command",
        partIndex: 0,
        index: 0,
        part: {
          type: "dynamic-tool",
          toolName: "bash",
          toolCallId: "call-command",
          input: { command: "pnpm check:type" },
          output: "ok",
          state: "output-available",
        },
      },
      {
        messageId: "message-edit",
        partIndex: 1,
        index: 1,
        part: {
          type: "dynamic-tool",
          toolName: "edit",
          toolCallId: "call-edit",
          input: { filePath: "/workspace/2026-07-19.md" },
          output: "updated",
          state: "output-available",
        },
      },
    ], false);

    expect(meta).toEqual({
      label: "Run checks and edit: 2026-07-19.md",
      category: "terminal",
      variant: "summary",
      running: false,
    });
  });

  test("merges contiguous foldable process clusters across tool categories", () => {
    const readA = stepBlock("read-a", "read");
    const readB = stepBlock("read-b", "read");
    const terminal = stepBlock("terminal-a", "bash");
    const readC = stepBlock("read-c", "read");

    expect(canMergeStepClusters(readA, readB)).toBe(true);
    expect(canMergeStepClusters(readB, terminal)).toBe(true);
    expect(canMergeStepClusters(terminal, readC)).toBe(true);
  });

  test("summarizes merged process clusters by action category", () => {
    const readA = stepBlock("read-a", "read");
    const readB = stepBlock("read-b", "read");
    const terminal = stepBlock("terminal-a", "bash");

    expect(summarizeStepCluster([...readA.stepGroups, ...readB.stepGroups]).category).toBe("read");
    expect(summarizeStepCluster(terminal.stepGroups).category).toBe("terminal");
    expect(summarizeStepCluster([...readA.stepGroups, ...terminal.stepGroups])).toEqual({
      category: "tool",
      label: "Processed 2 actions",
    });
  });

  test("folds every root process cluster so transport details never dominate the transcript", () => {
    const readA = stepBlock("read-a", "read");
    const terminal = stepBlock("terminal-a", "bash");

    expect(shouldFoldStepGroups(readA.stepGroups)).toBe(true);
    expect(shouldFoldStepGroups([...readA.stepGroups, ...terminal.stepGroups])).toBe(true);
  });

  test("uses the concrete action label for a single uncategorized process item", () => {
    expect(summarizeStepCluster(stepBlock("question-a", "question").stepGroups).label).toBe("question");
  });

  test("attaches a leading assistant process cluster to the following assistant message", () => {
    const merged = mergeLeadingAssistantStepClusters([
      stepBlock("read-a", "read"),
      messageBlock("assistant-a", "assistant"),
    ]);

    expect(merged).toHaveLength(1);
    const block = merged[0];
    expect(block?.kind).toBe("message");
    if (block?.kind !== "message") throw new Error("expected assistant message block");
    expect(block.leadingStepGroups?.map((group) => group.id)).toEqual(["read-a"]);
    expect(block.leadingStepMessageIds).toEqual(["message-read-a"]);
  });

  test("does not attach an assistant process cluster to a following user message", () => {
    const merged = mergeLeadingAssistantStepClusters([
      stepBlock("read-a", "read"),
      messageBlock("user-a", "user"),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]?.kind).toBe("steps-cluster");
    expect(merged[1]?.kind).toBe("message");
  });

  test("keeps visible assistant text outside pure process clusters", () => {
    const groups = groupMessageParts(
      [
        { id: "intro", type: "text", text: "我先说明当前状态。" },
        toolPart("write-a", "write"),
        { id: "result", type: "text", text: "文件已经写好。" },
      ],
      "assistant-a",
    );

    expect(groups.map((group) => group.kind)).toEqual(["text", "steps", "text"]);
  });

  test("renders pasted text placeholders as their text content", () => {
    expect(
      resolveDisplayedPastedText(
        "目标：[pasted text 9flg · 77 lines]",
        new Map([["9flg · 77 lines", "创建项目管理工具并完成自测"]]),
      ),
    ).toBe("目标：创建项目管理工具并完成自测");
  });

  test("uses the interface language for tool process titles", () => {
    setLocale("zh");
    const title = summarizeStep(toolPart("write-a", "write")).title;
    setLocale("en");

    expect(title).toBe("已写入 write-a.ts");
  });
});
