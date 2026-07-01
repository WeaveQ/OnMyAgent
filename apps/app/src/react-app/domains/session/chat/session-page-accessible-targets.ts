import {
  isCollectibleArtifactTarget,
  isLocalhostBrowserTarget,
  type OpenTarget,
} from "../artifacts/open-target";

export function isTrackableAccessibleTarget(target: OpenTarget) {
  return (
    isCollectibleArtifactTarget(target) || isLocalhostBrowserTarget(target)
  );
}

export function hiddenAccessibleTargetsStorageKey(
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  if (!workspaceId || !sessionId) return null;
  return `onmyagent.session.hiddenAccessibleTargets.v1:${workspaceId}:${sessionId}`;
}

export function readHiddenAccessibleTargetIds(
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
): Set<string> {
  const key = hiddenAccessibleTargetsStorageKey(workspaceId, sessionId);
  if (!key || typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      ),
    );
  } catch {
    return new Set();
  }
}

export function writeHiddenAccessibleTargetIds(
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
  ids: Set<string>,
) {
  const key = hiddenAccessibleTargetsStorageKey(workspaceId, sessionId);
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch {
    return;
  }
}
