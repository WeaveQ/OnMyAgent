import { describe, expect, test } from "bun:test";

import { mergeStableSessionTabOrder } from "../src/react-app/domains/session/sidebar/agent-session-tabs";

describe("mergeStableSessionTabOrder", () => {
  test("freezes first-seen order when the parent re-sorts by recency", () => {
    const initial = mergeStableSessionTabOrder(
      [],
      [{ id: "a" }, { id: "b" }, { id: "c" }],
    );
    expect(initial).toEqual(["a", "b", "c"]);

    // Parent list now puts the selected tab first (updatedAt desc).
    const afterSelect = mergeStableSessionTabOrder(initial, [
      { id: "c" },
      { id: "a" },
      { id: "b" },
    ]);
    expect(afterSelect).toEqual(["a", "b", "c"]);
  });

  test("inserts newly created sessions at the left (newest-first)", () => {
    const current = ["a", "b"];
    const next = mergeStableSessionTabOrder(current, [
      { id: "new" },
      { id: "b" },
      { id: "a" },
    ]);
    // + 新会话 | new | a | b  — new is immediately right of the create button.
    expect(next).toEqual(["new", "a", "b"]);
  });

  test("keeps draft placeholders at the leading edge before new sessions", () => {
    const next = mergeStableSessionTabOrder(["a", "b"], [
      { id: "draft:ws" },
      { id: "new" },
      { id: "a" },
      { id: "b" },
    ]);
    expect(next).toEqual(["draft:ws", "new", "a", "b"]);
  });

  test("drops sessions that no longer exist", () => {
    const next = mergeStableSessionTabOrder(["a", "gone", "b"], [
      { id: "b" },
      { id: "a" },
    ]);
    expect(next).toEqual(["a", "b"]);
  });

  test("initial load preserves parent newest-first order left-to-right", () => {
    const next = mergeStableSessionTabOrder([], [
      { id: "newest" },
      { id: "mid" },
      { id: "oldest" },
    ]);
    expect(next).toEqual(["newest", "mid", "oldest"]);
  });
});
