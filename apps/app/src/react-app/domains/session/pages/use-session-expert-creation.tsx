/** @jsxImportSource react */
import { useCallback } from "react";

import { t } from "../../../../i18n";
import { ReactSessionComposer } from "../surface/composer/composer";
import type { SessionPageProps } from "./session-page-types";
import { ExpertCreationCoachSurface } from "./expert-creation-coach-surface";
import { ExpertCreationPreviewSurface } from "./expert-creation-preview-surface";
import {
  type AgentRegistry,
  type AgentWizardDraft,
  type ExpertCreationComposerProps,
  type ExpertCreationControllerInput,
  type ExpertCreationSuggestionApplyOptions,
  type ExpertDraftSuggestion,
  type PendingAgentContext,
  useExpertCreationController,
} from "../../agents";
import type { ReactNode } from "react";

type SessionExpertCreationInput = {
  props: SessionPageProps;
  registry: AgentRegistry | null;
  showToast: ExpertCreationControllerInput["showToast"];
  onCreatedAgent: (agent: PendingAgentContext) => void;
};

export function useSessionExpertCreation(input: SessionExpertCreationInput) {
  const renderComposer = useCallback(
    (composer: ExpertCreationComposerProps) => {
      const surface = input.props.surface;
      if (!surface) return null;
      return (
        <ReactSessionComposer
          sessionId={composer.sessionId}
          draft={composer.draft}
          mentions={{}}
          placeholder={composer.placeholder}
          onDraftChange={composer.onDraftChange}
          onSend={composer.onSend}
          onStop={composer.onStop}
          busy={composer.busy}
          disabled={composer.disabled || surface.model.modelUnavailable === true}
          modelUnavailable={surface.model.modelUnavailable}
          accessMode="default"
          onAccessModeChange={() => undefined}
          collaborationMode={{ planning: false, pursueGoal: false }}
          onCollaborationModeChange={() => undefined}
          modelPickerOpen={surface.model.modelPickerOpen}
          selectedModel={surface.model.selectedModel}
          onModelPickerOpenChange={surface.model.onModelPickerOpenChange}
          onModelChange={surface.model.onModelChange}
          attachments={composer.attachments}
          onAttachFiles={composer.onAttachFiles}
          onRemoveAttachment={composer.onRemoveAttachment}
          attachmentsEnabled={surface.attachmentsEnabled}
          attachmentsDisabledReason={surface.attachmentsDisabledReason}
          modelVariantLabel={surface.model.modelVariantLabel}
          modelVariant={surface.model.modelVariant}
          modelBehaviorOptions={surface.model.modelBehaviorOptions}
          onModelVariantChange={surface.model.onModelVariantChange}
          agentLabel={t("agents.expert_creation_coach")}
          selectedAgent={null}
          listAgents={surface.listAgents}
          onSelectAgent={() => undefined}
          listCommands={surface.listCommands}
          recentFiles={surface.recentFiles}
          searchFiles={surface.searchFiles}
          listFolderFiles={surface.searchFiles}
          loadWorkspaceFiles={async () => []}
          onInsertMention={() => undefined}
          notice={null}
          onNotice={() => undefined}
          onPasteText={() => undefined}
          onUnsupportedFileLinks={() => undefined}
          pastedText={[]}
          onExpandPastedText={() => undefined}
          onRevealPastedText={() => undefined}
          onRemovePastedText={() => undefined}
          isRemoteWorkspace={surface.isRemoteWorkspace}
          isSandboxWorkspace={surface.isSandboxWorkspace}
          onUploadInboxFiles={surface.onUploadInboxFiles}
          showOuterBorder
          flushShell
          hideAccessPermissionSelect
        />
      );
    },
    [input.props.surface],
  );

  const renderCoachPanel = useCallback(
    (coach: {
      draft: AgentWizardDraft;
      registry: AgentRegistry;
      initialSessionId: string | null;
      onSessionIdChange: (sessionId: string) => void;
      onApplyDraftSuggestion: (
        suggestion: ExpertDraftSuggestion,
        options: ExpertCreationSuggestionApplyOptions,
      ) => void;
    }) => {
      const surface = input.props.surface;
      const client = input.props.onmyagentServerClient;
      const baseUrl = input.props.opencodeBaseUrl;
      if (!surface || !client || !baseUrl?.trim()) {
        return null;
      }
      return (
        <ExpertCreationCoachSurface
          surface={surface}
          client={client}
          workspaceId={input.props.selectedWorkspaceId}
          workspaceRoot={input.props.selectedWorkspaceRoot}
          opencodeBaseUrl={baseUrl}
          onmyagentToken={input.props.onmyagentServerToken ?? ""}
          registry={coach.registry}
          draft={coach.draft}
          selectedModel={surface.model.selectedModel}
          initialSessionId={coach.initialSessionId}
          onSessionIdChange={coach.onSessionIdChange}
          onApplyDraftSuggestion={coach.onApplyDraftSuggestion}
        />
      );
    },
    [input.props],
  );

  const renderPreviewPanel = useCallback(
    (preview: {
      draft: AgentWizardDraft;
      registry: AgentRegistry;
      knowledgePaths: readonly string[];
      sessionKey: string;
      emptyContent: ReactNode;
    }) => {
      const surface = input.props.surface;
      const client = input.props.onmyagentServerClient;
      const baseUrl = input.props.opencodeBaseUrl;
      if (!surface || !client || !baseUrl?.trim()) {
        return null;
      }
      return (
        <ExpertCreationPreviewSurface
          key={preview.sessionKey}
          surface={surface}
          client={client}
          workspaceId={input.props.selectedWorkspaceId}
          workspaceRoot={input.props.selectedWorkspaceRoot}
          opencodeBaseUrl={baseUrl}
          onmyagentToken={input.props.onmyagentServerToken ?? ""}
          registry={preview.registry}
          draft={preview.draft}
          knowledgePaths={preview.knowledgePaths}
          selectedModel={surface.model.selectedModel}
          sessionKey={preview.sessionKey}
          emptyContent={preview.emptyContent}
        />
      );
    },
    [input.props],
  );

  const controller = useExpertCreationController({
    registry: input.registry,
    workspaceId: input.props.selectedWorkspaceId,
    workspaceRoot: input.props.selectedWorkspaceRoot,
    opencodeBaseUrl: input.props.opencodeBaseUrl ?? null,
    onmyagentServerToken: input.props.onmyagentServerToken ?? null,
    client: input.props.onmyagentServerClient,
    skills: input.registry?.skills ?? [],
    selectedModel: input.props.surface?.model.selectedModel ?? null,
    renderCoachPanel,
    renderPreviewPanel,
    renderComposer,
    showToast: input.showToast,
    onCreatedAgent: input.onCreatedAgent,
  });
  const closeExpertCreationThen = useCallback(
    (next?: () => void) => () => {
      controller.closeExpertCreation();
      next?.();
    },
    [controller.closeExpertCreation],
  );
  return { ...controller, closeExpertCreationThen };
}
