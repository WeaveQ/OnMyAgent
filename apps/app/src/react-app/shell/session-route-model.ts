import type { LocalUser } from "../../app/lib/local-auth";
import type { OnMyAgentWorkspaceInfo } from "../../app/lib/onmyagent-server";
import type { WorkspaceInfo } from "../../app/lib/desktop";
import type {
  SidebarSessionItem,
  WorkspaceDisplay,
  WorkspaceSessionGroup,
} from "../../app/types";
import { normalizeDirectoryPath, safeStringify } from "../../app/utils";
import { t } from "../../i18n";

export type RouteWorkspace = OnMyAgentWorkspaceInfo & {
  displayNameResolved: string;
};

export function mapDesktopWorkspace(workspace: WorkspaceInfo): RouteWorkspace {
  return {
    ...workspace,
    displayNameResolved:
      workspace.displayName?.trim() ||
      workspace.name?.trim() ||
      workspace.path?.trim() ||
      t("session.workspace_fallback"),
  };
}

/**
 * Serialize an SDK error value into a string that parseSessionError can parse.
 * Preserves the original shape (name, data, message) as JSON when possible,
 * so the session surface can detect ProviderModelNotFoundError and offer
 * recovery actions like "Change model".
 */
export function serializeSDKError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      const msg = (error as Record<string, unknown>).message;
      return typeof msg === "string" ? msg : String(error);
    }
  }
  return String(error);
}

export function folderNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "workspace";
}

export function isTransientStartupError(message: string | null | undefined) {
  const value = (message ?? "").toLowerCase();
  return (
    value.includes("timed out") ||
    value.includes("failed to fetch") ||
    value.includes("connection") ||
    value.includes("not ready")
  );
}

export function workspaceLabel(workspace: OnMyAgentWorkspaceInfo) {
  return (
    workspace.displayName?.trim() ||
    workspace.onmyagentWorkspaceName?.trim() ||
    workspace.name?.trim() ||
    workspace.path?.trim() ||
    t("session.workspace_fallback")
  );
}

export function workspaceEditableTitle(workspace: OnMyAgentWorkspaceInfo) {
  return (
    workspace.displayName?.trim() ||
    workspace.name?.trim() ||
    workspace.path?.trim() ||
    ""
  );
}

export function workspaceRevealPath(workspace: OnMyAgentWorkspaceInfo | null | undefined) {
  return workspace?.path?.trim() || "";
}

export function findRouteWorkspace<TWorkspace extends OnMyAgentWorkspaceInfo>(
  workspaces: TWorkspace[],
  workspaceId: string,
) {
  return workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
}

export function canCreateTaskInRouteWorkspace<TWorkspace extends OnMyAgentWorkspaceInfo>(input: {
  workspaces: TWorkspace[];
  workspaceId: string;
  loading: boolean;
  retryingWorkspaceIds: string[];
}) {
  return !!findRouteWorkspace(input.workspaces, input.workspaceId) &&
    !input.loading &&
    !input.retryingWorkspaceIds.includes(input.workspaceId);
}

export function normalizePickedDirectory(value: unknown) {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : "";
  }
  return typeof value === "string" ? value : "";
}

export const emptyWorkspaceDisplay: WorkspaceDisplay = {
  id: "",
  name: "",
  path: "",
  preset: "default",
  workspaceType: "local",
};

export type SessionSidebarAccount = {
  name: string;
  email?: string | null;
};

export function localUserToSidebarAccount(
  user: LocalUser | null,
): SessionSidebarAccount | null {
  if (!user) return null;
  return {
    name: user.username,
    email: user.email,
  };
}

export function describeRouteError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  const serialized = safeStringify(error);
  return serialized && serialized !== "{}"
    ? serialized
    : t("app.unknown_error");
}

export function buildWorkspaceBootstrapErrorEvent(input: {
  error: unknown;
  route: string;
  preservedWorkspaceCount: number;
}) {
  const message = describeRouteError(input.error);
  return {
    message,
    payload: {
      route: input.route,
      message,
      preservedWorkspaceCount: input.preservedWorkspaceCount,
    },
  };
}

export function describeWorkspaceCreateError(error: unknown) {
  const message = describeRouteError(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("operation timed out") ||
    lower.includes("os error 60") ||
    lower.includes("etimedout")
  ) {
    return `${message}\n\nOnMyAgent could not read the workspace config before the filesystem timed out. This often happens when the folder is still syncing from iCloud Drive or another remote folder. Wait for the folder to finish downloading, move the workspace to a local folder, or try again.`;
  }
  return message;
}

export function describeTaskCreateError(error: unknown) {
  const message = describeRouteError(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("failed to fetch") ||
    lower.includes("connection") ||
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("connection lost") ||
    lower.includes("internal_error") ||
    lower.includes("unexpected server error")
  ) {
    return "OpenCode is unavailable for this workspace. Retry once it restarts, or restart OnMyAgent if the problem continues.";
  }
  return message;
}

export type CachedWorkspaceSessionEntry = {
  workspaceId: string;
  sessions: SidebarSessionItem[];
};

export function buildCachedWorkspaceSessionEntries(input: {
  workspaces: RouteWorkspace[];
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
}): CachedWorkspaceSessionEntry[] {
  return input.workspaces.map((workspace) => ({
    workspaceId: workspace.id,
    sessions: input.sessionsByWorkspaceId[workspace.id] ?? [],
  }));
}

export function buildSessionsByWorkspaceId(
  entries: CachedWorkspaceSessionEntry[],
): Record<string, SidebarSessionItem[]> {
  return Object.fromEntries(
    entries.map((entry) => [entry.workspaceId, entry.sessions]),
  );
}

export function isRemoteOnMyAgentWorkspace(workspace: Pick<RouteWorkspace, "workspaceType" | "remoteType">) {
  return workspace.workspaceType === "remote" && workspace.remoteType !== "opencode";
}

export function shouldSkipWorkspaceSessionLoad(input: {
  startedAt: number;
  now: number;
  minimumIntervalMs?: number;
}) {
  return input.startedAt > 0 && input.now - input.startedAt < (input.minimumIntervalMs ?? 5_000);
}

export function workspaceSessionLoadBackoffMs(attempt: number) {
  return Math.min(500 * Math.pow(2, attempt), 4_000);
}

export function waitForWorkspaceSessionLoadBackoff(input: {
  attempt: number;
  setTimeoutFn: typeof window.setTimeout;
}) {
  return new Promise<void>((resolve) => {
    input.setTimeoutFn(resolve, workspaceSessionLoadBackoffMs(input.attempt));
  });
}

export function shouldRetryWorkspaceSessionLoad(input: {
  attempt: number;
  message: string;
  maxAttempts?: number;
}) {
  return input.attempt + 1 < (input.maxAttempts ?? 6) && isTransientStartupError(input.message);
}

export function shouldClearWorkspaceSessionLoadInFlight(input: {
  currentStartedAt: number | undefined;
  requestStartedAt: number;
}) {
  return input.currentStartedAt === input.requestStartedAt;
}

export function describeWorkspaceSessionLoadError(input: {
  error: unknown;
  fallbackMessage: string;
}) {
  return input.error instanceof Error ? input.error.message : input.fallbackMessage;
}

export function workspaceSessionEmptyRetryDelayMs() {
  return 3_000;
}

export function shouldScheduleEmptyWorkspaceSessionRetry(input: {
  attempt: number;
  sessionCount: number;
}) {
  return input.sessionCount === 0 && input.attempt === 0;
}

export function shouldRunEmptyWorkspaceSessionRetry(input: {
  currentStartedAt: number | undefined;
}) {
  return !input.currentStartedAt;
}

export function resolveNextRouteWorkspaceId(input: {
  workspaces: RouteWorkspace[];
  cachedEntries: CachedWorkspaceSessionEntry[];
  routeWorkspaceId: string;
  selectedSessionId: string | null;
  persistedActiveId: string;
  desktopSelectedId: string;
  serverActiveId: string | null | undefined;
}) {
  const hasWorkspace = (workspaceId: string) =>
    workspaceId && input.workspaces.some((workspace) => workspace.id === workspaceId);
  const sessionOwner = input.selectedSessionId
    ? input.cachedEntries.find((entry) =>
        entry.sessions.some((session) => session.id === input.selectedSessionId),
      )
    : null;

  return (
    sessionOwner?.workspaceId ||
    (hasWorkspace(input.routeWorkspaceId) ? input.routeWorkspaceId : "") ||
    (hasWorkspace(input.persistedActiveId) ? input.persistedActiveId : "") ||
    input.desktopSelectedId ||
    input.serverActiveId?.trim() ||
    input.workspaces[0]?.id ||
    ""
  );
}

export function buildRetryingWorkspaceIds(input: {
  cachedEntries: CachedWorkspaceSessionEntry[];
  selectedWorkspaceId: string;
  alreadyLoadedWorkspaceIds: Set<string>;
}) {
  return input.cachedEntries.flatMap((entry) =>
    entry.sessions.length === 0 &&
    (entry.workspaceId === input.selectedWorkspaceId ||
      !input.alreadyLoadedWorkspaceIds.has(entry.workspaceId))
      ? [entry.workspaceId]
      : [],
  );
}

export function removeRetryingWorkspaceId(current: string[], workspaceId: string) {
  return current.includes(workspaceId)
    ? current.filter((id) => id !== workspaceId)
    : current;
}

export function orderBackgroundSessionWorkspaces(input: {
  workspaces: RouteWorkspace[];
  selectedWorkspaceId: string;
  alreadyLoadedWorkspaceIds: Set<string>;
}) {
  const selectedWorkspace = input.workspaces.find(
    (workspace) => workspace.id === input.selectedWorkspaceId,
  );
  const backgroundWorkspaces = input.workspaces.filter(
    (workspace) =>
      workspace.id === input.selectedWorkspaceId ||
      !input.alreadyLoadedWorkspaceIds.has(workspace.id),
  );
  if (backgroundWorkspaces.length === 0) return [];
  return selectedWorkspace
    ? [
        selectedWorkspace,
        ...backgroundWorkspaces.filter(
          (workspace) => workspace.id !== selectedWorkspace.id,
        ),
      ]
    : backgroundWorkspaces;
}

export function resolveFallbackWorkspaceId(input: {
  workspaces: RouteWorkspace[];
  preferredWorkspaceId: string;
}) {
  return input.workspaces.some(
    (workspace) => workspace.id === input.preferredWorkspaceId,
  )
    ? input.preferredWorkspaceId
    : input.workspaces[0]?.id || "";
}

export function isSessionKnown(input: {
  selectedSessionId: string | null;
  sessions: unknown[];
}) {
  if (!input.selectedSessionId) return false;
  return input.sessions.some((session) => {
    if (!session || typeof session !== "object") return false;
    const id = (session as { id?: unknown }).id;
    return id === input.selectedSessionId;
  });
}

export function getRouteNotFoundMessage(input: {
  loading: boolean;
  routeWorkspaceId: string;
  selectedWorkspace: RouteWorkspace | null;
  selectedSessionId: string | null;
  selectedWorkspaceIsLoading: boolean;
  selectedSessionKnown: boolean;
}) {
  if (input.loading) return null;
  if (input.routeWorkspaceId && !input.selectedWorkspace) {
    return "Workspace was not found. Select a new workspace from the sidebar.";
  }
  if (
    input.selectedSessionId &&
    !input.selectedWorkspaceIsLoading &&
    !input.selectedSessionKnown
  ) {
    return "Session was not found. Select a new session from the sidebar.";
  }
  return null;
}

export function buildSelectedWorkspaceRouteState(input: {
  selectedWorkspace: RouteWorkspace | null;
  selectedSessionWorkspaceDirectory: string;
  selectedSessionDirectory?: string | null;
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  routeWorkspaceId: string;
  loading: boolean;
  retryingWorkspaceIds: string[];
  errorsByWorkspaceId: Record<string, string | null>;
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
}) {
  const selectedWorkspaceRoot = input.selectedWorkspace?.path?.trim() || "";
  const sessionWorkspaceRoot =
    input.selectedSessionWorkspaceDirectory.trim() ||
    input.selectedSessionDirectory?.trim() ||
    selectedWorkspaceRoot;
  const selectedWorkspaceIsLoading = input.retryingWorkspaceIds.includes(
    input.selectedWorkspaceId,
  );
  const selectedWorkspaceError =
    input.errorsByWorkspaceId[input.selectedWorkspaceId] ?? null;
  const selectedSessionKnown = isSessionKnown({
    selectedSessionId: input.selectedSessionId,
    sessions: input.sessionsByWorkspaceId[input.selectedWorkspaceId] ?? [],
  });
  const routeNotFoundMessage = getRouteNotFoundMessage({
    loading: input.loading,
    routeWorkspaceId: input.routeWorkspaceId,
    selectedWorkspace: input.selectedWorkspace,
    selectedSessionId: input.selectedSessionId,
    selectedWorkspaceIsLoading,
    selectedSessionKnown,
  });

  return {
    selectedWorkspaceRoot,
    sessionWorkspaceRoot,
    selectedWorkspaceIsLoading,
    selectedWorkspaceError,
    selectedSessionKnown,
    routeNotFoundMessage,
    effectiveLoading: input.loading,
  };
}

export function mergeRouteWorkspaces(
  serverWorkspaces: OnMyAgentWorkspaceInfo[],
  desktopWorkspaces: RouteWorkspace[],
): RouteWorkspace[] {
  const desktopById = new Map(
    desktopWorkspaces.map((workspace) => [workspace.id, workspace]),
  );
  const desktopByPath = new Map(
    desktopWorkspaces.flatMap((workspace) => {
      const path = normalizeDirectoryPath(workspace.path ?? "");
      return path ? [[path, workspace] as const] : [];
    }),
  );

  // If a server workspace's id matches a desktop workspace marked as remote,
  // skip the server's view entirely. The local OnMyAgent server may have stale
  // registrations from earlier (buggy) activate calls that show up here as
  // `workspaceType: "local"`, which would otherwise clobber the desktop's
  // remote routing fields and send workspace-scoped requests back to the
  // local server.
  const remoteDesktopIds = new Set(
    desktopWorkspaces.flatMap((workspace) =>
      workspace.workspaceType === "remote" ? [workspace.id] : [],
    ),
  );
  const filteredServer = serverWorkspaces.filter(
    (workspace) => !remoteDesktopIds.has(workspace.id),
  );

  const mergedServer = filteredServer.map((workspace) => {
    const match =
      desktopById.get(workspace.id) ??
      desktopByPath.get(normalizeDirectoryPath(workspace.path ?? ""));
    // For local workspaces, prefer the server's view (which knows things like
    // `path` and per-workspace runtime fields) and only fall back to the
    // desktop's display name when the server doesn't provide one.
    const merged = match
      ? {
          ...workspace,
          displayName: workspace.displayName?.trim()
            ? workspace.displayName
            : match.displayName,
          name: match.name?.trim() ? match.name : workspace.name,
        }
      : workspace;
    return {
      ...merged,
      displayNameResolved: workspaceLabel(merged),
    };
  });

  const mergedIds = new Set(mergedServer.map((workspace) => workspace.id));
  const mergedPaths = new Set(
    mergedServer.flatMap((workspace) => {
      const path = normalizeDirectoryPath(workspace.path ?? "");
      return path ? [path] : [];
    }),
  );

  const missingDesktop = desktopWorkspaces.filter((workspace) => {
    if (mergedIds.has(workspace.id)) return false;
    const normalizedPath = normalizeDirectoryPath(workspace.path ?? "");
    if (normalizedPath && mergedPaths.has(normalizedPath)) return false;
    return true;
  });

  return [...mergedServer, ...missingDesktop];
}

export function orderRouteWorkspaces(
  workspaces: RouteWorkspace[],
  orderIds: string[],
): RouteWorkspace[] {
  if (orderIds.length === 0) return workspaces;

  const workspaceById = new Map(
    workspaces.map((workspace) => [workspace.id, workspace]),
  );
  const ordered: RouteWorkspace[] = [];
  const usedIds = new Set<string>();

  for (const id of orderIds) {
    const workspace = workspaceById.get(id);
    if (!workspace || usedIds.has(id)) continue;
    ordered.push(workspace);
    usedIds.add(id);
  }

  for (const workspace of workspaces) {
    if (usedIds.has(workspace.id)) continue;
    ordered.push(workspace);
  }

  return ordered;
}

export function buildDisconnectedRouteState(input: {
  desktopWorkspaces: RouteWorkspace[];
  workspaceOrderIds: string[];
  desktopSelectedId: string;
}) {
  const orderedWorkspaces = orderRouteWorkspaces(
    input.desktopWorkspaces,
    input.workspaceOrderIds,
  );
  return {
    orderedWorkspaces,
    selectedWorkspaceId: input.desktopSelectedId || orderedWorkspaces[0]?.id || "",
  };
}

export function buildRouteRefreshErrorFallbackWorkspaces(input: {
  desktopWorkspaces: RouteWorkspace[];
  workspaceOrderIds: string[];
}) {
  return orderRouteWorkspaces(
    input.desktopWorkspaces,
    input.workspaceOrderIds,
  );
}

export function resolveRouteRefreshErrorSelectedWorkspace(input: {
  currentWorkspaceId: string;
  desktopSelectedId: string;
  orderedWorkspaces: RouteWorkspace[];
}) {
  return (
    input.currentWorkspaceId ||
    input.desktopSelectedId ||
    input.orderedWorkspaces[0]?.id ||
    ""
  );
}

export function buildConnectedRouteRefreshPlan(input: {
  serverWorkspaces: OnMyAgentWorkspaceInfo[];
  desktopWorkspaces: RouteWorkspace[];
  workspaceOrderIds: string[];
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
  routeWorkspaceId: string;
  selectedSessionId: string | null;
  persistedActiveId: string;
  desktopSelectedId: string;
  serverActiveId: string | null | undefined;
}) {
  const workspaces = orderRouteWorkspaces(
    mergeRouteWorkspaces(input.serverWorkspaces, input.desktopWorkspaces),
    input.workspaceOrderIds,
  );
  const alreadyLoadedWorkspaceIds = new Set(Object.keys(input.sessionsByWorkspaceId));
  const cachedEntries = buildCachedWorkspaceSessionEntries({
    workspaces,
    sessionsByWorkspaceId: input.sessionsByWorkspaceId,
  });
  const selectedWorkspaceId = resolveNextRouteWorkspaceId({
    workspaces,
    cachedEntries,
    routeWorkspaceId: input.routeWorkspaceId,
    selectedSessionId: input.selectedSessionId,
    persistedActiveId: input.persistedActiveId,
    desktopSelectedId: input.desktopSelectedId,
    serverActiveId: input.serverActiveId,
  });

  return {
    workspaces,
    alreadyLoadedWorkspaceIds,
    cachedEntries,
    selectedWorkspaceId,
    sessionsByWorkspaceId: buildSessionsByWorkspaceId(cachedEntries),
    retryingWorkspaceIds: buildRetryingWorkspaceIds({
      cachedEntries,
      selectedWorkspaceId,
      alreadyLoadedWorkspaceIds,
    }),
    backgroundWorkspaces: orderBackgroundSessionWorkspaces({
      workspaces,
      selectedWorkspaceId,
      alreadyLoadedWorkspaceIds,
    }),
  };
}

export function retainWorkspaceErrorsById(input: {
  workspaces: RouteWorkspace[];
  previous: Record<string, string | null>;
}) {
  const next: Record<string, string | null> = {};
  for (const workspace of input.workspaces) {
    next[workspace.id] = input.previous[workspace.id] ?? null;
  }
  return next;
}

export function shouldLaunchActivateWorkspace(input: {
  launchedWorkspaceIds: Set<string>;
  selectedWorkspaceId: string;
  serverActiveId: string | null | undefined;
}) {
  return Boolean(
    input.selectedWorkspaceId &&
    input.serverActiveId !== input.selectedWorkspaceId &&
    !input.launchedWorkspaceIds.has(input.selectedWorkspaceId),
  );
}

export function buildRouteRefreshCompleteEvent(input: {
  selectedWorkspaceId: string;
  workspaces: RouteWorkspace[];
}) {
  return {
    workspaces: input.workspaces.length,
    selectedWorkspaceId: input.selectedWorkspaceId,
    errors: {},
  };
}

export function buildRouteRefreshErrorEvent(input: {
  message: string;
  preservedWorkspaceCount: number;
}) {
  return {
    route: "session",
    message: input.message,
    preservedWorkspaceCount: input.preservedWorkspaceCount,
  };
}

export function buildWorkspaceReorderIds(input: {
  workspaces: RouteWorkspace[];
  requestedWorkspaceIds: string[];
}) {
  const activeWorkspaceIds = new Set(
    input.workspaces.map((workspace) => workspace.id),
  );
  const nextOrderIds: string[] = [];
  const nextOrderIdSet = new Set<string>();

  for (const id of input.requestedWorkspaceIds) {
    if (!activeWorkspaceIds.has(id) || nextOrderIdSet.has(id)) continue;
    nextOrderIds.push(id);
    nextOrderIdSet.add(id);
  }

  for (const workspace of input.workspaces) {
    if (nextOrderIdSet.has(workspace.id)) continue;
    nextOrderIds.push(workspace.id);
    nextOrderIdSet.add(workspace.id);
  }

  return nextOrderIds;
}

export function toSessionGroups(
  workspaces: RouteWorkspace[],
  sessionsByWorkspaceId: Record<string, WorkspaceSessionGroup["sessions"]>,
  errorsByWorkspaceId: Record<string, string | null>,
  loadingWorkspaceIds: Set<string>,
): WorkspaceSessionGroup[] {
  return workspaces.map((workspace) => ({
    workspace,
    sessions: sessionsByWorkspaceId[workspace.id] ?? [],
    status: loadingWorkspaceIds.has(workspace.id)
      ? "loading"
      : errorsByWorkspaceId[workspace.id]
        ? "error"
        : "ready",
    error: errorsByWorkspaceId[workspace.id],
  }));
}

export type GlobalShortcutAction = "create-task" | "toggle-command-palette";
export type OrgOnboardingReloadAction = "mark-required" | "reload";

export function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable;
}

export function isMacShortcutPlatform(platform: string | null | undefined) {
  return /Mac/i.test(platform ?? "");
}

export function resolveGlobalShortcutAction(input: {
  key: string | null | undefined;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  platform: string | null | undefined;
  target: EventTarget | null;
}): GlobalShortcutAction | null {
  const mod = isMacShortcutPlatform(input.platform) ? input.metaKey : input.ctrlKey;
  if (!mod) return null;
  if (input.shiftKey || input.altKey) return null;

  const key = input.key?.toLowerCase();
  if (key === "n" && !isEditableShortcutTarget(input.target)) return "create-task";
  if (key === "k") return "toggle-command-palette";
  return null;
}

export function resolveOrgOnboardingReloadAction(input: {
  canReloadWorkspaceEngine: boolean;
  reloadPending: boolean;
  shouldReloadAfterOnboarding: boolean;
}): OrgOnboardingReloadAction | null {
  if (!input.canReloadWorkspaceEngine) return null;
  if (!input.shouldReloadAfterOnboarding) return null;
  return input.reloadPending ? "reload" : "mark-required";
}

export function normalizeSettingsRouteTab(route: string) {
  return route.replace(/^\/settings\/?/, "").replace(/^\/+|\/+$/g, "") || "general";
}

export function buildSettingsNavigationTarget(input: {
  route: string;
  workspaceId: string;
  activeWorkspaceId: string;
  selectedSessionId: string | null;
  workspaceSettingsRoute: (workspaceId: string, tab: string) => string;
}) {
  const sessionId = input.workspaceId === input.activeWorkspaceId ? input.selectedSessionId : null;
  const tab = normalizeSettingsRouteTab(input.route);
  const target = input.workspaceId
    ? input.workspaceSettingsRoute(input.workspaceId, tab)
    : input.route;
  return { target, state: { workspaceId: input.workspaceId, sessionId } };
}
