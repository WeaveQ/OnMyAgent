// Recent workspace roots used by local-agent conversations. Modeled after
// Upstream's `packages/desktop/src/renderer/components/workspace/recentWorkspaces.ts`:
// pure browser-side storage, LRU ordered, small cap.
//
// Values are absolute filesystem paths. An empty override means "temporary
// conversation" (no project) and is not stored here.

export const RECENT_WORKSPACES_KEY = "onmyagent.local-agent.recent-workspaces";
export const WORKSPACE_OVERRIDE_KEY = "onmyagent.local-agent.workspace-override";
const MAX_RECENT_WORKSPACES = 12;

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getRecentWorkspaces(storageKey: string = RECENT_WORKSPACES_KEY): string[] {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      const trimmed = entry.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= MAX_RECENT_WORKSPACES) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function addRecentWorkspace(path: string, storageKey: string = RECENT_WORKSPACES_KEY): string[] {
  const trimmed = path.trim();
  if (!trimmed) return getRecentWorkspaces(storageKey);
  const storage = safeStorage();
  const prev = getRecentWorkspaces(storageKey);
  const next = [trimmed, ...prev.filter((item) => item !== trimmed)].slice(0, MAX_RECENT_WORKSPACES);
  if (storage) {
    try {
      storage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // storage may be full or blocked; recent list is best-effort
    }
  }
  return next;
}

export function removeRecentWorkspace(path: string, storageKey: string = RECENT_WORKSPACES_KEY): string[] {
  const trimmed = path.trim();
  if (!trimmed) return getRecentWorkspaces(storageKey);
  const storage = safeStorage();
  const prev = getRecentWorkspaces(storageKey);
  const next = prev.filter((item) => item !== trimmed);
  if (storage) {
    try {
      storage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return next;
}

export function readWorkspaceOverride(storageKey: string = WORKSPACE_OVERRIDE_KEY): string {
  const storage = safeStorage();
  if (!storage) return "";
  try {
    const raw = storage.getItem(storageKey);
    return typeof raw === "string" ? raw.trim() : "";
  } catch {
    return "";
  }
}

export function writeWorkspaceOverride(path: string, storageKey: string = WORKSPACE_OVERRIDE_KEY): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const trimmed = path.trim();
    if (trimmed) storage.setItem(storageKey, trimmed);
    else storage.removeItem(storageKey);
  } catch {
    // ignore
  }
}

export function workspaceDisplayName(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  const segments = trimmed.split(/[\\/]/).filter(Boolean);
  const last = segments[segments.length - 1];
  return last ?? trimmed;
}
