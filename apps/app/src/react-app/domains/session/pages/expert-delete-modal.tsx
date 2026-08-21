/** @jsxImportSource react */
import { SessionTaskRenameDeleteModals } from "./session-task-rename-delete-modals";

export type ExpertDeleteModalProps = {
  open: boolean;
  busy: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Shared expert-delete confirmation for Expert and Store entry routes. */
export function ExpertDeleteModal(props: ExpertDeleteModalProps) {
  return (
    <SessionTaskRenameDeleteModals
      canRename={false}
      renameOpen={false}
      renameTitle=""
      renameBusy={false}
      canSaveRename={false}
      onRenameClose={() => undefined}
      onRenameSave={() => undefined}
      onRenameTitleChange={() => undefined}
      showDelete={props.open}
      deleteOpen={props.open}
      deleteBusy={props.busy}
      deleteTitle={props.title}
      deleteMessage={props.message}
      deleteConfirmLabel={props.confirmLabel}
      onDeleteConfirm={props.onConfirm}
      onDeleteCancel={props.onCancel}
    />
  );
}
