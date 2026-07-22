import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import {
  blockIdentityKey,
  blocksAreEquivalent,
  stabilizeMessageBlocks,
} from "../src/react-app/domains/session/surface/message-list/block-model";
import type {
  DividerBlock,
  MessageBlock,
  MessageBlockItem,
  StepClusterBlock,
} from "../src/react-app/domains/session/surface/message-list/types";

function uiMessage(id: string, text = "hello"): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
  } as UIMessage;
}

function messageBlock(
  id: string,
  source: UIMessage,
  overrides?: Partial<MessageBlock>,
): MessageBlock {
  return {
    kind: "message",
    message: source,
    renderableParts: [],
    attachments: [],
    groups: [],
    isUser: false,
    messageId: id,
    ...overrides,
  };
}

function dividerBlock(id: string, label = "Stopped"): DividerBlock {
  return {
    kind: "divider",
    id,
    label,
    variant: "stopped",
    afterMessageCount: 1,
    isUser: false,
  };
}

function stepCluster(
  id: string,
  messageIds: string[],
  parts: unknown[] = [],
): StepClusterBlock {
  return {
    kind: "steps-cluster",
    id,
    messageIds,
    isUser: false,
    stepGroups: [
      {
        id: `${id}:g0`,
        mode: "tool",
        parts: parts as StepClusterBlock["stepGroups"][number]["parts"],
      },
    ],
  };
}

describe("blockIdentityKey (shipped)", () => {
  test("prefixes by kind for stable map keys", () => {
    const source = uiMessage("m1");
    expect(blockIdentityKey(messageBlock("m1", source))).toBe("msg:m1");
    expect(blockIdentityKey(dividerBlock("d1"))).toBe("divider:d1");
    expect(blockIdentityKey(stepCluster("c1", ["m2"]))).toBe("cluster:c1");
  });
});

describe("blocksAreEquivalent (shipped)", () => {
  test("message blocks equal only when source pointer and structure match", () => {
    const source = uiMessage("m1", "a");
    const a = messageBlock("m1", source);
    const b = messageBlock("m1", source);
    expect(blocksAreEquivalent(a, b)).toBe(true);

    const freshSource = uiMessage("m1", "a");
    const c = messageBlock("m1", freshSource);
    // Different UIMessage reference → not equivalent (streaming tick).
    expect(blocksAreEquivalent(a, c)).toBe(false);
  });

  test("divider and cluster compare structural fields", () => {
    expect(blocksAreEquivalent(dividerBlock("d1"), dividerBlock("d1"))).toBe(
      true,
    );
    expect(
      blocksAreEquivalent(dividerBlock("d1", "A"), dividerBlock("d1", "B")),
    ).toBe(false);

    const part = { type: "tool", id: "t1" };
    const clusterA = stepCluster("c1", ["m1"], [part]);
    const clusterB = stepCluster("c1", ["m1"], [part]);
    expect(blocksAreEquivalent(clusterA, clusterB)).toBe(true);
    const clusterC = stepCluster("c1", ["m1"], [{ type: "tool", id: "t2" }]);
    expect(blocksAreEquivalent(clusterA, clusterC)).toBe(false);
  });
});

describe("stabilizeMessageBlocks (shipped structural sharing)", () => {
  test("reuses previous object identity for unchanged blocks", () => {
    const sourceA = uiMessage("a", "old");
    const sourceB = uiMessage("b", "keep");
    const prevA = messageBlock("a", sourceA);
    const prevB = messageBlock("b", sourceB);
    const previous = new Map<string, MessageBlockItem>([
      [blockIdentityKey(prevA), prevA],
      [blockIdentityKey(prevB), prevB],
    ]);

    // Streaming: only message `a` gets a new source reference.
    const nextA = messageBlock("a", uiMessage("a", "new"));
    const nextB = messageBlock("b", sourceB);
    const raw = [nextA, nextB];

    const { blocks, nextByKey } = stabilizeMessageBlocks(previous, raw);
    expect(blocks).toHaveLength(2);
    // Active stream block is new object.
    expect(blocks[0]).toBe(nextA);
    expect(blocks[0]).not.toBe(prevA);
    // Idle block keeps previous pointer for React.memo bailout.
    expect(blocks[1]).toBe(prevB);
    expect(nextByKey.get("msg:b")).toBe(prevB);
  });

  test("drops keys that left the transcript", () => {
    const source = uiMessage("only", "x");
    const prev = messageBlock("only", source);
    const gone = messageBlock("gone", uiMessage("gone"));
    const previous = new Map<string, MessageBlockItem>([
      [blockIdentityKey(prev), prev],
      [blockIdentityKey(gone), gone],
    ]);
    const { blocks, nextByKey } = stabilizeMessageBlocks(previous, [
      messageBlock("only", source),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBe(prev);
    expect(nextByKey.has("msg:gone")).toBe(false);
    expect(nextByKey.has("msg:only")).toBe(true);
  });
});
