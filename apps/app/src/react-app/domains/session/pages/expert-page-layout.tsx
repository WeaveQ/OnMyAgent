/** @jsxImportSource react */
/**
 * Presentational layout for ExpertPage.
 * Extracted from expert.tsx (P1-5 residual file-size split).
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, PanelRight, Plus, Search, X, Zap } from "lucide-react";
import { t } from "../../../../i18n";
import { formatShortcut } from "../../../../lib/format-shortcut";
import { readLocalAuthUser } from "../../../../app/lib/local-auth";
import type { ComposerDraft, SidebarSessionItem } from "../../../../app/types";
import type { OpenTarget } from "../artifacts/open-target";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/action-row";
import { NoticeBox } from "@/components/ui/notice-box";
import { CountBadge } from "@/components/ui/status-badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ProviderAuthModal } from "../../connections";
import { SessionSurface } from "../surface/session-surface";
import { useComposerStateStore } from "../surface/composer-state-store";
import { COMPOSER_TEMPLATE_EVENTS } from "../surface/composer/capability-template";
import { ShareWorkspaceModal } from "../../workspace";
import {
  DEFAULT_BROWSER_SIDE_PANEL_WIDTH,
  OwDotTicker,
  type SidePanelItem,
  useReactRenderWatchdog,
  useUiStateStore,
} from "../../../shell";
import { cn } from "@/lib/utils";
import { PersonalLocalAgentPage } from "../../local-agents";
import { ConversationHistoryPopover } from "../sidebar/conversation-history-popover";
import { SessionHistorySearchChrome } from "./session-history-search-chrome";
import { SessionArchivePage } from "../chat/session-page-session-archive-page";
import { createCanvasSessionKey } from "../infinite-canvas";
import {
  LazyCodeWorkspaceSidePanel,
  LazyInfiniteCanvasPanel,
} from "./lazy-session-side-panels";
import {
  SessionPageMainColumn,
  SessionRailKeepAliveStack,
} from "./session-page-shell";

import type { SessionPageProps } from "./session-page-types";

import {
  type AgentCardItem,
  type AgentRegistry,
  buildAgentToolAccess,
  buildAgentSystemPrompt,
  friendlyModelNameToModelRef,
  isExpertSession,
  isValidSdkModelRef,
  type PendingAgentContext,
  readCustomAgentIdForSession,
  readCustomAgentSessionEntries,
  resolveAgentAvatarUrl,
  useAgentRegistryStore,
  usePendingAgentStore,
  useSessionOriginHydrationDegraded,
  useSessionOriginHydrated,
} from "../../agents";
import { AgentManagementPage } from "../../local-agents";
import { MessagingChannelsPage } from "../../messaging";
import { WorkspaceFilesPage } from "../../workspace";
import { buildFilesOpenSessionMeta } from "./session-files-open-meta";
import {
  resolveExpertDeleteCopy,
  useExpertSessionDelete,
  type ExpertGroupDeleteTarget,
} from "./use-expert-session-delete";
import { useExpertHardDeleteUi } from "./use-expert-hard-delete-ui";
import {
  AgentConversationPanel,
  AgentSessionTabs,
  mergeStableSessionTabOrder,
  readExpertSessionSelection,
  resolveExpertSessionSelection,
  writeExpertSessionSelection,
  AgentPanelResizeHandle,
  SidebarPaneCollapseToggle,
  OnMyAgentRail,
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  shouldShowSessionStartupSkeleton,
  workspaceTaskStatus,
  isAutomationRailView,
  type OnMyAgentPrimaryView,
} from "../sidebar/session-chrome";
import { openAutomationRailPath } from "./open-automation-rail";
import { SessionStartupSkeleton } from "./session-startup-skeleton";
import {
  readExpertPinnedAgentIds,
  writeExpertPinnedAgentIds,
} from "../sidebar/conversation-model";
import { useExpertUnreadStore } from "../status/expert-unread-store";
import {
  BillingPage,
  DevicesPage,
  ProjectsComingSoonPage,
  SidebarFeaturePlaceholder,
  StorePage,
  type StorePrimaryTab,
} from "../components/side-panel-pages";
import { CompanyRailPane } from "../components/company-rail-pane";
import { isPrimaryOrHostedRailView } from "../navigation/rail-view-guards";
import { EmptyArtifactsPanel } from "../surface/chrome/empty-artifacts-panel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { CustomConnectorDialog } from "@/react-app/domains/plugins";
import { useStatusToasts } from "../../shell-feedback";
import {
  archiveAssistantTask,
  archivedSessionIdSet,
  assistantArchivedTasksChangedEvent,
  permanentlyRemoveAssistantArchivedTask,
  readAssistantArchivedTasks,
} from "../../shared";

import {
  createWorkspaceFilesAgentHandlers,
  setComposerDraftAfterNewTask,
  setExpertComposerDraftAfterNewTask,
} from "./shared-page-utils";
import { buildAskAgentFileInstruction } from "../../../capabilities/artifacts/file-preview-policy";
import {
  EXPERT_SIDE_PANEL_DEFAULT_WIDTH,
  EXPERT_SIDE_PANEL_MIN_WIDTH,
  NO_EXPERT_CONVERSATIONS_ASSET,
  expertFeatureCategoryForAgent,
} from "./expert-page-utils";
import { EmptyStateIllustration } from "@/react-app/design-system/empty-state-illustration";
import { useCustomConnectorDialog } from "./use-custom-connector-dialog";
import { useMyExpertPackages } from "./use-my-expert-packages";
import { useAgentPanelResize } from "./use-agent-panel-resize";
import { useSessionPageHostState } from "./use-session-page-host-state";
import {
  buildCurrentAgentSessions,
  buildDraftAgentGroups,
  buildExpertSidebarSessionGroups,
  buildExpertWorkspaceSessions,
  buildAgentConversationGroups,
  computeHasAnyExpertConversation,
  resolveExpertSidebarOpen,
  resolveActiveAgentContext,
  resolveActiveConversationGroup,
  selectRawWorkspaceSessions,
  shouldExitDraftForExpertSidebarTarget,
} from "./expert-conversation-model";
import { useExpertAutomationOffer } from "./use-expert-automation-offer";
import {
  shouldKeepUnboundExpertDraft,
} from "./expert-draft-session";
import { useExpertBoundDraftTransition } from "./use-expert-bound-draft-transition";
import { resolveColdOpenExpertSessionId } from "./order-conversation-groups";
import { useExpertSessionStarters } from "./use-expert-session-starters";
import { useExpertWaybillPatch } from "./use-expert-waybill-patch";
import { resolveExpertOriginHydrationView, shouldBlockExpertSurfaceForWorkspaceError } from "./expert-origin-hydration";
import { ExpertOriginRecoveryNotice } from "./expert-origin-recovery-notice";

import { useSessionTaskRenameDelete } from "./session-task-rename-delete";
import { SessionTaskRenameDeleteModals } from "./session-task-rename-delete-modals";
import { useExpertSkillNavigation } from "./use-expert-skill-navigation";
import { useSessionExpertCreation } from "./use-session-expert-creation";
import { useOpenExpertSession } from "./use-open-expert-session";


import type { useExpertPage } from "./use-expert-page";

export type ExpertPageLayoutProps = {
  m: ReturnType<typeof useExpertPage>;
};

export function ExpertPageLayout({ m }: ExpertPageLayoutProps) {
  const {
    props,
    activeAgentContext,
    activeConversationAgentId,
    activeDraftSessionId,
    activeExpertFeatureCategoryId,
    activePlaceholderView,
    activeSidePanel,
    activeSidebarView,
    agentCreateRequestKey,
    agentPanelCollapsed,
    agentPanelWidth,
    agentSearch,
    artifactFileTargets,
    artifactFocusToken,
    artifactTarget,
    automationOfferFlow,
    automationResultAccessory,
    blockExpertSurfaceForWorkspaceError,
    browserPanelRef,
    canRenderReactSurface,
    canSaveRename,
    canvasSessionKey,
    closeDeleteModal,
    closeExpertCreation,
    closeExpertCreationThen,
    closeRenameModal,
    closeRightPane,
    codeWorkspaceCatalogRoot,
    codeWorkspacePath,
    commitBrowserPanelWidth,
    confirmDelete,
    conversationGroups,
    conversationTabs,
    customConnectorInitialView,
    customConnectorOpen,
    deletableExpertIds,
    deleteBusy,
    deleteOpen,
    draftAgentGroup,
    draftAgentGroups,
    draftSessionActive,
    editableExpertIds,
    effectiveActiveQuestion,
    effectiveRespondQuestion,
    expertCreationPage,
    expertDeleteConfirmLabel,
    expertDeleteMessage,
    expertDeleteTitle,
    filesOpenSessionMeta,
    handleChatWithSkill,
    handleCreateCurrentAgentSession,
    handleCreateSkill,
    handleEditExpert,
    handleEditSkill,
    handleOpenDraftSession,
    handleOpenExpertFromSidebar,
    handleOpenExpertStarter,
    handleOpenTargetsChange,
    handleSelectArtifactPrompt,
    handleStartAgentConversation,
    handleStartMarketplaceExpert,
    headerPanelControls,
    historyActiveMatch,
    historySearchOpen,
    historySearchQuery,
    isDraftSession,
    isPrimarySessionView,
    localAuthUser,
    myExpertPackages,
    navigate,
    openCreatedAutomation,
    openCustomConnector,
    openDeleteExpertModal,
    openDeleteModal,
    openExpertCreation,
    openExpertMarket,
    openRailView,
    openTarget,
    pendingArchiveResume,
    reactSessionBaseUrl,
    reactSessionToken,
    renameBusy,
    renameOpen,
    renameTitle,
    renderedSessionId,
    selectedWorkspaceErrorMessage,
    selectedWorkspaceErrorTitle,
    setAgentCreateRequestKey,
    setAgentPanelCollapsed,
    setAgentPanelWidth,
    setAgentSearch,
    setCustomConnectorOpen,
    setHistoryMatchCount,
    setPendingArchiveResume,
    setRenameTitle,
    setStoreActiveTab,
    showBlockingStartupSkeleton,
    showDelayedSessionLoadingState,
    showExpertOriginHydrationDegraded,
    showExpertOriginHydrationLoading,
    showNoExpertConversationEmptyState,
    showSelectedWorkspaceError,
    showToast,
    showWorkspaceSetupEmptyState,
    sidePanelOpen,
    sidebarWorkspaceSessionGroups,
    snapToBrowserWidth,
    startAgentPanelResize,
    storeActiveTab,
    submitRename,
    taskStatus,
    visitedRailViews,
    wrappedOnSendDraft,
  } = m;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-dls-radial-shell text-dls-text mac:bg-transparent">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-3 mac:pointer-events-auto mac:titlebar-drag" />
      {/*
        Keep primary rail outside bg-dls-background so mac vibrancy can show
        through the strip (WeChat). Background wash only covers list + content.
      */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <OnMyAgentRail
          activeView={
            isAutomationRailView(activeSidebarView) ? "automation" : activeSidebarView
          }
          account={props.account}
          onOpenView={(view) => {
            closeExpertCreation();
            if (view === "assistant") {
              props.onNavigateToMode("assistant");
              return;
            }
            if (isAutomationRailView(view)) {
              const path = openAutomationRailPath(props.selectedWorkspaceId);
              if (path) navigate(path);
              return;
            }
            openRailView(view);
            if (view === "chat") setAgentPanelCollapsed(false);
          }}
          onOpenAccountSettings={closeExpertCreationThen(props.onOpenAccountSettings)}
          onOpenProfile={closeExpertCreationThen(props.onOpenProfile)}
          onSignOut={props.onSignOut}
          onOpenDevices={closeExpertCreationThen(() => openRailView("devices"))}
          onOpenBilling={closeExpertCreationThen(() => openRailView("billing"))}
        />
        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-dls-background mac:bg-dls-background">
            {activeSidebarView === "chat" && !agentPanelCollapsed ? (
              <AgentConversationPanel
                mode="agent"
                width={agentPanelWidth}
                client={props.onmyagentServerClient}
                taskStatusVariant={taskStatus.variant}
                collapsed={agentPanelCollapsed}
                groups={sidebarWorkspaceSessionGroups}
                selectedWorkspaceId={props.sidebar.selectedWorkspaceId}
                selectedSessionId={
                  draftSessionActive
                    ? activeDraftSessionId
                    : props.sidebar.selectedSessionId
                }
                selectedAgentId={activeConversationAgentId}
                sessionStatusById={props.sidebar.sessionStatusById}
                draftAgentGroup={draftAgentGroup}
                draftAgentGroups={draftAgentGroups}
                query={agentSearch}
                onQueryChange={setAgentSearch}
                onToggleCollapsed={() =>
                  setAgentPanelCollapsed((value) => !value)
                }
                onOpenAgents={openExpertMarket}
                onCreateExpert={openExpertCreation} onEditExpert={handleEditExpert} editableExpertIds={editableExpertIds}
                deletableExpertIds={deletableExpertIds}
                onOpenAgentStarter={handleOpenExpertStarter}
                onCreateTask={handleCreateCurrentAgentSession}
                onOpenSession={handleOpenExpertFromSidebar}
                onOpenDraftAgent={handleOpenDraftSession}
                onPrefetchSession={props.sidebar.onPrefetchSession}
                onDeleteSession={openDeleteModal}
                onDeleteExpert={openDeleteExpertModal}
              />
            ) : null}
            {activeSidebarView === "chat" ? (
              <SidebarPaneCollapseToggle
                collapsed={agentPanelCollapsed}
                onToggle={() => setAgentPanelCollapsed((value) => !value)}
                style={{
                  left: agentPanelCollapsed ? 0 : agentPanelWidth,
                }}
              />
            ) : null}
            {activeSidebarView === "chat" && !agentPanelCollapsed ? (
              <AgentPanelResizeHandle
                onPointerDown={startAgentPanelResize}
                onKeyNudge={(delta) =>
                  setAgentPanelWidth((width) =>
                    Math.min(
                      AGENT_PANEL_MAX_WIDTH,
                      Math.max(AGENT_PANEL_MIN_WIDTH, width + delta),
                    ),
                  )
                }
              />
            ) : null}
            <ResizablePanelGroup
              orientation="horizontal"
              onLayoutChanged={
                sidePanelOpen && isPrimarySessionView
                  ? commitBrowserPanelWidth
                  : undefined
              }
              className="min-h-0 flex-1"
            >
              <ResizablePanel minSize="360px" className="min-w-0">
                <SessionPageMainColumn
                  activeSidebarView={activeSidebarView}
                  sidePanelBorderOpen={sidePanelOpen && isPrimarySessionView}
                >
                  <SessionRailKeepAliveStack
                    activeSidebarView={activeSidebarView}
                    visitedRailViews={visitedRailViews}
                    isPrimarySessionView={isPrimarySessionView}
                    primarySessionActive={isPrimarySessionView}
                    panes={{
                      agents: props.renderAgentsPage({
                        workspaceId: props.selectedWorkspaceId,
                        workspaceRoot: props.selectedWorkspaceRoot,
                        client: props.onmyagentServerClient,
                        providers: props.providers,
                        connectedProviderIds: props.providerConnectedIds,
                        onStartConversation: handleStartAgentConversation,
                      }),
                      store: (
                        <StorePage
                          workspaceId={props.selectedWorkspaceId}
                          workspaceRoot={props.selectedWorkspaceRoot}
                          client={props.onmyagentServerClient}
                          activeTab={storeActiveTab}
                          myExperts={myExpertPackages}
                          activeExpertAgentIds={conversationGroups
                            .map((group) => group.agentId)
                            .filter((id): id is string => Boolean(id?.trim()))}
                          onActiveTabChange={setStoreActiveTab}
                          onSummonMarketplaceExpert={handleStartMarketplaceExpert}
                          onCreateExpert={openExpertCreation}
                          onCreateSkill={handleCreateSkill}
                          onChatWithSkill={handleChatWithSkill}
                          onEditSkill={handleEditSkill}
                          onSelectArtifactPrompt={handleSelectArtifactPrompt}
                          onOpenCustomConnector={() => openCustomConnector("list")}
                        />
                      ),
                      company: <CompanyRailPane onChatWithSkill={handleChatWithSkill} />,
                      localAgent: (
                        <PersonalLocalAgentPage
                          resumeRequest={pendingArchiveResume}
                          onResumeConsumed={() => setPendingArchiveResume(null)}
                          workspaceRoot={props.selectedWorkspaceRoot}
                          workspaceName={props.selectedWorkspaceDisplay.name}
                          onmyagentServerClient={props.onmyagentServerClient}
                          runtimeWorkspaceId={props.runtimeWorkspaceId ?? props.selectedWorkspaceId}
                          onOpenArtifact={openTarget}
                          onOpenTargetsChange={handleOpenTargetsChange}
                        />
                      ),
                      agentManagement: (
                        <AgentManagementPage
                          workspaceRoot={props.selectedWorkspaceRoot}
                          sessionArchiveSlot={(
                            <SessionArchivePage
                              client={props.onmyagentServerClient}
                              workspaceId={props.runtimeWorkspaceId ?? props.selectedWorkspaceId}
                              onResume={(request) => {
                                setPendingArchiveResume(request);
                                openRailView("localAgent");
                              }}
                            />
                          )}
                        />
                      ),
                      files: (active) => (
                        <WorkspaceFilesPage active={active}
                          client={props.onmyagentServerClient}
                          workspaceId={
                            props.runtimeWorkspaceId ??
                            props.selectedWorkspaceId
                          }
                          workspaceRoot={
                            props.workspaceFilesRoot?.trim() ||
                            props.selectedWorkspaceRoot
                          }
                          fileRoot={
                            props.workspaceFilesRoot?.trim() ||
                            props.selectedWorkspaceRoot
                          }
                          activeSessionIds={filesOpenSessionMeta.activeSessionIds}
                          archivedSessionIds={
                            filesOpenSessionMeta.archivedSessionIds
                          }
                          sessionTitleByKey={
                            filesOpenSessionMeta.sessionTitleByKey
                          }
                          sessionIdByPathKey={
                            filesOpenSessionMeta.sessionIdByPathKey
                          }
                          onOpenSourceSession={(sessionId) => {
                            props.sidebar.onOpenSession(
                              props.selectedWorkspaceId,
                              sessionId,
                            );
                            openRailView("chat");
                          }}
                          onOpenArtifact={openTarget}
                          {...createWorkspaceFilesAgentHandlers({
                            sessionId: renderedSessionId,
                            openRail: () => openRailView("chat"),
                            showToast,
                            buildInstruction: buildAskAgentFileInstruction,
                            t,
                          })}
                        />
                      ),
                      projects: <ProjectsComingSoonPage />,
                      devices: <DevicesPage />,
                      channels: (
                        <MessagingChannelsPage workspaceRoot={props.selectedWorkspaceRoot} />
                      ),
                      billing: <BillingPage />,
                    }}
                    middle={
                      <>
                      {activePlaceholderView &&
                      activeSidebarView !== "agents" &&
                      activeSidebarView !== "files" &&
                      activeSidebarView !== "store" &&
                      activeSidebarView !== "company" &&
                      activeSidebarView !== "projects" &&
                      activeSidebarView !== "localAgent" &&
                      activeSidebarView !== "agentManagement" &&
                      activeSidebarView !== "devices" &&
                      activeSidebarView !== "channels" &&
                      activeSidebarView !== "billing" ? (
                        <SidebarFeaturePlaceholder
                          view={activePlaceholderView}
                        />
                      ) : null}

                      {isPrimarySessionView && showBlockingStartupSkeleton ? (
                        <SessionStartupSkeleton />
                      ) : null}

                      {isPrimarySessionView && showExpertOriginHydrationLoading ? (
                        <div className="px-6 py-16">
                          <div
                            className="mx-auto flex max-w-[320px] flex-col items-center gap-3 text-center"
                            role="status"
                            aria-live="polite"
                          >
                            <OwDotTicker size="md" />
                            <div className="text-xs leading-5 text-dls-secondary">
                              {t("session.loading_detail")}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {isPrimarySessionView && showExpertOriginHydrationDegraded ? (
                        <ExpertOriginRecoveryNotice />
                      ) : null}

                      {isPrimarySessionView &&
                      showNoExpertConversationEmptyState ? (
                        <div className="flex h-full min-h-0 items-center justify-center px-8 py-10">
                          <div className="flex max-w-md flex-col items-center text-center">
                            <EmptyStateIllustration
                              src={NO_EXPERT_CONVERSATIONS_ASSET}
                            />
                            <h2 className="text-lg font-medium tracking-tight text-dls-text">
                              {t("session.no_expert_conversations_title")}
                            </h2>
                            <p className="mt-2 max-w-sm text-sm leading-6 text-dls-secondary">
                              {t("session.no_expert_conversations_desc")}
                            </p>
                            <Button
                              type="button"
                              size="default"
                              className="mt-5 gap-1.5"
                              onClick={openExpertMarket}
                              data-testid="expert-empty-open-market"
                            >
                              <Plus className="size-4" strokeWidth={2} />
                              {t("session.no_expert_conversations_action")}
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      {isPrimarySessionView &&
                      !showNoExpertConversationEmptyState &&
                      showDelayedSessionLoadingState ? (
                        <div className="px-6 py-16">
                          <div
                            className="mx-auto flex max-w-[320px] flex-col items-center gap-3 text-center"
                            role="status"
                            aria-live="polite"
                          >
                            <OwDotTicker size="md" />
                            <div className="text-xs leading-5 text-dls-secondary">
                              {t("session.loading_detail")}
                            </div>
                          </div>
                        </div>
                      ) : null}
                      </>
                    }
                    primarySession={
                      canRenderReactSurface &&
                      !blockExpertSurfaceForWorkspaceError &&
                      !showNoExpertConversationEmptyState &&
                      !showExpertOriginHydrationDegraded &&
                      !showExpertOriginHydrationLoading ? (
                          <SessionSurface
                            // Workspace-stable key: session switches are prop-driven.
                            key={props.runtimeWorkspaceId ?? "expert-surface"}
                            {...props.surface!}
                            onSendDraft={wrappedOnSendDraft}
                            client={props.onmyagentServerClient!}
                            workspaceId={props.runtimeWorkspaceId!}
                            sessionId={renderedSessionId}
                            draftOnly={isDraftSession}
                            surfaceVisible={isPrimarySessionView}
                            opencodeBaseUrl={reactSessionBaseUrl}
                            onmyagentToken={reactSessionToken}
                            todos={props.todos}
                            permission={{
                              ...props.surface!.permission,
                              activePermission: props.activePermission,
                              permissionReplyBusy: props.permissionReplyBusy,
                              respondPermission: props.respondPermission,
                              autoApprovedPermissionNoticeId:
                                props.autoApprovedPermissionNoticeId,
                              activeQuestion: effectiveActiveQuestion,
                              questionReplyBusy:
                                props.questionReplyBusy || automationOfferFlow.busy,
                              respondQuestion: effectiveRespondQuestion,
                            }}
                            extraComposerAccessory={automationResultAccessory}
                            safeStringify={props.safeStringify}
                            userIdentity={{
                              name:
                                localAuthUser?.username ||
                                props.account?.name ||
                                props.account?.email ||
                                t("session.current_user"),
                            }}
                            headerActions={draftSessionActive ? null : headerPanelControls}
                            conversationTabs={conversationTabs}
                            searchQuery={historySearchOpen ? historySearchQuery : ""}
                            searchActiveMatchIndex={historyActiveMatch}
                            onSearchMatchCountChange={setHistoryMatchCount}
                            onOpenTarget={openTarget}
                            onOpenTargetsChange={handleOpenTargetsChange}
                            personalAssistantHome={false}
                            assistantFeatureCategoryId={activeExpertFeatureCategoryId}
                            agentContext={activeAgentContext}
                            marketplace={{
                              ...props.surface!.marketplace,
                              onOpenSkillsMarketplace: () => {
                                setStoreActiveTab("skills");
                                openRailView("store");
                              },
                              onOpenConnectorsMarketplace: () => {
                                setStoreActiveTab("plugins");
                                openRailView("store");
                              },
                              onOpenCustomConnector: () => openCustomConnector("config"),
                            }}
                          />
                      ) : null
                    }
                    afterPrimary={
                      isPrimarySessionView &&
                      !showNoExpertConversationEmptyState &&
                      !showDelayedSessionLoadingState &&
                      (!canRenderReactSurface || blockExpertSurfaceForWorkspaceError) &&
                      !showBlockingStartupSkeleton ? (
                        <div
                          className={`mx-auto max-w-[800px] px-6 ${showWorkspaceSetupEmptyState ? "pt-20" : "pt-10"}`}
                        >
                          {props.notFoundMessage ? (
                            <div className="px-6 py-16 text-center">
                              <div className="mx-auto max-w-md rounded-xl border border-dls-border bg-dls-card px-5 py-6">
                                <h3 className="text-base font-medium text-dls-text">
                                  Workspace or session not found
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-dls-secondary">
                                  {props.notFoundMessage}
                                </p>
                              </div>
                            </div>
                          ) : showWorkspaceSetupEmptyState ? (
                            <div className="space-y-6 px-6 text-center">
                              <IconTile size="2xl" shape="xl" border className="mx-auto rounded-xl">
                                <Zap className="text-dls-secondary" />
                              </IconTile>
                              <div className="space-y-2">
                                <h3 className="text-xl font-medium">
                                  {t("session.create_or_connect_workspace")}
                                </h3>
                                <p className="mx-auto max-w-sm text-sm text-dls-secondary">
                                  {t("workspace.empty_state_body")}
                                </p>
                              </div>
                              <div className="flex justify-center">
                                <Button
                                  onClick={props.sidebar.onOpenCreateWorkspace}
                                >
                                  {t("workspace.create_workspace")}
                                </Button>
                              </div>
                            </div>
                          ) : showSelectedWorkspaceError ? (
                            <div className="px-6 py-16">
                              <NoticeBox className="mx-auto max-w-lg text-left" size="comfortable" tone="error">
                                <div className="font-medium">
                                  {selectedWorkspaceErrorTitle}
                                </div>
                                <p className="mt-2 whitespace-pre-wrap wrap-anywhere leading-6">
                                  {selectedWorkspaceErrorMessage}
                                </p>
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      props.sidebar.onCreateTaskInWorkspace(
                                        props.selectedWorkspaceId,
                                      )
                                    }
                                  >
                                    Retry
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      void Promise.resolve(
                                        props.sidebar.onTestWorkspaceConnection(
                                          props.selectedWorkspaceId,
                                        ),
                                      )
                                    }
                                  >
                                    {t("workspace_list.test_connection")}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      props.sidebar.onEditWorkspaceConnection(
                                        props.selectedWorkspaceId,
                                      )
                                    }
                                  >
                                    {t("workspace_list.edit_connection")}
                                  </Button>
                                  {props.sidebar.workspaceConnectionStateById[
                                    props.selectedWorkspaceId
                                  ]?.status === "error" ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        void Promise.resolve(
                                          props.sidebar.onRecoverWorkspace(
                                            props.selectedWorkspaceId,
                                          ),
                                        )
                                      }
                                    >
                                      {t("workspace_list.recover")}
                                    </Button>
                                  ) : null}
                                </div>
                              </NoticeBox>
                            </div>
                          ) : props.selectedSessionId ? (
                            <div className="px-6 py-16 text-center text-sm text-dls-secondary">
                              {t("session.loading_detail")}
                            </div>
                          ) : null}
                        </div>
                      ) : null
                    }
                  />
                </SessionPageMainColumn>

              </ResizablePanel>
              {sidePanelOpen && isPrimarySessionView ? (
                <>
                  {/* 2px gutter only — no center hairline (reads as a double seam). */}
                  <ResizableHandle className="hidden w-[2px] before:hidden lg:flex" />
                  <ResizablePanel
                    key="office-side-panel"
                    panelRef={browserPanelRef}
                    defaultSize={`${
                      activeSidePanel === "browser"
                        ? DEFAULT_BROWSER_SIDE_PANEL_WIDTH
                        : EXPERT_SIDE_PANEL_DEFAULT_WIDTH
                    }px`}
                    minSize={
                      `${EXPERT_SIDE_PANEL_MIN_WIDTH}px`
                    }
                    maxSize="70%"
                    // Match main workspace bg so the handle seam stays quiet.
                    className="min-h-0 overflow-hidden bg-dls-background lg:flex lg:flex-col"
                  >
                    {activeSidePanel === "canvas" ? (
                      <LazyInfiniteCanvasPanel
                        canvasKey={canvasSessionKey}
                        onClose={closeRightPane}
                      />
                    ) : activeSidePanel === "extensions" && props.settingsSlot ? (
                      <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-dls-background">
                        {props.settingsSlot}
                      </div>
                    ) : (
                      <LazyCodeWorkspaceSidePanel
                        workspacePath={codeWorkspacePath}
                        workspaceCatalogRoot={codeWorkspaceCatalogRoot}
                        fileRoot={props.selectedSessionFileRoot ?? ""}
                        fileTargets={artifactFileTargets}
                        focusPath={artifactTarget?.value ?? null}
                        focusToken={artifactFocusToken}
                        workspaceId={props.runtimeWorkspaceId}
                        sessionId={props.selectedSessionId}
                        automationSourceSessionId={props.selectedSessionId}
                        client={props.onmyagentServerClient}
                        initialKind={
                          activeSidePanel === "review"
                            ? "review"
                            : activeSidePanel === "terminal"
                              ? "terminal"
                              : activeSidePanel === "browser"
                                ? "browser"
                                : activeSidePanel === "artifacts"
                                  ? "files"
                                  : null
                        }
                        onClose={closeRightPane}
                        onBrowserOpen={snapToBrowserWidth}
                        onViewAutomation={openCreatedAutomation}
                        hiddenKinds={
                          activeExpertFeatureCategoryId === "office"
                            ? ["review"]
                            : undefined
                        }
                      />
                    )}
                  </ResizablePanel>
                </>
              ) : null}
            </ResizablePanelGroup>
            {expertCreationPage}
          </div>
        </div>

      {agentCreateRequestKey ? (
        props.renderAgentsPage({
          workspaceId: props.selectedWorkspaceId,
          workspaceRoot: props.selectedWorkspaceRoot,
          client: props.onmyagentServerClient,
          providers: props.providers,
          connectedProviderIds: props.providerConnectedIds,
          initialCreateRequestKey: agentCreateRequestKey,
          dialogOnly: true,
          onStartConversation: (item, registry) => {
            handleStartAgentConversation(item, registry);
            setAgentCreateRequestKey(null);
          },
        })
      ) : null}
      {props.providerAuthModal ? (
        <ProviderAuthModal {...props.providerAuthModal} />
      ) : null}

      <SessionTaskRenameDeleteModals
        canRename={Boolean(props.onRenameSession)}
        renameOpen={renameOpen}
        renameTitle={renameTitle}
        renameBusy={renameBusy}
        canSaveRename={canSaveRename}
        onRenameClose={closeRenameModal}
        onRenameSave={() => void submitRename()}
        onRenameTitleChange={setRenameTitle}
        showDelete={deleteOpen}
        deleteOpen={deleteOpen}
        deleteBusy={deleteBusy}
        deleteTitle={expertDeleteTitle}
        deleteMessage={expertDeleteMessage}
        deleteConfirmLabel={expertDeleteConfirmLabel}
        onDeleteConfirm={() => void confirmDelete()}
        onDeleteCancel={closeDeleteModal}
      />

      {props.shareWorkspaceModal ? (
        <ShareWorkspaceModal {...props.shareWorkspaceModal} />
      ) : null}

      <CustomConnectorDialog
        open={customConnectorOpen}
        onOpenChange={setCustomConnectorOpen}
        workspaceRoot={props.selectedWorkspaceRoot}
        initialView={customConnectorInitialView}
        onSaved={() => {
          showToast({
            title: t("plugins.custom_connector_saved"),
            tone: "success",
          });
        }}
      />
    </div>
  );
}
