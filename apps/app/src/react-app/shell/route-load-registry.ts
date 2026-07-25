/**
 * Unified route/page load registry.
 *
 * Problem this solves: desktop boot (BootState), session/settings `loading`
 * flags, React.lazy Suspense fallbacks, and per-feature skeletons each owned
 * their own spinner + copy ("Starting OnMyAgent…"). Users saw stacked full-
 * screen overlays and wrong messages when opening Settings mid-session.
 *
 * This registry is the single place routes report "I am loading X". Visual
 * surfaces (boot overlay, suspense fallbacks, page chrome) read it.
 *
 * Scopes are nested by count (same id can begin twice). Priority is the
 * highest among active scopes; messages come from the top priority scope.
 */

export type LoadSurfaceKind = "boot" | "route" | "page" | "inline";

export type LoadScopeId =
  | "desktop-boot"
  | "route-session"
  | "route-settings"
  | "route-welcome"
  | "chunk-settings"
  | "chunk-welcome"
  | "settings-tab"
  | "settings-ai-providers"
  | "session-refresh"
  | "session-workspace";

export type LoadScopeDefinition = {
  id: LoadScopeId;
  /** Higher wins when multiple scopes are active. */
  priority: number;
  kind: LoadSurfaceKind;
  /** i18n key preferred; fall back to defaultMessage. */
  messageKey?: string;
  defaultMessage: string;
};

const SCOPE_DEFS: Record<LoadScopeId, LoadScopeDefinition> = {
  "desktop-boot": {
    id: "desktop-boot",
    priority: 100,
    kind: "boot",
    messageKey: "system.boot_preparing_workspace",
    defaultMessage: "Starting OnMyAgent…",
  },
  "route-session": {
    id: "route-session",
    priority: 80,
    kind: "route",
    messageKey: "system.load_session_route",
    defaultMessage: "Loading workspace…",
  },
  "route-settings": {
    id: "route-settings",
    priority: 80,
    kind: "route",
    messageKey: "system.load_settings_route",
    defaultMessage: "Loading settings…",
  },
  "route-welcome": {
    id: "route-welcome",
    priority: 80,
    kind: "route",
    messageKey: "system.load_welcome_route",
    defaultMessage: "Preparing onboarding…",
  },
  "chunk-settings": {
    id: "chunk-settings",
    priority: 70,
    kind: "route",
    messageKey: "system.load_settings_chunk",
    defaultMessage: "Opening settings…",
  },
  "chunk-welcome": {
    id: "chunk-welcome",
    priority: 70,
    kind: "route",
    messageKey: "system.load_welcome_chunk",
    defaultMessage: "Opening onboarding…",
  },
  "settings-tab": {
    id: "settings-tab",
    priority: 40,
    kind: "page",
    messageKey: "system.load_settings_tab",
    defaultMessage: "Loading page…",
  },
  "settings-ai-providers": {
    id: "settings-ai-providers",
    priority: 35,
    kind: "inline",
    messageKey: "system.load_settings_ai",
    defaultMessage: "Loading providers…",
  },
  "session-refresh": {
    id: "session-refresh",
    priority: 50,
    kind: "page",
    messageKey: "system.load_session_refresh",
    defaultMessage: "Refreshing workspace…",
  },
  "session-workspace": {
    id: "session-workspace",
    priority: 45,
    kind: "page",
    messageKey: "system.load_session_workspace",
    defaultMessage: "Switching workspace…",
  },
};

type ActiveEntry = { id: LoadScopeId; count: number; detail: string | null };

type RegistrySnapshot = {
  active: ActiveEntry[];
  top: LoadScopeDefinition | null;
  topDetail: string | null;
  busy: boolean;
};

const listeners = new Set<() => void>();
const activeMap = new Map<LoadScopeId, ActiveEntry>();

function rebuildSnapshot(): RegistrySnapshot {
  const active = [...activeMap.values()].filter((e) => e.count > 0);
  active.sort(
    (a, b) => SCOPE_DEFS[b.id].priority - SCOPE_DEFS[a.id].priority,
  );
  const topEntry = active[0] ?? null;
  return {
    active,
    top: topEntry ? SCOPE_DEFS[topEntry.id] : null,
    topDetail: topEntry?.detail ?? null,
    busy: active.length > 0,
  };
}

let snapshot: RegistrySnapshot = rebuildSnapshot();

function emit() {
  snapshot = rebuildSnapshot();
  for (const listener of listeners) listener();
}

export function getLoadScopeDefinition(id: LoadScopeId): LoadScopeDefinition {
  return SCOPE_DEFS[id];
}

export function beginLoadScope(
  id: LoadScopeId,
  detail?: string | null,
): () => void {
  const current = activeMap.get(id);
  activeMap.set(id, {
    id,
    count: (current?.count ?? 0) + 1,
    detail: detail ?? current?.detail ?? null,
  });
  emit();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    endLoadScope(id);
  };
}

export function endLoadScope(id: LoadScopeId): void {
  const current = activeMap.get(id);
  if (!current) return;
  const next = current.count - 1;
  if (next <= 0) activeMap.delete(id);
  else activeMap.set(id, { ...current, count: next });
  emit();
}

export function setLoadScopeDetail(
  id: LoadScopeId,
  detail: string | null,
): void {
  const current = activeMap.get(id);
  if (!current) return;
  activeMap.set(id, { ...current, detail });
  emit();
}

export function getRouteLoadSnapshot(): RegistrySnapshot {
  return snapshot;
}

export function subscribeRouteLoad(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper. */
export function resetRouteLoadRegistryForTests(): void {
  activeMap.clear();
  emit();
}

export function listLoadScopeIds(): LoadScopeId[] {
  return Object.keys(SCOPE_DEFS) as LoadScopeId[];
}
