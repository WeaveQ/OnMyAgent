/** @jsxImportSource react */
import { t } from "../../../../i18n";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import { RenameSessionModal } from "../modals/rename-session-modal";

export type SessionTaskRenameDeleteModalsProps = {
  canRename: boolean;
  renameOpen: boolean;
  renameTitle: string;
  renameBusy: boolean;
  canSaveRename: boolean;
  onRenameClose: () => void;
  onRenameSave: () => void;
  onRenameTitleChange: (value: string) => void;
  /**
   * Expert mounts only while open; assistant mounts whenever delete is available.
   */
  showDelete: boolean;
  deleteOpen: boolean;
  deleteBusy: boolean;
  deleteTitle: string;
  deleteMessage: string;
  deleteConfirmLabel: string;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
};

/**
 * Presentational rename + delete confirm modals shared by Expert and Assistant hosts.
 * Call sites own i18n title/message so product copy stays page-specific.
 */
export function SessionTaskRenameDeleteModals(
  props: SessionTaskRenameDeleteModalsProps,
) {
  return (
    <>
      {props.canRename ? (
        <RenameSessionModal
          open={props.renameOpen}
          title={props.renameTitle}
          busy={props.renameBusy}
          canSave={props.canSaveRename}
          onClose={props.onRenameClose}
          onSave={props.onRenameSave}
          onTitleChange={props.onRenameTitleChange}
        />
      ) : null}

      {props.showDelete ? (
        <ConfirmModal
          open={props.deleteOpen}
          title={props.deleteTitle}
          message={props.deleteMessage}
          confirmLabel={props.deleteConfirmLabel}
          cancelLabel={t("common.cancel")}
          variant="danger"
          onConfirm={props.onDeleteConfirm}
          onCancel={props.onDeleteCancel}
        />
      ) : null}
    </>
  );
}
