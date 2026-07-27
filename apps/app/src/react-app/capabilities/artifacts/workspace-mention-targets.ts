import type { OnMyAgentWorkspaceFileCatalogEntry } from "../../../app/lib/onmyagent-server";
import type { ComposerMentionTarget } from "../../../app/types";
import { shouldHideEntry } from "./workspace-file-tree";

function basename(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function matchesQuery(path: string, query: string) {
  const normalizedPath = path.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  return normalizedPath.includes(normalizedQuery)
    || basename(normalizedPath).includes(normalizedQuery);
}

export function workspaceMentionTargets(
  entries: OnMyAgentWorkspaceFileCatalogEntry[],
  query: string,
): ComposerMentionTarget[] {
  const trimmed = query.trim();
  return entries
    .filter((entry) => !shouldHideEntry(entry.path))
    .filter((entry) => trimmed ? matchesQuery(entry.path, trimmed) : !entry.path.includes("/"))
    .map((entry): ComposerMentionTarget => ({
      path: entry.path,
      kind: entry.kind === "dir" ? "directory" : "file",
    }))
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return left.path.localeCompare(right.path);
    })
    .slice(0, 50);
}
