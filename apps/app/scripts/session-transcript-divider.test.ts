import { describe, expect, test } from "bun:test";

import {
  isTranscriptDividerReady,
  toggleTranscriptFeedback,
} from "../src/react-app/domains/session/surface/message-list";

describe("session transcript dividers", () => {
  test("keeps a historical node visible after the transcript count moves past it", () => {
    const divider = {
      id: "stopped-1",
      label: "You stopped after 1m",
      afterMessageCount: 4,
    };

    expect(isTranscriptDividerReady(divider, 3)).toBe(false);
    expect(isTranscriptDividerReady(divider, 4)).toBe(true);
    expect(isTranscriptDividerReady(divider, 7)).toBe(true);
  });
});

describe("session transcript feedback", () => {
  test("selects, replaces, and cancels feedback without mutating the prior state", () => {
    const empty = {};
    const liked = toggleTranscriptFeedback(empty, "assistant-1", "like");
    const disliked = toggleTranscriptFeedback(liked, "assistant-1", "dislike");
    const cleared = toggleTranscriptFeedback(disliked, "assistant-1", "dislike");

    expect(empty).toEqual({});
    expect(liked).toEqual({ "assistant-1": "like" });
    expect(disliked).toEqual({ "assistant-1": "dislike" });
    expect(cleared).toEqual({});
  });
});
