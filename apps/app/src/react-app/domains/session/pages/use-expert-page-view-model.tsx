/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";

import { formatShortcut } from "../../../../lib/format-shortcut";
import { createCanvasSessionKey } from "../infinite-canvas";
import {
  shouldShowSessionStartupSkeleton,
  workspaceTaskStatus,
} from "../sidebar/session-chrome";
import { ConversationHistoryPopover } from "../sidebar/conversation-history-popover";
import { isPrimaryOrHostedRailView } from "../navigation/rail-view-guards";
import { SessionHistorySearchChrome } from "./session-history-search-chrome";
import {
  resolveExpertDirectoryView,
  shouldBlockExpertSurfaceForWorkspaceError,
  shouldMountExpertSessionSurface,
} from "./expert-directory-view";
import type { ExpertSurfaceMode } from "./expert-surface-mode";
import type { buildExpertDirectoryPageModel } from "../../../capabilities/session-identity/expert-directory-page-model";
import type { useSessionPageHostState } from "./use-session-page-host-state";
import type { ExpertPageProps } from "./use-expert-page";

type DirectoryPage = ReturnType<typeof buildExpertDirectoryPageModel>;
type HostState = ReturnType<typeof useSessionPageHostState>;

/** Derives loading/error/empty surface presentation without owning lifecycle. */
export function useExpertPageViewModel(input: {
  props: ExpertPageProps;
  hostState: HostState;
  expertHistorySessionId: string | null;
  expertSurfaceMode: ExpertSurfaceMode;
  routeRealSessionId: string | null;
  showDraftChrome: boolean;
  directoryPage: DirectoryPage;
  effectiveSelectedSessionId: string | null;
  hasAnyExpertConversation: boolean;
  handleHistorySelectPrompt: (prompt: string) => void;
  openExpertSidePanelMenu: () => void;
}) {
  const { props, hostState } = input;
  const [showDelayedSessionLoadingState, setShowDelayedSessionLoadingState] =
    useState(false);
  const showWorkspaceSetupEmptyState =
    props.workspaces.length === 0 && !props.selectedSessionId;
  const showStartupSkeleton = shouldShowSessionStartupSkeleton({
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    clientConnected: props.clientConnected,
    startupPhase: props.startupPhase,
    coldBootShell: props.coldBootShell === true,
  });
  const showSessionLoadingState =
    Boolean(input.routeRealSessionId) &&
    !input.showDraftChrome &&
    input.expertSurfaceMode.kind === "real_session" &&
    props.sessionLoadingById(props.selectedSessionId) &&
    !showWorkspaceSetupEmptyState;
  const taskStatus = useMemo(
    () => workspaceTaskStatus(
      props.clientConnected,
      props.onmyagentServerStatus,
      props.statusBar?.loading ?? showStartupSkeleton,
    ),
    [
      props.clientConnected,
      props.onmyagentServerStatus,
      props.statusBar?.loading,
      showStartupSkeleton,
    ],
  );
  const connection =
    props.sidebar.workspaceConnectionStateById[props.selectedWorkspaceId];
  const selectedWorkspaceConnectionMessage = connection?.status === "error"
    ? connection.message?.trim() ?? ""
    : "";
  const selectedWorkspaceGroupError = props.sidebar.workspaceSessionGroups.find(
    (item) => item.workspace.id === props.selectedWorkspaceId,
  )?.error?.trim() ?? "";
  const selectedWorkspaceErrorMessage =
    props.selectedWorkspaceError?.trim() ||
    selectedWorkspaceConnectionMessage ||
    selectedWorkspaceGroupError;
  const showSelectedWorkspaceError = Boolean(selectedWorkspaceErrorMessage);
  const blockExpertSurfaceForWorkspaceError =
    shouldBlockExpertSurfaceForWorkspaceError({
      selectedSessionId: props.selectedSessionId,
      showSelectedWorkspaceError,
    });
  const selectedWorkspaceErrorTitle =
    props.selectedWorkspaceDisplay.workspaceType === "remote"
      ? "Remote workspace unavailable"
      : "Agent runtime unavailable";
  const reactSessionBaseUrl = props.opencodeBaseUrl?.trim() ?? "";
  const reactSessionToken =
    props.onmyagentServerToken?.trim() ||
    props.onmyagentServerClient?.token?.trim() ||
    "";
  const renderedSessionId = input.expertSurfaceMode.sessionId;
  const isDraftSession = input.expertSurfaceMode.draftOnly;
  const canvasSessionKey = createCanvasSessionKey({
    workspaceId: props.selectedWorkspaceId,
    sessionId: renderedSessionId,
    surface: "expert",
  });
  const canRenderReactSurface = Boolean(
    props.runtimeWorkspaceId &&
    props.onmyagentServerClient &&
    reactSessionBaseUrl &&
    reactSessionToken &&
    props.surface,
  );
  const showBlockingStartupSkeleton = showStartupSkeleton && !canRenderReactSurface;
  const directoryView = resolveExpertDirectoryView({
    activeChat: hostState.activeSidebarView === "chat" && !input.showDraftChrome,
    directoryState: input.directoryPage.state,
    selectedSessionId: input.effectiveSelectedSessionId,
    hasAnyExpertConversation: input.hasAnyExpertConversation,
    showWorkspaceSetupEmptyState,
    showSelectedWorkspaceError,
    showBlockingStartupSkeleton,
    showDraftChrome: input.showDraftChrome,
  });
  const showNoExpertConversationEmptyState = directoryView.showNoExpertConversation;
  const showExpertDirectoryLoading = directoryView.showLoadingWithoutSelection;
  const showExpertDirectoryIncomplete = directoryView.showIncompleteWithoutSelection;
  const mountExpertSessionSurface = shouldMountExpertSessionSurface({
    canRenderReactSurface,
    blockForWorkspaceError: blockExpertSurfaceForWorkspaceError,
    showNoExpertConversationEmptyState,
    showDirectoryIncomplete: showExpertDirectoryIncomplete,
    showDirectoryLoading: showExpertDirectoryLoading,
    isDraftSession,
    showDraftChrome: input.showDraftChrome,
    surfaceSessionId: renderedSessionId,
  });
  const activePlaceholderView = isPrimaryOrHostedRailView(hostState.activeSidebarView)
    ? null
    : hostState.activeSidebarView;

  useEffect(() => {
    if (!showSessionLoadingState) {
      setShowDelayedSessionLoadingState(false);
      return;
    }
    const id = window.setTimeout(() => setShowDelayedSessionLoadingState(true), 1000);
    return () => window.clearTimeout(id);
  }, [showSessionLoadingState]);

  const query = hostState.historySearchQuery.trim();
  const historyMatchLabel = query
    ? hostState.historyMatchCount > 0
      ? `${(hostState.historyActiveMatch % hostState.historyMatchCount) + 1}/${hostState.historyMatchCount}`
      : "0/0"
    : "";
  const headerPanelControls = (
    <SessionHistorySearchChrome
      searchOpen={hostState.historySearchOpen}
      searchQuery={hostState.historySearchQuery}
      matchLabel={historyMatchLabel}
      matchCount={hostState.historyMatchCount}
      shortcutLabel={formatShortcut(["Mod", "F"])}
      inputRef={hostState.historySearchInputRef}
      onQueryChange={hostState.setHistorySearchQuery}
      onOpen={hostState.openHistorySearch}
      onClose={hostState.closeHistorySearch}
      onPrev={() => hostState.setHistoryActiveMatch((i) =>
        hostState.historyMatchCount
          ? (i - 1 + hostState.historyMatchCount) % hostState.historyMatchCount
          : 0
      )}
      onNext={() => hostState.setHistoryActiveMatch((i) =>
        hostState.historyMatchCount ? (i + 1) % hostState.historyMatchCount : 0
      )}
      onEnterNavigate={(shiftKey) => hostState.setHistoryActiveMatch((i) =>
        shiftKey
          ? (i - 1 + hostState.historyMatchCount) % hostState.historyMatchCount
          : (i + 1) % hostState.historyMatchCount
      )}
      historyPopover={
        <ConversationHistoryPopover
          client={props.onmyagentServerClient}
          workspaceId={props.runtimeWorkspaceId ?? props.selectedWorkspaceId}
          sessionId={
            input.expertHistorySessionId &&
            !input.expertHistorySessionId.startsWith("draft:")
              ? input.expertHistorySessionId
              : props.selectedSessionId
          }
          onSelectPrompt={input.handleHistorySelectPrompt}
        />
      }
      sidePanelOpen={hostState.sidePanelOpen}
      onToggleSidePanel={(event) => {
        event.stopPropagation();
        input.openExpertSidePanelMenu();
      }}
    />
  );

  return {
    activePlaceholderView,
    blockExpertSurfaceForWorkspaceError,
    canRenderReactSurface,
    canvasSessionKey,
    headerPanelControls,
    isDraftSession,
    mountExpertSessionSurface,
    reactSessionBaseUrl,
    reactSessionToken,
    renderedSessionId,
    selectedWorkspaceErrorMessage,
    selectedWorkspaceErrorTitle,
    showBlockingStartupSkeleton,
    showDelayedSessionLoadingState,
    showExpertDirectoryIncomplete,
    showExpertDirectoryLoading,
    showNoExpertConversationEmptyState,
    showSelectedWorkspaceError,
    showWorkspaceSetupEmptyState,
    taskStatus,
  };
}
