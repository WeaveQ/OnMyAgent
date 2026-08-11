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
  const modal = useSessionTaskRenameDelete<ExpertGroupDeleteTarget>({
    selectedSessionId: props.selectedSessionId,
    workspaceSessionGroups: props.sidebar.workspaceSessionGroups,
    onRenameSession: props.onRenameSession,
    onDeleteSession: props.onDeleteSession,
    executeDelete: executeExpertDelete,
    requireGroupSessionIds: false,
  });
  const hardDelete = useExpertHardDeleteUi({
    registry: input.registry,
    conversationGroups: input.conversationGroups,
    openDeleteGroupModal: modal.openDeleteGroupModal,
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
    expertDeleteTitle: copy.title,
    expertDeleteMessage: copy.message,
    expertDeleteConfirmLabel: copy.confirmLabel,
  };
}
