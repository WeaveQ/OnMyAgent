import { describe, expect, test } from "bun:test";

import {
  archiveTaskInList,
  archiveTasksInList,
  archivedSessionIdSet,
  filterArchivedTaskRoots,
  filterGroupsExcludingArchived,
  permanentlyRemoveFromList,
  permanentlyRemoveTaskTreeFromList,
  resolveOpenFolderPath,
  restoreTaskFromList,
  restoreTaskTreeFromList,
  type AssistantArchivedTask,
} from "../src/react-app/domains/shared/assistant-archived-tasks";

function task(
  sessionId: string,
  overrides: Partial<AssistantArchivedTask> = {},
): AssistantArchivedTask {
  return {
    sessionId,
    title: overrides.title ?? sessionId,
    directory: overrides.directory ?? null,
    archivedAt: overrides.archivedAt ?? 1_700_000_000_000,
    category: overrides.category ?? "office",
    parentID: overrides.parentID ?? null,
  };
}

describe("assistant archived task helpers", () => {
  test("resolveOpenFolderPath hides empty paths", () => {
    expect(resolveOpenFolderPath(null)).toBeNull();
    expect(resolveOpenFolderPath("")).toBeNull();
    expect(resolveOpenFolderPath("   ")).toBeNull();
    expect(resolveOpenFolderPath("/Users/work/proj")).toBe("/Users/work/proj");
    expect(resolveOpenFolderPath("  /tmp/x  ")).toBe("/tmp/x");
  });

  test("archive prepends and dedupes by session id", () => {
    const initial = [task("a", { title: "A" })];
    const next = archiveTaskInList(initial, task("b", { title: "B" }));
    expect(next.map((item) => item.sessionId)).toEqual(["b", "a"]);

    const again = archiveTaskInList(next, task("a", { title: "A2" }));
    expect(again.map((item) => item.sessionId)).toEqual(["a", "b"]);
    expect(again[0]?.title).toBe("A2");
  });

  test("restore and permanent remove drop the session from the archive list", () => {
    const list = [task("a"), task("b"), task("c")];
    expect(restoreTaskFromList(list, "b").map((item) => item.sessionId)).toEqual([
      "a",
      "c",
    ]);
    expect(
      permanentlyRemoveFromList(list, "a").map((item) => item.sessionId),
    ).toEqual(["b", "c"]);
  });

  test("archiveTasksInList keeps parentID on cascaded children", () => {
    const next = archiveTasksInList([], [
      task("child", { title: "Child", parentID: "parent" }),
      task("parent", { title: "Parent" }),
    ]);
    expect(next.map((item) => item.sessionId)).toEqual(["parent", "child"]);
    expect(next.find((item) => item.sessionId === "child")?.parentID).toBe(
      "parent",
    );
  });

  test("restore and permanent-remove trees drop parent and stored children", () => {
    const list = [
      task("parent", { title: "Parent" }),
      task("child", { title: "Child", parentID: "parent" }),
      task("other", { title: "Other" }),
    ];
    expect(
      restoreTaskTreeFromList(list, "parent").map((item) => item.sessionId),
    ).toEqual(["other"]);
    expect(
      permanentlyRemoveTaskTreeFromList(list, "parent").map(
        (item) => item.sessionId,
      ),
    ).toEqual(["other"]);
  });

  test("filterArchivedTaskRoots hides cascaded children when the parent is archived", () => {
    const list = [
      task("parent", { title: "Parent" }),
      task("child", { title: "Child", parentID: "parent" }),
      task("orphan", { title: "Orphan", parentID: "missing" }),
    ];
    expect(
      filterArchivedTaskRoots(list).map((item) => item.sessionId),
    ).toEqual(["parent", "orphan"]);
  });

  test("filterGroupsExcludingArchived hides archived sessions from main list", () => {
    const groups = [
      { key: "1", latestSession: { id: "ses-1" } },
      { key: "2", latestSession: { id: "ses-2" } },
      { key: "3", latestSession: { id: "ses-3" } },
    ];
    const archived = archivedSessionIdSet([task("ses-2"), task("ses-9")]);
    const visible = filterGroupsExcludingArchived(groups, archived);
    expect(visible.map((item) => item.latestSession.id)).toEqual([
      "ses-1",
      "ses-3",
    ]);
  });
});
