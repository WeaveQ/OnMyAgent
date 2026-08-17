import { isIsolatedExpertSessionDirectory } from "../session-identity/expert-session-directory";
import { classifyOpenTarget, isLikelyUserUploadArtifactPath, type OpenTarget } from "./open-target";
import { shouldHideEntry } from "./workspace-file-tree";

/** Clock slack when comparing file mtime to the turn start. */
export const TURN_MTIME_SLACK_MS = 2_000;

function basenameOf(path: string): string {
  const normalized = path.replace(/[\\]+/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function normalizePathKey(path: string): string {
  return path.replace(/[\\]+/g, "/").replace(/^\.\//, "").trim();
}

/** Tmp / cache / OS plumbing — never a user-facing result. */
export function isProcessArtifactPath(path: string): boolean {
  const normalized = normalizePathKey(path);
  if (!normalized) return true;
  if (
    /(^|\/)(?:\.opencode\/tmp|tmp|temp|temps|cache|node_modules)(\/|$)/i.test(normalized)
    || /^(?:\/|[a-z]:\/)(?:tmp|var\/folders|private|system|library|usr)(?:\/|$)/i.test(normalized)
  ) {
    return true;
  }
  return false;
}

/**
 * Hidden / marker files. Allow `.onmyagent` as a workspace-root segment so
 * absolute paths under the app data dir are not dropped.
 */
export function isHiddenResultPath(path: string): boolean {
  const parts = normalizePathKey(path).split("/").filter(Boolean);
  if (parts.length === 0) return true;
  return parts.some((part) => part !== ".onmyagent" && shouldHideEntry(part));
}

/** Result file: any extension, but not uploads, hidden files, or process junk. */
export function isEligibleSessionResultPath(path: string): boolean {
  const normalized = normalizePathKey(path);
  if (!normalized || !normalized.includes(".")) return false;
  if (isLikelyUserUploadArtifactPath(normalized)) return false;
  if (isHiddenResultPath(normalized)) return false;
  if (isProcessArtifactPath(normalized)) return false;
  return true;
}

/** Shared workspace/space folders leak other sessions — only scan isolated dirs. */
export function shouldScanSessionInventoryRoot(sessionRoot: string): boolean {
  return isIsolatedExpertSessionDirectory(sessionRoot);
}

/** Last path segment of a session cwd (expert sessionKey or folder name). */
export function sessionDirectoryKey(sessionRoot: string): string {
  const parts = sessionRoot.replace(/[\\]+/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/**
 * Expert catalog paths are `<agent>/<sessionKey>/<rel>`.
 * Artifact resolve uses the session cwd, so strip down to `<rel>`.
 */
export function sessionRelativeExpertInventoryPath(
  catalogPath: string,
  sessionKey: string,
): string | null {
  const key = sessionKey.trim();
  if (!key) return null;
  const parts = catalogPath.replace(/[\\]+/g, "/").split("/").filter(Boolean);
  const index = parts.indexOf(key);
  if (index < 0 || index >= parts.length - 1) return null;
  return parts.slice(index + 1).join("/");
}

export function normalizeEpochMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e12 ? value * 1000 : value;
}

/** True when the file's mtime falls inside this transcript turn. */
export function wasWrittenDuringTurn(
  updatedAt: number | undefined,
  turnStartedAt: number | null | undefined,
): boolean {
  const updated = normalizeEpochMs(updatedAt);
  const started = normalizeEpochMs(turnStartedAt ?? null);
  if (updated == null || started == null) return false;
  return updated >= started - TURN_MTIME_SLACK_MS;
}

export function openTargetFromInventoryPath(
  path: string,
  extras: { size?: number; updatedAt?: number } = {},
): OpenTarget | null {
  const normalized = normalizePathKey(path);
  if (!isEligibleSessionResultPath(normalized)) return null;
  return {
    id: `file:${normalized.toLowerCase()}`,
    kind: "file",
    value: normalized,
    name: basenameOf(normalized),
    preview: classifyOpenTarget(normalized, "file"),
    confidence: 88,
    reason: "session inventory",
    exists: true,
    size: extras.size,
    updatedAt: extras.updatedAt,
  };
}

export type InventoryListItem = {
  path: string;
  kind?: string;
  size?: number;
  mtimeMs?: number;
};

export function inventoryListedFilesToOpenTargets(
  listed: readonly InventoryListItem[],
): OpenTarget[] {
  const targets: OpenTarget[] = [];
  const seen = new Set<string>();
  for (const item of listed) {
    if (item.kind === "dir") continue;
    const target = openTargetFromInventoryPath(item.path, {
      size: item.size,
      updatedAt: item.mtimeMs,
    });
    if (!target || seen.has(target.id)) continue;
    seen.add(target.id);
    targets.push(target);
  }
  return targets;
}

export function mergeOpenTargetsWithInventory(
  openTargets: OpenTarget[],
  inventoryTargets: OpenTarget[],
): OpenTarget[] {
  const map = new Map(openTargets.map((target) => [target.id, target]));
  for (const target of inventoryTargets) {
    const existing = map.get(target.id);
    if (!existing) {
      map.set(target.id, target);
      continue;
    }
    map.set(target.id, {
      ...existing,
      exists: existing.exists === true || target.exists === true,
      size: existing.size ?? target.size,
      updatedAt: existing.updatedAt ?? target.updatedAt,
      confidence: Math.max(existing.confidence, target.confidence),
    });
  }
  return Array.from(map.values());
}
