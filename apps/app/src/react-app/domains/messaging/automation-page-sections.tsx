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
import { nextRunLabel, scheduleLabel } from "./automation-form-model";

export type CompletedRun = {
  task: OnMyAgentAutomationTaskItem;
  run: OnMyAgentAutomationTaskItem["runs"][number];
};

export { nextRunLabel, scheduleLabel };

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
  recommended?: boolean;
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
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="block truncate text-sm font-medium text-dls-text">{t(props.template.titleKey)}</span>
          {props.recommended ? (
            <StatusBadge tone="accent" size="tiny" shape="soft" className="shrink-0">
              {t("automation.personalization_recommended")}
            </StatusBadge>
          ) : null}
        </span>
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

function formatAutomationElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t("automation.running_elapsed_seconds");
  if (minutes < 60) {
    return t("automation.running_elapsed_minutes", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0
    ? t("automation.running_elapsed_hours_minutes", { hours, minutes: rest })
    : t("automation.running_elapsed_hours", { count: hours });
}

export function RunningAutomationRow(props: {
  item: OnMyAgentAutomationTaskItem;
  onOpenSession: (sessionId: string) => void;
}) {
  const startedAt = props.item.running?.startedAt;
  const elapsedMs =
    typeof startedAt === "number" && Number.isFinite(startedAt)
      ? Math.max(0, Date.now() - startedAt)
      : null;
  const longRunning = elapsedMs != null && elapsedMs >= 10 * 60_000;
  const canOpen = Boolean(props.item.running?.sessionId);

  return (
    <div className="flex min-h-16 items-center gap-3 rounded-xl bg-dls-subtle px-3 py-2 text-sm text-dls-text">
      <LoadingSpinner />
      <div className="min-w-0 flex flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{props.item.title}</span>
          <AutomationTaskMeta item={props.item} />
        </div>
        {elapsedMs != null ? (
          <span className="truncate text-xs text-dls-secondary">
            {longRunning
              ? t("automation.running_long_hint", {
                  elapsed: formatAutomationElapsed(elapsedMs),
                })
              : t("automation.running_elapsed", {
                  elapsed: formatAutomationElapsed(elapsedMs),
                })}
          </span>
        ) : null}
      </div>
      <StatusBadge tone={longRunning ? "warning" : "surface"} size="lg" shape="soft">
        {t("automation.status_running")}
      </StatusBadge>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canOpen}
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
