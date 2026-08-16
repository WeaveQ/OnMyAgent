import { describe, expect, test } from "bun:test";

import {
  collectSessionDescendantIds,
  collectSessionSubtreeIds,
  excludeSessionsWithArchivedAncestor,
} from "../src/react-app/domains/shared/session-parent-tree";

describe("collectSessionDescendantIds", () => {
  test("returns nested children and skips the root", () => {
    const sessions = [
      { id: "parent" },
      { id: "child_a", parentID: "parent" },
      { id: "child_b", parentID: "parent" },
      { id: "grand", parentID: "child_a" },
      { id: "other" },
    ];
    expect(collectSessionDescendantIds(sessions, "parent").sort()).toEqual([
      "child_a",
      "child_b",
      "grand",
    ]);
  });

  test("is cycle-safe and ignores blank ids", () => {
    const sessions = [
      { id: "a", parentID: "b" },
      { id: "b", parentID: "a" },
      { id: "  ", parentID: "a" },
    ];
    expect(collectSessionDescendantIds(sessions, "a").sort()).toEqual(["b"]);
    expect(collectSessionDescendantIds(sessions, "   ")).toEqual([]);
  });
});

describe("collectSessionSubtreeIds", () => {
  test("includes the root even when it is not in the session list", () => {
    expect(collectSessionSubtreeIds([], "ses_parent")).toEqual(["ses_parent"]);
  });

  test("puts the root first", () => {
    const sessions = [
      { id: "parent" },
      { id: "child", parentID: "parent" },
    ];
    expect(collectSessionSubtreeIds(sessions, "parent")).toEqual([
      "parent",
      "child",
    ]);
  });
});

describe("excludeSessionsWithArchivedAncestor", () => {
  test("drops children of an archived parent even if the child is still live", () => {
    const sessions = [
      { id: "child_a", parentID: "parent" },
      { id: "child_b", parentID: "parent" },
      { id: "unrelated" },
    ];
    const visible = excludeSessionsWithArchivedAncestor(
      sessions,
      new Set(["parent"]),
    );
    expect(visible.map((session) => session.id)).toEqual(["unrelated"]);
  });

  test("hides nested descendants when a live ancestor is archived farther up", () => {
    const sessions = [
      { id: "child", parentID: "parent" },
      { id: "grand", parentID: "child" },
      { id: "keep" },
    ];
    const visible = excludeSessionsWithArchivedAncestor(
      sessions,
      new Set(["parent"]),
    );
    expect(visible.map((session) => session.id)).toEqual(["keep"]);
  });
});
