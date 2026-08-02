/**
 * Pure helpers for the workspace files rail (categories, outline, filters).
 */
import {
  canEditArtifactTarget,
} from "../../capabilities/artifacts/open-artifact-for-editing";
import {
  canPreviewOpenTargetInline,
  type OpenTarget,
} from "../../capabilities/artifacts/open-target";
import {
  formatWorkspaceFileTime,
  shouldHideEntry,
  type WorkspaceFileSortDir,
  type WorkspaceFileSortKey,
  type WorkspaceFileTreeNode,
} from "../../capabilities/artifacts/workspace-file-tree";
import { t } from "../../../i18n";
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

export {
  WORKSPACE_EXPERTS_DIR,
  WORKSPACE_PROJECTS_DIR,
  WORKSPACE_TASKS_DIR,
  WORKSPACE_UPLOADS_DIR,
  isAutomationTaskFolderName,
  isWorkspaceLayoutTopDir,
  resolveProductWriteRelativePath,
} from "./workspace-files-layout";

export type FileCategory =
  | "all"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "pdf"
  | "image"
  | "video"
  | "audio"
  | "website"
  | "markdown"
  | "code"
  | "other";

export const FILE_CATEGORIES: FileCategory[] = [
  "all",
  "document",
  "spreadsheet",
  "presentation",
  "pdf",
  "image",
  "video",
  "audio",
  "website",
  "markdown",
  "code",
  "other",
];

const FILE_CATEGORY_BY_EXT: Record<string, FileCategory> = {
  md: "markdown",
  markdown: "markdown",
  txt: "document",
  doc: "document",
  docx: "document",
  rtf: "document",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  csv: "spreadsheet",
  tsv: "spreadsheet",
  ppt: "presentation",
  pptx: "presentation",
  key: "presentation",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  ico: "image",
  tiff: "image",
  tif: "image",
  avif: "image",
  mp4: "video",
  avi: "video",
  mov: "video",
  mkv: "video",
  wmv: "video",
  flv: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  aac: "audio",
  ogg: "audio",
  m4a: "audio",
  wma: "audio",
  html: "website",
  css: "website",
  htm: "website",
  js: "code",
  ts: "code",
  jsx: "code",
  tsx: "code",
  py: "code",
  rs: "code",
  go: "code",
  java: "code",
  c: "code",
  cpp: "code",
  h: "code",
  hpp: "code",
  rb: "code",
  php: "code",
  swift: "code",
  kt: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  sql: "code",
  r: "code",
  json: "code",
  yaml: "code",
  yml: "code",
  toml: "code",
  xml: "code",
  ini: "code",
  env: "code",
  scss: "code",
  sass: "code",
  less: "code",
};

export function getFileCategory(name: string): FileCategory {
  const ext =
    name.lastIndexOf(".") > 0
      ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
      : "";
  return FILE_CATEGORY_BY_EXT[ext] || "other";
}

/** i18n key for a file category chip (caller translates). */
export function fileCategoryI18nKey(category: FileCategory): string {
  switch (category) {
    case "all":
      return "files.category_all";
    case "document":
      return "files.category_document";
    case "spreadsheet":
      return "files.category_spreadsheet";
    case "presentation":
      return "files.category_presentation";
    case "pdf":
      return "files.category_pdf";
    case "image":
      return "files.category_image";
    case "video":
      return "files.category_video";
    case "audio":
      return "files.category_audio";
    case "website":
      return "files.category_website";
    case "markdown":
      return "files.category_markdown";
    case "code":
      return "files.category_code";
    case "other":
      return "files.category_other";
  }
}

export function countFilesInNode(node: WorkspaceFileTreeNode): number {
  if (node.kind === "file") return 1;
  return node.children.reduce((sum, child) => sum + countFilesInNode(child), 0);
}

export function countDirsInNode(node: WorkspaceFileTreeNode): number {
  return node.children.filter((child) => child.kind === "dir").length;
}

/**
 * Expert archive folder label: "财报研究员-earnings-reviewer" → "财报研究员".
 * Also cleans glued slugs: "报价作业-quote-specialistquote-specialist" → "报价作业".
 * Pure package slugs stay as-is.
 */
export function formatExpertFolderDisplayName(folderName: string): string {
  const n = folderName.trim();
  if (!n) return n;
  // Prefer: non-ASCII display name + trailing ascii kebab (slug may be doubled/glued).
  const withDisplay = n.match(
    /^(.*[^\u0000-\u007f].*?)-([a-z][a-z0-9-]+)$/i,
  );
  if (withDisplay?.[1]?.trim()) return withDisplay[1].trim();
  return n;
}

/** Session isolation dirs: Date.now() ms, short hex, or 2026-07-23_155052. */
export function isLikelySessionFolderName(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (/^\d{10,16}$/.test(n)) return true;
  if (/^[a-f0-9]{8,12}$/i.test(n)) return true;
  if (/^\d{4}-\d{2}-\d{2}[_-]\d{4,6}$/.test(n)) return true;
  return false;
}

/** Best-effort timestamp for a session folder (folder name first, then mtime). */
export function resolveSessionFolderTimeMs(
  name: string,
  mtimeMs = 0,
): number {
  const n = name.trim();
  if (/^\d{10,16}$/.test(n)) {
    const ms = Number(n);
    if (Number.isFinite(ms) && ms > 1e11) return ms;
  }
  const stamp = n.match(
    /^(\d{4})-(\d{2})-(\d{2})[_-](\d{2})(\d{2})(\d{2})?$/,
  );
  if (stamp) {
    const date = new Date(
      Number(stamp[1]),
      Number(stamp[2]) - 1,
      Number(stamp[3]),
      Number(stamp[4]),
      Number(stamp[5]),
      Number(stamp[6] ?? "0"),
    );
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }
  if (Number.isFinite(mtimeMs) && mtimeMs > 0) return mtimeMs;
  return 0;
}

/**
 * Fixed session title for Files UI: "会话 · 07/26 14:32".
 * Does not use first user message (product: fixed title).
 */
export function formatSessionFolderDisplayName(
  name: string,
  mtimeMs = 0,
): string {
  const whenMs = resolveSessionFolderTimeMs(name, mtimeMs);
  const when =
    whenMs > 0
      ? formatWorkspaceFileTime(whenMs)
      : name.trim() || t("common.unknown");
  return t("files.session_folder_title", { when });
}

/** Folder label in Files tree: session dirs get fixed title; experts get clean name. */
export function formatWorkspaceFolderDisplayName(
  name: string,
  mtimeMs = 0,
): string {
  if (isLikelySessionFolderName(name)) {
    return formatSessionFolderDisplayName(name, mtimeMs);
  }
  return formatExpertFolderDisplayName(name);
}

/** Outline rows for root: collapsible folders (project) + nested task/file rows. */
/**
 * Synthetic browse path for top-level loose files (not under a session/task
 * folder). Tasks/Experts root shows a drillable「未分组」folder for these.
 * Not a real workspace path — never pass to open/reveal/delete APIs.
 */
export const FILES_UNGROUPED_PATH = "__ungrouped__";

export function isFilesUngroupedPath(path: string): boolean {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") === FILES_UNGROUPED_PATH;
}

/** Build a virtual folder node holding root-level loose files. */
export function buildUngroupedFolderNode(
  looseFiles: readonly WorkspaceFileTreeNode[],
  label: string,
): WorkspaceFileTreeNode {
  const files = looseFiles.filter((n) => n.kind === "file");
  let mtimeMs = 0;
  for (const file of files) {
    if ((file.mtimeMs || 0) > mtimeMs) mtimeMs = file.mtimeMs || 0;
  }
  return {
    name: label,
    path: FILES_UNGROUPED_PATH,
    kind: "dir",
    size: 0,
    mtimeMs,
    children: files.map((file) => ({ ...file, children: [] })),
  };
}

export type OutlineRow =
  | {
      type: "project";
      node: WorkspaceFileTreeNode;
      taskCount: number;
      fileCount: number;
      expanded: boolean;
    }
  | {
      type: "task";
      node: WorkspaceFileTreeNode;
      fileCount: number;
      expanded: boolean;
      depth: number;
      /** Prefer real session title when provided. */
      displayTitle?: string;
    }
  | {
      type: "file";
      node: WorkspaceFileTreeNode;
      depth: number;
    }
  | {
      type: "loose-file";
      node: WorkspaceFileTreeNode;
    }
  | {
      /** Synthetic header for loose files not under a session (orphan bucket). */
      type: "orphan-header";
      fileCount: number;
      expanded: boolean;
    };

export type BuildOutlineOptions = {
  /**
   * Optional map of folder name or session id → full session title.
   * Applied to session-like directory nodes for display.
   */
  sessionTitleByKey?: ReadonlyMap<string, string> | Record<string, string>;
  /**
   * When true, top-level loose files are grouped under an orphan-header row
   * instead of mixed as peer “session” rows.
   */
  groupLooseAsOrphan?: boolean;
  orphanExpanded?: boolean;
};

function titleForSessionNode(
  node: WorkspaceFileTreeNode,
  titles?: BuildOutlineOptions["sessionTitleByKey"],
): string | undefined {
  if (!titles) return undefined;
  const get = (key: string): string | undefined => {
    if (titles instanceof Map) return titles.get(key);
    return (titles as Record<string, string>)[key];
  };
  return (
    get(node.name)?.trim() ||
    get(node.path)?.trim() ||
    get(node.path.replace(/\\/g, "/").split("/").pop() ?? "")?.trim() ||
    undefined
  );
}

export function buildRootOutlineRows(
  children: WorkspaceFileTreeNode[],
  expanded: ReadonlySet<string>,
  options: BuildOutlineOptions = {},
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const looseFiles: WorkspaceFileTreeNode[] = [];
  // Opt-in: Tasks/Experts browsers pass true so loose root files become an orphan bucket.
  const groupLoose = options.groupLooseAsOrphan === true;

  // Preserve caller order (name / updated / size sort) — do not force dirs first.
  for (const child of children) {
    if (child.kind === "file") {
      if (groupLoose) {
        looseFiles.push(child);
      } else {
        rows.push({ type: "loose-file", node: child });
      }
      continue;
    }

    // Session-like top-level dir (no project wrapper): treat as task/session row.
    if (isLikelySessionFolderName(child.name)) {
      const taskExpanded = expanded.has(child.path);
      const displayTitle = titleForSessionNode(child, options.sessionTitleByKey);
      rows.push({
        type: "task",
        node: child,
        fileCount: countFilesInNode(child),
        expanded: taskExpanded,
        depth: 0,
        displayTitle,
      });
      if (!taskExpanded) continue;
      for (const file of child.children.filter((c) => c.kind === "file")) {
        rows.push({ type: "file", node: file, depth: 1 });
      }
      continue;
    }

    const project = child;
    const projectExpanded = expanded.has(project.path);
    const taskCount = countDirsInNode(project);
    const fileCount = countFilesInNode(project);
    rows.push({
      type: "project",
      node: project,
      taskCount,
      fileCount,
      expanded: projectExpanded,
    });
    if (!projectExpanded) continue;

    for (const nested of project.children) {
      if (nested.kind === "file") {
        rows.push({ type: "file", node: nested, depth: 1 });
        continue;
      }
      const taskExpanded = expanded.has(nested.path);
      const displayTitle = titleForSessionNode(nested, options.sessionTitleByKey);
      rows.push({
        type: "task",
        node: nested,
        fileCount: countFilesInNode(nested),
        expanded: taskExpanded,
        depth: 1,
        displayTitle,
      });
      if (!taskExpanded) continue;
      for (const taskChild of nested.children) {
        if (taskChild.kind === "file") {
          rows.push({ type: "file", node: taskChild, depth: 2 });
          continue;
        }
        const nestedTitle = titleForSessionNode(
          taskChild,
          options.sessionTitleByKey,
        );
        rows.push({
          type: "task",
          node: taskChild,
          fileCount: countFilesInNode(taskChild),
          expanded: expanded.has(taskChild.path),
          depth: 2,
          displayTitle: nestedTitle,
        });
        if (expanded.has(taskChild.path)) {
          for (const file of taskChild.children.filter((c) => c.kind === "file")) {
            rows.push({ type: "file", node: file, depth: 3 });
          }
        }
      }
    }
  }

  if (groupLoose && looseFiles.length > 0) {
    const orphanKey = "__orphan_loose__";
    const expandedOrphan =
      options.orphanExpanded ?? expanded.has(orphanKey);
    rows.push({
      type: "orphan-header",
      fileCount: looseFiles.length,
      expanded: expandedOrphan,
    });
    if (expandedOrphan) {
      for (const file of looseFiles) {
        rows.push({ type: "loose-file", node: file });
      }
    }
  }

  return rows;
}

export function canPreviewWorkspaceFileInline(target: OpenTarget) {
  return canPreviewOpenTargetInline(target);
}

export function usesLocalFileRenderer(target: OpenTarget) {
  return (
    canEditArtifactTarget(target) ||
    target.preview === "audio" ||
    target.preview === "video"
  );
}

export function filterWorkspaceFileTree(
  node: WorkspaceFileTreeNode,
  query: string,
  typeFilter: FileCategory,
): WorkspaceFileTreeNode | null {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredChildren = node.children
    .map((child) => filterWorkspaceFileTree(child, normalizedQuery, typeFilter))
    .filter((child): child is WorkspaceFileTreeNode => child !== null);
  if (!node.path) return { ...node, children: filteredChildren };

  const matchesQuery =
    !normalizedQuery ||
    node.name.toLowerCase().includes(normalizedQuery) ||
    node.path.toLowerCase().includes(normalizedQuery);
  if (node.kind === "dir") {
    if (!matchesQuery && filteredChildren.length === 0) return null;
    return { ...node, children: filteredChildren };
  }
  if (!matchesQuery) return null;
  if (typeFilter !== "all" && getFileCategory(node.name) !== typeFilter) return null;
  return { ...node, children: [] };
}

/**
 * Flatten matching files under a directory node (all depths).
 * Used when type/search filters are active so results are not limited to one level.
 */
export function collectMatchingFilesUnder(
  node: WorkspaceFileTreeNode,
  query: string,
  typeFilter: FileCategory,
  sortKey: WorkspaceFileSortKey = "updated",
  sortDir: WorkspaceFileSortDir = "desc",
): WorkspaceFileTreeNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  const out: WorkspaceFileTreeNode[] = [];

  const walk = (current: WorkspaceFileTreeNode) => {
    if (current.kind === "file") {
      const matchesQuery =
        !normalizedQuery ||
        current.name.toLowerCase().includes(normalizedQuery) ||
        current.path.toLowerCase().includes(normalizedQuery);
      if (!matchesQuery) return;
      if (typeFilter !== "all" && getFileCategory(current.name) !== typeFilter) return;
      out.push(current);
      return;
    }
    for (const child of current.children) walk(child);
  };

  for (const child of node.children) walk(child);

  out.sort((left, right) => {
    if (sortKey === "updated") {
      const byTime = (left.mtimeMs || 0) - (right.mtimeMs || 0);
      if (byTime !== 0) return sortDir === "asc" ? byTime : -byTime;
    } else if (sortKey === "size") {
      const bySize = (left.size || 0) - (right.size || 0);
      if (bySize !== 0) return sortDir === "asc" ? bySize : -bySize;
    } else {
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) return sortDir === "asc" ? byName : -byName;
    }
    return left.path.localeCompare(right.path);
  });
  return out;
}

export function relativeDisplayPath(filePath: string, directoryPath: string): string {
  const base = directoryPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const full = filePath.replace(/\\/g, "/");
  if (!base) return full;
  if (full === base) return full;
  if (full.startsWith(`${base}/`)) return full.slice(base.length + 1);
  return full;
}

/**
 * Legacy helper for tool/session-scoped roots. The Files rail no longer uses
 * this — it always lists the OnMyAgent-selected workspace folder.
 */
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

// --- Files page three-source tabs (product draft §2 / P0) -----------------

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

/** Normalize a user-facing file name into an inbox relative path under uploads/. */
export function buildUserUploadRelativePath(fileName: string): string {
  const base = fileName.trim().replace(/\\/g, "/").split("/").pop() || "file";
  const safe = base.replace(/^\.+/, "") || "file";
  // Force product layout root (never bare workspace root).
  return resolveProductWriteRelativePath({
    source: "user_upload",
    fileName: safe,
  });
}

/**
 * On-disk inbox root under a workspace (matches server `resolveInboxDir`).
 * listInbox paths are relative to this directory.
 */
export const WORKSPACE_INBOX_DIR = ".opencode/onmyagent/inbox";

/** Workspace-relative path for read/delete APIs (from inbox-relative list path). */
export function workspaceRelativeInboxPath(inboxRelativePath: string): string {
  const rel = String(inboxRelativePath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!rel) return WORKSPACE_INBOX_DIR;
  if (rel === WORKSPACE_INBOX_DIR || rel.startsWith(`${WORKSPACE_INBOX_DIR}/`)) {
    return rel;
  }
  return `${WORKSPACE_INBOX_DIR}/${rel}`;
}

/** Absolute filesystem path for Electron reveal / Office overlay. */
export function absoluteInboxFilePath(
  workspaceRoot: string,
  inboxRelativePath: string,
): string {
  const root = String(workspaceRoot ?? "").trim().replace(/[/\\]+$/, "");
  const rel = workspaceRelativeInboxPath(inboxRelativePath);
  if (!root) return rel;
  if (/^[A-Za-z]:[\\/]/.test(root) || root.includes("\\")) {
    return `${root}\\${rel.replace(/\//g, "\\")}`;
  }
  return `${root}/${rel}`;
}

export type InboxListItemLike = {
  id: string;
  name?: string;
  path?: string;
  size?: number;
  updatedAt?: number;
};

export type UserUploadRow = {
  id: string;
  name: string;
  path: string;
  size: number;
  updatedAt: number;
  /** Directory rows from product uploads/ layout (Mine create-folder). */
  kind?: "file" | "dir";
  /**
   * Where the path is rooted:
   * - inbox: path is relative to `.opencode/onmyagent/inbox/`
   * - workspace: path is workspace-relative (e.g. `uploads/…`)
   */
  source?: "inbox" | "workspace";
};

/**
 * Resolve a Mine row to a workspace-relative path for read/download/preview APIs.
 * Inbox rows are under `.opencode/onmyagent/inbox/…`; catalog rows stay `uploads/…`.
 */
export function workspaceRelativeForUploadRow(row: {
  path: string;
  kind?: "file" | "dir";
  source?: "inbox" | "workspace";
}): string {
  const p = String(row.path ?? "")
    .trim()
    .replace(/\\/g, "/");
  if (!p) return WORKSPACE_INBOX_DIR;
  if (row.kind === "dir" || row.source === "workspace") {
    if (
      p === WORKSPACE_UPLOADS_DIR
      || p.startsWith(`${WORKSPACE_UPLOADS_DIR}/`)
      || p.startsWith(`${WORKSPACE_INBOX_DIR}/`)
    ) {
      return p;
    }
    // Catalog may return bare names under current prefix — still treat as workspace.
    return p;
  }
  // Default / inbox: relative to inbox root.
  return workspaceRelativeInboxPath(p);
}

/** True when a Mine row is OS/system junk (not user content). */
export function isMineHiddenUploadPath(path: string, name?: string): boolean {
  const p = String(path ?? "").trim().replace(/\\/g, "/");
  if (p && shouldHideEntry(p)) return true;
  const base =
    String(name ?? "").trim()
    || p.split("/").pop()
    || "";
  if (base && shouldHideEntry(base)) return true;
  return false;
}

/** Map inbox API items into stable upload rows (import-by-copy list). */
export function mapInboxItemsToUploadRows(
  items: readonly InboxListItemLike[],
): UserUploadRow[] {
  const rows: UserUploadRow[] = [];
  for (const item of items) {
    const id = item.id?.trim();
    if (!id) continue;
    const path = (item.path ?? item.name ?? id).trim();
    if (!path) continue;
    const name =
      (item.name ?? path.replace(/\\/g, "/").split("/").pop() ?? path).trim() ||
      path;
    // Hide .DS_Store / Thumbs.db / dotfiles — Mine must not surface Finder junk.
    if (isMineHiddenUploadPath(path, name)) continue;
    rows.push({
      id,
      name,
      path,
      size: typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0,
      updatedAt:
        typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
          ? item.updatedAt
          : 0,
      kind: "file",
      source: "inbox",
    });
  }
  rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || a.name.localeCompare(b.name));
  return rows;
}

export type UploadsCatalogEntryLike = {
  path?: string;
  name?: string;
  kind?: string;
  size?: number;
  mtimeMs?: number;
  updatedAt?: number;
};

/**
 * Map workspace catalog entries under uploads/ into Mine rows (files + dirs).
 * Scoped to `parentPrefix` only (never rewrites sibling paths into the current
 * folder). When `shallow` is true (default), only direct children of the parent
 * are kept; when false, all descendants under the parent are kept.
 */
export function mapUploadsCatalogToRows(
  items: readonly UploadsCatalogEntryLike[],
  options?: { parentPrefix?: string; shallow?: boolean },
): UserUploadRow[] {
  const parent = String(options?.parentPrefix ?? WORKSPACE_UPLOADS_DIR)
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "") || WORKSPACE_UPLOADS_DIR;
  const shallow = options?.shallow !== false;
  const rows: UserUploadRow[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const rawPath = String(item.path ?? "").trim().replace(/\\/g, "/");
    if (!rawPath) continue;
    // Strictly under the current folder — never fall back to uploads/ root
    // siblings (that used to reappear inside every nested folder).
    if (rawPath === parent) continue;
    if (!rawPath.startsWith(`${parent}/`)) continue;

    const rest = rawPath.slice(parent.length + 1);
    if (!rest) continue;
    if (shallow && rest.includes("/")) continue;

    const rel = rawPath;
    if (seen.has(rel)) continue;
    const kind: "file" | "dir" =
      item.kind === "dir" || item.kind === "directory" ? "dir" : "file";
    const name =
      (item.name ?? rel.split("/").pop() ?? rel).trim() || rel;
    if (isMineHiddenUploadPath(rel, name)) continue;
    seen.add(rel);
    const updatedAt =
      typeof item.mtimeMs === "number" && Number.isFinite(item.mtimeMs)
        ? item.mtimeMs
        : typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
          ? item.updatedAt
          : 0;
    rows.push({
      id: `uploads:${rel}`,
      name,
      path: rel,
      size:
        kind === "dir"
          ? 0
          : typeof item.size === "number" && Number.isFinite(item.size)
            ? item.size
            : 0,
      updatedAt,
      kind,
      source: "workspace",
    });
  }

  // Dirs first, then mtime desc.
  rows.sort((a, b) => {
    const ka = a.kind === "dir" ? 0 : 1;
    const kb = b.kind === "dir" ? 0 : 1;
    if (ka !== kb) return ka - kb;
    return (b.updatedAt || 0) - (a.updatedAt || 0) || a.name.localeCompare(b.name);
  });
  return rows;
}

/** Merge inbox files with product uploads/ catalog; prefer catalog for same path. */
export function mergeMineUploadRows(
  inboxRows: readonly UserUploadRow[],
  catalogRows: readonly UserUploadRow[],
): UserUploadRow[] {
  const byPath = new Map<string, UserUploadRow>();
  for (const row of inboxRows) {
    if (isMineHiddenUploadPath(row.path, row.name)) continue;
    const key = row.path.replace(/\\/g, "/");
    byPath.set(key, {
      ...row,
      kind: row.kind ?? "file",
      source: row.source ?? "inbox",
    });
  }
  for (const row of catalogRows) {
    if (isMineHiddenUploadPath(row.path, row.name)) continue;
    const key = row.path.replace(/\\/g, "/");
    // Prefer workspace catalog when both list the same relative name.
    byPath.set(key, { ...row, source: row.source ?? "workspace" });
  }
  return Array.from(byPath.values()).sort((a, b) => {
    const ka = a.kind === "dir" ? 0 : 1;
    const kb = b.kind === "dir" ? 0 : 1;
    if (ka !== kb) return ka - kb;
    return (b.updatedAt || 0) - (a.updatedAt || 0) || a.name.localeCompare(b.name);
  });
}

export function filterUploadRows(
  rows: readonly UserUploadRow[],
  query: string,
  typeFilter: FileCategory = "all",
): UserUploadRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (row.kind === "dir") {
      // Folders ignore type chips other than "all".
      if (typeFilter !== "all") return false;
    } else if (typeFilter !== "all" && getFileCategory(row.name) !== typeFilter) {
      return false;
    }
    if (!q) return true;
    return (
      row.name.toLowerCase().includes(q) || row.path.toLowerCase().includes(q)
    );
  });
}
