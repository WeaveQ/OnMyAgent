import { describe, expect, test } from "bun:test";

import {
  resolveVirtualItemKey,
  selectVirtualRenderWindow,
  shouldVirtualizeTranscript,
  TRANSCRIPT_VIRTUALIZATION_THRESHOLD,
} from "../src/react-app/domains/session/surface/message-list/virtual-window";

describe("session transcript virtual window (shipped helpers)", () => {
  test("shouldVirtualizeTranscript trips on render items or blocks threshold", () => {
    expect(
      shouldVirtualizeTranscript(0, 0, TRANSCRIPT_VIRTUALIZATION_THRESHOLD),
    ).toBe(false);
    expect(
      shouldVirtualizeTranscript(
        TRANSCRIPT_VIRTUALIZATION_THRESHOLD - 1,
        TRANSCRIPT_VIRTUALIZATION_THRESHOLD - 1,
      ),
    ).toBe(false);
    expect(
      shouldVirtualizeTranscript(TRANSCRIPT_VIRTUALIZATION_THRESHOLD, 0),
    ).toBe(true);
    expect(
      shouldVirtualizeTranscript(0, TRANSCRIPT_VIRTUALIZATION_THRESHOLD),
    ).toBe(true);
  });

  test("selectVirtualRenderWindow keeps full list when not virtualizing", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const window = selectVirtualRenderWindow(items, false);
    expect(window.virtualItems.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(window.detachedTail).toBeNull();
    expect(window.detachedIndex).toBe(-1);
  });

  test("selectVirtualRenderWindow detaches newest row when virtualizing", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const window = selectVirtualRenderWindow(items, true);
    expect(window.virtualItems.map((item) => item.id)).toEqual(["a", "b"]);
    expect(window.detachedTail).toEqual({ id: "c" });
    expect(window.detachedIndex).toBe(2);
  });

  test("selectVirtualRenderWindow handles empty and single-item lists", () => {
    expect(selectVirtualRenderWindow([], true)).toEqual({
      virtualItems: [],
      detachedTail: null,
      detachedIndex: -1,
    });
    const single = selectVirtualRenderWindow([{ id: "only" }], true);
    expect(single.virtualItems).toEqual([]);
    expect(single.detachedTail).toEqual({ id: "only" });
    expect(single.detachedIndex).toBe(0);
  });

  test("resolveVirtualItemKey uses stable item ids with fallback", () => {
    const items = [{ id: "turn:1" }, { id: "turn:2" }];
    expect(resolveVirtualItemKey(items, 0)).toBe("turn:1");
    expect(resolveVirtualItemKey(items, 1)).toBe("turn:2");
    expect(resolveVirtualItemKey(items, 9)).toBe("item-9");
  });
});
