import { describe, expect, test } from "bun:test";

import { groupTranscriptRenderItems } from "../src/react-app/domains/session/surface/transcript/render-items";

type Block = { id: string };

function entry(id: string, messageIds: string[], dividerId: string | null = null) {
  return { key: id, block: { id }, messageIds, dividerId };
}

describe("session transcript render items", () => {
  test("groups user and assistant blocks into virtualized turns", () => {
    const turnIds = new Map([
      ["user-1", "turn-1"],
      ["assistant-1a", "turn-1"],
      ["assistant-1b", "turn-1"],
      ["user-2", "turn-2"],
    ]);
    const items = groupTranscriptRenderItems<Block>(
      [
        entry("user", ["user-1"]),
        entry("steps", ["assistant-1a"]),
        entry("answer", ["assistant-1b"]),
        entry("user-2", ["user-2"]),
      ],
      turnIds,
    );

    expect(items.map((item) => item.kind)).toEqual(["turn", "turn"]);
    expect(items[0]?.kind === "turn" ? items[0].blocks.map((block) => block.id) : []).toEqual([
      "user",
      "steps",
      "answer",
    ]);
  });

  test("preserves dividers and creates stable turn segments around them", () => {
    const turnIds = new Map([
      ["user", "turn"],
      ["assistant", "turn"],
    ]);
    const items = groupTranscriptRenderItems<Block>(
      [
        entry("user", ["user"]),
        entry("notice", [], "notice-1"),
        entry("assistant", ["assistant"]),
      ],
      turnIds,
    );

    expect(items.map((item) => item.id)).toEqual([
      "turn:turn:0",
      "divider:notice-1",
      "turn:turn:1",
    ]);
  });
});
