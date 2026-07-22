import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import {
  clampVirtualEstimate,
  estimateBlockSize,
  estimateRenderItemSize,
  estimateTextBlockSize,
} from "../src/react-app/domains/session/surface/message-list/estimate-size";
import type {
  MessageBlock,
  MessageBlockItem,
} from "../src/react-app/domains/session/surface/message-list/types";

function emptyMessageBlock(
  isUser: boolean,
  groups: MessageBlock["groups"] = [],
): MessageBlock {
  const source = {
    id: isUser ? "u1" : "a1",
    role: isUser ? "user" : "assistant",
    parts: [],
  } as UIMessage;
  return {
    kind: "message",
    message: source,
    renderableParts: [],
    attachments: [],
    groups,
    isUser,
    messageId: source.id,
  };
}

describe("estimate-size helpers (shipped)", () => {
  test("clampVirtualEstimate rounds and clamps", () => {
    expect(clampVirtualEstimate(10.4, 20, 100)).toBe(20);
    expect(clampVirtualEstimate(150.6, 20, 100)).toBe(100);
    expect(clampVirtualEstimate(55.4, 20, 100)).toBe(55);
  });

  test("estimateTextBlockSize grows with content but stays finite", () => {
    const short = estimateTextBlockSize("hi", false);
    const long = estimateTextBlockSize("word ".repeat(400), false);
    expect(long).toBeGreaterThan(short);
    expect(Number.isFinite(long)).toBe(true);
  });

  test("estimateBlockSize caps assistant height to avoid multi-viewport blanks", () => {
    // Many step groups would over-reserve if uncapped.
    const heavyGroups = Array.from({ length: 40 }, (_, i) => ({
      kind: "steps" as const,
      parts: Array.from({ length: 8 }, (__, j) => ({
        type: "tool",
        id: `t-${i}-${j}`,
      })),
    }));
    const block = emptyMessageBlock(false, heavyGroups as MessageBlock["groups"]);
    const size = estimateBlockSize(block);
    expect(size).toBeLessThanOrEqual(720);
    expect(size).toBeGreaterThanOrEqual(200);
  });

  test("divider and folded step cluster stay compact", () => {
    const divider: MessageBlockItem = {
      kind: "divider",
      id: "d1",
      label: "Stopped",
      afterMessageCount: 1,
      isUser: false,
    };
    expect(estimateBlockSize(divider)).toBe(56);

    const cluster: MessageBlockItem = {
      kind: "steps-cluster",
      id: "c1",
      isUser: false,
      messageIds: ["m1"],
      stepGroups: [
        {
          id: "g1",
          mode: "tool",
          parts: Array.from({ length: 20 }, (_, i) => ({
            type: "tool",
            id: `p${i}`,
          })) as MessageBlockItem extends { stepGroups: Array<{ parts: infer P }> }
            ? P
            : never,
        },
      ],
    };
    const size = estimateBlockSize(cluster);
    expect(size).toBeLessThanOrEqual(320);
    expect(size).toBeGreaterThanOrEqual(72);
  });

  test("estimateRenderItemSize sums turn blocks", () => {
    const user = emptyMessageBlock(true, [
      {
        kind: "text",
        part: { type: "text", text: "hello world" },
      } as MessageBlock["groups"][number],
    ]);
    const item = {
      kind: "turn" as const,
      id: "turn:1",
      turnId: "t1",
      blocks: [user],
    };
    const size = estimateRenderItemSize(item);
    expect(size).toBeGreaterThanOrEqual(112);
    expect(size).toBeLessThanOrEqual(720);
  });
});
