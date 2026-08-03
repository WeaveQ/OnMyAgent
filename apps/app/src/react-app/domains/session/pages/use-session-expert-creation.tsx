/** @jsxImportSource react */
import { useCallback } from "react";

import { t } from "../../../../i18n";
import { ReactSessionComposer } from "../surface/composer/composer";
import type { SessionPageProps } from "./session-page-types";
import {
  type AgentRegistry,
  type ExpertCreationComposerProps,
  type ExpertCreationControllerInput,
  useExpertCreationController,
} from "../../agents";

type SessionExpertCreationInput = {
  props: SessionPageProps;
  registry: AgentRegistry | null;
  showToast: ExpertCreationControllerInput["showToast"];
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

  const controller = useExpertCreationController({
    registry: input.registry,
    workspaceId: input.props.selectedWorkspaceId,
    workspaceRoot: input.props.selectedWorkspaceRoot,
    opencodeBaseUrl: input.props.opencodeBaseUrl ?? null,
    onmyagentServerToken: input.props.onmyagentServerToken ?? null,
    client: input.props.onmyagentServerClient,
    skills: input.registry?.skills ?? [],
    selectedModel: input.props.surface?.model.selectedModel ?? null,
    renderComposer,
    showToast: input.showToast,
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
