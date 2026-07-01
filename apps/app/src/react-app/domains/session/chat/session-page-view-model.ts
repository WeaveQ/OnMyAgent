import type {
  OpenworkServerClient,
  OpenworkServerStatus,
} from "../../../../app/lib/onmyagent-server";
import { useEffect, useState } from "react";
import type { BootPhase } from "../../../../app/lib/startup-boot";
import type { WorkspaceSessionGroup } from "../../../../app/types";
import {
  getSidebarInitialLoading,
  sessionTitleForId,
  workspaceTaskStatus,
} from "./session-page-model";
import type { OnMyAgentPrimaryView } from "./session-page-sidebar-view-model";

type SidebarSnapshot = {
  workspaceSessionGroups: WorkspaceSessionGroup[];
  workspaceConnectionStateById: Record<
    string,
    { status: string; message?: string | null } | undefined
  >;
  sidebarHydratedFromCache?: boolean;
  startupPhase: BootPhase;
};

type BuildSessionPageViewModelInput = {
  activeSidebarView: OnMyAgentPrimaryView;
  clientConnected: boolean;
  onmyagentServerClient: OpenworkServerClient | null;
  onmyagentServerStatus: OpenworkServerStatus;
  onmyagentServerToken?: string | null;
  opencodeBaseUrl?: string | null;
  runtimeWorkspaceId?: string | null;
  selectedSessionId: string | null;
  selectedWorkspaceDisplay: { workspaceType?: "local" | "remote" };
  selectedWorkspaceError?: string | null;
  selectedWorkspaceId: string;
  sessionLoadingById: (sessionId: string) => boolean;
  sidebar: SidebarSnapshot;
  startupPhase: BootPhase;
  statusBarLoading?: boolean;
  surface?: unknown;
  workspaceCount: number;
};

export function buildSessionPageViewModel(input: BuildSessionPageViewModelInput) {
  const selectedSessionTitle = sessionTitleForId(
    input.sidebar.workspaceSessionGroups,
    input.selectedSessionId,
  );
  const messageCountVisible = input.selectedSessionId ? 1 : 0;
  const showWorkspaceSetupEmptyState =
    input.workspaceCount === 0 && !input.selectedSessionId;
  const showStartupSkeleton =
    !input.selectedSessionId &&
    !input.clientConnected &&
    input.startupPhase !== "sessionIndexReady" &&
    input.startupPhase !== "firstSessionReady" &&
    input.startupPhase !== "ready";
  const selectedSessionId = input.selectedSessionId;
  const showSessionLoadingState =
    selectedSessionId !== null &&
    input.sessionLoadingById(selectedSessionId) &&
    !showWorkspaceSetupEmptyState;
  const taskStatus = workspaceTaskStatus(
    input.clientConnected,
    input.onmyagentServerStatus,
    input.statusBarLoading ?? showStartupSkeleton,
  );
  const sidebarInitialLoading = getSidebarInitialLoading(input.sidebar);
  const state =
    input.sidebar.workspaceConnectionStateById[input.selectedWorkspaceId];
  const selectedWorkspaceConnectionMessage =
    state?.status === "error" ? (state.message?.trim() ?? "") : "";
  const selectedWorkspaceGroupError =
    input.sidebar.workspaceSessionGroups
      .find((item) => item.workspace.id === input.selectedWorkspaceId)
      ?.error?.trim() ?? "";
  const selectedWorkspaceErrorMessage =
    input.selectedWorkspaceError?.trim() ||
    selectedWorkspaceConnectionMessage ||
    selectedWorkspaceGroupError ||
    "";
  const selectedWorkspaceErrorTitle =
    input.selectedWorkspaceDisplay.workspaceType === "remote"
      ? "Remote workspace unavailable"
      : "OpenCode unavailable";
  const reactSessionBaseUrl = input.opencodeBaseUrl?.trim() ?? "";
  const reactSessionToken =
    input.onmyagentServerToken?.trim() ||
    input.onmyagentServerClient?.token?.trim() ||
    "";
  const draftSessionId = `draft:${input.selectedWorkspaceId}`;
  const renderedSessionId = input.selectedSessionId ?? draftSessionId;
  const isDraftSession = !input.selectedSessionId;
  const canRenderReactSurface = Boolean(
    input.runtimeWorkspaceId &&
    input.onmyagentServerClient &&
    reactSessionBaseUrl &&
    reactSessionToken &&
    input.surface,
  );
  const activePlaceholderView =
    input.activeSidebarView === "chat" ||
    input.activeSidebarView === "files" ||
    input.activeSidebarView === "store" ||
    input.activeSidebarView === "projects" ||
    input.activeSidebarView === "skills" ||
    input.activeSidebarView === "connectors" ||
    input.activeSidebarView === "localAgent"
      ? null
      : input.activeSidebarView;

  return {
    activePlaceholderView,
    canRenderReactSurface,
    isDraftSession,
    isLocalAgentView: input.activeSidebarView === "localAgent",
    isSessionSurfaceView: input.activeSidebarView === "chat",
    messageCountVisible,
    reactSessionBaseUrl,
    reactSessionToken,
    renderedSessionId,
    selectedSessionTitle,
    selectedWorkspaceErrorMessage,
    selectedWorkspaceErrorTitle,
    showSelectedWorkspaceError: Boolean(selectedWorkspaceErrorMessage),
    showSessionLoadingState,
    showStartupSkeleton,
    showWorkspaceSetupEmptyState,
    sidebarInitialLoading,
    taskStatus,
  };
}

export function useDelayedSessionLoadingState(showSessionLoadingState: boolean) {
  const [showDelayedSessionLoadingState, setShowDelayedSessionLoadingState] =
    useState(false);

  useEffect(() => {
    if (!showSessionLoadingState) {
      setShowDelayedSessionLoadingState(false);
      return;
    }
    const id = window.setTimeout(() => {
      setShowDelayedSessionLoadingState(true);
    }, 1000);
    return () => window.clearTimeout(id);
  }, [showSessionLoadingState]);

  return showDelayedSessionLoadingState;
}
