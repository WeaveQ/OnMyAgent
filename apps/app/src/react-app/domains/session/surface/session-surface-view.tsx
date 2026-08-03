/** @jsxImportSource react */
/**
 * Presentational view shell for SessionSurface.
 * Host computes state/handlers; this owns the final layout JSX only.
 */
import {
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type UIEvent,
} from "react";
import type { UIMessage } from "ai";

import type { OnMyAgentSessionSnapshot } from "../../../../app/lib/onmyagent-server";
import type {
  ComposerAccessMode,
  ComposerAttachment,
  ComposerCollaborationMode,
  ComposerMentionKind,
  ComposerMentionTarget,
  McpServerEntry,
  McpStatusMap,
  ModelRef,
  SkillCard,
  SlashCommandOption,
} from "../../../../app/types";
import type { CloudImportedPlugin } from "../../../../app/cloud/import-state";
import type { PendingAgentContext } from "../../agents";
import { AgentPromptSuggestions } from "../../agents";
import { DevProfiler } from "../../../shell";
import type { OpenTarget } from "../artifacts/open-target";
import type { SessionRenderModel } from "../sync/transition-controller";
import { ReactSessionComposer } from "./composer/composer";
import type { ReactComposerNotice } from "./composer/notice";
import type {
  ComposerPromptTemplate,
  PastedTextChip,
} from "./composer/composer-helpers";
import {
  buildSessionContextUsage,
  estimateContextUsedFromTokens,
} from "../../../capabilities/context-usage/session-context-usage";
import { readTranscriptMessageMetadata } from "../sync/message-metadata";
import { SessionDebugPanel } from "./debug-panel";
import {
  SessionTranscript,
  type SessionTranscriptDivider,
} from "./message-list";
import {
  getAssistantActivityPhaseLabel,
  type AssistantActivity,
} from "./chrome/assistant-activity";
import {
  SessionSurfaceBody,
  SessionSurfaceComposerColumn,
  SessionSurfaceTranscriptPane,
} from "./session-surface-layout";
import {
  SessionSurfaceSwitchingBadge,
  SessionSurfaceTranscriptContent,
} from "./session-surface-transcript-content";
import {
  SessionDraftWorkspaceAccessory,
  SessionSurfaceDraftHome,
  SessionSurfaceExpertEmpty,
  SessionSurfaceHeader,
  type SessionSurfaceHeaderAgent,
} from "./session-surface-chrome";
import type { AssistantCategoryId } from "./personal-assistant-config";
import type { SessionError } from "./session-surface-support";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import { KeyboardShortcutsGuideButton } from "./chrome/keyboard-shortcuts-guide";

export type SessionSurfaceViewProps = {
  // Layout / chrome
  personalAssistantDraftHome: boolean;
  homeComposerLayout: boolean;
  composerOuterBorderVisible: boolean;
  draftWorkspaceAccessoryActive: boolean;
  conversationTabs?: ReactNode;
  chatHeaderAgent: SessionSurfaceHeaderAgent;
  codeSceneToolbar: ReactNode;
  personalAssistantHome?: boolean;
  onOpenAgentSettings?: () => void;
  /** Open Settings → Shortcuts from draft-home keyboard guide. */
  onOpenShortcutsSettings?: () => void;
  headerActions?: ReactNode;
  /** Keep-alive rail visibility — remeasure transcript when becoming true. */
  surfaceVisible?: boolean;

  // Transition / load
  transitionState: SessionRenderModel["transitionState"];
  renderSource: SessionRenderModel["renderSource"];
  showDelayedLoading: boolean;
  pendingSessionLoad: boolean;
  snapshotQueryError: boolean;
  snapshotErrorMessage: string;
  snapshot: OnMyAgentSessionSnapshot | null;
  model: SessionRenderModel;
  developerMode: boolean;

  // Transcript
  sessionId: string;
  /** Live connected provider IDs for historical model "removed" badges. */
  connectedProviderIds?: readonly string[] | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  onWheel: (event: { deltaY: number; target: EventTarget }) => void;
  onTouchStart: (event: { target: EventTarget }) => void;
  onTouchMove: (event: { target: EventTarget }) => void;
  onPointerDown: (event: {
    target: EventTarget;
    currentTarget: EventTarget;
  }) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  onJumpToLatest: () => void;
  visibleTranscriptError: SessionError | null | undefined;
  hasTranscriptContent: boolean;
  activityIdle: boolean;
  draftOnly?: boolean;
  /** Hide header/tabs when embedded in a host panel (creation coach). */
  chrome?: "default" | "embedded";
  /** Override default expert-empty hero when provided. */
  emptyContent?: ReactNode;
  effectiveAgent: PendingAgentContext | null;
  typeComposerText: (text: string) => void | Promise<void>;
  typeComposerTemplate: (template: string) => void | Promise<void>;
  assistantActivity: AssistantActivity;
  onDismissError: () => void;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
  onOpenModelPicker: () => void;
  renderedMessages: UIMessage[];
  chatStreaming: boolean;
  showThinking: boolean;
  interruptionDividers: SessionTranscriptDivider[];
  resolveTranscriptScrollElement: () => HTMLElement | null | undefined;
  onRevertToMessage?: (messageId: string) => void;
  verifiedOpenTargets: OpenTarget[];
  onOpenTarget?: (target: OpenTarget, options?: { auto?: boolean }) => void;
  onDownloadCodePath?: (path: string) => Promise<void>;
  workspaceRoot: string;
  assistantStatusFooter: ReactNode;
  searchQuery: string;
  searchMatchIdSet: Set<string>;
  activeSearchMessageId: string | null | undefined;
  scrollToMessageByIdRef: RefObject<
    ((messageId: string, behavior?: ScrollBehavior) => boolean) | null
  >;
  // scrollToMessageById uses the stable ref prop on SessionTranscript

  // Draft home / composer column
  assistantCategoryId: AssistantCategoryId;
  assistantDraftHomeTitle: string;
  assistantDraftHomeSubtitle: string;
  composerShellRef: RefObject<HTMLDivElement | null>;

  // Composer state + handlers
  draft: string;
  mentions: Record<string, ComposerMentionKind>;
  assistantScenarioTags: { id: string; label: string }[];
  personalizedPromptTemplates: ComposerPromptTemplate[] | undefined;
  onSelectPromptTemplate: (scenarioId: string, prompt: string) => void;
  onDraftChange: (draft: string) => void;
  onSend: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  composerDisabled: boolean;
  modelUnavailable: boolean;
  effectiveAccessMode: ComposerAccessMode;
  onAccessModeChange: (mode: ComposerAccessMode) => void;
  effectiveCollaborationMode: ComposerCollaborationMode;
  onCollaborationModeChange: (mode: ComposerCollaborationMode) => void;
  collaborationModeVariant: "office" | "legacy";
  modelPickerOpen: boolean;
  selectedModel: ModelRef;
  onModelPickerOpenChange: (open: boolean) => void;
  onModelChange: (model: ModelRef) => void;
  attachments: ComposerAttachment[];
  onAttachFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  attachmentsEnabled: boolean;
  attachmentsDisabledReason: string | null;
  modelVariantLabel: string;
  modelVariant: string | null;
  modelBehaviorOptions?: { value: string | null; label: string }[];
  onModelVariantChange: (value: string | null) => void;
  agentLabel: string;
  selectedAgent: string | null;
  listAgents: () => Promise<Agent[]>;
  onSelectAgent: (agent: string | null) => void;
  listCommands: () => Promise<SlashCommandOption[]>;
  listSkills: () => Promise<SkillCard[]>;
  skills: SkillCard[];
  listMcp: () => Promise<{
    servers: McpServerEntry[];
    statuses: McpStatusMap;
    status: string | null;
  }>;
  mcpServers: McpServerEntry[];
  mcpStatus: string | null;
  mcpStatuses: McpStatusMap;
  listImportedPlugins: () => Promise<CloudImportedPlugin[]>;
  importedPlugins: CloudImportedPlugin[];
  onOpenSettingsSection?:
    | ((section: "ai" | "commands" | "skills" | "mcps" | "plugins") => void)
    | undefined;
  onOpenSkillsMarketplace?: (() => void) | undefined;
  onOpenConnectorsMarketplace?: (() => void) | undefined;
  onOpenCustomConnector?: (() => void) | undefined;
  recentFiles: string[];
  searchFiles: (query: string) => Promise<ComposerMentionTarget[]>;
  listFolderFiles: (path: string) => Promise<ComposerMentionTarget[]>;
  loadWorkspaceFiles: (paths: string[]) => Promise<File[]>;
  onInsertMention: (kind: ComposerMentionKind, value: string) => void;
  notice: ReactComposerNotice | null;
  onNotice: (notice: ReactComposerNotice | null) => void;
  onPasteText: (text: string) => void;
  onUnsupportedFileLinks: (links: string[]) => void;
  pastedText: PastedTextChip[];
  onExpandPastedText: (id: string) => void;
  onRevealPastedText: (id: string) => void;
  onRemovePastedText: (id: string) => void;
  isRemoteWorkspace: boolean;
  isSandboxWorkspace: boolean;
  onUploadInboxFiles:
    | ((files: File[]) => void | Promise<unknown>)
    | null;
  composerAccessory: ReactNode;
  // Draft workspace accessory
  draftWorkspaceDirectory?: string | null;
  draftWorkspaceOwnerId?: string | null;
  assistantFeatureCategoryId: AssistantCategoryId;
  showFolderRequiredBubble: boolean;
  onDismissFolderRequiredBubble: () => void;
  onSelectDraftWorkspace?: (path: string) => void;
  onCreateDraftWorkspace?: (name: string) => Promise<string>;
  onPickDraftWorkspace?: () => void;
  onClearDraftWorkspace?: () => void;
};

export function SessionSurfaceView(props: SessionSurfaceViewProps) {
  // When the multi-session tab strip is expanded it owns the bottom rule;
  // hide the header border so expert chrome does not draw two lines.
  const [sessionTabsExpanded, setSessionTabsExpanded] = useState(
    () => Boolean(props.conversationTabs),
  );
  useEffect(() => {
    if (!props.conversationTabs) setSessionTabsExpanded(false);
  }, [props.conversationTabs]);
  const conversationTabsNode = useMemo(() => {
    if (!props.conversationTabs || !isValidElement(props.conversationTabs)) {
      return props.conversationTabs ?? null;
    }
    return cloneElement(
      props.conversationTabs as ReactElement<{
        onExpandedChange?: (expanded: boolean) => void;
      }>,
      { onExpandedChange: setSessionTabsExpanded },
    );
  }, [props.conversationTabs]);

  const {
    personalAssistantDraftHome,
    homeComposerLayout,
    composerOuterBorderVisible,
    draftWorkspaceAccessoryActive,
  } = props;

  // Context ring next to model select: last assistant prompt occupancy vs model window.
  const sessionContextUsage = useMemo(() => {
    let usedTokens: number | null = null;
    for (let index = props.renderedMessages.length - 1; index >= 0; index -= 1) {
      const message = props.renderedMessages[index];
      if (message?.role !== "assistant") continue;
      const tokens = readTranscriptMessageMetadata(message.metadata).tokens;
      const estimated = estimateContextUsedFromTokens(
        tokens
          ? {
              input: tokens.input,
              cacheRead: tokens.cacheRead,
              total: tokens.total,
            }
          : null,
      );
      if (estimated != null) {
        usedTokens = estimated;
        break;
      }
    }
    return buildSessionContextUsage({
      modelId: props.selectedModel?.modelID ?? null,
      usedTokens,
    });
  }, [props.renderedMessages, props.selectedModel?.modelID]);

  return (
    <DevProfiler id="SessionSurface">
      {/* relative: anchors draft-home top-right chrome (keyboard guide). */}
      <div className="relative flex h-full min-h-0 flex-col">
        {/* New-task / draft home: no top agent chrome — hero + composer own the canvas.
            Once a session has messages (or is loading), pin the header at the top.
            Embedded panels (creation coach) hide header/tabs — host owns chrome. */}
        {!personalAssistantDraftHome && props.chrome !== "embedded" ? (
          <SessionSurfaceHeader
            agent={props.chatHeaderAgent}
            codeSceneToolbar={props.codeSceneToolbar}
            personalAssistantHome={props.personalAssistantHome}
            onOpenAgentSettings={props.onOpenAgentSettings}
            headerActions={props.headerActions}
            showBottomBorder={!sessionTabsExpanded}
          />
        ) : null}
        {!personalAssistantDraftHome && props.chrome !== "embedded"
          ? conversationTabsNode
          : null}
        <SessionSurfaceSwitchingBadge
          visible={props.transitionState === "switching" && props.showDelayedLoading}
          fromCache={props.renderSource === "cache"}
        />

        {/* Draft home only: pin shortcuts to the surface corner (not the centered hero). */}
        {personalAssistantDraftHome ? (
          <div className="pointer-events-none absolute right-4 top-3 z-30 flex items-center gap-1.5 mac:right-5 mac:top-4 mac:titlebar-no-drag">
            <div className="pointer-events-auto flex items-center gap-1.5">
              {props.codeSceneToolbar}
              <KeyboardShortcutsGuideButton
                onConfigure={props.onOpenShortcutsSettings}
              />
            </div>
          </div>
        ) : null}

        {/* Body: draft home centers title+composer; chat fills remaining height. */}
        <SessionSurfaceBody personalAssistantDraftHome={Boolean(personalAssistantDraftHome)}>
        <SessionSurfaceTranscriptPane
          hidden={Boolean(personalAssistantDraftHome)}
          sessionId={props.sessionId}
          scrollRef={props.scrollRef}
          contentRef={props.contentRef}
          showJumpToLatest={!personalAssistantDraftHome}
          onWheel={(event) => {
            props.onWheel(event);
          }}
          onTouchStart={(event) => {
            props.onTouchStart(event);
          }}
          onTouchMove={(event) => {
            props.onTouchMove(event);
          }}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            props.onPointerDown(event);
          }}
          onScroll={props.onScroll}
          onJumpToLatest={() => {
            props.onJumpToLatest();
          }}
        >
          <SessionSurfaceTranscriptContent
            showDelayedLoading={props.showDelayedLoading}
            pendingSessionLoad={props.pendingSessionLoad}
            snapshotQueryError={props.snapshotQueryError}
            snapshotErrorMessage={props.snapshotErrorMessage}
            visibleTranscriptError={props.visibleTranscriptError}
            hasSnapshot={Boolean(props.snapshot)}
            hasTranscriptContent={props.hasTranscriptContent}
            activityIdle={props.activityIdle}
            draftOnly={props.draftOnly}
            snapshotEmpty={Boolean(
              props.snapshot && props.snapshot.messages.length === 0,
            )}
            personalAssistantHome={props.personalAssistantHome}
            expertEmpty={
              props.emptyContent ??
              (props.effectiveAgent ? (
                <SessionSurfaceExpertEmpty
                  agent={{
                    name: props.effectiveAgent.name,
                    description: props.effectiveAgent.description,
                    avatar: props.effectiveAgent.avatar,
                  }}
                  promptSuggestions={
                    <AgentPromptSuggestions
                      agentId={props.effectiveAgent.id}
                      quickPrompts={props.effectiveAgent.quickPrompts}
                      promptTemplates={props.effectiveAgent.promptTemplates}
                      onSelect={(prompt, template) =>
                        void (template
                          ? props.typeComposerTemplate(prompt)
                          : props.typeComposerText(prompt))
                      }
                      className="shrink-0"
                    />
                  }
                />
              ) : null)
            }
            waitingLabel={getAssistantActivityPhaseLabel(props.assistantActivity)}
            onDismissError={props.onDismissError}
            onChangeModel={props.onChangeModel}
            onOpenModelPicker={props.onOpenModelPicker}
            transcript={
              <SessionTranscript
                messages={props.renderedMessages}
                isStreaming={props.chatStreaming}
                developerMode={props.developerMode}
                showThinking={props.showThinking}
                dividers={props.interruptionDividers}
                scrollElement={props.resolveTranscriptScrollElement}
                surfaceVisible={props.surfaceVisible !== false}
                onRevertToMessage={props.onRevertToMessage}
                openTargets={props.verifiedOpenTargets}
                onOpenTarget={props.onOpenTarget}
                onDownloadCodePath={props.onDownloadCodePath}
                workspaceRoot={props.workspaceRoot}
                connectedProviderIds={props.connectedProviderIds}
                footer={props.assistantStatusFooter}
                assistantAvatar={props.chatHeaderAgent}
                searchHighlightQuery={props.searchQuery || undefined}
                searchMatchMessageIds={
                  props.searchQuery ? props.searchMatchIdSet : undefined
                }
                activeSearchMessageId={props.activeSearchMessageId}
                scrollToMessageByIdRef={props.scrollToMessageByIdRef}
              />
            }
          />
        </SessionSurfaceTranscriptPane>

        <SessionSurfaceComposerColumn
          personalAssistantDraftHome={Boolean(personalAssistantDraftHome)}
          homeComposerLayout={Boolean(homeComposerLayout)}
          floatingToolbar={null}
          draftHome={
            personalAssistantDraftHome ? (
              <SessionSurfaceDraftHome
                categoryId={props.assistantCategoryId}
                title={props.assistantDraftHomeTitle}
                subtitle={props.assistantDraftHomeSubtitle}
              />
            ) : null
          }
          composerShellRef={props.composerShellRef}
        >
          <DevProfiler id="SessionComposer">
            <ReactSessionComposer
              sessionId={props.sessionId}
              draft={props.draft}
              mentions={props.mentions}
              contextUsage={sessionContextUsage}
              scenarioTags={props.assistantScenarioTags}
              promptTemplates={props.personalizedPromptTemplates}
              onSelectPromptTemplate={props.onSelectPromptTemplate}
              onDraftChange={props.onDraftChange}
              onSend={props.onSend}
              onStop={props.onStop}
              busy={props.chatStreaming}
              disabled={
                props.composerDisabled
                || (props.transitionState !== "idle"
                  && props.transitionState !== "failed")
              }
              modelUnavailable={Boolean(props.modelUnavailable)}
              accessMode={props.effectiveAccessMode}
              onAccessModeChange={props.onAccessModeChange}
              collaborationMode={props.effectiveCollaborationMode}
              onCollaborationModeChange={props.onCollaborationModeChange}
              collaborationModeVariant={props.collaborationModeVariant}
              modelPickerOpen={props.modelPickerOpen}
              selectedModel={props.selectedModel}
              onModelPickerOpenChange={props.onModelPickerOpenChange}
              onModelChange={props.onModelChange}
              attachments={props.attachments}
              onAttachFiles={props.onAttachFiles}
              onRemoveAttachment={props.onRemoveAttachment}
              attachmentsEnabled={props.attachmentsEnabled}
              attachmentsDisabledReason={props.attachmentsDisabledReason}
              modelVariantLabel={props.modelVariantLabel}
              modelVariant={props.modelVariant}
              modelBehaviorOptions={props.modelBehaviorOptions}
              onModelVariantChange={props.onModelVariantChange}
              agentLabel={props.agentLabel}
              selectedAgent={props.selectedAgent}
              listAgents={props.listAgents}
              onSelectAgent={props.onSelectAgent}
              listCommands={props.listCommands}
              listSkills={props.listSkills}
              skills={props.skills}
              listMcp={props.listMcp}
              mcpServers={props.mcpServers}
              mcpStatus={props.mcpStatus}
              mcpStatuses={props.mcpStatuses}
              listImportedPlugins={props.listImportedPlugins}
              importedPlugins={props.importedPlugins}
              onOpenSettingsSection={props.onOpenSettingsSection}
              onOpenSkillsMarketplace={props.onOpenSkillsMarketplace}
              onOpenConnectorsMarketplace={props.onOpenConnectorsMarketplace}
              onOpenCustomConnector={props.onOpenCustomConnector}
              recentFiles={props.recentFiles}
              searchFiles={props.searchFiles}
              listFolderFiles={props.listFolderFiles}
              loadWorkspaceFiles={props.loadWorkspaceFiles}
              onInsertMention={props.onInsertMention}
              notice={props.notice}
              onNotice={props.onNotice}
              onPasteText={props.onPasteText}
              onUnsupportedFileLinks={props.onUnsupportedFileLinks}
              pastedText={props.pastedText}
              onExpandPastedText={props.onExpandPastedText}
              onRevealPastedText={props.onRevealPastedText}
              onRemovePastedText={props.onRemovePastedText}
              isRemoteWorkspace={props.isRemoteWorkspace}
              isSandboxWorkspace={props.isSandboxWorkspace}
              onUploadInboxFiles={props.onUploadInboxFiles}
              showOuterBorder={
                props.chrome === "embedded" ? true : composerOuterBorderVisible
              }
              flushShell={props.chrome === "embedded"}
              compactTopSpacing={
                props.chrome === "embedded" || Boolean(props.composerAccessory)
              }
              homeLayout={homeComposerLayout}
              heroHome={Boolean(personalAssistantDraftHome)}
              topAccessory={props.composerAccessory}
              hideAccessPermissionSelect={draftWorkspaceAccessoryActive}
              bottomAccessory={
                draftWorkspaceAccessoryActive ? (
                  <SessionDraftWorkspaceAccessory
                    draftWorkspaceDirectory={props.draftWorkspaceDirectory}
                    ownerWorkspaceId={props.draftWorkspaceOwnerId}
                    assistantFeatureCategoryId={props.assistantFeatureCategoryId}
                    showFolderRequiredBubble={props.showFolderRequiredBubble}
                    onDismissFolderRequiredBubble={
                      props.onDismissFolderRequiredBubble
                    }
                    onSelectDraftWorkspace={props.onSelectDraftWorkspace}
                    onCreateDraftWorkspace={props.onCreateDraftWorkspace}
                    onPickDraftWorkspace={props.onPickDraftWorkspace}
                    onClearDraftWorkspace={props.onClearDraftWorkspace}
                    accessMode={props.effectiveAccessMode}
                    onAccessModeChange={props.onAccessModeChange}
                  />
                ) : undefined
              }
            />
          </DevProfiler>
        </SessionSurfaceComposerColumn>
        </SessionSurfaceBody>
        {/* Error display moved inline into the session conversation area */}
        {props.developerMode ? (
          <SessionDebugPanel model={props.model} snapshot={props.snapshot} />
        ) : null}
      </div>
    </DevProfiler>
  );
}
