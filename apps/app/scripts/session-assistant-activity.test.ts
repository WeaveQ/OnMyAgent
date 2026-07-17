import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import {
  deriveAssistantActivity,
  deriveAssistantActivityPhase,
  getAssistantActivityPhaseLabel,
} from "../src/react-app/domains/session/surface/chrome/assistant-activity";
import { nextLoadingTipIndex } from "../src/react-app/domains/session/surface/chrome/assistant-status";
import { createTranscriptMessageMetadata } from "../src/react-app/domains/session/sync/message-metadata";
import enLoadingTips from "../src/i18n/locales/en/session-loading-tips";
import zhLoadingTips from "../src/i18n/locales/zh/session-loading-tips";
import zhTWLoadingTips from "../src/i18n/locales/zh-TW/session-loading-tips";

const assistantMessage = (parts: UIMessage["parts"]): UIMessage => ({
  id: "assistant-1",
  role: "assistant",
  parts,
});

describe("root assistant activity phase", () => {
  test("selects loading tips randomly without immediate repetition", () => {
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      expect(nextLoadingTipIndex(null, 4)).toBe(0);
      expect(nextLoadingTipIndex(0, 4)).toBe(1);
      expect(nextLoadingTipIndex(3, 4)).toBe(0);
      expect(nextLoadingTipIndex(null, 0)).toBeNull();
    } finally {
      Math.random = originalRandom;
    }
  });

  test("ports the complete localized WorkBuddy loading-tip pools", () => {
    expect(enLoadingTips).toHaveLength(184);
    expect(zhLoadingTips).toHaveLength(275);
    expect(zhTWLoadingTips).toHaveLength(275);
    expect(zhLoadingTips).toContain("论据和论点正在确认眼神");
    expect(zhLoadingTips).toContain("CPU 已起飞，风扇在劝它冷静");
    expect(zhLoadingTips.some((tip) => tip.includes("WorkBuddy"))).toBe(false);
    expect(enLoadingTips.some((tip) => tip.includes("WorkBuddy"))).toBe(false);
    expect(enLoadingTips.some((tip) => /QQ Mail|Tencent|WeChat|WeCom/.test(tip))).toBe(false);
    expect(zhLoadingTips.some((tip) => /腾讯|微信|企业微信/.test(tip))).toBe(false);
    expect(zhTWLoadingTips).toContain("論據和論點正在確認眼神");
  });

  test("keeps WorkBuddy tips available across phase label changes", async () => {
    const source = await Bun.file(new URL(
      "../src/react-app/domains/session/surface/chrome/assistant-status.tsx",
      import.meta.url,
    )).text();

    expect(source).toContain("const LOADING_TIP_DELAY_MS = 4_000");
    expect(source).toContain("const LOADING_TIP_ROTATION_MS = 10_000");
    expect(source).toContain("const locale = currentLocale()");
    expect(source).not.toContain("LOADING_TIPS_DISMISSED_KEY");
    expect(source).not.toContain("tipsDismissed");
    expect(source).not.toContain("loading_tip_dismiss");
  });

  test("maps model lifecycle without inventing terminal state", () => {
    expect(deriveAssistantActivityPhase({
      status: "thinking",
      sending: true,
      hasActivePermission: false,
      hasActiveQuestion: false,
      messages: [],
    })).toBe("preparing");
    expect(deriveAssistantActivityPhase({
      status: "thinking",
      sending: false,
      hasActivePermission: false,
      hasActiveQuestion: false,
      messages: [],
    })).toBe("model-requesting");
    expect(deriveAssistantActivityPhase({
      status: "responding",
      sending: false,
      hasActivePermission: false,
      hasActiveQuestion: false,
      messages: [assistantMessage([{ type: "text", text: "Hello" }])],
    })).toBe("model-streaming");
    expect(deriveAssistantActivityPhase({
      status: "retrying",
      sending: false,
      hasActivePermission: false,
      hasActiveQuestion: false,
      messages: [],
    })).toBe("retrying");
  });

  test("maps active tool preparation and execution from actual part state", () => {
    expect(deriveAssistantActivityPhase({
      status: "responding",
      sending: false,
      hasActivePermission: false,
      hasActiveQuestion: false,
      messages: [assistantMessage([{
        type: "dynamic-tool",
        toolName: "read",
        toolCallId: "tool-1",
        state: "input-streaming",
        input: {},
      }])],
    })).toBe("tool-preparing");
    expect(deriveAssistantActivityPhase({
      status: "responding",
      sending: false,
      hasActivePermission: false,
      hasActiveQuestion: false,
      messages: [assistantMessage([{
        type: "dynamic-tool",
        toolName: "read",
        toolCallId: "tool-1",
        state: "input-available",
        input: {},
      }])],
    })).toBe("tool-executing");
  });

  test("prioritizes compacting and explicit waits over model/tool phases", () => {
    const base = {
      sending: false,
      messages: [],
    };
    expect(deriveAssistantActivityPhase({
      ...base,
      status: "compacting",
      hasActivePermission: true,
      hasActiveQuestion: true,
    })).toBe("compacting");
    expect(deriveAssistantActivityPhase({
      ...base,
      status: "waiting",
      hasActivePermission: true,
      hasActiveQuestion: false,
      messages: [assistantMessage([{
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "tool-permission",
        state: "approval-requested",
        input: { command: "rm output.txt" },
        approval: { id: "approval-1" },
      }])],
    })).toBe("waiting-permission");
    expect(deriveAssistantActivityPhase({
      ...base,
      status: "waiting",
      hasActivePermission: false,
      hasActiveQuestion: true,
    })).toBe("waiting-user");
  });

  test("specializes permission and user waits from the backing tool", () => {
    const permission = deriveAssistantActivity({
      status: "waiting",
      sending: false,
      hasActivePermission: true,
      hasActiveQuestion: false,
      messages: [assistantMessage([{
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "tool-permission",
        state: "approval-requested",
        input: { command: "rm output.txt" },
        approval: { id: "approval-1" },
      }])],
    });
    const question = deriveAssistantActivity({
      status: "waiting",
      sending: false,
      hasActivePermission: false,
      hasActiveQuestion: true,
      messages: [assistantMessage([{
        type: "dynamic-tool",
        toolName: "question",
        toolCallId: "tool-question",
        state: "input-available",
        input: {},
      }])],
    });

    expect(permission).toEqual({ phase: "waiting-permission", toolIntent: "command" });
    expect(getAssistantActivityPhaseLabel(permission)).not.toBe(
      getAssistantActivityPhaseLabel("waiting-permission"),
    );
    expect(question).toEqual({ phase: "waiting-user", toolIntent: "question" });
  });

  test("does not mislabel an unclassified runtime wait as user input", () => {
    expect(deriveAssistantActivityPhase({
      status: "waiting",
      sending: false,
      hasActivePermission: false,
      hasActiveQuestion: false,
      messages: [],
    })).toBe("model-requesting");

    expect(deriveAssistantActivityPhase({
      status: "waiting",
      sending: false,
      hasActivePermission: false,
      hasActiveQuestion: false,
      messages: [assistantMessage([{
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "tool-waiting",
        state: "input-available",
        input: { command: "pnpm test" },
      }])],
    })).toBe("tool-executing");
  });

  test.each([
    ["read", "read"],
    ["apply_patch", "edit"],
    ["bash", "command"],
    ["grep", "search"],
    ["webfetch", "web"],
    ["task", "task"],
    ["skill", "skill"],
    ["render_visual", "visual"],
    ["TodoWrite", "todo"],
    ["SaveMemory", "memory"],
    ["LSP", "analysis"],
    ["ComputerUse", "computer"],
    ["SendMessage", "message"],
    ["EnterWorktree", "workspace"],
    ["CronCreate", "schedule"],
    ["connect_cloud_service", "cloud"],
    ["automation_update", "automation"],
    ["deliver_attachments", "delivery"],
    ["open_result_view", "result"],
    ["StructuredOutput", "structured"],
  ])("classifies the reachable %s tool activity", (toolName, intent) => {
    const activity = deriveAssistantActivity({
      status: "responding",
      sending: false,
      hasActivePermission: false,
      hasActiveQuestion: false,
      messages: [assistantMessage([{
        type: "dynamic-tool",
        toolName,
        toolCallId: `tool-${toolName}`,
        state: "input-available",
        input: {},
      }])],
    });

    expect(activity).toMatchObject({
      phase: "tool-executing",
      toolIntent: intent,
    });
    expect(getAssistantActivityPhaseLabel(activity)).not.toBe("");
  });

  test("returns to response generation after a tool reaches a terminal part state", () => {
    expect(deriveAssistantActivity({
      status: "responding",
      sending: false,
      hasActivePermission: false,
      hasActiveQuestion: false,
      messages: [assistantMessage([{
        type: "dynamic-tool",
        toolName: "read",
        toolCallId: "tool-complete",
        state: "output-available",
        input: {},
        output: "done",
      }])],
    })).toEqual({
      phase: "model-streaming",
      toolIntent: null,
    });
  });

  test("uses model-done only when a final assistant text is completed while the run remains active", () => {
    const completedAssistant: UIMessage = {
      id: "assistant-completed",
      role: "assistant",
      metadata: createTranscriptMessageMetadata({
        time: { created: 1_000, completed: 2_000 },
      }),
      parts: [{ type: "text", text: "Final answer" }],
    };

    expect(deriveAssistantActivityPhase({
      status: "responding",
      sending: false,
      hasActivePermission: false,
      hasActiveQuestion: false,
      messages: [completedAssistant],
    })).toBe("model-done");
    expect(deriveAssistantActivityPhase({
      status: "idle",
      sending: false,
      hasActivePermission: false,
      hasActiveQuestion: false,
      messages: [completedAssistant],
    })).toBe("idle");
  });
});
