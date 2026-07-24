import type { SidebarSessionItem } from "../../../app/types";
import { t } from "../../../i18n";
import type { OnMyAgentControlAction } from "../control/control-provider";
import {
  canCreateTaskInRouteWorkspace,
  findRouteWorkspace,
  resolveFallbackWorkspaceId,
  resolveGlobalShortcutAction,
  workspaceLabel,
  workspaceRevealPath,
  workspaceEditableTitle,
  type RouteWorkspace,
} from "./model";
import { findWorkspaceIdOwningSession } from "./sessions";
import {
  legacyAssistantRoute,
  legacySessionRoute,
  workspaceAssistantRoute,
  workspaceSessionRoute,
} from "../workspace-routes";

export function buildCommandPaletteControlAction(input: {
  openCommandPalette: () => void;
}): OnMyAgentControlAction {
  return {
    id: "command_palette.open",
    label: t("system.control_open_command_palette"),
    description: t("system.control_open_command_palette_desc"),
    sideEffect: "none",
    execute: input.openCommandPalette,
  };
}

export function resolveControlSessionWorkspaceId(input: {
  fallbackWorkspaceId: string;
  sessionId: string;
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
}) {
  return findWorkspaceIdOwningSession({
    sessionsByWorkspaceId: input.sessionsByWorkspaceId,
    sessionId: input.sessionId,
  }) || input.fallbackWorkspaceId;
}

export function resolveCreateTaskWorkspaceNavigation(input: {
  loading: boolean;
  retryingWorkspaceIds: string[];
  workspaceId: string;
  workspaces: RouteWorkspace[];
}) {
  if (!canCreateTaskInRouteWorkspace(input)) return null;
  return {
    activeWorkspaceId: input.workspaceId || null,
    workspaceId: input.workspaceId,
  };
}

export function resolveWorkspaceSessionRoute(input: {
  assistantMode: boolean;
  sessionId?: string | null;
  workspaceId: string;
}) {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    return input.assistantMode
      ? legacyAssistantRoute(input.sessionId)
      : legacySessionRoute(input.sessionId);
  }
  return input.assistantMode
    ? workspaceAssistantRoute(workspaceId, input.sessionId)
    : workspaceSessionRoute(workspaceId, input.sessionId);
}

export type SessionRouteRestoreNavigation =
  | { type: "none" }
  | { type: "reset-suppression" }
  | { type: "workspace"; workspaceId: string; sessionId: string | null };

export function resolveSessionRouteRestoreNavigation(input: {
  firstSessionIdForPageMode: (workspaceId: string) => string | null;
  legacySelectedWorkspaceId: string;
  loading: boolean;
  /**
   * React Router navigationType. When "POP", last-session restore must not
   * rewrite the URL (Back to draft/empty would otherwise be stolen).
   */
  navigationType?: string | null;
  /** Prefer mode-scoped: readLastSessionFor(workspaceId, pageMode). */
  pageMode?: "assistant" | "expert";
  readLastSessionFor: (
    workspaceId: string,
    mode?: "assistant" | "expert",
  ) => string | null;
  routeWorkspaceId: string;
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  sessionMatchesPageMode: (sessionId: string) => boolean;
  sessionListOwnsSession: (input: { sessionId: string; sessions: SidebarSessionItem[] }) => boolean;
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
  suppressRestoreSession: boolean;
  workspaces: RouteWorkspace[];
}): SessionRouteRestoreNavigation {
  if (input.loading) return { type: "none" };
  if (
    input.routeWorkspaceId &&
    input.workspaces.length > 0 &&
    !input.workspaces.some((workspace) => workspace.id === input.routeWorkspaceId)
  ) {
    // Repair invalid workspace id (allowed even on POP — not last-session steal).
    const fallbackWorkspaceId = resolveFallbackWorkspaceId({
      preferredWorkspaceId: input.legacySelectedWorkspaceId,
      workspaces: input.workspaces,
    });
    return fallbackWorkspaceId
      ? { type: "workspace", workspaceId: fallbackWorkspaceId, sessionId: input.selectedSessionId }
      : { type: "none" };
  }
  if (!input.routeWorkspaceId && input.selectedWorkspaceId) {
    return { type: "workspace", workspaceId: input.selectedWorkspaceId, sessionId: input.selectedSessionId };
  }
  if (input.selectedSessionId) {
    // Keep the user's selected session. Never steal focus to "first task" when
    // isAssistantSession/isExpertSession lags (e.g. race after create, or
    // force-new without start intent). That jump felt like "chatting on #3
    // then suddenly on #1".
    return { type: "reset-suppression" };
  }
  if (!input.selectedWorkspaceId) return { type: "none" };
  if (input.suppressRestoreSession) return { type: "none" };
  // Do not auto-restore last session on browser/history Back (POP).
  if (input.navigationType === "POP") return { type: "none" };
  const remembered = input.readLastSessionFor(
    input.selectedWorkspaceId,
    input.pageMode,
  );
  if (!remembered) return { type: "none" };
  const sessions = input.sessionsByWorkspaceId[input.selectedWorkspaceId] ?? [];
  if (!input.sessionListOwnsSession({ sessions, sessionId: remembered })) return { type: "none" };
  if (!input.sessionMatchesPageMode(remembered)) return { type: "none" };
  return { type: "workspace", workspaceId: input.selectedWorkspaceId, sessionId: remembered };
}

/**
 * Send the user back to the welcome / onboarding guide when they have not
 * finished (or have reset) onboarding. Workspace count is intentionally
 * ignored so "重置入门" re-opens the guide even if workspaces already exist.
 */
export function shouldRedirectSessionRouteToWelcome(input: {
  hasCompletedOnboarding: boolean;
  loading: boolean;
  /** @deprecated kept for call-site compat; not used in the decision */
  workspaceCount?: number;
}) {
  return !input.loading && !input.hasCompletedOnboarding;
}

export function resolveSessionRouteModeSwitchPath(input: {
  currentMode: "assistant" | "expert";
  findFirstSessionIdMatching: (
    sessions: SidebarSessionItem[],
    predicate: (sessionId: string) => boolean,
  ) => string | null;
  isExpertSession: (sessionId: string) => boolean;
  /** Prefer mode-scoped memory: readLastSessionFor(workspaceId, mode). */
  readLastSessionFor: (
    workspaceId: string,
    mode?: "assistant" | "expert",
  ) => string | null;
  sessionListOwnsSession: (input: { sessionId: string; sessions: SidebarSessionItem[] }) => boolean;
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
  targetMode: "assistant" | "expert";
  workspaceId: string;
}) {
  if (input.targetMode === input.currentMode) return null;
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) return input.targetMode === "assistant" ? "/assistant" : "/session";

  const sessions = input.sessionsByWorkspaceId[workspaceId] ?? [];

  // Returning to assistant: restore last assistant session (or first assistant), not a blank draft.
  if (input.targetMode === "assistant") {
    const remembered = input.readLastSessionFor(workspaceId, "assistant");
    if (
      remembered &&
      input.sessionListOwnsSession({ sessions, sessionId: remembered }) &&
      !input.isExpertSession(remembered)
    ) {
      return workspaceAssistantRoute(workspaceId, remembered);
    }
    const firstAssistantId = input.findFirstSessionIdMatching(
      sessions,
      (sessionId) => !input.isExpertSession(sessionId),
    );
    return firstAssistantId
      ? workspaceAssistantRoute(workspaceId, firstAssistantId)
      : workspaceAssistantRoute(workspaceId);
  }

  // Returning to expert: restore last expert session (or first expert), not empty home when possible.
  const remembered = input.readLastSessionFor(workspaceId, "expert");
  if (
    remembered &&
    input.sessionListOwnsSession({ sessions, sessionId: remembered }) &&
    input.isExpertSession(remembered)
  ) {
    return workspaceSessionRoute(workspaceId, remembered);
  }
  const firstExpertId = input.findFirstSessionIdMatching(sessions, input.isExpertSession);
  return firstExpertId
    ? workspaceSessionRoute(workspaceId, firstExpertId)
    : workspaceSessionRoute(workspaceId);
}

export function resolveWorkspaceSelectionSessionTarget(input: {
  firstSessionIdForPageMode: (workspaceId: string) => string | null;
  pageMode?: "assistant" | "expert";
  readLastSessionFor: (
    workspaceId: string,
    mode?: "assistant" | "expert",
  ) => string | null;
  selectedSessionId: string | null;
  sessionMatchesPageMode: (sessionId: string) => boolean;
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
  workspaceId: string;
}) {
  const remembered = input.readLastSessionFor(input.workspaceId, input.pageMode);
  if (remembered && remembered !== input.selectedSessionId) {
    const known = input.sessionsByWorkspaceId[input.workspaceId];
    if (
      known?.some((session: { id?: unknown }) => session?.id === remembered) &&
      input.sessionMatchesPageMode(remembered)
    ) {
      return remembered;
    }
  }
  return input.firstSessionIdForPageMode(input.workspaceId);
}

export function resolveWorkspaceRevealTarget(input: {
  workspaceId: string;
  workspaces: RouteWorkspace[];
}) {
  return workspaceRevealPath(findRouteWorkspace(input.workspaces, input.workspaceId));
}

export function resolveWorkspaceExportTarget(input: {
  workspaceId: string;
  workspaces: RouteWorkspace[];
}) {
  const workspace = findRouteWorkspace(input.workspaces, input.workspaceId);
  if (!workspace) return null;
  return {
    title: `Choose where to export ${workspaceLabel(workspace)}`,
    workspaceId: input.workspaceId,
  };
}

export function shouldBlockCreateWorkspaceForRestriction(input: {
  multipleWorkspacesRestricted: boolean;
  workspaceCount: number;
}) {
  return input.workspaceCount > 0 && input.multipleWorkspacesRestricted;
}

export function resolveRenameWorkspaceTarget(input: {
  workspaceId: string;
  workspaces: RouteWorkspace[];
}) {
  const workspace = findRouteWorkspace(input.workspaces, input.workspaceId);
  if (!workspace) return null;
  return {
    title: workspaceEditableTitle(workspace),
    workspaceId: input.workspaceId,
  };
}

export function shouldNavigateAfterForgettingWorkspace(input: {
  selectedWorkspaceId: string;
  workspaceId: string;
}) {
  return input.selectedWorkspaceId === input.workspaceId;
}

export function resolveSessionRouteGlobalShortcut(input: {
  altKey: boolean;
  canCreateTask: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  platform: string | null;
  selectedWorkspaceId: string;
  shiftKey: boolean;
  target: EventTarget | null;
}) {
  const action = resolveGlobalShortcutAction(input);
  if (action === "create-task") {
    return input.canCreateTask && input.selectedWorkspaceId
      ? { action, workspaceId: input.selectedWorkspaceId }
      : { action, workspaceId: "" };
  }
  return { action, workspaceId: "" };
}
