/**
 * Tree outline / ungrouped bucket / file-tree filters for the Files rail.
 */
import {
  canEditArtifactTarget,
} from "../../capabilities/artifacts/open-artifact-for-editing";
import {
  canPreviewOpenTargetInline,
  type OpenTarget,
} from "../../capabilities/artifacts/open-target";
import {
  compareWorkspaceFileNodes,
  formatWorkspaceFileTime,
  type WorkspaceFileSortDir,
  type WorkspaceFileSortKey,
  type WorkspaceFileTreeNode,
} from "../../capabilities/artifacts/workspace-file-tree";
import { t } from "../../../i18n";
import { getFileCategory, type FileCategory } from "./workspace-files-categories";

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
export function formatExpertRuntimeTreeNames(root: WorkspaceFileTreeNode): WorkspaceFileTreeNode {
  return { ...root, children: root.children.map((a) => ({ ...a, name: formatExpertFolderDisplayName(a.name), children: a.children.map((s) => ({ ...s, name: formatExpertSessionKeyDisplay(s.name) })) })) };
}
export function formatExpertSessionKeyDisplay(name: string): string {
  if (!/^\d{10,16}$/.test(name)) return name;
  const d = new Date(Number(name)), p = (n: number) => String(n).padStart(2, "0");
  return Number.isNaN(+d) ? name : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
 * folder). Tasks/Experts root shows a drillable ungrouped folder for these.
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

/** Flattened tree rows with depth for expand/collapse outline (Tasks/Experts). */
export type TreeOutlineRow =
  | {
      type: "dir";
      node: WorkspaceFileTreeNode;
      depth: number;
      expanded: boolean;
      fileCount: number;
      /** Prefer real session title when provided. */
      displayTitle?: string;
    }
  | {
      type: "file";
      node: WorkspaceFileTreeNode;
      depth: number;
    };

export type BuildOutlineOptions = {
  /**
   * Optional map of folder name or session id → full session title.
   * Applied to session-like directory nodes for display.
   */
  sessionTitleByKey?: ReadonlyMap<string, string> | Record<string, string>;
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

/**
 * Build hierarchical outline rows under `roots` (preserves order).
 * Only expanded directories reveal children — keeps parent/child depth.
 */
export function buildTreeOutlineRows(
  roots: readonly WorkspaceFileTreeNode[],
  expanded: ReadonlySet<string>,
  options: BuildOutlineOptions = {},
): TreeOutlineRow[] {
  const rows: TreeOutlineRow[] = [];
  const walk = (nodes: readonly WorkspaceFileTreeNode[], depth: number) => {
    for (const node of nodes) {
      if (node.kind === "file") {
        rows.push({ type: "file", node, depth });
        continue;
      }
      const isExpanded = expanded.has(node.path);
      const displayTitle = titleForSessionNode(node, options.sessionTitleByKey);
      rows.push({
        type: "dir",
        node,
        depth,
        expanded: isExpanded,
        fileCount: countFilesInNode(node),
        displayTitle,
      });
      if (isExpanded) walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);
  return rows;
}

/** Every directory path under roots that has children (expandable). */
export function collectExpandableDirPaths(
  roots: readonly WorkspaceFileTreeNode[],
): string[] {
  const paths: string[] = [];
  const walk = (nodes: readonly WorkspaceFileTreeNode[]) => {
    for (const node of nodes) {
      if (node.kind !== "dir") continue;
      if (node.children.length > 0) paths.push(node.path);
      walk(node.children);
    }
  };
  walk(roots);
  return paths;
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
  sortKey: WorkspaceFileSortKey = "type",
  sortDir: WorkspaceFileSortDir = "asc",
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
    const byCompare = compareWorkspaceFileNodes(left, right, sortKey, sortDir);
    if (byCompare !== 0) return byCompare;
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
