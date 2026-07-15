import { describe, expect, test } from "bun:test";

import {
  anchoredTranscriptScrollTop,
  countPrependedTranscriptMessages,
} from "../src/react-app/domains/session/surface/transcript/prepend-anchor";

describe("session transcript prepend anchoring", () => {
  test("recognizes a pure history prepend without confusing replacement or append", () => {
    expect(countPrependedTranscriptMessages(["m3", "m4"], ["m1", "m2", "m3", "m4"])).toBe(2);
    expect(countPrependedTranscriptMessages(["m1", "m2"], ["m1", "m2", "m3"])).toBe(0);
    expect(countPrependedTranscriptMessages(["m3", "m4"], ["m1", "m3", "changed"])).toBe(0);
  });

  test("keeps the same anchor at the same viewport offset", () => {
    expect(anchoredTranscriptScrollTop({
      scrollTop: 120,
      anchorTopBefore: 80,
      anchorTopAfter: 330,
    })).toBe(370);
    expect(anchoredTranscriptScrollTop({
      scrollTop: 20,
      anchorTopBefore: 100,
      anchorTopAfter: 60,
    })).toBe(0);
  });
});
