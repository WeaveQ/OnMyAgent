import type { OnMyAgentWorkspaceInfo } from "../../../app/lib/onmyagent-server";
import type { WorkspaceInfo, WorkspaceList } from "../../../app/lib/desktop";
import type {
  ProviderListItem,
  SettingsTab,
  SidebarSessionItem,
  WorkspaceConnectionState,
  WorkspaceSessionGroup,
} from "../../../app/types";
// ProviderListItem used by normalizeSettingsProviderSource
import { normalizeDirectoryPath, safeStringify } from "../../../app/utils";
import { t } from "../../../i18n";
import { resolveWorkspaceListSelectedId } from "../../../app/lib/desktop";
import type {
  ConversationMemoryState,
  OnboardingProfile,
} from "../../kernel/local-provider";
import type { AiSettingsConnectedProvider } from "../../domains/settings";

export type RouteWorkspace = OnMyAgentWorkspaceInfo & {
  displayNameResolved: string;
};

export function settingsMemoryHasChanges(input: {
  draft: OnboardingProfile | null;
  saved: OnboardingProfile | null;
  conversationMemoryDraft?: ConversationMemoryState | null;
  conversationMemorySaved?: ConversationMemoryState | null;
}) {
  const profileChanged = (() => {
    if (input.draft === null && input.saved === null) return false;
    if (input.draft === null || input.saved === null) return true;
    return JSON.stringify(input.draft) !== JSON.stringify(input.saved);
  })();
  if (profileChanged) return true;
  if (
    input.conversationMemoryDraft === undefined &&
    input.conversationMemorySaved === undefined
  ) {
    return false;
  }
  return (
    JSON.stringify(input.conversationMemoryDraft ?? null) !==
    JSON.stringify(input.conversationMemorySaved ?? null)
  );
}

export type SettingsRoutePath = {
  tab: SettingsTab;
  redirectPath: string | null;
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

export function isOnMyAgentCloudProvider(provider: {
  providerId?: string | null;
  source?: string | null;
  sourceProviderId?: string | null;
}) {
  return [provider.providerId, provider.source, provider.sourceProviderId].some(
    (value) => value?.trim().toLowerCase() === "onmyagent",
  );
}

export function describeRouteError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  const serialized = safeStringify(error);
  return serialized && serialized !== "{}" ? serialized : t("app.unknown_error");
}

export function buildSettingsWorkspaceBootstrapErrorEvent(input: {
  error: unknown;
  preservedWorkspaceCount: number;
}) {
  return {
    route: "settings",
    message: describeRouteError(input.error),
    preservedWorkspaceCount: input.preservedWorkspaceCount,
  };
}

export function buildSettingsRefreshErrorEvent(input: {
  message: string;
  preservedWorkspaceCount: number;
}) {
  return {
    route: "settings",
    message: input.message,
    preservedWorkspaceCount: input.preservedWorkspaceCount,
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

export function workspaceLabel(workspace: OnMyAgentWorkspaceInfo) {
  return (
    workspace.displayName?.trim() ||
    workspace.onmyagentWorkspaceName?.trim() ||
    workspace.name?.trim() ||
    workspace.path?.trim() ||
    t("session.workspace_fallback")
  );
}

export function mergeRouteWorkspaces(
  serverWorkspaces: OnMyAgentWorkspaceInfo[],
  desktopWorkspaces: RouteWorkspace[],
): RouteWorkspace[] {
  const desktopById = new Map(desktopWorkspaces.map((workspace) => [workspace.id, workspace]));
  const desktopByPath = new Map(
    desktopWorkspaces.flatMap((workspace) => {
      const path = normalizeDirectoryPath(workspace.path ?? "");
      return path ? [[path, workspace] as const] : [];
    }),
  );

  const mergedServer = serverWorkspaces.map((workspace) => {
    const match =
      desktopById.get(workspace.id) ??
      desktopByPath.get(normalizeDirectoryPath(workspace.path ?? ""));
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

export function reconcileSelectedWorkspaceId(
  currentId: string,
  serverList: { activeId?: string | null },
  desktopList: WorkspaceList | null,
  workspaces: RouteWorkspace[],
) {
  const current = currentId.trim();
  const serverIds = new Set(workspaces.map((workspace) => workspace.id));
  if (current && serverIds.has(current)) return current;

  const desktopSelectedId = resolveWorkspaceListSelectedId(desktopList);
  const desktopSelected = desktopSelectedId
    ? desktopList?.workspaces?.find((workspace) => workspace.id === desktopSelectedId)
    : null;
  const currentDesktop = current
    ? desktopList?.workspaces?.find((workspace) => workspace.id === current)
    : null;
  const selectedPath = normalizeDirectoryPath((currentDesktop ?? desktopSelected)?.path ?? "");

  if (selectedPath) {
    const pathMatch = workspaces.find(
      (workspace) => normalizeDirectoryPath(workspace.path ?? "") === selectedPath,
    );
    if (pathMatch) return pathMatch.id;
  }

  return serverList.activeId?.trim() || desktopSelectedId || workspaces[0]?.id || "";
}

export function folderNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "workspace";
}

export function resolveCreatedSettingsWorkspaceId(list: WorkspaceList) {
  return resolveWorkspaceListSelectedId(list) || list.workspaces[list.workspaces.length - 1]?.id || "";
}

export function resolveSettingsWorkspaceIdAfterRemoval(input: {
  removedWorkspaceId: string;
  selectedWorkspaceId: string;
  workspaces: RouteWorkspace[];
}) {
  if (input.selectedWorkspaceId !== input.removedWorkspaceId) {
    return input.selectedWorkspaceId;
  }
  return input.workspaces.find((workspace) => workspace.id !== input.removedWorkspaceId)?.id ?? "";
}

export function buildSettingsEnvironmentWorkspacePaths(input: {
  selectedWorkspaceRoot: string;
  workspaces: RouteWorkspace[];
}) {
  const workspacePaths = Array.from(
    new Set(
      input.workspaces.flatMap((workspace) => {
        const path = workspace.workspaceType !== "remote" ? workspace.path?.trim() ?? "" : "";
        return path ? [path] : [];
      }),
    ),
  );
  if (input.selectedWorkspaceRoot && !new Set(workspacePaths).has(input.selectedWorkspaceRoot)) {
    workspacePaths.unshift(input.selectedWorkspaceRoot);
  }
  return workspacePaths;
}

export function toSessionGroups(
  workspaces: RouteWorkspace[],
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>,
  errorsByWorkspaceId: Record<string, string | null>,
): WorkspaceSessionGroup[] {
  return workspaces.map((workspace) => ({
    workspace,
    sessions: sessionsByWorkspaceId[workspace.id] ?? [],
    status: errorsByWorkspaceId[workspace.id] ? "error" : "ready",
    error: errorsByWorkspaceId[workspace.id],
  }));
}

export function isActiveSessionStatus(status: unknown) {
  return status === "running" || status === "retry" || status === "busy";
}

export function getSessionStatus(session: SidebarSessionItem) {
  return session?.status ?? session?.state ?? session?.runStatus ?? null;
}

export function parseSettingsPath(pathname: string): SettingsRoutePath {
  const trimmed = pathname
    .replace(/^\/workspace\/[^/]+\/settings\/?/, "")
    .replace(/^\/settings\/?/, "")
    .replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    return { tab: "general", redirectPath: "general" };
  }

  const [head, tail] = trimmed.split("/");
  switch (head) {
    case "general":
    case "ai":
    case "preferences":
    case "permissions":
    case "environment":
    case "updates":
    case "usage":
    case "memory":
    case "conversation-memory":
    case "archived-tasks":
    case "recovery":
    case "debug":
      return { tab: head, redirectPath: null };
    case "cloud-marketplaces":
    case "cloud-providers":
      return { tab: head, redirectPath: null };
    // Removed stub settings pages — keep old deep links from 404ing.
    case "advanced":
    case "skills":
    case "cloud-workers":
    case "cloud-account":
    case "den":
      return { tab: "general", redirectPath: "general" };
    // Settings → Extensions / MCP page removed; deep links redirect to general.
    case "extensions":
      return { tab: "general", redirectPath: "general" };
    default:
      return { tab: "general", redirectPath: "general" };
  }
}

export function readNavigationWorkspaceId(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as { workspaceId?: unknown }).workspaceId;
  return typeof value === "string" ? value.trim() || null : null;
}

export function readNavigationSessionId(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as { sessionId?: unknown }).sessionId;
  return typeof value === "string" ? value.trim() || null : null;
}

export function readNavigationPageMode(
  state: unknown,
): "assistant" | "expert" | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as { pageMode?: unknown }).pageMode;
  if (value === "assistant" || value === "expert") return value;
  return null;
}

/** Exact shell path+search captured when opening settings. */
export function readNavigationReturnTo(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as { returnTo?: unknown }).returnTo;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // Only allow in-app relative paths (no protocol / open redirect).
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return trimmed;
}

/**
 * Resolve where "Back to app" should land.
 * Prefer exact returnTo; else rebuild from workspace + session + pageMode.
 * Default pageMode is assistant (never hardcode expert-only session routes).
 */
export function resolveSettingsReturnPath(input: {
  returnTo?: string | null;
  workspaceId: string;
  sessionId?: string | null;
  pageMode?: "assistant" | "expert" | null;
  workspaceAssistantRoute: (
    workspaceId: string,
    sessionId?: string | null,
  ) => string;
  workspaceSessionRoute: (
    workspaceId: string,
    sessionId?: string | null,
  ) => string;
}): string {
  const exact = input.returnTo?.trim();
  if (exact && exact.startsWith("/") && !exact.startsWith("//")) {
    return exact;
  }
  const workspaceId = input.workspaceId.trim();
  const mode = input.pageMode === "expert" ? "expert" : "assistant";
  if (!workspaceId) {
    return mode === "expert" ? "/session" : "/assistant";
  }
  return mode === "expert"
    ? input.workspaceSessionRoute(workspaceId, input.sessionId)
    : input.workspaceAssistantRoute(workspaceId, input.sessionId);
}

/**
 * Prefer history.back when settings was opened from the shell (return state
 * present) and the history stack has a previous entry. Tab switches use
 * replace, so -1 lands on the pre-settings app surface.
 */
export function shouldPreferHistoryBackFromSettings(input: {
  returnTo?: string | null;
  pageMode?: "assistant" | "expert" | null;
  sessionId?: string | null;
  historyIndex?: number | null;
}): boolean {
  const hasReturnContext = Boolean(
    input.returnTo?.trim() ||
      input.pageMode === "assistant" ||
      input.pageMode === "expert" ||
      input.sessionId?.trim(),
  );
  if (!hasReturnContext) return false;
  if (typeof input.historyIndex === "number") {
    return input.historyIndex > 0;
  }
  // Unknown index: still prefer -1 when we captured return context from shell.
  return true;
}

export function readHistoryIndexFromWindow(
  historyState: unknown,
): number | null {
  if (!historyState || typeof historyState !== "object") return null;
  const idx = (historyState as { idx?: unknown }).idx;
  return typeof idx === "number" && Number.isFinite(idx) ? idx : null;
}

export function findSessionWorkspaceId(
  sessionId: string | null,
  entries: Array<{ workspaceId: string; sessions: SidebarSessionItem[] }>,
) {
  const id = sessionId?.trim();
  if (!id) return null;
  return entries.find((entry) => entry.sessions.some((session) => session.id === id))?.workspaceId ?? null;
}

export function resolveSettingsPreferredWorkspaceId(input: {
  currentWorkspaceId: string;
  navigationSessionId: string | null;
  navigationWorkspaceId: string | null;
  persistedWorkspaceId: string;
  routeWorkspaceId: string;
  sessionEntries: SettingsWorkspaceSessionEntry[];
}) {
  return (
    input.routeWorkspaceId ||
    findSessionWorkspaceId(input.navigationSessionId, input.sessionEntries) ||
    input.navigationWorkspaceId ||
    input.currentWorkspaceId ||
    input.persistedWorkspaceId ||
    ""
  );
}

export function resolveSettingsFallbackWorkspaceId(input: {
  currentWorkspaceId: string;
  desktopSelectedId: string;
  persistedWorkspaceId: string;
  workspaces: RouteWorkspace[];
}) {
  return (
    input.currentWorkspaceId ||
    input.persistedWorkspaceId ||
    input.desktopSelectedId ||
    input.workspaces[0]?.id ||
    ""
  );
}

export type SettingsWorkspaceSessionEntry = {
  connectionState?: WorkspaceConnectionState | null;
  error: string | null;
  sessions: SidebarSessionItem[];
  workspaceId: string;
};

export function buildSettingsSkippedWorkspaceSessionEntry(input: {
  workspaceId: string;
}): SettingsWorkspaceSessionEntry {
  return {
    workspaceId: input.workspaceId,
    sessions: [],
    error: null,
    connectionState: null,
  };
}

export function buildSettingsLoadedWorkspaceSessionEntry(input: {
  sessions: SidebarSessionItem[];
  workspaceId: string;
}): SettingsWorkspaceSessionEntry {
  return {
    workspaceId: input.workspaceId,
    sessions: input.sessions,
    error: null,
    connectionState: null,
  };
}

export function buildSettingsFailedWorkspaceSessionEntry(input: {
  connectionState?: WorkspaceConnectionState | null;
  error: string;
  workspaceId: string;
}): SettingsWorkspaceSessionEntry {
  return {
    workspaceId: input.workspaceId,
    sessions: [],
    error: input.connectionState?.message ?? input.error,
    connectionState: input.connectionState ?? null,
  };
}

export function buildSettingsSessionMaps(entries: SettingsWorkspaceSessionEntry[]) {
  return {
    errorsByWorkspaceId: Object.fromEntries(
      entries.map((entry) => [entry.workspaceId, entry.error]),
    ),
    sessionsByWorkspaceId: Object.fromEntries(
      entries.map((entry) => [entry.workspaceId, entry.sessions]),
    ),
  };
}

export function updateSettingsWorkspaceConnectionOverrides(input: {
  current: Record<string, WorkspaceConnectionState>;
  entries: SettingsWorkspaceSessionEntry[];
}) {
  const next = { ...input.current };
  for (const entry of input.entries) {
    if (entry.connectionState) {
      next[entry.workspaceId] = entry.connectionState;
    } else if (next[entry.workspaceId]?.status === "error") {
      delete next[entry.workspaceId];
    }
  }
  return next;
}

export function settingsPathForRoute(route: SettingsRoutePath) {
  return route.tab;
}

export function normalizeSettingsProviderSource(
  source: ProviderListItem["source"],
): AiSettingsConnectedProvider["source"] | undefined {
  if (
    source === "env" ||
    source === "api" ||
    source === "config" ||
    source === "custom"
  ) {
    return source;
  }
  return undefined;
}

