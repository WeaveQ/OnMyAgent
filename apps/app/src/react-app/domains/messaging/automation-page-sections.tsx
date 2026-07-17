/** @jsxImportSource react */
import { type ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";

import { SegmentedTabButton } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import type { OnMyAgentAutomationTaskItem } from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import type { AutomationTemplate } from "./automation-model";

export type CompletedRun = {
  task: OnMyAgentAutomationTaskItem;
  run: OnMyAgentAutomationTaskItem["runs"][number];
};

export function scheduleLabel(schedule: OnMyAgentAutomationTaskItem["schedule"]) {
  if (schedule.mode === "once") {
    return schedule.onceAt
      ? t("automation.schedule_once_datetime", { time: new Date(schedule.onceAt).toLocaleString() })
      : t("automation.schedule_once_at", { time: schedule.time });
  }
  if (schedule.mode === "interval") {
    return t("automation.schedule_interval_minutes", { minutes: schedule.intervalMinutes ?? 60 });
  }
  return schedule.day === "weekly"
    ? t("automation.schedule_weekly_at", { time: schedule.time })
    : t("automation.schedule_daily_at", { time: schedule.time });
}

export function nextRunLabel(item: OnMyAgentAutomationTaskItem) {
  if (!item.enabled) return t("automation.status_paused");
  if (!item.nextRunAt) return t("automation.no_next_run");
  const delta = Math.max(0, item.nextRunAt - Date.now());
  const hours = Math.floor(delta / 3_600_000);
  if (hours >= 24) return t("automation.starts_in_days", { days: Math.ceil(hours / 24) });
  if (hours > 0) return t("automation.starts_in_hours", { hours });
  return t("automation.starts_in_minutes", { minutes: Math.max(1, Math.ceil(delta / 60_000)) });
}

export function AutomationField(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <div className="text-xs font-medium text-dls-secondary">
        {props.label}
        {props.hint ? <span className="ml-1 font-normal">{props.hint}</span> : null}
      </div>
      {props.children}
    </label>
  );
}

export function AddWorkspaceField() {
  return (
    <Button type="button" variant="outline" size="sm" className="w-full justify-start px-3 text-dls-secondary">
      <span className="flex size-5 items-center justify-center rounded-full border border-dls-border">
        <Plus className="size-3.5" />
      </span>
    </Button>
  );
}

export function SelectLikeField(props: { label: string }) {
  return (
    <Button type="button" variant="outline" size="sm" className="w-full justify-between px-3 text-dls-secondary">
      <span className="truncate">{props.label}</span>
      <ChevronDown className="size-4 shrink-0" />
    </Button>
  );
}

export function AutomationTemplateCard(props: {
  template: AutomationTemplate;
  onSelect: (template: AutomationTemplate) => void;
}) {
  const Icon = props.template.icon;
  return (
    <button
      type="button"
      onClick={() => props.onSelect(props.template)}
      className="group flex min-h-16 items-center gap-3 rounded-lg border border-dls-border bg-dls-surface px-3 py-2.5 text-left transition-colors hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      <Icon className="size-5 shrink-0 text-dls-secondary group-hover:text-dls-text" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-dls-text">{t(props.template.titleKey)}</span>
        <span className="mt-0.5 block truncate text-xs text-dls-secondary">{t(props.template.descriptionKey)}</span>
      </span>
    </button>
  );
}

function AutomationTaskMeta(props: { item: OnMyAgentAutomationTaskItem }) {
  return (
    <>
      <StatusBadge tone="surface" size="sm" shape="soft" className="max-w-48 shrink-0 truncate font-medium">
        {props.item.id}
      </StatusBadge>
      <StatusBadge tone="surface" size="sm" shape="soft" className="shrink-0 font-medium">
        {scheduleLabel(props.item.schedule)}
      </StatusBadge>
    </>
  );
}

export function ScheduledAutomationRow(props: {
  item: OnMyAgentAutomationTaskItem;
  onEdit: (item: OnMyAgentAutomationTaskItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => props.onEdit(props.item)}
      className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs text-dls-text transition-colors hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      <StatusDot size="md" tone={props.item.enabled ? "muted" : "danger"} />
      <span className="min-w-0 flex flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium">{props.item.title}</span>
        <AutomationTaskMeta item={props.item} />
        {!props.item.enabled ? (
          <StatusBadge tone="surface" size="sm" shape="soft">{t("automation.status_paused")}</StatusBadge>
        ) : null}
      </span>
      <span className="shrink-0 text-xs text-dls-secondary">{nextRunLabel(props.item)}</span>
    </button>
  );
}

export function RunningAutomationRow(props: {
  item: OnMyAgentAutomationTaskItem;
  onOpenSession: (sessionId: string) => void;
}) {
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-lg bg-dls-subtle px-3 py-2 text-xs text-dls-text">
      <LoadingSpinner />
      <div className="min-w-0 flex flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium">{props.item.title}</span>
        <AutomationTaskMeta item={props.item} />
      </div>
      <StatusBadge tone="surface" size="sm" shape="soft">{t("automation.status_running")}</StatusBadge>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!props.item.running?.sessionId}
        onClick={() => {
          const sessionId = props.item.running?.sessionId;
          if (sessionId) props.onOpenSession(sessionId);
        }}
      >
        {t("automation.view_run_details")}
      </Button>
    </div>
  );
}

export function CompletedAutomationRow(props: {
  entry: CompletedRun;
  onOpenSession: (sessionId: string) => void;
}) {
  const { run, task } = props.entry;
  const successful = run.status === "success";
  return (
    <button
      type="button"
      disabled={!run.sessionId}
      onClick={() => {
        if (run.sessionId) props.onOpenSession(run.sessionId);
      }}
      className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs text-dls-text transition-colors enabled:hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-default"
    >
      <StatusDot size="md" tone={successful ? "active" : run.status === "skipped" ? "warning" : "danger"} />
      <span className="min-w-0 flex flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium">{task.title}</span>
        <StatusBadge tone="surface" size="sm" shape="soft" className="max-w-48 shrink-0 truncate font-medium">
          {task.id}
        </StatusBadge>
        <span className={successful ? "text-dls-status-success-fg" : "text-dls-secondary"}>
          {successful
            ? t("automation.run_completed")
            : run.status === "skipped"
              ? t("automation.run_skipped")
              : t("automation.run_failed")}
        </span>
      </span>
      <span className="shrink-0 text-xs text-dls-secondary">{new Date(run.ranAt).toLocaleString()}</span>
    </button>
  );
}

export { SegmentedTabButton };
