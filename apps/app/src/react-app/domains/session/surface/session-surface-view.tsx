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
  headerActions?: ReactNode;

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
  effectiveAgent: PendingAgentContext | null;
  typeComposerText: (text: string) => void | Promise<void>;
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
  mentions: Record<string, "agent" | "file">;
  assistantScenarioTags: { id: string; label: string }[];
  personalizedPromptTemplates: ComposerPromptTemplate[] | undefined;
  onSelectPromptTemplate: (scenarioId: string, prompt: string) => void;
  onDraftChange: (draft: string) => void;
  onSend: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
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
    | ((section: "commands" | "skills" | "mcps" | "plugins") => void)
    | undefined;
  onOpenSkillsMarketplace?: (() => void) | undefined;
  onOpenConnectorsMarketplace?: (() => void) | undefined;
  onOpenCustomConnector?: (() => void) | undefined;
  recentFiles: string[];
  searchFiles: (query: string) => Promise<string[]>;
  onInsertMention: (kind: "agent" | "file", value: string) => void;
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

  return (
    <DevProfiler id="SessionSurface">
      <div className="flex h-full min-h-0 flex-col">
        {/* New-task / draft home: no top agent chrome — hero + composer own the canvas.
            Once a session has messages (or is loading), pin the header at the top. */}
        {!personalAssistantDraftHome ? (
          <SessionSurfaceHeader
            agent={props.chatHeaderAgent}
            codeSceneToolbar={props.codeSceneToolbar}
            personalAssistantHome={props.personalAssistantHome}
            onOpenAgentSettings={props.onOpenAgentSettings}
            headerActions={props.headerActions}
            showBottomBorder={!sessionTabsExpanded}
          />
        ) : null}
        {!personalAssistantDraftHome ? conversationTabsNode : null}
        <SessionSurfaceSwitchingBadge
          visible={props.transitionState === "switching" && props.showDelayedLoading}
          fromCache={props.renderSource === "cache"}
        />

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
              props.effectiveAgent ? (
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
                      onSelect={(prompt) => void props.typeComposerText(prompt)}
                      className="shrink-0"
                    />
                  }
                />
              ) : null
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
                onRevertToMessage={props.onRevertToMessage}
                openTargets={props.verifiedOpenTargets}
                onOpenTarget={props.onOpenTarget}
                onDownloadCodePath={props.onDownloadCodePath}
                workspaceRoot={props.workspaceRoot}
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
          floatingToolbar={
            personalAssistantDraftHome ? props.codeSceneToolbar : null
          }
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
              draft={props.draft}
              mentions={props.mentions}
              scenarioTags={props.assistantScenarioTags}
              promptTemplates={props.personalizedPromptTemplates}
              onSelectPromptTemplate={props.onSelectPromptTemplate}
              onDraftChange={props.onDraftChange}
              onSend={props.onSend}
              onStop={props.onStop}
              busy={props.chatStreaming}
              disabled={
                props.transitionState !== "idle" &&
                props.transitionState !== "failed"
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
              showOuterBorder={composerOuterBorderVisible}
              compactTopSpacing={Boolean(props.composerAccessory)}
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
