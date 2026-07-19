import { describe, expect, test } from "bun:test";

import {
  formatTaskArchiveMeta,
  groupArchivedRowsByProject,
  normalizeProjectKey,
  parseProjectFilterValue,
  projectFilterValue,
  rowMatchesArchivedFilters,
  sortArchivedRows,
  type ArchivedFilterableRow,
} from "../src/react-app/domains/settings/pages/archived-tasks-filters";

function row(
  partial: Partial<ArchivedFilterableRow> & Pick<ArchivedFilterableRow, "id">,
): ArchivedFilterableRow {
  return {
    id: partial.id,
    title: partial.title ?? partial.id,
    projectKey: partial.projectKey ?? "__unknown__",
    updatedAt: partial.updatedAt ?? 2,
    createdAt: partial.createdAt ?? 1,
    automated: partial.automated ?? false,
    source: partial.source ?? "local",
  };
}

describe("archived-tasks-filters", () => {
  test("normalizeProjectKey maps empty paths to __unknown__", () => {
    expect(normalizeProjectKey(null)).toBe("__unknown__");
    expect(normalizeProjectKey("")).toBe("__unknown__");
    expect(normalizeProjectKey("  ")).toBe("__unknown__");
    expect(normalizeProjectKey("/Users/work/proj")).toBe("/Users/work/proj");
  });

  test("project filter value round-trips", () => {
    expect(projectFilterValue("__unknown__")).toBe("project:__unknown__");
    expect(parseProjectFilterValue("project:/a/b")).toBe("/a/b");
    expect(parseProjectFilterValue("all")).toBe("all");
    expect(parseProjectFilterValue("kind:tasks")).toBeNull();
  });

  test("kind:tasks hides automated rows but keeps normal tasks", () => {
    const task = row({ id: "t1", automated: false, source: "cloud" });
    const auto = row({ id: "a1", automated: true, source: "cloud" });
    const filters = {
      query: "",
      source: "all" as const,
      project: "all" as const,
      kind: "tasks" as const,
    };
    expect(rowMatchesArchivedFilters(task, filters)).toBe(true);
    expect(rowMatchesArchivedFilters(auto, filters)).toBe(false);
  });

  test("kind:scheduled keeps only automated rows", () => {
    const task = row({ id: "t1", automated: false, source: "cloud" });
    const auto = row({ id: "a1", automated: true, source: "cloud" });
    const filters = {
      query: "",
      source: "all" as const,
      project: "all" as const,
      kind: "scheduled" as const,
    };
    expect(rowMatchesArchivedFilters(task, filters)).toBe(false);
    expect(rowMatchesArchivedFilters(auto, filters)).toBe(true);
  });

  test("project filter composes with kind filter", () => {
    const inProj = row({
      id: "1",
      projectKey: "/p/a",
      automated: false,
      source: "cloud",
    });
    const other = row({
      id: "2",
      projectKey: "/p/b",
      automated: false,
      source: "cloud",
    });
    const filters = {
      query: "",
      source: "all" as const,
      project: "/p/a",
      kind: "tasks" as const,
    };
    expect(rowMatchesArchivedFilters(inProj, filters)).toBe(true);
    expect(rowMatchesArchivedFilters(other, filters)).toBe(false);
  });

  test("sortArchivedRows by updated/created/name", () => {
    const rows = [
      row({ id: "b", title: "Beta", updatedAt: 1, createdAt: 30 }),
      row({ id: "a", title: "Alpha", updatedAt: 3, createdAt: 10 }),
      row({ id: "c", title: "Gamma", updatedAt: 2, createdAt: 20 }),
    ];
    expect(sortArchivedRows(rows, "updated").map((r) => r.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(sortArchivedRows(rows, "created").map((r) => r.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(sortArchivedRows(rows, "name").map((r) => r.title)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
  });

  test("groupArchivedRowsByProject builds folder sections (WorkBuddy project archive)", () => {
    const rows = [
      { ...row({ id: "1", projectKey: "/p/onmyagent", updatedAt: 1 }), projectLabel: "onmyagent" },
      { ...row({ id: "2", projectKey: "/p/onmyagent", updatedAt: 5 }), projectLabel: "onmyagent" },
      { ...row({ id: "3", projectKey: "__unknown__" }), projectLabel: "Unknown" },
      { ...row({ id: "4", projectKey: "/p/work", updatedAt: 9 }), projectLabel: "work" },
    ];
    // Default name-order groups (sortMode name) — folders A–Z.
    const byName = groupArchivedRowsByProject(rows, {
      unscopedLabel: "Unscoped",
      sortMode: "name",
    });
    expect(byName.map((g) => g.label)).toEqual([
      "onmyagent",
      "work",
      "Unscoped",
    ]);
    // Date sort: newest project first; items newest-first inside group.
    const byUpdated = groupArchivedRowsByProject(rows, {
      unscopedLabel: "Unscoped",
      sortMode: "updated",
    });
    expect(byUpdated.map((g) => g.label)).toEqual([
      "work",
      "onmyagent",
      "Unscoped",
    ]);
    expect(byUpdated[1]?.items.map((i) => i.id)).toEqual(["2", "1"]);
  });

  test("formatTaskArchiveMeta is date · project for task layout", () => {
    expect(
      formatTaskArchiveMeta({
        timeLabel: "2026年7月10日, 5:54",
        projectKey: "/p/multimodal-image-search",
        projectLabel: "multimodal-image-search",
      }),
    ).toBe("2026年7月10日, 5:54 · multimodal-image-search");
    expect(
      formatTaskArchiveMeta({
        timeLabel: "2026年7月10日, 5:54",
        projectKey: "__unknown__",
        projectLabel: "Unscoped",
      }),
    ).toBe("2026年7月10日, 5:54");
  });
});
