/** @jsxImportSource react */
import { Check, FolderPlus, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { NoticeBox } from "@/components/ui/notice-box";
import type { WorkspacePreset } from "../../../app/types";
import { t } from "../../../i18n";
import {
  errorBannerClass,
  modalBodyClass,
  sectionBodyClass,
  sectionTitleClass,
  softCardClass,
  surfaceCardClass,
  tagClass,
  warningBannerClass,
} from "../shared/modal-styles";

export type CreateWorkspaceProgressStep = {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string | null;
};

export type CreateWorkspaceProgressSnapshot = {
  runId: string;
  startedAt: number;
  stage: string;
  error: string | null;
  steps: CreateWorkspaceProgressStep[];
  logs: string[];
};

export type CreateWorkspaceLocalPanelProps = {
  selectedFolder: string | null;
  hasSelectedFolder: boolean;
  pickingFolder: boolean;
  onPickFolder: () => void;
  submitting: boolean;
  localError: string | null;
  onClose: () => void;
  onSubmit: () => void;
  confirmLabel?: string;
  workerLabel?: string;
  onConfirmWorker?: (preset: WorkspacePreset, folder: string | null) => void;
  preset: WorkspacePreset;
  workerSubmitting: boolean;
  workerDisabled: boolean;
  workerDisabledReason: string | null;
  workerCtaLabel?: string;
  workerCtaDescription?: string;
  onWorkerCta?: () => void;
  workerRetryLabel?: string;
  onWorkerRetry?: () => void;
  workerDebugLines: string[];
  progress: CreateWorkspaceProgressSnapshot | null;
  elapsedSeconds: number;
  showProgressDetails: boolean;
  onToggleProgressDetails: () => void;
};

const localPanelStateClass = {
  successIcon: "text-dls-status-success-fg",
  errorIcon: "text-dls-status-danger-fg",
  errorText: "text-dls-status-danger-fg font-medium",
  warningTitle: "font-medium text-dls-status-warning",
};

const localPanelLayoutClass = {
  stack: "space-y-4",
  checkList: "mt-3 space-y-1.5 pl-1",
  checkItem: "flex items-start gap-2 text-sm text-dls-secondary",
  checkIcon: "mt-0.5 shrink-0",
  folderHint: "mt-2 text-xs text-dls-secondary italic",
  selectedPath: "block truncate font-mono text-xs text-dls-text",
  emptyFolder: "text-sm text-dls-secondary",
  progressHeader: "flex items-start justify-between gap-3",
  progressMeta: "flex items-center gap-2 text-xs font-medium text-dls-text",
  progressGrid: "mt-4 grid gap-2.5",
  progressStep: "flex items-center gap-3",
  progressStepBody: "flex min-w-0 flex-1 items-center justify-between gap-2",
  progressLogs: "max-h-[120px] space-y-0.5 overflow-y-auto",
  logLine: "break-all font-mono text-xs leading-tight text-dls-text",
  actionWrap: "mt-3 flex flex-wrap items-center gap-2",
  footerActions: "flex justify-end gap-3",
};

function stepIcon(status: CreateWorkspaceProgressStep["status"]) {
  if (status === "done")
    return <XCircle size={16} className={localPanelStateClass.successIcon} />;
  if (status === "active")
    return <Loader2 size={16} className="animate-spin text-dls-accent" />;
  if (status === "error") return <XCircle size={16} className={localPanelStateClass.errorIcon} />;
  return <div className="size-4 rounded-full border-2 border-dls-border" />;
}

function toKeyedLines(lines: string[]) {
  let offset = 0;
  return lines.map((line) => {
    const key = `${offset}:${line}`;
    offset += line.length + 1;
    return { key, line };
  });
}

function stepTextClass(status: CreateWorkspaceProgressStep["status"]) {
  if (status === "done") return "text-dls-text font-medium";
  if (status === "active") return "text-dls-text font-medium";
  if (status === "error") return localPanelStateClass.errorText;
  return "text-dls-secondary";
}

export function CreateWorkspaceLocalPanel(
  props: CreateWorkspaceLocalPanelProps,
) {
  const progress = props.progress;

  return (
    <>
      <div
        className={`${modalBodyClass} transition-opacity duration-300 ${props.submitting ? "pointer-events-none opacity-40" : "opacity-100"}`}
      >
        <div className={localPanelLayoutClass.stack}>
          <div className={surfaceCardClass}>
            <div className={sectionTitleClass}>{t("welcome.folder_title")}</div>
            <div className={`${sectionBodyClass} mt-2`}>
              {t("welcome.folder_explanation")}
            </div>
            <ul className={localPanelLayoutClass.checkList}>
              <li className={localPanelLayoutClass.checkItem}>
                <Check size={14} className={`${localPanelLayoutClass.checkIcon} ${localPanelStateClass.successIcon}`} />
                {t("welcome.folder_read")}
              </li>
              <li className={localPanelLayoutClass.checkItem}>
                <Check size={14} className={`${localPanelLayoutClass.checkIcon} ${localPanelStateClass.successIcon}`} />
                {t("welcome.folder_write")}
              </li>
              <li className={localPanelLayoutClass.checkItem}>
                <Check size={14} className={`${localPanelLayoutClass.checkIcon} ${localPanelStateClass.successIcon}`} />
                {t("welcome.folder_anything")}
              </li>
            </ul>
            <div className={localPanelLayoutClass.folderHint}>
              {t("welcome.folder_drop_hint")}
            </div>

            <NoticeBox className="mt-4">
              {props.hasSelectedFolder ? (
                <span className={localPanelLayoutClass.selectedPath}>
                  {props.selectedFolder}
                </span>
              ) : (
                <span className={localPanelLayoutClass.emptyFolder}>
                  {t("welcome.folder_no_folder_selected_yet")}
                </span>
              )}
            </NoticeBox>
            <div className="mt-4">
              <Button
                type="button"
                onClick={props.onPickFolder}
                disabled={props.pickingFolder || props.submitting}
                variant="outline"
                size="sm"
              >
                {props.pickingFolder ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <FolderPlus size={14} />
                )}
                {props.hasSelectedFolder
                  ? t("dashboard.change")
                  : t("welcome.folder_select_folder")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter className="flex-col gap-3">
        {props.submitting && progress ? (
          <div className={softCardClass}>
            <div className={localPanelLayoutClass.progressHeader}>
              <div className="min-w-0">
                <div className={localPanelLayoutClass.progressMeta}>
                  {progress.error ? (
                    <XCircle size={14} className={localPanelStateClass.errorIcon} />
                  ) : (
                    <Loader2
                      size={14}
                      className="animate-spin text-dls-accent"
                    />
                  )}
                  Sandbox setup
                </div>
                <div className="mt-1 truncate text-sm leading-snug text-dls-text">
                  {progress.stage}
                </div>
                <div className="mt-1 font-mono text-xs text-dls-secondary">
                  {props.elapsedSeconds}s
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-dls-secondary hover:text-dls-text"
                onClick={props.onToggleProgressDetails}
              >
                {props.showProgressDetails ? "Hide logs" : "Show logs"}
              </Button>
            </div>

            {progress.error ? (
              <div className={`mt-3 ${errorBannerClass}`}>{progress.error}</div>
            ) : null}

            <div className={localPanelLayoutClass.progressGrid}>
              {progress.steps.map((step) => (
                <div key={step.key} className={localPanelLayoutClass.progressStep}>
                  <div className="flex size-5 shrink-0 items-center justify-center">
                    {stepIcon(step.status)}
                  </div>
                  <div className={localPanelLayoutClass.progressStepBody}>
                    <div
                      className={`text-xs ${stepTextClass(step.status)} transition-colors duration-200`.trim()}
                    >
                      {step.label}
                    </div>
                    {step.detail?.trim() ? (
                      <div
                        className={`${tagClass} max-w-[120px] truncate font-mono`}
                      >
                        {step.detail}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {props.showProgressDetails && progress.logs.length > 0 ? (
              <div className={`mt-3 ${softCardClass}`}>
                <div className="mb-2 text-xs font-medium text-dls-secondary">
                  Live logs
                </div>
                <div className={localPanelLayoutClass.progressLogs}>
                  {toKeyedLines(progress.logs.slice(-10)).map(
                    ({ key, line }) => (
                      <div
                        key={`${progress.runId}-log-${key}`}
                        className={localPanelLayoutClass.logLine}
                      >
                        {line}
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {props.onConfirmWorker &&
        props.workerDisabled &&
        props.workerDisabledReason ? (
          <div className={warningBannerClass}>
            <div className={localPanelStateClass.warningTitle}>
              {t("dashboard.sandbox_get_ready_title")}
            </div>
            <div className="mt-1 leading-relaxed">
              {props.workerDisabledReason || props.workerCtaDescription}
            </div>
            <div className={localPanelLayoutClass.actionWrap}>
              {props.onWorkerCta && props.workerCtaLabel?.trim() ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={props.onWorkerCta}
                  disabled={props.submitting}
                >
                  {props.workerCtaLabel}
                </Button>
              ) : null}
              {props.onWorkerRetry && props.workerRetryLabel?.trim() ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-dls-secondary hover:text-dls-text"
                  onClick={props.onWorkerRetry}
                  disabled={props.submitting}
                >
                  {props.workerRetryLabel}
                </Button>
              ) : null}
            </div>
            {props.workerDebugLines.length > 0 ? (
              <details
                className={`mt-3 ${softCardClass} text-xs text-dls-text`}
              >
                <summary className="cursor-pointer text-xs font-medium text-dls-text">
                  Docker debug details
                </summary>
                <div className="mt-2 space-y-1 break-words font-mono">
                  {toKeyedLines(props.workerDebugLines).map(({ key, line }) => (
                    <div key={`docker-line-${key}`}>{line}</div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}

        {props.localError ? <NoticeBox className="mb-3 whitespace-pre-line" size="comfortable" tone="error">{props.localError}</NoticeBox> : null}

        <div className={localPanelLayoutClass.footerActions}>
          <DialogClose
            disabled={props.submitting}
            render={<Button variant="outline" disabled={props.submitting} />}
          >
            {t("common.cancel")}
          </DialogClose>
          {props.onConfirmWorker ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                props.onConfirmWorker?.(props.preset, props.selectedFolder)
              }
              disabled={
                !props.selectedFolder ||
                props.submitting ||
                props.workerSubmitting ||
                props.workerDisabled
              }
              title={
                !props.selectedFolder
                  ? t("dashboard.choose_folder_continue")
                  : props.workerDisabledReason || undefined
              }
            >
              {props.workerSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  {t("dashboard.sandbox_checking_docker")}
                </span>
              ) : (
                (props.workerLabel ?? t("dashboard.create_sandbox_confirm"))
              )}
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => void props.onSubmit()}
            disabled={!props.selectedFolder || props.submitting}
            title={
              !props.selectedFolder
                ? t("dashboard.choose_folder_continue")
                : undefined
            }
          >
            {props.submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                Creating…
              </span>
            ) : (
              (props.confirmLabel ?? t("dashboard.create_workspace_confirm"))
            )}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
