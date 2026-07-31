/** @jsxImportSource react */
/**
 * Task / run list rows + bodies for AutomationPage.
 */
import {
  Check,
  CircleAlert,
  FileText,
  Pause,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyStateBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import type { OnMyAgentAutomationTaskItem } from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import {
  resolveRunDayLabel,
  type CompletedRunEntry,
  type DayGroupedRuns,
} from "./automation-list-model";
import {
  effectiveRangeLabel,
  relativeRunTime,
  scheduleLabel,
  automationDisplayId,
} from "./automation-form-model";
import { RunningAutomationRow } from "./automation-page-sections";

export type CompletedRun = CompletedRunEntry<OnMyAgentAutomationTaskItem>;

function AutomationTaskMeta(props: {
  item: OnMyAgentAutomationTaskItem;
  groupName?: string;
}) {
  return (
    <>
      <StatusBadge tone="neutral" size="tiny" shape="soft" className="max-w-48 shrink-0 truncate font-medium">
        {automationDisplayId(props.item, props.groupName)}
      </StatusBadge>
      <StatusBadge tone="neutral" size="tiny" shape="soft" className="shrink-0 font-medium">
        {scheduleLabel(props.item.schedule)}
      </StatusBadge>
    </>
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
  const rangeLabel = effectiveRangeLabel(props.item);
  const enabled = props.item.enabled;
  return (
    <div className="group flex min-h-14 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-dls-hover">
      <button
        type="button"
        onClick={() => props.onEdit(props.item)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1.5 text-left text-sm text-dls-text focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <StatusDot size="md" tone={enabled ? "muted" : "warning"} />
        <span className="min-w-0 flex flex-1 items-center gap-2">
          <span className="truncate text-sm font-medium">{props.item.title}</span>
          <AutomationTaskMeta item={props.item} groupName={props.item.running?.groupName} />
          {rangeLabel ? (
            <span className="shrink-0 text-xs text-dls-secondary">
              {t("automation.effective_range_list", { range: rangeLabel })}
            </span>
          ) : null}
          {!enabled ? (
            <StatusBadge tone="warning" size="tiny" shape="soft">
              {t("automation.status_paused")}
            </StatusBadge>
          ) : null}
        </span>
        <span className="shrink-0 text-xs text-dls-secondary group-hover:hidden">
          {nextRunLabel(props.item)}
        </span>
      </button>
      <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={props.busy}
          title={t("automation.test_run")}
          aria-label={t("automation.test_run")}
          onClick={(event) => {
            event.stopPropagation();
            props.onRunNow(props.item);
          }}
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
          onClick={(event) => {
            event.stopPropagation();
            props.onToggleEnabled(props.item);
          }}
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
          title={t("automation.edit")}
          aria-label={t("automation.edit")}
          onClick={(event) => {
            event.stopPropagation();
            props.onEdit(props.item);
          }}
        >
          <Pencil className="size-3.5 text-dls-secondary" />
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
            props.onDelete(props.item);
          }}
        >
          <Trash2 className="size-3.5 text-dls-secondary" />
        </Button>
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
        <div className="space-y-1">
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
          {t("automation.empty_runs_title")}
        </EmptyStateBox>
      ) : null}
    </div>
  );
}
