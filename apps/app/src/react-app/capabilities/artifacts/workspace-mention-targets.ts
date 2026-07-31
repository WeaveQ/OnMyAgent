import type { OnMyAgentWorkspaceFileCatalogEntry } from "../../../app/lib/onmyagent-server";
import type { ComposerMentionTarget } from "../../../app/types";
import { t } from "../../../i18n";
import {
  WORKSPACE_EXPERTS_DIR,
  WORKSPACE_PROJECTS_DIR,
  WORKSPACE_TASKS_DIR,
  WORKSPACE_UPLOADS_DIR,
  isWorkspaceLayoutTopDir,
  isWorkspaceSystemTopDir,
} from "../../domains/workspace/workspace-files-layout";
import {
  formatExpertFolderDisplayName,
  formatSessionFolderDisplayName,
  formatWorkspaceFolderDisplayName,
  isLikelySessionFolderName,
} from "../../domains/workspace/workspace-files-model";
import { shouldHideEntry } from "./workspace-file-tree";

/** Root-level files that are never useful as conversation mentions. */
const SYSTEM_ROOT_FILES = new Set([
  "registry.json",
  "opencode.jsonc",
  "opencode.json",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "readme.md",
  "readme-zh.md",
  ".ds_store",
]);

function basename(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function matchesQuery(path: string, query: string) {
  const normalizedPath = path.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  return (
    normalizedPath.includes(normalizedQuery) ||
    basename(normalizedPath).includes(normalizedQuery)
  );
}

function isMentionHiddenPath(path: string): boolean {
  if (shouldHideEntry(path)) return true;
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return true;
  const top = parts[0].toLowerCase();
  if (SYSTEM_ROOT_FILES.has(top) && parts.length === 1) return true;
  // Hide non-layout system roots; layout roots (uploads/tasks/experts/projects) stay.
  if (isWorkspaceSystemTopDir(parts[0]) && !isWorkspaceLayoutTopDir(parts[0])) {
    return true;
  }
  return false;
}

function segmentDisplayName(segment: string): string {
  if (isLikelySessionFolderName(segment)) {
    return formatSessionFolderDisplayName(segment);
  }
  return formatWorkspaceFolderDisplayName(segment);
}

/** Folder browser header for @ mention drill-in. */
export function resolveMentionFolderTitle(folderPath: string): string {
  if (folderPath === WORKSPACE_UPLOADS_DIR) return t("files.source_uploads");
  if (
    folderPath === WORKSPACE_TASKS_DIR ||
    folderPath === WORKSPACE_PROJECTS_DIR
  ) {
    return t("files.source_task");
  }
  if (folderPath === WORKSPACE_EXPERTS_DIR) return t("files.source_expert");
  const segment = folderPath.split("/").filter(Boolean).at(-1) ?? folderPath;
  return formatWorkspaceFolderDisplayName(segment);
}

/** Human subtitle trail: source tab label / expert / session. */
export function formatMentionPathSubtitle(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return "";

  const top = parts[0].toLowerCase();
  const rest = parts.slice(1);

  let sourceLabel = "";
  if (top === WORKSPACE_UPLOADS_DIR) {
    sourceLabel = t("files.source_uploads");
  } else if (top === WORKSPACE_TASKS_DIR || top === WORKSPACE_PROJECTS_DIR) {
    sourceLabel = t("files.source_task");
  } else if (top === WORKSPACE_EXPERTS_DIR) {
    sourceLabel = t("files.source_expert");
  } else {
    return parts.map(segmentDisplayName).join(" / ");
  }

  const trail = rest.map((part, index) => {
    if (top === WORKSPACE_EXPERTS_DIR && index === 0) {
      return formatExpertFolderDisplayName(part);
    }
    return segmentDisplayName(part);
  });

  // File rows: drop the filename from subtitle (shown as main label).
  // Directory rows: keep full trail under the source.
  return [sourceLabel, ...trail].filter(Boolean).join(" / ");
}

function mentionLabelForEntry(
  entry: OnMyAgentWorkspaceFileCatalogEntry,
): string {
  const name = basename(entry.path);
  if (entry.kind === "dir") {
    return formatWorkspaceFolderDisplayName(name, entry.mtimeMs);
  }
  return name;
}

function toTarget(
  entry: OnMyAgentWorkspaceFileCatalogEntry,
): ComposerMentionTarget {
  const kind = entry.kind === "dir" ? "directory" : "file";
  const label = mentionLabelForEntry(entry);
  const subtitle =
    kind === "directory"
      ? t("composer.folder_kind")
      : formatMentionPathSubtitle(entry.path);
  // For files, subtitle is source path without repeating the file name.
  const fileSubtitle =
    kind === "file"
      ? (() => {
          const parts = entry.path.replace(/\\/g, "/").split("/").filter(Boolean);
          if (parts.length <= 1) return t("composer.file_kind");
          return formatMentionPathSubtitle(parts.slice(0, -1).join("/")) ||
            t("composer.file_kind");
        })()
      : subtitle;

  return {
    path: entry.path,
    kind,
    label,
    subtitle: kind === "file" ? fileSubtitle : t("composer.folder_kind"),
  };
}

/** Empty @ query: product three-source roots only (no raw disk dump). */
export function workspaceMentionRootTargets(): ComposerMentionTarget[] {
  return [
    {
      path: WORKSPACE_UPLOADS_DIR,
      kind: "directory",
      label: t("files.source_uploads"),
      subtitle: t("composer.folder_kind"),
    },
    {
      path: WORKSPACE_TASKS_DIR,
      kind: "directory",
      label: t("files.source_task"),
      subtitle: t("composer.folder_kind"),
    },
    {
      path: WORKSPACE_EXPERTS_DIR,
      kind: "directory",
      label: t("files.source_expert"),
      subtitle: t("composer.folder_kind"),
    },
  ];
}

export function workspaceMentionTargets(
  entries: OnMyAgentWorkspaceFileCatalogEntry[],
  query: string,
): ComposerMentionTarget[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return workspaceMentionRootTargets();
  }

  const rootLabels = workspaceMentionRootTargets();
  const rootHits = rootLabels.filter(
    (item) =>
      matchesQuery(item.path, trimmed) ||
      matchesQuery(item.label ?? "", trimmed),
  );

  const fileHits = entries
    .filter((entry) => !isMentionHiddenPath(entry.path))
    .filter((entry) => {
      const label = mentionLabelForEntry(entry);
      const subtitle = formatMentionPathSubtitle(entry.path);
      return (
        matchesQuery(entry.path, trimmed) ||
        matchesQuery(label, trimmed) ||
        matchesQuery(subtitle, trimmed)
      );
    })
    .map(toTarget)
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return (left.label ?? left.path).localeCompare(right.label ?? right.path);
    })
    .slice(0, 50);

  // Prefer source roots first when they match, then concrete hits.
  const seen = new Set(rootHits.map((item) => item.path));
  const merged = [...rootHits];
  for (const hit of fileHits) {
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    merged.push(hit);
  }
  return merged.slice(0, 50);
}

export function workspaceDirectoryTargets(
  entries: OnMyAgentWorkspaceFileCatalogEntry[],
): ComposerMentionTarget[] {
  return entries
    .filter((entry) => !isMentionHiddenPath(entry.path))
    .map(toTarget)
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return (left.label ?? left.path).localeCompare(right.label ?? right.path);
    });
}

/**
 * When browsing the Task source root, also surface projects/ children
 * (same product bucket as Files → 任务文件).
 */
export function mergeTaskSourceDirectoryTargets(
  taskTargets: ComposerMentionTarget[],
  projectTargets: ComposerMentionTarget[],
): ComposerMentionTarget[] {
  const seen = new Set(taskTargets.map((item) => item.path));
  const merged = [...taskTargets];
  for (const item of projectTargets) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    merged.push(item);
  }
  return merged.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return (left.label ?? left.path).localeCompare(right.label ?? right.path);
  });
}

export {
  WORKSPACE_EXPERTS_DIR,
  WORKSPACE_PROJECTS_DIR,
  WORKSPACE_TASKS_DIR,
  WORKSPACE_UPLOADS_DIR,
};
