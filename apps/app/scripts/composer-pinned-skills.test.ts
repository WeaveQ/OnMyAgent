import { describe, expect, test } from "bun:test";
import {
  sortWithPinnedFirst,
  togglePinnedSkillId,
} from "../src/react-app/domains/session/surface/composer/pinned-skills";

describe("composer pinned skills", () => {
  test("toggle pins and unpins by id", () => {
    const pinned = togglePinnedSkillId([], "skill:a");
    expect(pinned.pinned).toBe(true);
    expect(pinned.next).toEqual(["skill:a"]);

    const again = togglePinnedSkillId(pinned.next, "skill:b");
    expect(again.next).toEqual(["skill:b", "skill:a"]);

    const unpinned = togglePinnedSkillId(again.next, "skill:a");
    expect(unpinned.pinned).toBe(false);
    expect(unpinned.next).toEqual(["skill:b"]);
  });

  test("sortWithPinnedFirst keeps pin order then original order", () => {
    const items = [
      { id: "c", name: "c" },
      { id: "a", name: "a" },
      { id: "b", name: "b" },
      { id: "d", name: "d" },
    ];
    const sorted = sortWithPinnedFirst(items, ["b", "a"], (item) => item.id);
    expect(sorted.map((item) => item.id)).toEqual(["b", "a", "c", "d"]);
  });
});
