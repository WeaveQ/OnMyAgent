import { describe, expect, test } from "bun:test";

import {
  buildAssistantListModel,
  dropSlotToIndex,
  reorderList,
  resolveDropSlot,
} from "../src/react-app/domains/session/sidebar/assistant-list-model";
import type { AgentConversationGroup } from "../src/react-app/domains/session/sidebar/conversation-model";

function group(
  id: string,
  updated: number,
  title = id,
): AgentConversationGroup {
  const session = {
    id,
    title,
    time: { created: updated, updated },
  };
  return {
    key: id,
    name: title,
    description: title,
    preview: title,
    agentId: null,
    avatarUrl: null,
    avatarBackground: "#000000",
    sessions: [session],
    latestSession: session,
  };
}

describe("buildAssistantListModel", () => {
  test("splits global pins, space folders, and recent without a separate task list", () => {
    const freeA = group("free_a", 100);
    const freeB = group("free_b", 200);
    const spaceTask = group("space_task", 150);
    const pinnedTask = group("pinned_task", 50);
    const spaceDir = "/Users/work/projects/demo";

    const model = buildAssistantListModel({
      groups: [freeA, freeB, spaceTask, pinnedTask],
      globalPins: [
        { kind: "session", id: "pinned_task" },
        { kind: "folder", id: spaceDir },
      ],
      spaceLocalPinsByDirectory: {
        [spaceDir]: ["space_task"],
      },
      spaceFolderOrder: [spaceDir],
      workspaceBySessionId: new Map([
        [spaceTask.latestSession.id, { directory: spaceDir }],
      ]),
    });

    // Global pins preserved in order.
    expect(model.globalPins).toEqual([
      { kind: "session", id: "pinned_task" },
      { kind: "folder", id: spaceDir },
    ]);
    expect(model.groupsBySessionId.get("pinned_task")?.latestSession.id).toBe(
      "pinned_task",
    );
    expect(model.spaceItemsByDirectory.get(spaceDir)?.map((g) => g.latestSession.id)).toEqual([
      "space_task",
    ]);

    // Pinned folder is excluded from 空间 section.
    expect(model.spaceFolders).toEqual([]);

    // 最近 = unpinned + non-space only, sorted by recency.
    expect(model.recentGroups.map((g) => g.latestSession.id)).toEqual([
      "free_b",
      "free_a",
    ]);
  });

  test("orders space folders and applies local pin order inside each", () => {
    const dirA = "/tmp/a";
    const dirB = "/tmp/b";
    const a1 = group("a1", 10);
    const a2 = group("a2", 20);
    const b1 = group("b1", 30);

    const model = buildAssistantListModel({
      groups: [a1, a2, b1],
      globalPins: [],
      spaceLocalPinsByDirectory: {
        [dirA]: ["a1"],
      },
      spaceFolderOrder: [dirB, dirA],
      workspaceBySessionId: new Map([
        ["a1", { directory: dirA }],
        ["a2", { directory: dirA }],
        ["b1", { directory: dirB }],
      ]),
    });

    expect(model.spaceFolders.map((f) => f.directory)).toEqual([dirB, dirA]);
    // Local pin a1 first even though a2 is newer.
    expect(
      model.spaceFolders
        .find((f) => f.directory === dirA)
        ?.items.map((g) => g.latestSession.id),
    ).toEqual(["a1", "a2"]);
  });
});

describe("reorder helpers", () => {
  test("reorderList moves items and no-ops invalid indices", () => {
    expect(reorderList(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorderList(["a", "b"], 0, 0)).toEqual(["a", "b"]);
    expect(reorderList(["a", "b"], -1, 1)).toEqual(["a", "b"]);
  });

  test("dropSlotToIndex accounts for removal shift", () => {
    expect(dropSlotToIndex(1, 3)).toBe(2);
    expect(dropSlotToIndex(2, 1)).toBe(1);
  });

  test("resolveDropSlot clamps to list bounds", () => {
    // Before midpoint → slot at row index (midpoint is exclusive lower half)
    expect(resolveDropSlot(9, 0, 20, 0, 3)).toBe(0);
    // At/after midpoint → next slot
    expect(resolveDropSlot(10, 0, 20, 0, 3)).toBe(1);
    expect(resolveDropSlot(15, 0, 20, 0, 3)).toBe(1);
    // Clamp high
    expect(resolveDropSlot(100, 80, 20, 2, 3)).toBe(3);
  });
});
