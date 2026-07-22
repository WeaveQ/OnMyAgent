import { describe, expect, test } from "bun:test";

import {
  buildAssistantListModel,
  buildAssistantSidebarModel,
  buildAutomationLocalPinsMap,
  dropSlotToIndex,
  globalPinKey,
  localPinMapsEqual,
  mergeVisibleReorderIntoFull,
  partitionCategoryGroupsForSidebar,
  reorderList,
  orderedSpaceDirectories,
  reorderSpaceFolderDirectories,
  resolveDropSlot,
  selectVisiblePins,
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

describe("selectVisiblePins", () => {
  test("keeps session/folder/automation pins that resolve; drops the rest", () => {
    const visible = selectVisiblePins({
      globalPins: [
        { kind: "folder", id: "/office" },
        { kind: "folder", id: "/code" },
        { kind: "session", id: "s-office" },
        { kind: "session", id: "s-code" },
        { kind: "automation", id: "auto-office" },
        { kind: "automation", id: "auto-code" },
      ],
      sessionIds: new Set(["s-code"]),
      folderSessionCounts: new Map([
        ["/code", 2],
        ["/office", 0],
      ]),
      automationIds: ["auto-code"],
    });
    expect(visible).toEqual([
      { kind: "folder", id: "/code" },
      { kind: "session", id: "s-code" },
      { kind: "automation", id: "auto-code" },
    ]);
  });

  test("folder pin with only office sessions is absent when groups are code-only", () => {
    const officeDir = "/tmp/office-project";
    const codeDir = "/tmp/code-project";
    // Code category: only code session ids / folder counts.
    const visible = selectVisiblePins({
      globalPins: [
        { kind: "folder", id: officeDir },
        { kind: "folder", id: codeDir },
      ],
      sessionIds: new Set(["code_task"]),
      folderSessionCounts: new Map([[codeDir, 1]]),
      automationIds: [],
    });
    expect(visible.map((p) => p.id)).toEqual([codeDir]);
  });

  test("same folder present when code sessions exist in folderSessionCounts", () => {
    const dir = "/tmp/shared";
    const visible = selectVisiblePins({
      globalPins: [{ kind: "folder", id: dir }],
      sessionIds: new Set(["c1"]),
      folderSessionCounts: new Map([[dir, 1]]),
    });
    expect(visible).toEqual([{ kind: "folder", id: dir }]);
  });
});

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

    expect(model.globalPins).toEqual([
      { kind: "session", id: "pinned_task" },
      { kind: "folder", id: spaceDir },
    ]);
    expect(model.groupsBySessionId.get("pinned_task")?.latestSession.id).toBe(
      "pinned_task",
    );
    expect(
      model.spaceItemsByDirectory.get(spaceDir)?.map((g) => g.latestSession.id),
    ).toEqual(["space_task"]);
    expect(model.spaceFolders).toEqual([]);
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
    expect(
      model.spaceFolders
        .find((f) => f.directory === dirA)
        ?.items.map((g) => g.latestSession.id),
    ).toEqual(["a1", "a2"]);
  });

  test("hides global pins that do not resolve in the current category groups", () => {
    const officeDir = "/tmp/office-project";
    const codeDir = "/tmp/code-project";
    const officeTask = group("office_task", 100);
    const codeTask = group("code_task", 200);
    const freeCode = group("free_code", 50);

    const model = buildAssistantListModel({
      groups: [codeTask, freeCode],
      globalPins: [
        { kind: "folder", id: officeDir },
        { kind: "folder", id: codeDir },
        { kind: "session", id: "office_only_session" },
        { kind: "session", id: "free_code" },
        { kind: "automation", id: "auto-office" },
        { kind: "automation", id: "auto-code" },
      ],
      spaceLocalPinsByDirectory: {},
      spaceFolderOrder: [officeDir, codeDir],
      workspaceBySessionId: new Map([
        [officeTask.latestSession.id, { directory: officeDir }],
        [codeTask.latestSession.id, { directory: codeDir }],
      ]),
      automationIds: ["auto-code"],
    });

    expect(model.globalPins).toEqual([
      { kind: "folder", id: codeDir },
      { kind: "session", id: "free_code" },
      { kind: "automation", id: "auto-code" },
    ]);
    expect(model.spaceFolders.map((f) => f.directory)).toEqual([]);
    expect(model.recentGroups.map((g) => g.latestSession.id)).toEqual([]);
  });
});

describe("buildAssistantSidebarModel", () => {
  test("partitions, archives, elevates automation pins, builds recent/space", () => {
    const free = group("free", 300);
    const spaceTask = group("space_1", 200);
    const autoRun = group("auto_run", 100);
    const archived = group("archived", 50);
    const spaceDir = "/tmp/space";

    const model = buildAssistantSidebarModel({
      categoryGroups: [free, spaceTask, autoRun, archived],
      categoryId: "office",
      globalPins: [
        { kind: "session", id: "free" },
        { kind: "automation", id: "auto-1" },
      ],
      spaceLocalPinsByDirectory: { [spaceDir]: ["space_1"] },
      spaceFolderOrder: [spaceDir],
      workspaceBySessionId: new Map([
        ["space_1", { directory: spaceDir }],
      ]),
      automationRecords: [
        {
          sessionId: "auto_run",
          automationId: "auto-1",
          title: "Daily",
          category: "office",
          createdAt: 100,
        },
      ],
      archivedIdSet: new Set(["archived"]),
      automationLocalPinsById: { "auto-1": ["auto_run"] },
    });

    expect(model.regularGroups.map((g) => g.latestSession.id).sort()).toEqual([
      "free",
      "space_1",
    ]);
    expect(model.automationGroupsAll.map((g) => g.id)).toEqual(["auto-1"]);
    // Elevated into global pins → not in schedules section.
    expect(model.automationGroups).toEqual([]);
    expect(model.listModel.globalPins.map((p) => p.kind)).toEqual([
      "session",
      "automation",
    ]);
    expect(model.listModel.recentGroups.map((g) => g.latestSession.id)).toEqual(
      [],
    );
    expect(model.listModel.spaceFolders.map((f) => f.directory)).toEqual([
      spaceDir,
    ]);
  });

  test("partitionCategoryGroupsForSidebar separates automation sessions", () => {
    const a = group("a", 1);
    const b = group("b", 2);
    const part = partitionCategoryGroupsForSidebar({
      categoryGroups: [a, b],
      categoryId: "code",
      automationRecords: [
        {
          sessionId: "b",
          automationId: "x",
          title: "X",
          category: "code",
          createdAt: 2,
        },
      ],
    });
    expect(part.regularGroups.map((g) => g.latestSession.id)).toEqual(["a"]);
    expect(part.automationGroupsRaw.map((g) => g.id)).toEqual(["x"]);
  });
});

describe("localPinMapsEqual / buildAutomationLocalPinsMap", () => {
  test("localPinMapsEqual is true for identical maps", () => {
    const a = { g1: ["s1", "s2"], g2: [] as string[] };
    const b = { g1: ["s1", "s2"], g2: [] as string[] };
    expect(localPinMapsEqual(a, b)).toBe(true);
    expect(localPinMapsEqual(a, { g1: ["s1"] })).toBe(false);
  });

  test("buildAutomationLocalPinsMap reads scopes via pure callback", () => {
    const map = buildAutomationLocalPinsMap(["auto-a", "auto-b"], (scope) => {
      if (scope.includes("auto-a")) return ["s1"];
      return [];
    });
    expect(map["auto-a"]).toEqual(["s1"]);
    expect(map["auto-b"]).toEqual([]);
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
    expect(resolveDropSlot(9, 0, 20, 0, 3)).toBe(0);
    expect(resolveDropSlot(10, 0, 20, 0, 3)).toBe(1);
    expect(resolveDropSlot(15, 0, 20, 0, 3)).toBe(1);
    expect(resolveDropSlot(100, 80, 20, 2, 3)).toBe(3);
  });

  test("mergeVisibleReorderIntoFull keeps hidden pins in place", () => {
    const full = [
      { kind: "folder" as const, id: "office-f" },
      { kind: "session" as const, id: "code-s" },
      { kind: "folder" as const, id: "code-f" },
      { kind: "automation" as const, id: "office-a" },
    ];
    // Code category only sees code-s and code-f (indices 0,1 of visible).
    const visible = [
      { kind: "session" as const, id: "code-s" },
      { kind: "folder" as const, id: "code-f" },
    ];
    // Swap visible order: code-f before code-s.
    const next = mergeVisibleReorderIntoFull({
      full,
      visible,
      fromIndex: 1,
      toIndex: 0,
      keyOf: globalPinKey,
    });
    expect(next.map(globalPinKey)).toEqual([
      "folder:office-f",
      "folder:code-f",
      "session:code-s",
      "automation:office-a",
    ]);
  });

  test("reorderSpaceFolderDirectories keeps globally-pinned dirs in storage slots", () => {
    // full order includes globally pinned /office-pin (hidden from 空间 list).
    const full = ["/office-pin", "/space-a", "/space-b", "/space-c"];
    const visible = ["/space-a", "/space-b", "/space-c"];
    // Drag /space-c before /space-a (visible indices 2 → 0).
    const next = reorderSpaceFolderDirectories({
      fullDirectories: full,
      visibleDirectories: visible,
      fromIndex: 2,
      toIndex: 0,
    });
    expect(next).toEqual([
      "/office-pin",
      "/space-c",
      "/space-a",
      "/space-b",
    ]);
  });

  test("interleaved pinned dir: storage order not Map-key order as fullDirectories", () => {
    // Bug: Map.keys() discovery order put /space-b before /office-pin even when
    // saved spaceFolderOrder has the pin first — merge then scrambled pin slots.
    const storageOrder = ["/office-pin", "/space-b", "/space-a"];
    const mapKeyOrder = ["/space-b", "/office-pin", "/space-a"]; // wrong full
    const visible = ["/space-b", "/space-a"];

    const fullFromStorage = orderedSpaceDirectories({
      knownDirectories: mapKeyOrder,
      spaceFolderOrder: storageOrder,
    });
    expect(fullFromStorage).toEqual(["/office-pin", "/space-b", "/space-a"]);

    // Reorder visible: /space-a before /space-b (fromIndex 1 → 0).
    const correct = reorderSpaceFolderDirectories({
      fullDirectories: fullFromStorage,
      visibleDirectories: visible,
      fromIndex: 1,
      toIndex: 0,
    });
    expect(correct).toEqual(["/office-pin", "/space-a", "/space-b"]);

    // Same drag with Map-key full would move the pin (regression lock).
    const wrong = reorderSpaceFolderDirectories({
      fullDirectories: mapKeyOrder,
      visibleDirectories: visible,
      fromIndex: 1,
      toIndex: 0,
    });
    expect(wrong).toEqual(["/space-a", "/office-pin", "/space-b"]);
    expect(correct).not.toEqual(wrong);
  });

  test("buildAssistantListModel.allSpaceDirectories follows spaceFolderOrder", () => {
    const pinDir = "/office-pin";
    const a = "/space-a";
    const b = "/space-b";
    const pinTask = group("pin_task", 10);
    const aTask = group("a_task", 20);
    const bTask = group("b_task", 30);
    // Discovery order in groups is a, pin, b — storage wants pin first.
    const model = buildAssistantListModel({
      groups: [aTask, pinTask, bTask],
      globalPins: [{ kind: "folder", id: pinDir }],
      spaceLocalPinsByDirectory: {},
      spaceFolderOrder: [pinDir, b, a],
      workspaceBySessionId: new Map([
        ["pin_task", { directory: pinDir }],
        ["a_task", { directory: a }],
        ["b_task", { directory: b }],
      ]),
    });
    expect(model.allSpaceDirectories).toEqual([pinDir, b, a]);
    // Visible spaces exclude global pin folder.
    expect(model.spaceFolders.map((f) => f.directory)).toEqual([b, a]);
  });
});

describe("SpaceFolderDragList uses shared reorder helper", () => {
  test("sections commitReorder imports reorderSpaceFolderDirectories (structural)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.join(
        import.meta.dir,
        "../src/react-app/domains/session/sidebar/assistant-conversation-sections.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("reorderSpaceFolderDirectories");
    expect(source).toContain("commitReorder");
    // Must not inline splice-based visible reorder in commitReorder body.
    const commitIdx = source.indexOf("const commitReorder");
    expect(commitIdx).toBeGreaterThan(-1);
    const commitBody = source.slice(commitIdx, commitIdx + 600);
    expect(commitBody).toContain("reorderSpaceFolderDirectories");
    expect(commitBody).not.toMatch(/nextVisible\.splice/);
    // fullDirectories must come from listModel (storage order), not Map.keys().
    expect(source).toContain("allSpaceDirectories");
    expect(source).not.toMatch(
      /allSpaceDirectories\s*=\s*Array\.from\(\s*spaceItemsByDirectory\.keys/,
    );
  });
});
