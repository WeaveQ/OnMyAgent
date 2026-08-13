/** @jsxImportSource react */
import { RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { t } from "@/i18n";
import { isTaskCenterRevisionConflict, type TaskCenterActionErrorMap, type TaskCenterActionName, type TaskCenterActionPendingMap } from "./task-center-query";

const ACTION_LABEL_KEYS: Record<TaskCenterActionName, string> = {
  create: "task_center.action_create",
  alignment: "task_center.action_alignment",
  alignmentCancel: "task_center.action_alignment_cancel",
  finalize: "task_center.action_finalize",
  update: "task_center.action_update",
  start: "task_center.action_start",
  stop: "task_center.action_stop",
  pause: "task_center.action_pause",
  resume: "task_center.action_resume",
  retry: "task_center.action_retry",
  recovery: "task_center.action_recovery",
  gate: "task_center.action_gate",
  archive: "task_center.action_archive",
  restore: "task_center.action_restore",
};

function errorMessage(error: unknown): string {
  if (isTaskCenterRevisionConflict(error)) return t("task_center.revision_conflict_actionable");
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return t("task_center.unknown_error");
}

export function TaskCenterActionErrors(props: {
  errors: TaskCenterActionErrorMap;
  pending: TaskCenterActionPendingMap;
  readOnly?: boolean;
  onRetry: (name: TaskCenterActionName) => void | Promise<unknown>;
  onDismiss: (name: TaskCenterActionName) => void;
}) {
  const entries = (Object.entries(props.errors) as Array<[TaskCenterActionName, unknown]>).filter(([name, error]) => Boolean(error) && (!props.readOnly || name === "restore"));
  if (!entries.length) return null;
  return (
    <div className="mx-3 mt-3 space-y-2 md:mx-6" data-task-center-action-errors>
      {entries.map(([name, error]) => (
        <NoticeBox key={name} role="alert" tone="error" className="flex flex-wrap items-center justify-between gap-3" data-task-center-action-error={name}>
          <div className="min-w-0">
            <p className="font-medium">{t("task_center.action_error_title", { action: t(ACTION_LABEL_KEYS[name]) })}</p>
            <p className="mt-1 break-words">{errorMessage(error)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={props.pending[name]} onClick={() => void props.onRetry(name)}>
              <RefreshCw className="size-3.5" aria-hidden />
              {props.pending[name] ? t("task_center.retrying") : isTaskCenterRevisionConflict(error) ? t("task_center.refresh_task") : t("task_center.retry_action")}
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("task_center.dismiss_error")} onClick={() => props.onDismiss(name)}>
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </NoticeBox>
      ))}
    </div>
  );
}
