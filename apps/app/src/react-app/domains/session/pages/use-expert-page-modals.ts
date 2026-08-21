import { useCallback, useState } from "react";
import type { AgentRegistry } from "../../agents";
import type { AgentConversationGroup } from "../sidebar/session-chrome";
import type { SidebarSessionItem } from "../../../../app/types";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import {
  resolveExpertDeleteCopy,
  useExpertSessionDelete,
  type ExpertGroupDeleteTarget,
} from "./use-expert-session-delete";
import { useExpertHardDeleteUi } from "./use-expert-hard-delete-ui";
import { useSessionTaskRenameDelete } from "./session-task-rename-delete";
import type { ExpertPageProps } from "./use-expert-page";

/** Owns rename/session-delete/expert-hard-delete modal state. */
export function useExpertPageModals(input: {
  props: ExpertPageProps;
  client: OnMyAgentServerClient | null;
  activeConversationAgentId: string | null;
  currentAgentSessions: SidebarSessionItem[];
  registry: AgentRegistry | null;
  conversationGroups: AgentConversationGroup[];
}) {
  const { props } = input;
  const { executeExpertDelete, deleteProgress } = useExpertSessionDelete({
    workspaceId: props.selectedWorkspaceId,
    workspaceRoot: props.selectedWorkspaceRoot,
    client: input.client,
    activeConversationAgentId: input.activeConversationAgentId,
    currentAgentSessions: input.currentAgentSessions,
    onDeleteSession: props.onDeleteSession,
    registry: input.registry,
  });
  const [deletePackageSelected, setDeletePackageSelected] = useState(false);
  const executeDelete = useCallback(
    (target: Parameters<typeof executeExpertDelete>[0]) =>
      executeExpertDelete(
        target.kind === "expert" && target.allowPackageDelete
          ? { ...target, deletePackage: deletePackageSelected }
          : target,
      ),
    [deletePackageSelected, executeExpertDelete],
  );
  const modal = useSessionTaskRenameDelete<ExpertGroupDeleteTarget>({
    selectedSessionId: props.selectedSessionId,
    workspaceSessionGroups: props.sidebar.workspaceSessionGroups,
    onRenameSession: props.onRenameSession,
    onDeleteSession: props.onDeleteSession,
    executeDelete,
    requireGroupSessionIds: false,
  });
  const openDeleteGroupModal = useCallback(
    (target: ExpertGroupDeleteTarget) => {
      setDeletePackageSelected(false);
      modal.openDeleteGroupModal(target);
    },
    [modal.openDeleteGroupModal],
  );
  const hardDelete = useExpertHardDeleteUi({
    registry: input.registry,
    conversationGroups: input.conversationGroups,
    openDeleteGroupModal,
  });
  const copy = resolveExpertDeleteCopy({
    deleteTarget: modal.deleteTarget,
    sessionActionTitle: modal.sessionActionTitle,
    deleteBusy: modal.deleteBusy,
    deleteProgress,
  });
  return {
    ...modal,
    ...hardDelete,
    openDeleteGroupModal,
    deletePackageOptionVisible:
      modal.deleteTarget?.kind === "expert" &&
      modal.deleteTarget.allowPackageDelete === true,
    deletePackageSelected,
    setDeletePackageSelected,
    expertDeleteTitle: copy.title,
    expertDeleteMessage: copy.message,
    expertDeleteConfirmLabel: copy.confirmLabel,
  };
}
