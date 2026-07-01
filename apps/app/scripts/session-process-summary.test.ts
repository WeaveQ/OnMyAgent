import { describe, expect, test } from "bun:test";
import type { Part } from "@opencode-ai/sdk/v2/client";

import {
  canMergeStepClusters,
  mergeLeadingAssistantStepClusters,
  summarizeStepCluster,
} from "../src/react-app/domains/session/surface/message-list";

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
  test("merges only contiguous process clusters with the same summary category", () => {
    const readA = stepBlock("read-a", "read");
    const readB = stepBlock("read-b", "read");
    const terminal = stepBlock("terminal-a", "bash");
    const readC = stepBlock("read-c", "read");

    expect(canMergeStepClusters(readA, readB)).toBe(true);
    expect(canMergeStepClusters(readB, terminal)).toBe(false);
    expect(canMergeStepClusters(terminal, readC)).toBe(false);
  });

  test("summarizes merged process clusters by action category", () => {
    const readA = stepBlock("read-a", "read");
    const readB = stepBlock("read-b", "read");
    const terminal = stepBlock("terminal-a", "bash");

    expect(summarizeStepCluster([...readA.stepGroups, ...readB.stepGroups]).category).toBe("read");
    expect(summarizeStepCluster(terminal.stepGroups).category).toBe("terminal");
  });

  test("uses a user-facing fallback label for uncategorized process work", () => {
    expect(summarizeStepCluster(stepBlock("question-a", "question").stepGroups).label).toBe("Processed 1 actions");
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
});
