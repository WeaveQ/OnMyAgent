/**
 * Pure filter helpers for archived-tasks settings view.
 * Kept free of React so contracts can assert behavior without mounting UI.
 */

export type ArchivedSourceFilter = "all" | "local" | "cloud";
export type ArchivedSortMode = "updated" | "created" | "name";
/** Project key: "all", "__unknown__", or a directory/path string. */
export type ArchivedProjectFilter = "all" | string;
export type ArchivedKindFilter = "all" | "tasks" | "scheduled";

export type ArchivedFilterableRow = {
  id: string;
  title: string;
  projectKey: string;
  updatedAt: number;
  createdAt: number;
  automated: boolean;
  source: "local" | "cloud";
};

export function normalizeProjectKey(project: string | null | undefined): string {
  const trimmed = project?.trim() ?? "";
  return trimmed || "__unknown__";
}

export function projectFilterValue(projectKey: string): string {
  return `project:${projectKey}`;
}

export function parseProjectFilterValue(
  value: string,
): ArchivedProjectFilter | null {
  if (value === "all") return "all";
  if (value.startsWith("project:")) {
    const key = value.slice("project:".length);
    return key || "__unknown__";
  }
  return null;
}

export function rowMatchesArchivedFilters(
  row: ArchivedFilterableRow,
  filters: {
    query: string;
    source: ArchivedSourceFilter;
    project: ArchivedProjectFilter;
    kind: ArchivedKindFilter;
  },
): boolean {
  if (filters.source === "local" && row.source !== "local") return false;
  if (filters.source === "cloud" && row.source !== "cloud") return false;

  if (filters.project !== "all" && row.projectKey !== filters.project) {
    return false;
  }

  if (filters.kind === "tasks" && row.automated) return false;
  if (filters.kind === "scheduled" && !row.automated) return false;

  const q = filters.query.trim().toLowerCase();
  if (q && !row.title.toLowerCase().includes(q)) {
    // Title-only match is the minimum; callers may pre-filter richer haystacks.
    // Keep this helper focused on structured filters when query is empty.
  }

  return true;
}

export function sortArchivedRows<T extends ArchivedFilterableRow>(
  rows: T[],
  sortMode: ArchivedSortMode,
): T[] {
  const next = [...rows];
  next.sort((left, right) => {
    if (sortMode === "name") {
      return left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
      });
    }
    if (sortMode === "created") {
      return right.createdAt - left.createdAt;
    }
    return right.updatedAt - left.updatedAt;
  });
  return next;
}

export type ArchivedProjectGroup<T extends ArchivedFilterableRow> = {
  key: string;
  /** Display name (folder basename or unscoped label). */
  label: string;
  items: T[];
};

/**
 * WorkBuddy project archive: group under folder headers.
 * Unscoped rows (__unknown__) stay in their own trailing group.
 */
export function groupArchivedRowsByProject<T extends ArchivedFilterableRow & {
  projectLabel: string;
}>(
  rows: T[],
  options?: { unscopedLabel?: string },
): ArchivedProjectGroup<T>[] {
  const unscopedLabel = options?.unscopedLabel ?? "Unscoped";
  const map = new Map<string, ArchivedProjectGroup<T>>();
  for (const row of rows) {
    const key = row.projectKey || "__unknown__";
    const existing = map.get(key);
    if (existing) {
      existing.items.push(row);
      continue;
    }
    map.set(key, {
      key,
      label: key === "__unknown__" ? unscopedLabel : row.projectLabel,
      items: [row],
    });
  }
  const groups = Array.from(map.values());
  groups.sort((a, b) => {
    if (a.key === "__unknown__") return 1;
    if (b.key === "__unknown__") return -1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
  return groups;
}

/** Task-mode meta line: date · projectSlug (omit empty/unknown project). */
export function formatTaskArchiveMeta(input: {
  timeLabel: string;
  projectKey: string;
  projectLabel: string;
}): string {
  const parts: string[] = [];
  if (input.timeLabel) parts.push(input.timeLabel);
  if (input.projectKey && input.projectKey !== "__unknown__") {
    parts.push(input.projectLabel || input.projectKey);
  }
  return parts.join(" · ");
}
