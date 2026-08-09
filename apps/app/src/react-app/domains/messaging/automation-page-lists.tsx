/** @jsxImportSource react */
/**
 * Task / run list rows + bodies for AutomationPage.
 */
import {
  Archive,
  Check,
  CircleAlert,
  Clock,
  FileText,
  Pause,
  Pencil,
  Play,
  Square,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyStateBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import type { OnMyAgentAutomationTaskItem } from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import { AUTOMATION_EMPTY_STATE_ASSET } from "@/react-app/design-system/empty-state-assets";
import { EmptyStateIllustration } from "@/react-app/design-system/empty-state-illustration";
import {
  resolveRunDayLabel,
  type CompletedRunEntry,
  type DayGroupedRuns,
} from "./automation-list-model";
import {
  relativeRunTime,
  scheduleLabel,
} from "./automation-form-model";
import { RunningAutomationRow } from "./automation-page-sections";

export type CompletedRun = CompletedRunEntry<OnMyAgentAutomationTaskItem>;

function AutomationTaskStatusBadge(props: {
  enabled: boolean;
  running?: boolean;
}) {
  // Running: a run is in progress for this task.
  if (props.running) {
    return (
      <StatusBadge tone="success" size="sm" shape="soft">
        <Square className="size-2.5 fill-current" aria-hidden />
        {t("automation.status_running")}
      </StatusBadge>
    );
  }
  // Paused: schedule is disabled.
  if (!props.enabled) {
    return (
      <StatusBadge tone="warning" size="sm" shape="soft">
        <Pause className="size-2.5" aria-hidden />
        {t("automation.status_paused")}
      </StatusBadge>
    );
  }
  // Enabled: schedule is on, not currently running.
  return (
    <StatusBadge tone="accent" size="sm" shape="soft">
      <Clock className="size-2.5" aria-hidden />
      {t("automation.status_active")}
    </StatusBadge>
  );
}

function AutomationTaskCardMeta(props: { item: OnMyAgentAutomationTaskItem }) {
  const agentName = props.item.agent?.name?.trim();
  const agentInitial = agentName ? agentName.charAt(0).toUpperCase() : "";
  const runCount = props.item.runs?.length ?? 0;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dls-secondary">
      {agentName ? (
        <span className="inline-flex min-w-0 max-w-40 items-center gap-1.5">
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-dls-icon-muted-bg text-2xs font-semibold text-dls-text"
            aria-hidden
          >
            {agentInitial}
          </span>
          <span className="truncate">{agentName}</span>
        </span>
      ) : null}
      <span className="inline-flex min-w-0 items-center gap-1">
        <Clock className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{scheduleLabel(props.item.schedule)}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1">
        <Play className="size-3.5 shrink-0" aria-hidden />
        {t("automation.run_count", { count: runCount })}
      </span>
    </div>
  );
}

export function ScheduledAutomationRow(props: {
  item: OnMyAgentAutomationTaskItem;
  busy?: boolean;
  onEdit: (item: OnMyAgentAutomationTaskItem) => void;
  onRunNow: (item: OnMyAgentAutomationTaskItem) => void;
  onToggleEnabled: (item: OnMyAgentAutomationTaskItem) => void;
  onDelete: (item: OnMyAgentAutomationTaskItem) => void;
}) {
  const enabled = props.item.enabled;
  const promptPreview = props.item.prompt.trim().replace(/\s+/g, " ");
  return (
    <div className="group rounded-xl border border-dls-border bg-dls-surface px-4 py-3 transition-colors hover:bg-dls-hover/60">
      <div className="flex items-start justify-between gap-2">
        <AutomationTaskStatusBadge enabled={enabled} />
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={props.busy}
            className="h-7 px-2 text-xs text-dls-secondary"
            onClick={() => props.onEdit(props.item)}
          >
            <Pencil className="size-3.5" />
            {t("automation.edit")}
          </Button>
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={props.busy}
              title={t("automation.test_run")}
              aria-label={t("automation.test_run")}
              onClick={() => props.onRunNow(props.item)}
            >
              <Play className="size-3.5 text-dls-secondary" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={props.busy}
              title={enabled ? t("automation.pause") : t("automation.resume")}
              aria-label={enabled ? t("automation.pause") : t("automation.resume")}
              onClick={() => props.onToggleEnabled(props.item)}
            >
              {enabled ? (
                <Pause className="size-3.5 text-dls-secondary" />
              ) : (
                <Play className="size-3.5 text-dls-secondary" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={props.busy}
              title={t("automation.delete")}
              aria-label={t("automation.delete")}
              onClick={() => props.onDelete(props.item)}
            >
              <Trash2 className="size-3.5 text-dls-secondary" />
            </Button>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => props.onEdit(props.item)}
        className="mt-2 block w-full min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <div className="truncate text-sm font-semibold text-dls-text">{props.item.title}</div>
        {promptPreview ? (
          <div className="mt-1 line-clamp-2 text-xs leading-5 text-dls-secondary">{promptPreview}</div>
        ) : null}
      </button>
      <div className="mt-3">
        <AutomationTaskCardMeta item={props.item} />
      </div>
    </div>
  );
}

export function CompletedAutomationRow(props: {
  entry: CompletedRun;
  busy: boolean;
  onOpenSession: (sessionId: string) => void;
  onArchive: (entry: CompletedRun) => void;
  onDelete: (item: OnMyAgentAutomationTaskItem) => void;
}) {
  const { run, task } = props.entry;
  const successful = run.status === "success";
  const skipped = run.status === "skipped";
  const failed = !successful && !skipped;
  const statusClassName = successful
    ? "text-dls-secondary"
    : skipped
      ? "text-dls-status-warning-fg"
      : "text-dls-status-danger-fg";
  const statusLabel = successful
    ? run.source === "manual"
      ? t("automation.run_manual_completed")
      : t("automation.run_completed")
    : skipped
      ? t("automation.run_skipped")
      : t("automation.run_failed");
  const failureMessage = failed ? run.error?.trim() : "";
  const canOpenSession = Boolean(run.sessionId);

  return (
    <div className="group flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-dls-hover">
      <button
        type="button"
        disabled={!canOpenSession}
        onClick={() => {
          if (run.sessionId) props.onOpenSession(run.sessionId);
        }}
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-dls-text focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-default"
        title={
          failureMessage ||
          (canOpenSession
            ? t("automation.open_run_session", { sessionId: run.sessionId ?? "" })
            : undefined)
        }
      >
        <span className="min-w-0 flex flex-1 items-baseline gap-2">
          <span className="truncate font-medium text-dls-text">{task.title}</span>
          <span className={`shrink-0 text-sm ${statusClassName}`}>{statusLabel}</span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {/* Idle chrome: time + status glyph (hidden on hover). */}
        <span className="flex items-center gap-2 text-xs text-dls-secondary group-hover:hidden">
          <span className="tabular-nums">{relativeRunTime(run.ranAt)}</span>
          {successful ? (
            <Check className="size-4 text-dls-status-success-fg" aria-hidden />
          ) : (
            <CircleAlert
              className={
                skipped
                  ? "size-4 text-dls-status-warning-fg"
                  : "size-4 text-dls-status-danger-fg"
              }
              aria-hidden
            />
          )}
        </span>
        {/* Hover: open session · archive run · delete task. */}
        <div className="hidden items-center gap-0.5 group-hover:flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={props.busy || !canOpenSession}
            title={t("automation.view_run_details")}
            aria-label={t("automation.view_run_details")}
            onClick={(event) => {
              event.stopPropagation();
              if (run.sessionId) props.onOpenSession(run.sessionId);
            }}
          >
            <FileText className="size-3.5 text-dls-secondary" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={props.busy}
            title={t("automation.archive_run")}
            aria-label={t("automation.archive_run")}
            onClick={(event) => {
              event.stopPropagation();
              props.onArchive(props.entry);
            }}
          >
            <Archive className="size-3.5 text-dls-secondary" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={props.busy}
            title={t("automation.delete")}
            aria-label={t("automation.delete")}
            onClick={(event) => {
              event.stopPropagation();
              props.onDelete(task);
            }}
          >
            <Trash2 className="size-3.5 text-dls-secondary" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AutomationTasksListBody(props: {
  running: OnMyAgentAutomationTaskItem[];
  scheduled: OnMyAgentAutomationTaskItem[];
  taskCount: number;
  busy: boolean;
  onOpenSession: (sessionId: string) => void;
  onStop: (item: OnMyAgentAutomationTaskItem) => void;
  onEdit: (item: OnMyAgentAutomationTaskItem) => void;
  onRunNow: (item: OnMyAgentAutomationTaskItem) => void;
  onToggleEnabled: (item: OnMyAgentAutomationTaskItem) => void;
  onDelete: (item: OnMyAgentAutomationTaskItem) => void;
}) {
  const enabled = props.scheduled.filter((item) => item.enabled);
  const paused = props.scheduled.filter((item) => !item.enabled);
  const hasCurrent = props.running.length > 0 || enabled.length > 0;

  return (
    <div className="space-y-4">
      {hasCurrent ? (
        <div className="space-y-2.5">
          <div className="px-1 text-xs font-medium text-dls-secondary">
            {t("automation.section_current")}
          </div>
          {props.running.map((item) => (
            <RunningAutomationRow
              key={item.id}
              item={item}
              busy={props.busy}
              onOpenSession={props.onOpenSession}
              onStop={props.onStop}
            />
          ))}
          {enabled.map((item) => (
            <ScheduledAutomationRow
              key={item.id}
              item={item}
              busy={props.busy}
              onEdit={props.onEdit}
              onRunNow={props.onRunNow}
              onToggleEnabled={props.onToggleEnabled}
              onDelete={props.onDelete}
            />
          ))}
        </div>
      ) : null}
      {paused.length > 0 ? (
        <div className="space-y-2.5">
          <div className="px-1 text-xs font-medium text-dls-secondary">
            {t("automation.section_paused")}
          </div>
          {paused.map((item) => (
            <ScheduledAutomationRow
              key={item.id}
              item={item}
              busy={props.busy}
              onEdit={props.onEdit}
              onRunNow={props.onRunNow}
              onToggleEnabled={props.onToggleEnabled}
              onDelete={props.onDelete}
            />
          ))}
        </div>
      ) : null}
      {props.taskCount === 0 ? (
        <EmptyStateBox size="default" tone="muted" className="text-sm">
          <EmptyStateIllustration
            src={AUTOMATION_EMPTY_STATE_ASSET}
            size="compact"
          />
          {t("automation.empty_tasks_title")}
        </EmptyStateBox>
      ) : null}
    </div>
  );
}

export function AutomationRunsListBody(props: {
  running: OnMyAgentAutomationTaskItem[];
  completedByDay: DayGroupedRuns<OnMyAgentAutomationTaskItem>[];
  runCount: number;
  busy: boolean;
  onOpenSession: (sessionId: string) => void;
  onStop: (item: OnMyAgentAutomationTaskItem) => void;
  onArchive: (entry: CompletedRun) => void;
  onDelete: (item: OnMyAgentAutomationTaskItem) => void;
}) {
  return (
    <div className="space-y-4">
      {props.running.length > 0 ? (
        <div className="space-y-1">
          <div className="px-1 text-xs font-medium text-dls-secondary">
            {t("automation.section_current")}
          </div>
          {props.running.map((item) => (
            <RunningAutomationRow
              key={item.id}
              item={item}
              busy={props.busy}
              onOpenSession={props.onOpenSession}
              onStop={props.onStop}
            />
          ))}
        </div>
      ) : null}
      {props.completedByDay.length > 0 ? (
        <div className="space-y-4">
          {props.running.length > 0 ? (
            <div className="px-1 text-xs font-medium text-dls-secondary">
              {t("automation.section_run_history")}
            </div>
          ) : null}
          {props.completedByDay.map((group) => (
            <div key={group.dayKey} className="space-y-1">
              <div className="px-1 text-xs font-medium text-dls-secondary">
                {resolveRunDayLabel({
                  dayKey: group.dayKey,
                  dayLabel: group.dayLabel,
                  todayLabel: t("automation.day_today"),
                  yesterdayLabel: t("automation.day_yesterday"),
                })}
              </div>
              {group.entries.map((entry) => (
                <CompletedAutomationRow
                  key={`${entry.task.id}-${entry.run.ranAt}-${entry.run.sessionId ?? entry.run.status}`}
                  entry={entry}
                  busy={props.busy}
                  onOpenSession={props.onOpenSession}
                  onArchive={props.onArchive}
                  onDelete={props.onDelete}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {props.running.length === 0 && props.runCount === 0 ? (
        <EmptyStateBox size="default" tone="muted" className="text-sm">
          <EmptyStateIllustration
            src={AUTOMATION_EMPTY_STATE_ASSET}
            size="compact"
          />
          {t("automation.empty_runs_title")}
        </EmptyStateBox>
      ) : null}
    </div>
  );
}
