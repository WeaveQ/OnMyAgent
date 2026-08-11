import type { Dispatch, SetStateAction } from "react";
import { t } from "../../../../i18n";
import type { AgentCardItem, AgentRegistry } from "../../agents";
import { ProviderAuthModal } from "../../connections";
import { ShareWorkspaceModal } from "../../workspace";
import { CustomConnectorDialog } from "@/react-app/domains/plugins";
import type { AppStatusToastInput } from "../../shell-feedback";
import {
  SessionTaskRenameDeleteModals,
} from "./session-task-rename-delete-modals";
import type { CustomConnectorDialogView } from "./use-custom-connector-dialog";
import type { SessionPageProps } from "./session-page-types";

export type ExpertPageModalsProps = {
  selectedWorkspaceId: string;
  selectedWorkspaceRoot: string;
  onmyagentServerClient: SessionPageProps["onmyagentServerClient"];
  providers: SessionPageProps["providers"];
  providerConnectedIds: string[];
  renderAgentsPage: SessionPageProps["renderAgentsPage"];
  providerAuthModal: SessionPageProps["providerAuthModal"];
  shareWorkspaceModal: SessionPageProps["shareWorkspaceModal"];
  onRenameSession: SessionPageProps["onRenameSession"];
  agentCreateRequestKey: number | null;
  handleStartAgentConversation: (item: AgentCardItem, registry: AgentRegistry) => void;
  setAgentCreateRequestKey: Dispatch<SetStateAction<number | null>>;
  renameOpen: boolean;
  renameTitle: string;
  renameBusy: boolean;
  canSaveRename: boolean;
  closeRenameModal: () => void;
  submitRename: () => void | Promise<void>;
  setRenameTitle: Dispatch<SetStateAction<string>>;
  deleteOpen: boolean;
  deleteBusy: boolean;
  expertDeleteTitle: string;
  expertDeleteMessage: string;
  expertDeleteConfirmLabel: string;
  confirmDelete: () => void | Promise<void>;
  closeDeleteModal: () => void;
  customConnectorOpen: boolean;
  setCustomConnectorOpen: (open: boolean) => void;
  customConnectorInitialView: CustomConnectorDialogView;
  showToast: (input: AppStatusToastInput) => string;
};

export function ExpertPageModals({
  selectedWorkspaceId,
  selectedWorkspaceRoot,
  onmyagentServerClient,
  providers,
  providerConnectedIds,
  renderAgentsPage,
  providerAuthModal,
  shareWorkspaceModal,
  onRenameSession,
  agentCreateRequestKey,
  handleStartAgentConversation,
  setAgentCreateRequestKey,
  renameOpen,
  renameTitle,
  renameBusy,
  canSaveRename,
  closeRenameModal,
  submitRename,
  setRenameTitle,
  deleteOpen,
  deleteBusy,
  expertDeleteTitle,
  expertDeleteMessage,
  expertDeleteConfirmLabel,
  confirmDelete,
  closeDeleteModal,
  customConnectorOpen,
  setCustomConnectorOpen,
  customConnectorInitialView,
  showToast,
}: ExpertPageModalsProps) {
  return (
    <>
      {agentCreateRequestKey
        ? renderAgentsPage({
            workspaceId: selectedWorkspaceId,
            workspaceRoot: selectedWorkspaceRoot,
            client: onmyagentServerClient,
            providers,
            connectedProviderIds: providerConnectedIds,
            initialCreateRequestKey: agentCreateRequestKey,
            dialogOnly: true,
            onStartConversation: (item, registry) => {
              handleStartAgentConversation(item, registry);
              setAgentCreateRequestKey(null);
            },
          })
        : null}
      {providerAuthModal ? <ProviderAuthModal {...providerAuthModal} /> : null}
      <SessionTaskRenameDeleteModals
        canRename={Boolean(onRenameSession)}
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
      {shareWorkspaceModal ? <ShareWorkspaceModal {...shareWorkspaceModal} /> : null}
      <CustomConnectorDialog
        open={customConnectorOpen}
        onOpenChange={setCustomConnectorOpen}
        workspaceRoot={selectedWorkspaceRoot}
        initialView={customConnectorInitialView}
        onSaved={() => {
          showToast({
            title: t("plugins.custom_connector_saved"),
            tone: "success",
          });
        }}
      />
    </>
  );
}
