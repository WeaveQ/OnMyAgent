/** @jsxImportSource react */
import { Check, ChevronRight, Clock3, HardDrive, RefreshCcw, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/action-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { ToolApprovalCard } from "@/components/ui/tool-approval-card";
import { t } from "@/i18n";
import type { PendingPermission } from "@/app/types";

type PermissionPresentation = {
  title: string;
  message: string;
  permissionLabel: string;
  scopeLabel: string;
  scopeValue: string;
  isDoomLoop: boolean;
  note: string | null;
};

type PermissionDetail = {
  label: string;
  value: string;
  multiline?: boolean;
};

type PermissionApprovalModalProps = {
  permission: PendingPermission;
  busy?: boolean;
  respondPermission?: (requestID: string, reply: "once" | "always" | "reject") => void;
  safeStringify?: (value: unknown) => string;
};

const permissionTextClass = {
  sectionLabel: "text-xs font-medium text-dls-secondary",
  inlineLabel: "flex items-center gap-2 text-xs font-medium text-dls-secondary",
};

const permissionLayoutClass = {
  body: "space-y-3 px-6 py-5",
  softCard: "rounded-xl border border-dls-border bg-dls-surface-muted p-4",
  surfaceCard: "rounded-xl border border-dls-border bg-dls-surface p-4",
  permissionValue: "mt-2 font-mono text-sm leading-6 text-dls-text",
  note: "mt-2 text-sm leading-5 text-dls-secondary",
  scopeValue: "mt-3 rounded-xl border border-dls-border bg-dls-surface-muted px-3.5 py-3 font-mono text-sm leading-6 text-dls-text",
  detailList: "mt-3 space-y-3",
  detailLabel: "text-xs font-medium text-dls-secondary",
  detailValue: "mt-1 rounded-xl border border-dls-border bg-dls-surface-muted px-3 py-2 font-mono text-xs leading-5 text-dls-text",
  details: "group rounded-xl border border-dls-border bg-dls-surface px-4 py-3",
  summary: "flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-dls-text",
  metadataPre: "mt-3 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-dls-border bg-dls-surface-muted px-3 py-2.5 text-xs leading-5 text-dls-secondary",
  panelShell: "overflow-hidden border-x-0 border-b border-t border-dls-border bg-transparent",
  panelHeader: "flex items-start justify-between gap-4 px-4 py-3.5",
  panelTitleWrap: "flex min-w-0 items-start gap-3",
  panelTitle: "text-sm font-medium leading-5 text-dls-text",
  panelMessage: "mt-0.5 text-xs leading-5 text-dls-secondary",
  panelNote: "mt-1 text-xs leading-5 text-dls-secondary",
  panelBody: "border-t border-dls-border bg-dls-surface-muted/40 px-4 py-3",
  panelScopeLabel: "flex items-center gap-1.5 text-xs font-medium text-dls-secondary",
  panelScope: "mt-1.5 truncate rounded-lg border border-dls-border bg-dls-surface px-3 py-2 font-mono text-xs leading-5 text-dls-text",
  panelDetails: "group mt-2.5 rounded-lg border border-dls-border bg-dls-surface",
  panelSummary: "flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-dls-secondary hover:text-dls-text",
  panelPre: "max-h-32 overflow-auto whitespace-pre-wrap break-words border-t border-dls-border px-3 py-2.5 text-xs leading-5 text-dls-secondary",
  panelDecision: "flex flex-col gap-3 border-t border-dls-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
  panelHint: "max-w-xl text-xs leading-5 text-dls-secondary",
  panelActions: "flex shrink-0 flex-wrap items-center justify-end gap-2",
  dangerButton: "text-dls-status-danger-fg hover:bg-dls-status-danger-soft hover:text-dls-status-danger-fg",
};

const metadataDetailKeys: Array<{ key: string; labelKey: string; multiline?: boolean }> = [
  { key: "command", labelKey: "session.permission_detail_command", multiline: true },
  { key: "description", labelKey: "session.permission_detail_description" },
  { key: "cwd", labelKey: "session.permission_detail_cwd" },
  { key: "filepath", labelKey: "session.permission_detail_file" },
  { key: "filePath", labelKey: "session.permission_detail_file" },
  { key: "path", labelKey: "session.permission_detail_path" },
  { key: "target", labelKey: "session.permission_detail_target" },
  { key: "parentDir", labelKey: "session.permission_detail_parent_directory" },
  { key: "url", labelKey: "session.permission_detail_url" },
  { key: "query", labelKey: "session.permission_detail_query", multiline: true },
  { key: "subagent_type", labelKey: "session.permission_detail_agent" },
  { key: "tool", labelKey: "session.permission_detail_tool" },
  { key: "files", labelKey: "session.permission_detail_files", multiline: true },
  { key: "diff", labelKey: "session.permission_detail_diff", multiline: true },
];

function readablePermissionLabel(permission: string): string {
  if (permission === "bash") return "Bash";
  if (permission === "edit") return t("session.permission_kind_edit");
  if (permission === "read") return t("session.permission_kind_read");
  if (permission === "external_directory") return t("session.permission_kind_external_directory");
  if (permission === "task") return t("session.permission_kind_task");
  if (permission === "todowrite") return t("session.permission_kind_todowrite");
  if (permission === "question") return t("session.permission_kind_question");
  if (permission === "skill") return t("session.permission_kind_skill");
  return permission;
}

function permissionCopy(permission: string): Pick<PermissionPresentation, "title" | "message"> {
  if (permission === "bash") {
    return {
      title: t("session.permission_title_bash"),
      message: t("session.permission_message_bash"),
    };
  }
  if (permission === "edit") {
    return {
      title: t("session.permission_title_edit"),
      message: t("session.permission_message_edit"),
    };
  }
  if (permission === "read") {
    return {
      title: t("session.permission_title_read"),
      message: t("session.permission_message_read"),
    };
  }
  if (permission === "external_directory") {
    return {
      title: t("session.permission_title_external_directory"),
      message: t("session.permission_message_external_directory"),
    };
  }
  if (permission === "task") {
    return {
      title: t("session.permission_title_task"),
      message: t("session.permission_message_task"),
    };
  }
  return {
    title: t("session.permission_title_generic", undefined, { permission: readablePermissionLabel(permission) }),
    message: t("session.permission_message"),
  };
}

function isRecordStringUnknown(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fileChangeLine(value: unknown): string | null {
  if (!isRecordStringUnknown(value)) return null;
  const path =
    (typeof value.relativePath === "string" && value.relativePath.trim()) ||
    (typeof value.filePath === "string" && value.filePath.trim()) ||
    (typeof value.path === "string" && value.path.trim()) ||
    null;
  if (!path) return null;
  const type = typeof value.type === "string" && value.type.trim() ? value.type.trim() : "change";
  return `${type}: ${path}`;
}

function metadataValue(key: string, value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (key === "files" && Array.isArray(value)) {
    const lines = value.flatMap((item) => {
      const line = fileChangeLine(item);
      return line ? [line] : [];
    });
    return lines.length ? lines.join("\n") : null;
  }
  return null;
}

export function permissionDetailRows(metadata: Record<string, unknown>): PermissionDetail[] {
  const seen = new Set<string>();
  const rows: PermissionDetail[] = [];
  for (const item of metadataDetailKeys) {
    if (seen.has(item.labelKey)) continue;
    const value = metadataValue(item.key, metadata[item.key]);
    if (!value) continue;
    seen.add(item.labelKey);
    rows.push({
      label: t(item.labelKey),
      value,
      multiline: item.multiline,
    });
  }
  return rows;
}

function stringifyMetadata(metadata: Record<string, unknown>, safeStringify?: (value: unknown) => string) {
  try {
    return safeStringify ? safeStringify(metadata) : JSON.stringify(metadata, null, 2);
  } catch {
    return t("session.permission_metadata_unavailable");
  }
}

function isFocusableElement(element: HTMLElement) {
  if (element.hasAttribute("disabled")) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function describePermissionRequest(permission: PendingPermission): PermissionPresentation {
  const patterns = permission.patterns.filter((pattern) => pattern.trim().length > 0);
  if (permission.permission === "doom_loop") {
    const tool =
      permission.metadata && typeof permission.metadata === "object" && typeof permission.metadata.tool === "string"
        ? permission.metadata.tool
        : null;

    return {
      title: t("session.doom_loop_title"),
      message: t("session.doom_loop_message"),
      permissionLabel: t("session.doom_loop_label"),
      scopeLabel: tool ? t("session.doom_loop_tool_label") : t("session.doom_loop_repeated_call_label"),
      scopeValue: tool ?? (patterns.length ? patterns.join(", ") : t("session.doom_loop_repeated_tool_call")),
      isDoomLoop: true,
      note: t("session.doom_loop_note"),
    };
  }

  const copy = permissionCopy(permission.permission);
  return {
    title: copy.title,
    message: copy.message,
    permissionLabel: readablePermissionLabel(permission.permission),
    scopeLabel: t("session.scope_label"),
    scopeValue: patterns.join(", ") || t("session.permission_scope_empty"),
    isDoomLoop: false,
    note: null,
  };
}

export function PermissionApprovalModal(props: PermissionApprovalModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const presentation = useMemo(() => describePermissionRequest(props.permission), [props.permission]);
  const metadata = isRecordStringUnknown(props.permission.metadata) ? props.permission.metadata : {};
  const hasMetadata = Object.keys(metadata).length > 0;
  const detailRows = permissionDetailRows(metadata);
  const Icon = presentation.isDoomLoop ? RefreshCcw : ShieldCheck;
  const iconClass = presentation.isDoomLoop
    ? "bg-dls-status-warning-soft text-dls-status-warning-fg"
    : "bg-dls-decision-soft text-dls-accent";

  useEffect(() => {
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      previousActiveElementRef.current?.focus({ preventScroll: true });
    };
  }, [props.permission.id]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.respondPermission?.(props.permission.id, "reject");
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(isFocusableElement);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <AlertDialog open>
      <AlertDialogContent
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="w-full max-w-xl overflow-hidden sm:max-w-xl"
      >
        <AlertDialogHeader>
          <div className="flex items-start gap-4 text-left">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${iconClass}`}>
              <Icon size={24} strokeWidth={1.9} />
            </div>
            <div className="min-w-0 flex-1">
              <AlertDialogTitle>
                {presentation.title}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {presentation.message}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <div className={permissionLayoutClass.body}>
          <div className={permissionLayoutClass.softCard}>
            <div className={permissionTextClass.sectionLabel}>
              {t("session.permission_label")}
            </div>
            <div className={permissionLayoutClass.permissionValue}>
              {presentation.permissionLabel}
            </div>
            {presentation.note ? (
              <p className={permissionLayoutClass.note}>
                {presentation.note}
              </p>
            ) : null}
          </div>

          <div className={permissionLayoutClass.surfaceCard}>
            <div className={permissionTextClass.inlineLabel}>
              <HardDrive size={12} />
              {presentation.scopeLabel}
            </div>
            <div className={permissionLayoutClass.scopeValue}>
              <span className="block break-all">{presentation.scopeValue}</span>
            </div>
          </div>

          {detailRows.length > 0 ? (
            <div className={permissionLayoutClass.surfaceCard}>
              <div className={permissionTextClass.sectionLabel}>
                {t("session.permission_review_label")}
              </div>
              <div className={permissionLayoutClass.detailList}>
                {detailRows.map((row) => (
                  <div key={row.label}>
                    <div className={permissionLayoutClass.detailLabel}>{row.label}</div>
                    <div
                      className={`${permissionLayoutClass.detailValue} ${
                        row.multiline ? "max-h-44 overflow-auto whitespace-pre-wrap" : "break-all"
                      }`}
                    >
                      {row.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {hasMetadata ? (
            <details className={permissionLayoutClass.details}>
              <summary className={permissionLayoutClass.summary}>
                <span>{t("session.details_label")}</span>
                <ChevronRight size={14} className="text-dls-secondary transition-transform group-open:rotate-90" />
              </summary>
              <pre className={permissionLayoutClass.metadataPre}>
                {stringifyMetadata(metadata, props.safeStringify)}
              </pre>
            </details>
          ) : null}
        </div>

        <AlertDialogFooter className="flex-col gap-4">
          <p className="mb-4 text-xs leading-5 text-dls-secondary">
            {t("session.permission_decision_hint")}
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_auto_auto]">
            <AlertDialogAction
              variant="destructive"
              className="justify-center sm:justify-self-start"
              onClick={() => props.respondPermission?.(props.permission.id, "reject")}
              disabled={props.busy || !props.respondPermission}
            >
              <XCircle data-icon="inline-start" />
              {t("session.deny")}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => props.respondPermission?.(props.permission.id, "once")}
              disabled={props.busy || !props.respondPermission}
            >
              <Clock3 data-icon="inline-start" />
              {t("session.allow_once")}
            </AlertDialogAction>
            <AlertDialogAction
              variant="outline"
              onClick={() => props.respondPermission?.(props.permission.id, "always")}
              disabled={props.busy || !props.respondPermission}
            >
              <Check data-icon="inline-start" />
              {t("session.allow_for_session")}
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function permissionRiskTier(permission: PendingPermission, isDoomLoop: boolean): "safe" | "careful" | "destructive" {
  if (isDoomLoop) return "destructive";
  const kind = permission.permission;
  if (kind === "bash" || kind === "edit" || kind === "external_directory") return "careful";
  if (kind === "read" || kind === "todowrite" || kind === "question" || kind === "skill") return "safe";
  return "careful";
}

export function PermissionApprovalPanel(props: PermissionApprovalModalProps) {
  const presentation = useMemo(() => describePermissionRequest(props.permission), [props.permission]);
  const metadata = isRecordStringUnknown(props.permission.metadata) ? props.permission.metadata : {};
  const hasMetadata = Object.keys(metadata).length > 0;
  const Icon = presentation.isDoomLoop ? RefreshCcw : ShieldCheck;

  const risk = permissionRiskTier(props.permission, presentation.isDoomLoop);
  const badgeTone =
    risk === "destructive" ? "danger" : risk === "careful" ? "warning" : "neutral";

  return (
    <ToolApprovalCard risk={risk} className={permissionLayoutClass.panelShell}>
      <div className={permissionLayoutClass.panelHeader}>
        <div className={permissionLayoutClass.panelTitleWrap}>
          <IconTile className="mt-0.5" shape="xl" tone="neutral" border>
            <Icon size={16} strokeWidth={1.9} />
          </IconTile>
          <div className="min-w-0">
            <div className={permissionLayoutClass.panelTitle}>{presentation.title}</div>
            <div className={permissionLayoutClass.panelMessage}>{presentation.message}</div>
            {presentation.note ? (
              <div className={permissionLayoutClass.panelNote}>{presentation.note}</div>
            ) : null}
          </div>
        </div>
        <StatusBadge tone={badgeTone} shape="soft" size="sm">
          {presentation.permissionLabel}
        </StatusBadge>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="shrink-0 text-dls-secondary hover:text-dls-text"
          onClick={() =>
            props.respondPermission?.(props.permission.id, "reject")
          }
          disabled={props.busy || !props.respondPermission}
          aria-label={t("session.goal_runtime_clear")}
        >
          <Trash2 size={12} />
        </Button>
      </div>

      <div className={permissionLayoutClass.panelBody}>
        <div className={permissionLayoutClass.panelScopeLabel}>
          <HardDrive size={12} />
          {presentation.scopeLabel}
        </div>
        <div className={permissionLayoutClass.panelScope} title={presentation.scopeValue}>
          {presentation.scopeValue}
        </div>

        {hasMetadata ? (
          <details className={permissionLayoutClass.panelDetails}>
            <summary className={permissionLayoutClass.panelSummary}>
              <span>{t("session.details_label")}</span>
              <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
            </summary>
            <pre className={permissionLayoutClass.panelPre}>
              {stringifyMetadata(metadata, props.safeStringify)}
            </pre>
          </details>
        ) : null}
      </div>

      <div className={permissionLayoutClass.panelDecision}>
        <p className={permissionLayoutClass.panelHint}>
          {t("session.permission_decision_hint")}
        </p>
        <div className={permissionLayoutClass.panelActions}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={permissionLayoutClass.dangerButton}
            onClick={() => props.respondPermission?.(props.permission.id, "reject")}
            disabled={props.busy || !props.respondPermission}
          >
            <XCircle data-icon="inline-start" />
            {t("session.deny")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => props.respondPermission?.(props.permission.id, "always")}
            disabled={props.busy || !props.respondPermission}
          >
            <Check data-icon="inline-start" />
            {t("session.allow_for_session")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => props.respondPermission?.(props.permission.id, "once")}
            disabled={props.busy || !props.respondPermission}
          >
            <Clock3 data-icon="inline-start" />
            {t("session.allow_once")}
          </Button>
        </div>
      </div>
    </ToolApprovalCard>
  );
}
