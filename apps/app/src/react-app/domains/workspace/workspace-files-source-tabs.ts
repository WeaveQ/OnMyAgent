/**
 * Files source tab identity, labels, and expert/task tree filters.
 */
import {
  shouldHideEntry,
  type WorkspaceFileTreeNode,
} from "../../capabilities/artifacts/workspace-file-tree";
import {
  WORKSPACE_EXPERTS_DIR,
  WORKSPACE_PROJECTS_DIR,
  WORKSPACE_TASKS_DIR,
  WORKSPACE_UPLOADS_DIR,
  isAutomationTaskFolderName,
  isWorkspaceLayoutTopDir,
  isWorkspaceSystemTopDir,
  resolveProductWriteRelativePath,
} from "./workspace-files-layout";
import { formatExpertFolderDisplayName } from "./workspace-files-tree-outline";

export {
  WORKSPACE_EXPERTS_DIR,
  WORKSPACE_PROJECTS_DIR,
  WORKSPACE_TASKS_DIR,
  WORKSPACE_UPLOADS_DIR,
  isAutomationTaskFolderName,
  isWorkspaceLayoutTopDir,
  resolveProductWriteRelativePath,
} from "./workspace-files-layout";

export function resolveToolWorkspaceFileRoot(input: {
  draftWorkspaceDirectory?: string | null;
  sessionFileRoot?: string | null;
  workspaceRoot: string;
}): string {
  const draft = input.draftWorkspaceDirectory?.trim() ?? "";
  if (draft) return draft;
  const session = input.sessionFileRoot?.trim() ?? "";
  if (session) return session;
  return input.workspaceRoot.trim();
}


/** Active provenance tabs on the primary-rail Files page. */
export type FilesSourceTab = "uploads" | "task" | "expert";

/**
 * Rail pills including coming-soon **项目** (not selectable).
 * Content still uses {@link FilesSourceTab} only.
 */
export type FilesSourceRailTab = FilesSourceTab | "project";

/** Default tab when opening Files (product: Mine / uploads). */
export const DEFAULT_FILES_SOURCE_TAB: FilesSourceTab = "uploads";

export const FILES_SOURCE_TABS: readonly FilesSourceTab[] = [
  "uploads",
  "task",
  "expert",
] as const;

/** Full rail order: Mine · Tasks · Experts · Projects (coming soon). */
export const FILES_SOURCE_RAIL_TABS: readonly FilesSourceRailTab[] = [
  "uploads",
  "task",
  "expert",
  "project",
] as const;

export function isFilesSourceRailTabEnabled(
  tab: FilesSourceRailTab,
): tab is FilesSourceTab {
  return tab !== "project";
}

/**
 * Relative workspace directory for user import-by-copy (inbox upload path prefix).
 * Server inbox stores under this logical area; UI lists via listInbox.
 * Aligns with product layout root `uploads/`.
 */
export const USER_UPLOADS_RELATIVE_DIR = WORKSPACE_UPLOADS_DIR;

/**
 * uploads: inbox API; task/expert: workspace browser with path layout + heuristics.
 */
export function isFilesSourceListReady(tab: FilesSourceTab): boolean {
  return tab === "uploads" || tab === "task" || tab === "expert";
}

/** Pure package slug with 3+ segments: fleet-management-specialist (avoids home-notes). */
const EXPERT_PACKAGE_SLUG_LONG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+){2,}$/;

/**
 * Heuristic: folder name is an expert agent archive (not a Home temp task).
 * Optional knownPackageSlugs strengthens matching (packageName from marketplace).
 *
 * Matches:
 * - pure slug (known or 3+ kebab parts): fleet-management-specialist
 * - DisplayName-slug with non-ASCII prefix: 财报研究员-earnings-reviewer
 * - CJK-only expert display names that already lived at root historically
 */
export function isLikelyExpertAgentFolderName(
  name: string,
  knownPackageSlugs: readonly string[] = [],
): boolean {
  const n = name.trim();
  if (!n || isWorkspaceSystemTopDir(n) || isAutomationTaskFolderName(n)) {
    return false;
  }
  const lower = n.toLowerCase();
  for (const slug of knownPackageSlugs) {
    const s = slug.trim().toLowerCase();
    if (!s) continue;
    if (lower === s || lower.endsWith(`-${s}`) || lower.startsWith(`${s}-`)) {
      return true;
    }
  }
  // Pure long english package slug at root
  if (EXPERT_PACKAGE_SLUG_LONG_RE.test(n)) return true;
  // Display name (often CJK) + kebab slug
  const m = n.match(/^(.*)-([a-z][a-z0-9]*(?:-[a-z0-9]+)+)$/);
  if (m) {
    const prefix = m[1];
    const slug = m[2];
    if (knownPackageSlugs.some((s) => s.trim().toLowerCase() === slug)) return true;
    // Non-ASCII display name is a strong expert signal (screenshot folders)
    if (/[^\u0000-\u007f]/.test(prefix)) return true;
    // Long slug after any prefix
    if (slug.split("-").length >= 3) return true;
  }
  // Display names that end with "expert" character pair (marketplace naming).
  if (/\u4e13\u5bb6$/.test(n) && n.length >= 4) return true;
  return false;
}

function findTopDir(
  root: WorkspaceFileTreeNode,
  name: string,
): WorkspaceFileTreeNode | null {
  const lower = name.toLowerCase();
  for (const child of root.children) {
    if (child.kind === "dir" && child.name.trim().toLowerCase() === lower) {
      return child;
    }
  }
  return null;
}

/**
 * Merge sibling expert folders that share the same display label.
 * e.g. `报价作业` + `报价作业-quote-specialistquote-specialist` → one "报价作业"
 * with sessions from both (deduped by session folder name).
 */
export function mergeExpertSiblingFolders(
  nodes: readonly WorkspaceFileTreeNode[],
): WorkspaceFileTreeNode[] {
  const looseFiles: WorkspaceFileTreeNode[] = [];
  const groups = new Map<string, WorkspaceFileTreeNode[]>();
  const order: string[] = [];

  for (const node of nodes) {
    if (node.kind === "file") {
      looseFiles.push(node);
      continue;
    }
    const key = formatExpertFolderDisplayName(node.name).trim().toLowerCase();
    if (!key) {
      looseFiles.push(node);
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(node);
  }

  const merged: WorkspaceFileTreeNode[] = [];
  for (const key of order) {
    const group = groups.get(key) ?? [];
    if (group.length === 0) continue;
    if (group.length === 1) {
      const only = group[0];
      merged.push({
        ...only,
        name: formatExpertFolderDisplayName(only.name),
      });
      continue;
    }

    // Prefer the longer disk name (usually DisplayName-slug) as path base.
    const primary = [...group].sort(
      (a, b) => b.name.length - a.name.length || b.mtimeMs - a.mtimeMs,
    )[0];
    const childByName = new Map<string, WorkspaceFileTreeNode>();
    for (const folder of group) {
      for (const child of folder.children) {
        const existing = childByName.get(child.name);
        if (!existing || (child.mtimeMs || 0) >= (existing.mtimeMs || 0)) {
          childByName.set(child.name, child);
        }
      }
    }
    const children = [...childByName.values()].sort(
      (a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0) || a.name.localeCompare(b.name),
    );
    let size = 0;
    let mtimeMs = 0;
    for (const child of children) {
      size += Math.max(0, child.size || 0);
      mtimeMs = Math.max(mtimeMs, child.mtimeMs || 0);
    }
    merged.push({
      ...primary,
      name: formatExpertFolderDisplayName(primary.name),
      children,
      size,
      mtimeMs,
    });
  }

  return [...merged, ...looseFiles];
}

/**
 * Filter a workspace root tree for Task vs Expert tabs.
 *
 * Preferred layout (after migration / new writes):
 * - Expert: children of `experts/`
 * - Task: children of `tasks/` + `projects/` + loose non-layout leftovers
 *
 * Legacy flat roots still classified by path heuristics until migrated.
 */
export function filterWorkspaceTreeBySourceTab(
  root: WorkspaceFileTreeNode,
  tab: "task" | "expert",
  knownPackageSlugs: readonly string[] = [],
): WorkspaceFileTreeNode {
  const expertsRoot = findTopDir(root, WORKSPACE_EXPERTS_DIR);
  const tasksRoot = findTopDir(root, WORKSPACE_TASKS_DIR);
  const projectsRoot = findTopDir(root, WORKSPACE_PROJECTS_DIR);

  if (tab === "expert") {
    const children: WorkspaceFileTreeNode[] = [];
    if (expertsRoot) {
      children.push(...expertsRoot.children.filter((c) => c.kind === "dir" || c.kind === "file"));
    }
    // Legacy unmigrated expert archives still at workspace root
    for (const child of root.children) {
      if (child.kind !== "dir") continue;
      if (isWorkspaceLayoutTopDir(child.name)) continue;
      if (isLikelyExpertAgentFolderName(child.name, knownPackageSlugs)) {
        children.push(child);
      }
    }
    return { ...root, children: mergeExpertSiblingFolders(children) };
  }

  // task tab: spaces (projects/) first in source order; sort layer keeps them above automation.
  const children: WorkspaceFileTreeNode[] = [];
  if (projectsRoot) {
    children.push(...projectsRoot.children);
  }
  if (tasksRoot) {
    children.push(...tasksRoot.children);
  }
  for (const child of root.children) {
    if (isWorkspaceLayoutTopDir(child.name)) continue;
    if (isWorkspaceSystemTopDir(child.name)) continue;
    if (child.kind === "file") {
      // Loose root files stay visible under task until migrated into uploads/tasks
      children.push(child);
      continue;
    }
    if (isLikelyExpertAgentFolderName(child.name, knownPackageSlugs)) continue;
    children.push(child);
  }
  return { ...root, children };
}

export function filesSourceTabLabelKey(tab: FilesSourceRailTab): string {
  switch (tab) {
    case "uploads":
      return "files.source_uploads";
    case "task":
      return "files.source_task";
    case "expert":
      return "files.source_expert";
    case "project":
      return "files.source_project";
  }
}

/** Page h1 under the rail pills (Mine / Task / Expert files). */
export function filesSourceTabTitleKey(tab: FilesSourceTab): string {
  switch (tab) {
    case "uploads":
      return "files.source_uploads_title";
    case "task":
      return "files.source_task_title";
    case "expert":
      return "files.source_expert_title";
  }
}

export function filesSourceTabSubtitleKey(tab: FilesSourceTab): string {
  switch (tab) {
    case "uploads":
      return "files.source_uploads_desc";
    case "task":
      return "files.source_task_desc";
    case "expert":
      return "files.source_expert_desc";
  }
}

export function filesSourceTabSearchPlaceholderKey(tab: FilesSourceTab): string {
  switch (tab) {
    case "uploads":
      return "files.search_uploads_placeholder";
    case "task":
      return "files.search_task_placeholder";
    case "expert":
      return "files.search_expert_placeholder";
  }
}

export function filesSourceEmptyTitleKey(tab: FilesSourceTab): string {
  switch (tab) {
    case "uploads":
      return "files.uploads_empty_title";
    case "task":
      return "files.task_empty_title";
    case "expert":
      return "files.expert_empty_title";
  }
}

export function filesSourceEmptyHintKey(tab: FilesSourceTab): string {
  switch (tab) {
    case "uploads":
      return "files.uploads_empty_hint";
    case "task":
      return "files.task_empty_hint";
    case "expert":
      return "files.expert_empty_hint";
  }
}

