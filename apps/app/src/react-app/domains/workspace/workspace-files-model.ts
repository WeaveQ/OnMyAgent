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
import type {
  WorkspaceFileSortDir,
  WorkspaceFileSortKey,
  WorkspaceFileTreeNode,
} from "../../capabilities/artifacts/workspace-file-tree";

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

/** Outline rows for root: collapsible folders (project) + nested task/file rows. */
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
    }
  | {
      type: "file";
      node: WorkspaceFileTreeNode;
      depth: number;
    }
  | {
      type: "loose-file";
      node: WorkspaceFileTreeNode;
    };

export function buildRootOutlineRows(
  children: WorkspaceFileTreeNode[],
  expanded: ReadonlySet<string>,
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  // Preserve caller order (name / updated / size sort) — do not force dirs first.
  for (const child of children) {
    if (child.kind === "file") {
      rows.push({ type: "loose-file", node: child });
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
      rows.push({
        type: "task",
        node: nested,
        fileCount: countFilesInNode(nested),
        expanded: taskExpanded,
        depth: 1,
      });
      if (!taskExpanded) continue;
      for (const taskChild of nested.children) {
        if (taskChild.kind === "file") {
          rows.push({ type: "file", node: taskChild, depth: 2 });
          continue;
        }
        rows.push({
          type: "task",
          node: taskChild,
          fileCount: countFilesInNode(taskChild),
          expanded: expanded.has(taskChild.path),
          depth: 2,
        });
        if (expanded.has(taskChild.path)) {
          for (const file of taskChild.children.filter((c) => c.kind === "file")) {
            rows.push({ type: "file", node: file, depth: 3 });
          }
        }
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

/** Provenance tabs on the primary-rail Files page. */
export type FilesSourceTab = "uploads" | "task" | "expert";

/** Default tab when opening Files (product: task files). */
export const DEFAULT_FILES_SOURCE_TAB: FilesSourceTab = "task";

export const FILES_SOURCE_TABS: readonly FilesSourceTab[] = [
  "uploads",
  "task",
  "expert",
] as const;

/**
 * Relative workspace directory for user import-by-copy (inbox upload path prefix).
 * Server inbox stores under this logical area; UI lists via listInbox.
 */
export const USER_UPLOADS_RELATIVE_DIR = "uploads";

/**
 * uploads: inbox API; task/expert: workspace browser with path heuristics until P1 tags.
 */
export function isFilesSourceListReady(tab: FilesSourceTab): boolean {
  return tab === "uploads" || tab === "task" || tab === "expert";
}

/** Pure package slug with 3+ segments: fleet-management-specialist (avoids home-notes). */
const EXPERT_PACKAGE_SLUG_LONG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+){2,}$/;

const RESERVED_NON_EXPERT_TOP_DIRS = new Set([
  "uploads",
  "inbox",
  "tmp",
  "temp",
  ".onmyagent",
  ".opencode",
]);

/**
 * Heuristic: top-level folder is an expert agent archive (not a Home temp task).
 * Optional knownPackageSlugs strengthens matching (packageName from marketplace).
 *
 * Matches:
 * - pure slug (known or 3+ kebab parts): fleet-management-specialist
 * - DisplayName-slug with non-ASCII prefix: 财报研究员-earnings-reviewer
 */
export function isLikelyExpertAgentFolderName(
  name: string,
  knownPackageSlugs: readonly string[] = [],
): boolean {
  const n = name.trim();
  if (!n || RESERVED_NON_EXPERT_TOP_DIRS.has(n.toLowerCase())) return false;
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
  if (!m) return false;
  const prefix = m[1];
  const slug = m[2];
  if (knownPackageSlugs.some((s) => s.trim().toLowerCase() === slug)) return true;
  // Non-ASCII display name is a strong expert signal (screenshot folders)
  if (/[^\u0000-\u007f]/.test(prefix)) return true;
  // Long slug after any prefix
  if (slug.split("-").length >= 3) return true;
  return false;
}

/**
 * Filter a workspace root tree for Task vs Expert tabs.
 * Only top-level children are classified; nested structure is preserved.
 */
export function filterWorkspaceTreeBySourceTab(
  root: WorkspaceFileTreeNode,
  tab: "task" | "expert",
  knownPackageSlugs: readonly string[] = [],
): WorkspaceFileTreeNode {
  const children = root.children.filter((child) => {
    if (child.kind === "file") {
      // Loose root files: show under task only (not expert archives).
      return tab === "task";
    }
    const isExpert = isLikelyExpertAgentFolderName(child.name, knownPackageSlugs);
    if (tab === "expert") return isExpert;
    // task: exclude expert agent folders and reserved upload dirs
    if (isExpert) return false;
    if (RESERVED_NON_EXPERT_TOP_DIRS.has(child.name.trim().toLowerCase())) {
      return false;
    }
    return true;
  });
  return { ...root, children };
}

export function filesSourceTabLabelKey(tab: FilesSourceTab): string {
  switch (tab) {
    case "uploads":
      return "files.source_uploads";
    case "task":
      return "files.source_task";
    case "expert":
      return "files.source_expert";
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
  return `${USER_UPLOADS_RELATIVE_DIR}/${safe}`;
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
};

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
    rows.push({
      id,
      name,
      path,
      size: typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0,
      updatedAt:
        typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
          ? item.updatedAt
          : 0,
    });
  }
  rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || a.name.localeCompare(b.name));
  return rows;
}

export function filterUploadRows(
  rows: readonly UserUploadRow[],
  query: string,
): UserUploadRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(q) || row.path.toLowerCase().includes(q),
  );
}
