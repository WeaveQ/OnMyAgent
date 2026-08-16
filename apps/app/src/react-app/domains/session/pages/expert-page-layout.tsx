/** @jsxImportSource react */
/**
 * Presentational layout for ExpertPage.
 * Extracted from expert.tsx (P1-5 residual file-size split).
 */
import { Plus } from "lucide-react";
import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { OwDotTicker } from "../../../shell";
import { PersonalLocalAgentPage } from "../../local-agents";
import { SessionArchivePage } from "../chat/session-page-session-archive-page";
import {
  SessionPageMainColumn,
  SessionRailKeepAliveStack,
} from "./session-page-shell";
import { AgentManagementPage } from "../../local-agents";
import { MessagingChannelsPage } from "../../messaging";
import { WorkspaceFilesPage } from "../../workspace";
import {
  AgentConversationPanel,
  AgentPanelResizeHandle,
  SidebarPaneCollapseToggle,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
} from "../sidebar/session-chrome";
import { SessionStartupSkeleton } from "./session-startup-skeleton";
import {
  BillingPage,
  DevicesPage,
  KnowledgeBaseComingSoonPage,
  ProjectsComingSoonPage,
  SidebarFeaturePlaceholder,
  StorePage,
} from "../components/side-panel-pages";
import { CompanyRailPane } from "../components/company-rail-pane";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

import {
  createWorkspaceFilesAgentHandlers,
} from "./shared-page-utils";
import { buildAskAgentFileInstruction } from "../../../capabilities/artifacts/file-preview-policy";
import {
  NO_EXPERT_CONVERSATIONS_ASSET,
} from "./expert-page-utils";
import { EmptyStateIllustration } from "@/react-app/design-system/empty-state-illustration";
import {
  ExpertDirectoryIncompleteNotice,
  ExpertDirectoryMissingSkillsNotice,
} from "./expert-directory-incomplete-notice";

import { ExpertPageAfterPrimary, ExpertPageSessionSurface } from "./expert-page-main-surface";
import { ExpertPageModals } from "./expert-page-modals";
import { ExpertPageRail } from "./expert-page-rail";
import { ExpertPageSidePanel } from "./expert-page-side-panel";

import type { useExpertPage } from "./use-expert-page";

export type ExpertPageLayoutProps = {
  m: ReturnType<typeof useExpertPage>;
};

export function ExpertPageLayout({ m }: ExpertPageLayoutProps) {
  const { host, rail, surface, sidePanel, modals } = m;
  const { props, navigate, localAuthUser, showToast } = host;
  const {
    activeConversationAgentId,
    activeDraftSessionId,
    activePlaceholderView,
    activeSidebarView,
    agentPanelCollapsed,
    agentPanelWidth,
    agentSearch,
    conversationGroups,
    conversationTabs,
    deletableExpertIds,
    draftAgentGroup,
    draftAgentGroups,
    draftSessionActive,
    editableExpertIds,
    expertDirectoryIdentity,
    handleChatWithSkill,
    handleCreateCurrentAgentSession,
    handleCreateSkill,
    handleEditExpert,
    handleEditSkill,
    handleOpenDraftSession,
    handleOpenExpertFromSidebar,
    handleOpenExpertStarter,
    handleStartAgentConversation,
    handleStartMarketplaceExpert,
    myExpertPackages,
    openCustomConnector,
    openDeleteExpertModal,
    openDeleteModal,
    openExpertCreation,
    openExpertMarket,
    openRailView,
    pendingArchiveResume,
    setAgentPanelCollapsed,
    setAgentPanelWidth,
    setAgentSearch,
    setPendingArchiveResume,
    setStoreActiveTab,
    sidebarWorkspaceSessionGroups,
    startAgentPanelResize,
    storeActiveTab,
    taskStatus,
    visitedRailViews,
    handleSelectArtifactPrompt,
  } = rail;
  const {
    activeAgentContext,
    activeExpertFeatureCategoryId,
    automationOfferFlow,
    automationResultAccessory,
    blockExpertSurfaceForWorkspaceError,
    canRenderReactSurface,
    effectiveActiveQuestion,
    effectiveRespondQuestion,
    expertDirectoryMissingSkills,
    headerPanelControls,
    historyActiveMatch,
    historySearchOpen,
    historySearchQuery,
    isDraftSession,
    isPrimarySessionView,
    mountExpertSessionSurface,
    reactSessionBaseUrl,
    reactSessionToken,
    renderedSessionId,
    selectedWorkspaceErrorMessage,
    selectedWorkspaceErrorTitle,
    setHistoryMatchCount,
    showBlockingStartupSkeleton,
    showDelayedSessionLoadingState,
    showExpertDirectoryIncomplete,
    showExpertDirectoryLoading,
    showNoExpertConversationEmptyState,
    showSelectedWorkspaceError,
    showWorkspaceSetupEmptyState,
    wrappedOnSendDraft,
  } = surface;
  const {
    activeSidePanel,
    artifactFileTargets,
    artifactFocusToken,
    artifactTarget,
    browserPanelRef,
    canvasSessionKey,
    closeRightPane,
    codeWorkspaceCatalogRoot,
    codeWorkspacePath,
    commitBrowserPanelWidth,
    filesOpenSessionMeta,
    handleOpenTargetsChange,
    openCreatedAutomation,
    openTarget,
    sidePanelOpen,
    snapToBrowserWidth,
  } = sidePanel;
  const {
    agentCreateRequestKey,
    canSaveRename,
    closeDeleteModal,
    closeExpertCreation,
    closeExpertCreationThen,
    closeRenameModal,
    confirmDelete,
    customConnectorInitialView,
    customConnectorOpen,
    deleteBusy,
    deleteOpen,
    expertCreationPage,
    expertDeleteConfirmLabel,
    expertDeleteMessage,
    expertDeleteTitle,
    renameBusy,
    renameOpen,
    renameTitle,
    setAgentCreateRequestKey,
    setCustomConnectorOpen,
    setRenameTitle,
    submitRename,
  } = modals;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-dls-radial-shell text-dls-text mac:bg-transparent">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-3 mac:pointer-events-auto mac:titlebar-drag" />
      {/*
        Keep primary rail outside bg-dls-background so mac vibrancy can show
        through the strip (WeChat). Background wash only covers list + content.
      */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <ExpertPageRail
          account={props.account}
          selectedWorkspaceId={props.selectedWorkspaceId}
          onNavigateToMode={props.onNavigateToMode}
          onOpenAccountSettings={props.onOpenAccountSettings}
          onOpenProfile={props.onOpenProfile}
          onSignOut={props.onSignOut}
          activeSidebarView={activeSidebarView}
          closeExpertCreation={closeExpertCreation}
          closeExpertCreationThen={closeExpertCreationThen}
          openRailView={openRailView}
          navigate={navigate}
          setAgentPanelCollapsed={setAgentPanelCollapsed}
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
                expertDirectoryIdentity={expertDirectoryIdentity}
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
                    primarySessionActive={
                      isPrimarySessionView && mountExpertSessionSurface
                    }
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
                          activeExpertAgentIds={[
                            ...conversationGroups.map((group) => group.agentId),
                            ...draftAgentGroups.map((group) => group.agentId),
                          ].filter((id): id is string => Boolean(id?.trim()))}
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
                      knowledgeBase: <KnowledgeBaseComingSoonPage />,
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
                      activeSidebarView !== "knowledgeBase" &&
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

                      {isPrimarySessionView && showExpertDirectoryLoading ? (
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

                      {isPrimarySessionView && showExpertDirectoryIncomplete ? (
                        <ExpertDirectoryIncompleteNotice />
                      ) : null}

                      {isPrimarySessionView ? (
                        <ExpertDirectoryMissingSkillsNotice
                          missingSkills={expertDirectoryMissingSkills}
                        />
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
                      <ExpertPageSessionSurface
                        surface={props.surface!}
                        onmyagentServerClient={props.onmyagentServerClient}
                        runtimeWorkspaceId={props.runtimeWorkspaceId!}
                        todos={props.todos}
                        activePermission={props.activePermission}
                        permissionReplyBusy={props.permissionReplyBusy}
                        respondPermission={props.respondPermission}
                        autoApprovedPermissionNoticeId={props.autoApprovedPermissionNoticeId}
                        questionReplyBusy={props.questionReplyBusy}
                        safeStringify={props.safeStringify}
                        account={props.account}
                        mountExpertSessionSurface={mountExpertSessionSurface}
                        wrappedOnSendDraft={wrappedOnSendDraft}
                        renderedSessionId={renderedSessionId}
                        isDraftSession={isDraftSession}
                        isPrimarySessionView={isPrimarySessionView}
                        reactSessionBaseUrl={reactSessionBaseUrl}
                        reactSessionToken={reactSessionToken}
                        effectiveActiveQuestion={effectiveActiveQuestion}
                        effectiveRespondQuestion={effectiveRespondQuestion}
                        automationOfferFlow={automationOfferFlow}
                        automationResultAccessory={automationResultAccessory}
                        localAuthUser={localAuthUser}
                        draftSessionActive={draftSessionActive}
                        headerPanelControls={headerPanelControls}
                        conversationTabs={conversationTabs}
                        historySearchOpen={historySearchOpen}
                        historySearchQuery={historySearchQuery}
                        historyActiveMatch={historyActiveMatch}
                        setHistoryMatchCount={setHistoryMatchCount}
                        openTarget={openTarget}
                        handleOpenTargetsChange={handleOpenTargetsChange}
                        activeExpertFeatureCategoryId={activeExpertFeatureCategoryId}
                        activeAgentContext={activeAgentContext}
                        setStoreActiveTab={setStoreActiveTab}
                        openRailView={openRailView}
                        openCustomConnector={openCustomConnector}
                      />
                    }
                    afterPrimary={
                      <ExpertPageAfterPrimary
                        selectedSessionId={props.selectedSessionId}
                        notFoundMessage={props.notFoundMessage}
                        sidebar={props.sidebar}
                        selectedWorkspaceId={props.selectedWorkspaceId}
                        isPrimarySessionView={isPrimarySessionView}
                        showNoExpertConversationEmptyState={showNoExpertConversationEmptyState}
                        showDelayedSessionLoadingState={showDelayedSessionLoadingState}
                        canRenderReactSurface={canRenderReactSurface}
                        blockExpertSurfaceForWorkspaceError={blockExpertSurfaceForWorkspaceError}
                        showBlockingStartupSkeleton={showBlockingStartupSkeleton}
                        showWorkspaceSetupEmptyState={showWorkspaceSetupEmptyState}
                        showSelectedWorkspaceError={showSelectedWorkspaceError}
                        selectedWorkspaceErrorMessage={selectedWorkspaceErrorMessage}
                        selectedWorkspaceErrorTitle={selectedWorkspaceErrorTitle}
                      />
                    }
                  />
                </SessionPageMainColumn>

              </ResizablePanel>
              <ExpertPageSidePanel
                settingsSlot={props.settingsSlot}
                selectedSessionFileRoot={props.selectedSessionFileRoot}
                runtimeWorkspaceId={props.runtimeWorkspaceId}
                selectedSessionId={props.selectedSessionId}
                onmyagentServerClient={props.onmyagentServerClient}
                sidePanelOpen={sidePanelOpen}
                isPrimarySessionView={isPrimarySessionView}
                browserPanelRef={browserPanelRef}
                activeSidePanel={activeSidePanel}
                canvasSessionKey={canvasSessionKey}
                closeRightPane={closeRightPane}
                codeWorkspacePath={codeWorkspacePath}
                codeWorkspaceCatalogRoot={codeWorkspaceCatalogRoot}
                artifactFileTargets={artifactFileTargets}
                artifactTarget={artifactTarget}
                artifactFocusToken={artifactFocusToken}
                openCreatedAutomation={openCreatedAutomation}
                snapToBrowserWidth={snapToBrowserWidth}
                activeExpertFeatureCategoryId={activeExpertFeatureCategoryId}
              />
            </ResizablePanelGroup>
            {expertCreationPage}
          </div>
        </div>

      <ExpertPageModals
        selectedWorkspaceId={props.selectedWorkspaceId}
        selectedWorkspaceRoot={props.selectedWorkspaceRoot}
        onmyagentServerClient={props.onmyagentServerClient}
        providers={props.providers}
        providerConnectedIds={props.providerConnectedIds}
        renderAgentsPage={props.renderAgentsPage}
        providerAuthModal={props.providerAuthModal}
        shareWorkspaceModal={props.shareWorkspaceModal}
        onRenameSession={props.onRenameSession}
        agentCreateRequestKey={agentCreateRequestKey}
        handleStartAgentConversation={handleStartAgentConversation}
        setAgentCreateRequestKey={setAgentCreateRequestKey}
        renameOpen={renameOpen}
        renameTitle={renameTitle}
        renameBusy={renameBusy}
        canSaveRename={canSaveRename}
        closeRenameModal={closeRenameModal}
        submitRename={submitRename}
        setRenameTitle={setRenameTitle}
        deleteOpen={deleteOpen}
        deleteBusy={deleteBusy}
        expertDeleteTitle={expertDeleteTitle}
        expertDeleteMessage={expertDeleteMessage}
        expertDeleteConfirmLabel={expertDeleteConfirmLabel}
        confirmDelete={confirmDelete}
        closeDeleteModal={closeDeleteModal}
        customConnectorOpen={customConnectorOpen}
        setCustomConnectorOpen={setCustomConnectorOpen}
        customConnectorInitialView={customConnectorInitialView}
        showToast={showToast}
      />

    </div>
  );
}
