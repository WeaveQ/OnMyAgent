/** @jsxImportSource react */
/**
 * Presentational layout for the personal local-agent host page
 * (list pane, transcript, composer chrome). Extracted from personal-local-agent-page
 * (P1-5 residual file-size split).
 */
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  Activity,
  CircleStop,
  Clock3,
  MessageSquare,
  Plus,
  RefreshCw,
  Settings2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SessionRowButton } from "@/components/ui/action-row";
import { NoticeBox } from "@/components/ui/notice-box";
import { CountBadge } from "@/components/ui/status-badge";
import { StatusPing } from "@/components/ui/status-dot";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { SelectMenu } from "../../../design-system/select-menu";
import {
  type PersonalLocalAgentApprovalMode,
} from "../../../../app/lib/desktop";
import { AgentBrandIcon } from "../agent-brand-icon";
import {
  LocalAgentDraftComposer,
} from "../local-agent-draft-composer";
import {
  APPROVAL_MODE_OPTIONS,
  LOCAL_AGENT_LIST_MAX_WIDTH,
  LOCAL_AGENT_LIST_MIN_WIDTH,
  agentIdFromChatKey,
} from "../local-agent-page-model";
import { LocalAgentStatusRail } from "../local-agent-status-rail";
import { ChatBubble } from "../messages/chat-bubble";
import {
  HeartbeatPanel,
  conversationTitle,
  heartbeatClass,
} from "../personal-local-agent-scheduled-tasks";
import { WorkspaceFootnote } from "../workspace-picker/workspace-footnote";
import { ListPaneCollapseToggle } from "./list-pane-collapse-toggle";
import { ActiveRunsOverview } from "./personal-local-agent-active-runs";
import {
  agentSubtitle,
  lastRunForAgent,
  localAgentLayoutClass,
  localAgentTextClass,
} from "./personal-local-agent-page-helpers";
import { PersonalLocalAgentModelSelector } from "./personal-local-agent-model-selector";
import type { PersonalLocalAgentPageModel } from "./use-personal-local-agent-page";

export function PersonalLocalAgentPageLayout(props: { m: PersonalLocalAgentPageModel }) {
  const {
    onOpenAgentManagement,
    onOpenArtifact,
    agentListCollapsed,
    agentListWidth,
    setAgentListCollapsed,
    setAgentListWidth,
    setShowActiveRunsPanel,
    showActiveRunsPanel,
    activeRuns,
    refreshing,
    refreshAgents,
    filteredAgents,
    activeRunIdByAgent,
    messagesByAgent,
    setSelectedAgentId,
    selectedAgentId,
    startAgentListResize,
    isChannelView,
    selectedAgent,
    selectedConversations,
    selectedConversationId,
    setSelectedChannelConversationId,
    setSelectedConversationIdByAgent,
    loadingConversationsByAgent,
    createNewConversation,
    canCreateConversation,
    creatingConversation,
    selectedAcpModelInfo,
    selectedModel,
    setSelectedModel,
    effectiveWorkspaceRoot,
    scheduledTasksButtonRef,
    setShowScheduledTasks,
    showScheduledTasks,
    selectedHeartbeatJobs,
    scheduledTasksPanelRef,
    heartbeatDraft,
    selectedConversation,
    heartbeatBusy,
    heartbeatError,
    setHeartbeatDraft,
    createHeartbeat,
    loadHeartbeats,
    runHeartbeatNow,
    updateHeartbeatEnabled,
    deleteHeartbeat,
    scrollRef,
    programmaticScrollRef,
    stickToBottomRef,
    selectedMessages,
    selectedError,
    draft,
    selectedChatKey,
    selectedSlashCommands,
    updateDraftForChat,
    handleSlashCommandExecute,
    running,
    composerContextUsage,
    submitComposerPayload,
    activeRun,
    cancelRun,
    displayWorkspaceRoot,
    workspaceRecentList,
    chipEditable,
    applyWorkspaceOverride,
    clearWorkspaceOverride,
    browseWorkspaceOverride,
    approvalMode,
    setApprovalMode,
    selectedCapability,
    cancelAgentRun,
    resolveApproval,
  } = props.m;

return (
  <div
    data-onmyagent-view="personal-assistant"
    // Transparent root so nested frosted layers do not lighten the list pane
    // vs assistant/expert AgentConversationPanel (sibling under one shell bg).
    className="relative flex h-full min-h-0 min-w-0 w-full overflow-hidden bg-transparent text-dls-text"
  >
    <aside
      className="flex shrink-0 flex-col overflow-hidden bg-dls-sidebar pb-5 mac:bg-dls-sidebar"
      style={{
        width: agentListCollapsed ? 0 : agentListWidth,
      }}
    >
      {agentListCollapsed ? null : (
        <>
          {/*
            mac:titlebar-no-drag + z-10: top 28px is a global Electron drag strip
            on macOS; interactive chrome must opt out or clicks are swallowed.
            List chrome only (runs / redetect / manage) — search field removed.
          */}
          <div className="relative z-10 flex h-14 shrink-0 items-center gap-1 border-b border-dls-mist px-3 pt-1.5 mac:titlebar-no-drag">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowActiveRunsPanel(true)}
                className="relative z-10 shrink-0 text-dls-secondary hover:bg-dls-hover hover:text-dls-text mac:titlebar-no-drag"
                title={t("local_agent.active_runs_title")}
                aria-label={t("local_agent.active_runs_title")}
                aria-expanded={showActiveRunsPanel}
              >
                <Activity className="size-4" />
                {activeRuns.length ? (
                  <CountBadge
                    size="dot"
                    className="absolute right-0 top-0 translate-x-1/2 -translate-y-1/2 bg-dls-accent text-dls-surface"
                  >
                    {activeRuns.length}
                  </CountBadge>
                ) : null}
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={refreshing}
                onClick={() => void refreshAgents({ notify: true })}
                className="relative z-10 shrink-0 text-dls-secondary hover:bg-dls-hover hover:text-dls-text disabled:opacity-70 mac:titlebar-no-drag"
                title={t("local_agent.redetect")}
                aria-label={t("local_agent.redetect")}
              >
                {refreshing ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>

              {onOpenAgentManagement ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="relative z-10 ml-auto h-8 shrink-0 gap-1.5 px-2 text-xs font-normal text-dls-secondary hover:bg-dls-hover hover:text-dls-text mac:titlebar-no-drag"
                  onClick={() => onOpenAgentManagement?.("agents")}
                  title={t("local_agent.manage_agents")}
                  aria-label={t("local_agent.manage_agents")}
                  data-testid="local-agent-manage-agents"
                >
                  <Settings2 className="size-3.5 shrink-0" />
                  <span className="truncate">{t("local_agent.manage_agents")}</span>
                </Button>
              ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredAgents.length > 0 ? (
              <div>
                {filteredAgents.map((agent) => {
                  const agentActiveRunKey =
                    Object.entries(activeRunIdByAgent).find(
                      ([chatKey, runId]) =>
                        Boolean(runId) &&
                        agentIdFromChatKey(chatKey) === agent.id,
                    )?.[0] ?? null;

                  const lastRun = agentActiveRunKey
                    ? lastRunForAgent(messagesByAgent[agentActiveRunKey])
                    : lastRunForAgent(messagesByAgent[agent.id]);

                  const hasActiveRun = Boolean(
                    agentActiveRunKey &&
                      lastRun &&
                      lastRun.runId === activeRunIdByAgent[agentActiveRunKey] &&
                      lastRun.status === "running",
                  );

                  return (
                    <SessionRowButton
                      key={agent.id}
                      type="button"
                      onClick={() => setSelectedAgentId(agent.id)}
                      active={selectedAgentId === agent.id}
                      className={cn(
                        localAgentLayoutClass.agentRow,
                        agent.status !== "online" && "opacity-70",
                      )}
                    >
                      <AgentBrandIcon
                        id={agent.id}
                        provider={agent.provider}
                        size="md"
                        alt={agent.name}
                        badge={
                          // One corner badge only (priority: running → online → offline).
                          // Avoid stacking ping + green online + trailing blue dot.
                          hasActiveRun ? (
                            <StatusPing
                              inset
                              size="status"
                              className="absolute -right-0.5 bottom-0 items-center justify-center"
                              title={t("local_agent.background_run_title")}
                              aria-label={t("local_agent.background_run_aria")}
                            />
                          ) : (
                            <span
                              className={cn(
                                localAgentLayoutClass.agentStatusDot,
                                selectedAgentId === agent.id
                                  ? "border-dls-list-selected"
                                  : "border-dls-sidebar",
                                agent.status === "online"
                                  ? "bg-dls-online"
                                  : "bg-dls-secondary",
                              )}
                              title={
                                agent.status === "online"
                                  ? t("local_agent.online")
                                  : t("local_agent.offline")
                              }
                              aria-label={
                                agent.status === "online"
                                  ? t("local_agent.online")
                                  : t("local_agent.offline")
                              }
                            />
                          )
                        }
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <div className={localAgentTextClass.rowTitle}>
                            {agent.name}
                          </div>
                        </div>

                        {(() => {
                          const subtitle = hasActiveRun
                            ? t("local_agent.background_run_aria")
                            : agent.status === "online"
                              ? agentSubtitle(agent)
                              : agent.error ||
                                t("local_agent.check_install_or_login");
                          if (!subtitle) return null;
                          return (
                            <div className="mt-1 min-w-0 truncate text-xs leading-5 text-dls-secondary">
                              {subtitle}
                            </div>
                          );
                        })()}
                      </div>
                    </SessionRowButton>
                  );
                })}
              </div>
            ) : refreshing ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm leading-5 text-dls-secondary">
                <LoadingSpinner size="default" className="text-dls-accent" />
                <div>
                  {t("local_agent.detecting")}
                  <div className="mt-1 text-xs text-dls-secondary/75">
                    {t("local_agent.detecting_desc")}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm leading-5 text-dls-secondary">
                {t("local_agent.empty")}
              </div>
            )}
          </div>
        </>
      )}
    </aside>

    {agentListCollapsed ? null : (
      <div
        role="separator"
        aria-label={t("session.resize_agent_list")}
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={startAgentListResize}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();

            setAgentListWidth((width) =>
              Math.min(
                LOCAL_AGENT_LIST_MAX_WIDTH,
                Math.max(
                  LOCAL_AGENT_LIST_MIN_WIDTH,
                  width + (event.key === "ArrowLeft" ? -16 : 16),
                ),
              ),
            );
          }
        }}
        className="group absolute inset-y-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none"
        style={{ left: agentListWidth }}
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-focus-visible:bg-dls-accent" />
      </div>
    )}

    <ListPaneCollapseToggle
      collapsed={agentListCollapsed}
      onToggle={() => setAgentListCollapsed((value) => !value)}
      style={{
        left: agentListCollapsed ? 0 : agentListWidth,
      }}
    />

    {/*
      Do not set overflow-x-hidden on this column: it forces overflow-y to auto
      and clips the scheduled-tasks popover that hangs below the header.
      Horizontal clipping stays on the message scroller below.
    */}
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-dls-background">
      <header className={localAgentLayoutClass.header}>
        {/*
          Header is a macOS drag region. Do NOT put titlebar-no-drag on the whole
          row — leave the flex-1 mid gap draggable so the window can move.
          Interactive controls opt out via headerActions / Button defaults.
        */}
        <div className={localAgentLayoutClass.headerRow}>
          <div className={localAgentLayoutClass.headerIdentity}>
            {isChannelView ? (
              <div className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dls-border bg-dls-surface-muted text-dls-accent">
                <MessageSquare className="size-4" />
              </div>
            ) : selectedAgent ? (
              <AgentBrandIcon
                id={selectedAgent.id}
                provider={selectedAgent.provider}
                size="sm"
                alt={selectedAgent.name}
                badge={
                  <span
                    className={cn(
                      "absolute -right-0.5 -bottom-0.5 size-2 rounded-full border-2 border-dls-surface",
                      selectedAgent.status === "online" ? "bg-dls-online" : "bg-dls-secondary",
                    )}
                    aria-hidden
                  />
                }
              />
            ) : (
              <div className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dls-border bg-dls-surface-muted text-dls-accent">
                <UserRound className="size-4" />
              </div>
            )}
            <div className="min-w-0 truncate text-sm font-medium text-dls-text">
              {selectedAgent?.name}
            </div>
          </div>

          {/* Window drag handle — absorbs leftover width between identity and actions. */}
          <div className="min-h-full min-w-3 flex-1" aria-hidden />

          <div className={localAgentLayoutClass.headerActions}>
            {/*
              Conversation picker + new-session as one control (split pill).
              A free-standing ghost + between two dropdowns looked orphaned.
            */}
            <div
              className={cn(
                "flex h-8 min-w-0 max-w-[min(18rem,42vw)] items-stretch overflow-hidden rounded-lg border border-dls-border bg-dls-surface",
                (!selectedAgent || running) && "opacity-60",
              )}
              data-testid="local-agent-conversation-control"
            >
              <div className="min-w-0 flex-1">
                <SelectMenu
                  size="compact"
                  className={cn(
                    "h-full w-full min-w-0",
                    // Flatten SelectMenu trigger into the split pill (outer border owns the chrome).
                    "[&>button]:!h-full [&>button]:!min-h-0 [&>button]:!rounded-none [&>button]:!border-0",
                    "[&>button]:!bg-transparent [&>button]:!px-2.5 [&>button]:!py-0 [&>button]:!shadow-none",
                    "[&>button]:hover:!border-transparent [&>button]:hover:!bg-dls-hover/60",
                    "[&>button]:focus-visible:!ring-0 [&>button]:focus-visible:!ring-offset-0",
                  )}
                  ariaLabel={t("local_agent.conversation")}
                  options={selectedConversations.length ? selectedConversations.map((conversation) => ({ value: conversation.id, label: conversationTitle(conversation) })) : [{ value: "", label: t("local_agent.loading_conversations") }]}
                  value={selectedConversationId ?? ""}
                  onChange={(value) => {
                    if (!selectedAgent || !value) return;
                    if (isChannelView) {
                      setSelectedChannelConversationId(value);
                      return;
                    }
                    setSelectedConversationIdByAgent((current) => ({ ...current, [selectedAgent.id]: value }));
                  }}
                  disabled={!selectedAgent || running || Boolean(selectedAgent && !isChannelView && loadingConversationsByAgent[selectedAgent.id])}
                />
              </div>
              <div className="w-px shrink-0 self-stretch bg-dls-border" aria-hidden />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-auto w-8 shrink-0 rounded-none border-0 text-dls-secondary hover:bg-dls-hover hover:text-dls-text disabled:opacity-50"
                onClick={() => void createNewConversation()}
                disabled={!canCreateConversation}
                title={t("local_agent.new_conversation")}
                aria-label={t("local_agent.new_conversation")}
                aria-busy={creatingConversation || undefined}
                data-testid="local-agent-new-conversation"
              >
                {creatingConversation ? <LoadingSpinner size="sm" /> : <Plus className="size-3.5" strokeWidth={2} />}
              </Button>
            </div>
            {!isChannelView && selectedAcpModelInfo.supportsModelOverride ? (
              <PersonalLocalAgentModelSelector
                agent={selectedAgent}
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                workspaceRoot={effectiveWorkspaceRoot}
                disabled={!selectedAgent || running}
                acpModelInfo={selectedAcpModelInfo}
              />
            ) : null}
            <Button
              ref={scheduledTasksButtonRef}
              variant="ghost"
              size="icon-sm"
              className="relative"
              onClick={() => setShowScheduledTasks((open) => !open)}
              disabled={!selectedAgent}
              data-testid="local-agent-scheduled-tasks-button"
              aria-expanded={showScheduledTasks}
              title={t("local_agent.heartbeat_title")}
              aria-label={t("local_agent.heartbeat_title")}
            >
              <Clock3 className="size-4" />
              {selectedHeartbeatJobs.length ? (
                <CountBadge size="dot" className="absolute right-0 top-0 translate-x-1/2 -translate-y-1/2 bg-dls-accent text-dls-surface">
                  {selectedHeartbeatJobs.length}
                </CountBadge>
              ) : null}
            </Button>
          </div>
        </div>
        {showScheduledTasks && selectedAgent ? (
          <div ref={scheduledTasksPanelRef} className={heartbeatClass.overlay} data-testid="local-agent-scheduled-tasks-panel">
            <HeartbeatPanel
              agent={selectedAgent}
              jobs={selectedHeartbeatJobs}
              draft={heartbeatDraft}
              conversations={selectedConversations}
              conversation={selectedConversation}
              busyId={heartbeatBusy}
              error={heartbeatError}
              onDraftChange={setHeartbeatDraft}
              onCreate={() => void createHeartbeat()}
              onRefresh={() => void loadHeartbeats()}
              onRunNow={(job) => void runHeartbeatNow(job)}
              onToggleEnabled={(job, enabled) => void updateHeartbeatEnabled(job, enabled)}
              onDelete={(job) => void deleteHeartbeat(job)}
              onClose={() => setShowScheduledTasks(false)}
            />
          </div>
        ) : null}
      </header>
      <LocalAgentStatusRail
        workspaceRoot={effectiveWorkspaceRoot}
        agent={selectedAgent ?? null}
        conversationId={selectedConversationId ?? null}
        onOpenManagement={() => onOpenAgentManagement?.("skills")}
      />
      <div
        ref={scrollRef}
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-8"
        onScroll={(event) => {
          if (programmaticScrollRef.current) return;
          const el = event.currentTarget;
          const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          stickToBottomRef.current = distanceFromBottom <= 80;
        }}
      >
        <div className={localAgentLayoutClass.pageContent}>
          {selectedMessages.map((message) => (
            <ChatBubble
              key={message.id}
              message={message}
              workspaceRoot={effectiveWorkspaceRoot}
              agent={selectedAgent}
              selectedModel={selectedModel}
              onOpenArtifact={onOpenArtifact}
              onResolveApproval={resolveApproval}
              onResolveTip={() => onOpenAgentManagement?.("skills")}
            />
          ))}
          {selectedError ? <NoticeBox tone="error">{selectedError}</NoticeBox> : null}
        </div>
      </div>
      {/* Solid footer plate — avoid gradient glass that washes out the composer. */}
      <footer className="mac:titlebar-no-drag min-w-0 shrink-0 px-6 pb-5 pt-2">
        <div className={localAgentLayoutClass.contentColumn}>
          <LocalAgentDraftComposer
            draftKey={selectedChatKey}
            workspaceRoot={effectiveWorkspaceRoot}
            initialDraft={draft}
            disabled={!selectedAgent || isChannelView || selectedAgent.status !== "online"}
            submitting={running}
            placeholder={isChannelView ? t("local_agent.channel_session_readonly") : selectedAgent?.status === "online" ? t("local_agent.input_placeholder") : t("local_agent.input_placeholder_unavailable")}
            slashCommands={selectedSlashCommands}
            onDraftCommit={updateDraftForChat}
            onSlashCommandExecute={handleSlashCommandExecute}
            contextUsage={composerContextUsage}
            onSubmit={(payload) => { updateDraftForChat(selectedChatKey, ""); void submitComposerPayload(payload); }}
            toolbarRight={
              <>
                {activeRun?.status === "running" ? (
                  <Button variant="outline" size="sm" onClick={() => void cancelRun()}>
                    <CircleStop className="mr-1.5 size-3.5" />
                    {t("composer.stop")}
                  </Button>
                ) : null}
              </>
            }
            bottomAccessory={
              <div className="flex min-w-0 w-full max-w-full items-center gap-2">
                <div className="min-w-0 flex-1">
                  <WorkspaceFootnote
                    density="compact"
                    workspaceRoot={displayWorkspaceRoot}
                    recentWorkspaces={workspaceRecentList}
                    disabled={running || !chipEditable}
                    readOnly={!chipEditable}
                    onSelect={applyWorkspaceOverride}
                    onClear={clearWorkspaceOverride}
                    onBrowse={() => { void browseWorkspaceOverride(); }}
                  />
                </div>
                <SelectMenu
                  size="compact"
                  className={cn(
                    "w-auto min-w-[9.5rem] max-w-[14rem] shrink-0",
                    // Opaque trigger in the composer footer strip.
                    "[&>button]:!border-dls-border [&>button]:!bg-dls-surface-solid [&>button]:!text-dls-text",
                    "[&>button]:hover:!bg-dls-hover",
                  )}
                  value={approvalMode}
                  onChange={(value) => setApprovalMode(value as PersonalLocalAgentApprovalMode)}
                  disabled={running || (selectedCapability ? selectedCapability.supportsApproval === false : false)}
                  ariaLabel={t("local_agent.approval_aria")}
                  placement="top"
                  panelMinWidth={180}
                  options={APPROVAL_MODE_OPTIONS.map((option) => ({
                    value: option.id,
                    label: option.label,
                  }))}
                />
              </div>
            }
          />
        </div>
      </footer></main>
      <Dialog open={showActiveRunsPanel} onOpenChange={setShowActiveRunsPanel}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("local_agent.active_runs_title")}</DialogTitle>
          </DialogHeader>
          <ActiveRunsOverview
            activeRuns={activeRuns}
            selectedChatKey={selectedChatKey}
            showTitle={false}
            onSelectAgent={(chatKey) => {
              setShowActiveRunsPanel(false);
              const [agentId, conversationId] = chatKey.split("::");
              if (agentId) setSelectedAgentId(agentId);
              if (agentId && conversationId) {
                setSelectedConversationIdByAgent((current) => ({ ...current, [agentId]: conversationId }));
              }
            }}
            onCancelRun={(runId, chatKey) => void cancelAgentRun(runId, chatKey)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
