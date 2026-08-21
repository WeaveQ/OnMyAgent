/** @jsxImportSource react */
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { t } from "../../../../i18n";
import { SessionTaskRenameDeleteModals } from "./session-task-rename-delete-modals";

export type ExpertDeleteModalProps = {
  open: boolean;
  busy: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  packageOptionVisible: boolean;
  packageSelected: boolean;
  onPackageSelectedChange: (selected: boolean) => void;
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
      deleteExtra={
        props.packageOptionVisible ? (
          <label
            className={cn(
              "flex cursor-pointer items-center gap-2 text-xs transition-colors",
              props.packageSelected
                ? "text-dls-status-danger-fg"
                : "text-dls-secondary/60",
            )}
          >
            <Checkbox
              checked={props.packageSelected}
              onCheckedChange={props.onPackageSelectedChange}
              className={cn(
                "border-dls-border bg-dls-surface-muted",
                "data-checked:border-dls-status-danger data-checked:bg-dls-status-danger",
              )}
            />
            <span>{t("session.delete_expert_package_option")}</span>
          </label>
        ) : undefined
      }
      onDeleteConfirm={props.onConfirm}
      onDeleteCancel={props.onCancel}
    />
  );
}
