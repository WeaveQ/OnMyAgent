/** @jsxImportSource react */
import {
  Bot,
  Check,
  ChevronDown,
  GraduationCap,
  Pause,
  Play,
  Plus,
  Shield,
  ShieldAlert,
  TriangleAlert,
  Trash2,
  X,
} from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import type { ComposerAccessMode, ModelRef } from "@/app/types";
import { pickDirectory } from "@/app/lib/desktop";
import { ModelSelectContainer } from "../session/components/model-select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MenuRowButton, NavTabButton, SegmentedTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox, EmptyStateBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/react-app/shell";
import { AccessPermissionSelect } from "../session/surface/composer/access-permission-select";
import type {
  OnMyAgentAutomationTaskItem,
  OnMyAgentServerClient,
} from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import {
  getAutomationTemplatesForScene,
  isAutomationScheduleTime,
  type AutomationDefaultSchedule,
  type AutomationCycle,
  type AutomationFrequencyMode,
  type AutomationScene,
  type AutomationTemplate,
} from "./automation-model";
import {
  buildPendingAgentFromRecord,
  createDefaultAgentRegistry,
  resolveAgentAvatarUrl,
  useAgentRegistryStore,
  type AgentRegistry,
  type AgentTemplate,
} from "../session/components/shared-pages/conversation-model";
import { syncAutomationSessionRecords } from "./automation-session-groups";

type IntervalUnit = "minutes" | "hours" | "days";
type AutomationDialogMode = "create" | "edit";
type AutomationStatusTab = "scheduled" | "running" | "completed";

type AutomationFormState = {
  title: string;
  prompt: string;
  workspaceDirectory: string;
  model: ModelRef | null;
  agentId: string;
  accessMode: ComposerAccessMode;
  frequencyMode: AutomationFrequencyMode;
  day: AutomationDefaultSchedule["day"];
  time: string;
  intervalValue: string;
  intervalUnit: IntervalUnit;
  weekdays: number[];
  onceDate: string;
  effectiveStartDate: string;
  effectiveEndDate: string;
};

type CompletedRun = {
  task: OnMyAgentAutomationTaskItem;
  run: OnMyAgentAutomationTaskItem["runs"][number];
};

const frequencyModes: AutomationFrequencyMode[] = ["weekly", "interval", "once"];
const automationCycles: AutomationCycle[] = ["daily", "weekly", "biweekly", "monthly", "yearly"];
const weekdays = [1, 2, 3, 4, 5, 6, 7];
const automationStatusTabs: AutomationStatusTab[] = ["scheduled", "running", "completed"];
const riskAcceptedStorageKey = "onmyagent.automationFullAccessRiskAccepted.v1";

function automationFrequencyLabel(mode: AutomationFrequencyMode) {
  switch (mode) {
    case "weekly":
      return t("automation.frequency_weekly");
    case "interval":
      return t("automation.frequency_interval");
    case "once":
      return t("automation.frequency_once");
  }
}

function automationCycleLabel(cycle: AutomationCycle) {
  switch (cycle) {
    case "daily":
      return t("automation.day_daily");
    case "weekly":
      return t("automation.day_weekly");
    case "biweekly":
      return t("automation.day_biweekly");
    case "monthly":
      return t("automation.day_monthly");
    case "yearly":
      return t("automation.day_yearly");
  }
}

function automationScheduleLabel(cycle: AutomationCycle, time: string) {
  switch (cycle) {
    case "daily":
      return t("automation.schedule_daily_at", { time });
    case "weekly":
      return t("automation.schedule_weekly_at", { time });
    case "biweekly":
      return t("automation.schedule_biweekly_at", { time });
    case "monthly":
      return t("automation.schedule_monthly_at", { time });
    case "yearly":
      return t("automation.schedule_yearly_at", { time });
  }
}

function automationWeekdayLabel(weekday: number) {
  switch (weekday) {
    case 1:
      return t("automation.weekday_1");
    case 2:
      return t("automation.weekday_2");
    case 3:
      return t("automation.weekday_3");
    case 4:
      return t("automation.weekday_4");
    case 5:
      return t("automation.weekday_5");
    case 6:
      return t("automation.weekday_6");
    case 7:
      return t("automation.weekday_7");
    default:
      return String(weekday);
  }
}

function localDateValue(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultOnceDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return localDateValue(tomorrow.getTime());
}

function createEmptyFormState(): AutomationFormState {
  return {
    title: "",
    prompt: "",
    workspaceDirectory: "",
    model: null,
    agentId: "",
    accessMode: "default",
    frequencyMode: "weekly",
    day: "daily",
    time: "09:00",
    intervalValue: "1",
    intervalUnit: "hours",
    weekdays: weekdays.slice(),
    onceDate: defaultOnceDate(),
    effectiveStartDate: "",
    effectiveEndDate: "",
  };
}

function intervalParts(intervalMinutes?: number): Pick<AutomationFormState, "intervalValue" | "intervalUnit"> {
  if (!intervalMinutes || intervalMinutes % 60 !== 0) {
    return { intervalValue: String(intervalMinutes ?? 60), intervalUnit: "minutes" };
  }
  if (intervalMinutes % (24 * 60) === 0) {
    return { intervalValue: String(intervalMinutes / (24 * 60)), intervalUnit: "days" };
  }
  return { intervalValue: String(intervalMinutes / 60), intervalUnit: "hours" };
}

function formStateFromTemplate(template: AutomationTemplate): AutomationFormState {
  return {
    ...createEmptyFormState(),
    title: t(template.titleKey),
    prompt: t(template.promptKey),
    frequencyMode: template.defaultSchedule.mode,
    day: template.defaultSchedule.day,
    time: template.defaultSchedule.time,
  };
}

function formStateFromAutomation(item: OnMyAgentAutomationTaskItem): AutomationFormState {
  return {
    title: item.title,
    prompt: item.prompt,
    workspaceDirectory: item.workspaceDirectory ?? "",
    model: item.model ?? null,
    agentId: item.agent?.id ?? "",
    accessMode: item.accessMode ?? "default",
    frequencyMode: item.schedule.mode,
    day: item.schedule.day,
    time: item.schedule.time,
    ...intervalParts(item.schedule.intervalMinutes),
    weekdays: item.schedule.weekdays?.slice() ?? weekdays.slice(),
    onceDate: item.schedule.onceAt ? localDateValue(item.schedule.onceAt) : defaultOnceDate(),
    effectiveStartDate: item.effectiveRange.startDate ?? "",
    effectiveEndDate: item.effectiveRange.endDate ?? "",
  };
}

function intervalMinutes(form: AutomationFormState) {
  const value = Number.parseInt(form.intervalValue, 10);
  if (!Number.isInteger(value) || value <= 0) return null;
  if (form.intervalUnit === "days") return value * 24 * 60;
  if (form.intervalUnit === "hours") return value * 60;
  return value;
}

function isIntervalUnit(value: string): value is IntervalUnit {
  return value === "minutes" || value === "hours" || value === "days";
}

function onceAt(form: AutomationFormState) {
  if (!form.onceDate || !isAutomationScheduleTime(form.time)) return null;
  const value = new Date(`${form.onceDate}T${form.time}:00`).getTime();
  return Number.isFinite(value) ? value : null;
}

function isEffectiveRangeValid(form: AutomationFormState) {
  if (!form.effectiveStartDate || !form.effectiveEndDate) return true;
  return form.effectiveStartDate <= form.effectiveEndDate;
}

function isFormValid(form: AutomationFormState) {
  if (!form.title.trim() || !form.prompt.trim() || !isAutomationScheduleTime(form.time)) return false;
  if (!isEffectiveRangeValid(form)) return false;
  return isScheduleValid(form);
}

function isScheduleValid(form: AutomationFormState) {
  if (!isAutomationScheduleTime(form.time)) return false;
  if (form.frequencyMode === "interval") {
    const minutes = intervalMinutes(form);
    return minutes !== null && minutes >= 5 && form.weekdays.length > 0;
  }
  if (form.frequencyMode === "once") {
    const timestamp = onceAt(form);
    return timestamp !== null && timestamp > Date.now();
  }
  return true;
}

function scheduleLabel(schedule: OnMyAgentAutomationTaskItem["schedule"]) {
  if (schedule.mode === "once") {
    return schedule.onceAt
      ? t("automation.schedule_once_datetime", { time: new Date(schedule.onceAt).toLocaleString() })
      : t("automation.schedule_once_at", { time: schedule.time });
  }
  if (schedule.mode === "interval") {
    const minutes = schedule.intervalMinutes ?? 60;
    if (minutes % (24 * 60) === 0) {
      return t("automation.schedule_interval_days", { days: minutes / (24 * 60) });
    }
    if (minutes % 60 === 0) {
      return t("automation.schedule_interval_hours", { hours: minutes / 60 });
    }
    return t("automation.schedule_interval_minutes", { minutes });
  }
  return automationScheduleLabel(schedule.day, schedule.time);
}

function nextRunLabel(item: OnMyAgentAutomationTaskItem) {
  if (!item.enabled) return t("automation.status_paused");
  if (!item.nextRunAt) return t("automation.no_next_run");
  const delta = Math.max(0, item.nextRunAt - Date.now());
  const hours = Math.floor(delta / 3_600_000);
  if (hours >= 24) return t("automation.starts_in_days", { days: Math.ceil(hours / 24) });
  if (hours > 0) return t("automation.starts_in_hours", { hours });
  return t("automation.starts_in_minutes", { minutes: Math.max(1, Math.ceil(delta / 60_000)) });
}

function automationDisplayId(item: OnMyAgentAutomationTaskItem, groupName?: string) {
  if (groupName?.startsWith("自动化任务-")) {
    return `automation-${groupName.slice("自动化任务-".length)}`;
  }
  const date = new Date(item.createdAt);
  const values = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ].map((value) => String(value).padStart(2, "0"));
  return `automation-${values.join("-")}`;
}

function effectiveRangeLabel(item: OnMyAgentAutomationTaskItem) {
  const { startDate, endDate } = item.effectiveRange;
  if (startDate && endDate) {
    return t("automation.effective_range_between", { startDate, endDate });
  }
  if (startDate) return t("automation.effective_range_from", { startDate });
  if (endDate) return t("automation.effective_range_until", { endDate });
  return null;
}

function automationCreatedDate(timestamp: number) {
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(timestamp);
}

function relativeRunTime(timestamp: number) {
  const deltaSeconds = Math.round((timestamp - Date.now()) / 1_000);
  const absoluteSeconds = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, {
    numeric: "auto",
  });
  if (absoluteSeconds < 60) return formatter.format(deltaSeconds, "second");
  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (Math.abs(deltaMinutes) < 60) return formatter.format(deltaMinutes, "minute");
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) return formatter.format(deltaHours, "hour");
  return formatter.format(Math.round(deltaHours / 24), "day");
}

function AutomationField(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <div className="text-sm font-medium text-dls-secondary">
        {props.label}
        {props.hint ? <span className="ml-1 font-normal">{props.hint}</span> : null}
      </div>
      {props.children}
    </label>
  );
}

function openNativePicker(event: MouseEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  input.focus();
  input.showPicker?.();
}

function workspaceDirectoryLabel(path: string) {
  const trimmed = path.trim();
  if (!trimmed) return t("automation.workspace_default");
  return trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
}

function modelLabel(model: ModelRef | null) {
  return model ? model.modelID : t("automation.model_auto");
}

function accessModeLabel(value: ComposerAccessMode) {
  return value === "full" ? t("composer.access_full") : t("composer.access_default");
}

function selectedAgentTemplate(registry: AgentRegistry, agentId: string) {
  return registry.templates.find((template) => template.id === agentId) ?? null;
}

function AgentAvatar(props: { template: AgentTemplate; registry: AgentRegistry }) {
  const avatar = resolveAgentAvatarUrl({
    avatarStyle: props.template.avatarStyle,
    avatarOptionId: props.template.avatarOptionId,
    customAvatarDataUrl: null,
  }, props.registry);
  if (avatar.url) {
    return (
      <img
        src={avatar.url}
        alt=""
        className="size-9 rounded-full border border-dls-border bg-dls-surface-muted"
      />
    );
  }
  return (
    <span
      className="flex size-9 items-center justify-center rounded-full border border-dls-border bg-dls-surface-muted text-sm font-semibold text-dls-secondary"
    >
      {props.template.name.slice(0, 1)}
    </span>
  );
}

function WorkspaceField(props: {
  value: string;
  defaultPath: string;
  onChange: (value: string) => void;
}) {
  const pickWorkspace = async () => {
    const selected = await pickDirectory({
      title: t("automation.workspace_pick_title"),
      defaultPath: props.value || props.defaultPath || undefined,
    });
    if (typeof selected === "string" && selected.trim()) props.onChange(selected);
  };
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="lg" className="min-w-0 flex-1 justify-start px-3 text-dls-secondary" onClick={pickWorkspace}>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dls-border">
          <Plus className="size-3.5" />
        </span>
        <span className="min-w-0 truncate text-left">
          {workspaceDirectoryLabel(props.value)}
        </span>
      </Button>
      {props.value ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => props.onChange("")}>
          {t("automation.workspace_clear")}
        </Button>
      ) : null}
    </div>
  );
}

function AgentSelect(props: {
  registry: AgentRegistry;
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = selectedAgentTemplate(props.registry, props.value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="ghost" size="sm" className="max-w-44 min-w-0 px-2 text-dls-secondary hover:bg-dls-hover hover:text-dls-text" />
        }
      >
        <GraduationCap className="size-4 text-dls-accent" />
        <span className="min-w-0 truncate">
          {selected?.name ?? t("automation.agent_none")}
        </span>
        <ChevronDown className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-80 rounded-xl border border-dls-border bg-dls-surface p-1.5">
        <MenuRowButton
          type="button"
          align="center"
          active={!props.value}
          onClick={() => props.onChange("")}
        >
          <span className="flex size-9 items-center justify-center rounded-full border border-dls-border bg-dls-surface-muted">
            <Bot className="size-4 text-dls-secondary" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-dls-text">{t("automation.agent_none")}</span>
            <span className="mt-1 block text-xs text-dls-secondary">{t("automation.agent_none_desc")}</span>
          </span>
        </MenuRowButton>
        {props.registry.templates.filter((template) => template.showInOverview || template.showInWizard).map((template) => (
          <MenuRowButton
            key={template.id}
            type="button"
            align="center"
            active={props.value === template.id}
            onClick={() => props.onChange(template.id)}
          >
            <AgentAvatar template={template} registry={props.registry} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-dls-text">{template.name}</span>
              <span className="mt-1 block line-clamp-2 text-xs leading-5 text-dls-secondary">{template.description}</span>
            </span>
          </MenuRowButton>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AutomationTemplateCard(props: {
  template: AutomationTemplate;
  onSelect: (template: AutomationTemplate) => void;
}) {
  const Icon = props.template.icon;
  return (
    <button
      type="button"
      onClick={() => props.onSelect(props.template)}
      className="group flex min-h-20 items-center gap-4 rounded-xl border border-dls-border bg-dls-surface px-5 py-4 text-left transition-colors hover:border-dls-border-strong hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <Icon className="size-5 shrink-0 text-dls-secondary group-hover:text-dls-text" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-dls-text">{t(props.template.titleKey)}</span>
        <span className="mt-1 block truncate text-sm text-dls-secondary">{t(props.template.descriptionKey)}</span>
      </span>
    </button>
  );
}

function AutomationTaskMeta(props: {
  item: OnMyAgentAutomationTaskItem;
  groupName?: string;
}) {
  return (
    <>
      <StatusBadge tone="neutral" size="sm" shape="soft" className="max-w-48 shrink-0 truncate font-medium">
        {automationDisplayId(props.item, props.groupName)}
      </StatusBadge>
      <StatusBadge tone="neutral" size="sm" shape="soft" className="shrink-0 font-medium">
        {scheduleLabel(props.item.schedule)}
      </StatusBadge>
    </>
  );
}

function ScheduledAutomationRow(props: {
  item: OnMyAgentAutomationTaskItem;
  onEdit: (item: OnMyAgentAutomationTaskItem) => void;
}) {
  const rangeLabel = effectiveRangeLabel(props.item);
  return (
    <button
      type="button"
      onClick={() => props.onEdit(props.item)}
      className="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-dls-text transition-colors hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <StatusDot size="md" tone={props.item.enabled ? "muted" : "danger"} />
      <span className="min-w-0 flex flex-1 items-center gap-2">
        <span className="truncate text-base font-semibold">{props.item.title}</span>
        <AutomationTaskMeta item={props.item} groupName={props.item.running?.groupName} />
        {rangeLabel ? (
          <span className="shrink-0 text-sm text-dls-secondary">
            {t("automation.effective_range_list", { range: rangeLabel })}
          </span>
        ) : null}
        {!props.item.enabled ? (
          <StatusBadge tone="surface" size="sm" shape="soft">{t("automation.status_paused")}</StatusBadge>
        ) : null}
      </span>
      <span className="shrink-0 text-sm text-dls-secondary">{nextRunLabel(props.item)}</span>
    </button>
  );
}

function RunningAutomationRow(props: {
  item: OnMyAgentAutomationTaskItem;
  onOpenSession: (sessionId: string) => void;
}) {
  return (
    <div className="flex min-h-16 items-center gap-3 rounded-xl bg-dls-subtle px-3 py-2 text-sm text-dls-text">
      <LoadingSpinner />
      <div className="min-w-0 flex flex-1 items-center gap-2">
        <span className="truncate text-base font-semibold">{props.item.title}</span>
        <AutomationTaskMeta item={props.item} />
      </div>
      <StatusBadge tone="surface" size="lg" shape="soft">{t("automation.status_running")}</StatusBadge>
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

function CompletedAutomationRow(props: {
  entry: CompletedRun;
  onOpenSession: (sessionId: string) => void;
}) {
  const { run, task } = props.entry;
  const successful = run.status === "success";
  const statusClassName = successful
    ? "text-dls-status-success-fg"
    : run.status === "skipped"
      ? "text-dls-status-warning-fg"
      : "text-dls-status-danger-fg";
  return (
    <button
      type="button"
      disabled={!run.sessionId}
      onClick={() => {
        if (run.sessionId) props.onOpenSession(run.sessionId);
      }}
      className="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-dls-text transition-colors enabled:hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-default"
    >
      <StatusDot size="md" tone={successful ? "success" : run.status === "skipped" ? "warning" : "danger"} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base font-semibold">{task.title}</span>
          <StatusBadge tone="neutral" size="sm" shape="soft" className="max-w-48 shrink-0 truncate font-medium">
            {automationDisplayId(task, run.groupName)}
          </StatusBadge>
          <span className={`shrink-0 ${statusClassName}`}>
            {successful
              ? run.source === "manual"
                ? t("automation.run_manual_completed")
                : t("automation.run_completed")
              : run.status === "skipped"
                ? t("automation.run_skipped")
                : t("automation.run_failed")}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-sm text-dls-secondary">
        {relativeRunTime(run.ranAt)}
        {successful ? (
          <Check className="size-4 text-dls-status-success-fg" />
        ) : (
          <X
            className={
              run.status === "skipped"
                ? "size-4 text-dls-status-warning-fg"
                : "size-4 text-dls-status-danger-fg"
            }
          />
        )}
      </span>
    </button>
  );
}

function FrequencyFields(props: {
  form: AutomationFormState;
  onFormChange: (form: AutomationFormState) => void;
}) {
  const setForm = (patch: Partial<AutomationFormState>) => props.onFormChange({ ...props.form, ...patch });
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-dls-secondary">{t("automation.field_frequency")}</div>
      <SegmentedTabGroup>
        {frequencyModes.map((mode) => (
          <SegmentedTabButton
            key={mode}
            type="button"
            active={props.form.frequencyMode === mode}
            size="comfortable"
            width="hug"
            className="whitespace-nowrap"
            onClick={() => setForm({ frequencyMode: mode })}
          >
            {automationFrequencyLabel(mode)}
          </SegmentedTabButton>
        ))}
      </SegmentedTabGroup>

      {props.form.frequencyMode === "weekly" ? (
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" variant="outline" size="lg" className="min-w-28 justify-between px-4" />
              }
            >
              {automationCycleLabel(props.form.day)}
              <ChevronDown className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              sideOffset={6}
              className="min-w-28 rounded-xl border border-dls-border bg-dls-surface p-1 text-dls-text"
            >
              {automationCycles.map((cycle) => (
                <DropdownMenuItem
                  key={cycle}
                  onClick={() => setForm({ day: cycle })}
                  className={
                    props.form.day === cycle
                      ? "rounded-lg bg-dls-text text-dls-surface focus:bg-dls-text focus:text-dls-surface"
                      : "rounded-lg"
                  }
                >
                  {automationCycleLabel(cycle)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Input
            type="time"
            variant="dlsMono"
            value={props.form.time}
            onClick={openNativePicker}
            onChange={(event) => setForm({ time: event.currentTarget.value })}
            aria-label={t("automation.field_time")}
            className="w-36"
          />
        </div>
      ) : null}

      {props.form.frequencyMode === "interval" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-dls-secondary">{t("automation.interval_every")}</span>
            <Input
              type="number"
              min={1}
              variant="dls"
              value={props.form.intervalValue}
              onChange={(event) => setForm({ intervalValue: event.currentTarget.value })}
              className="w-24"
            />
            <select
              value={props.form.intervalUnit}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (isIntervalUnit(value)) setForm({ intervalUnit: value });
              }}
              className="h-10 rounded-lg border border-dls-border bg-dls-surface px-3 text-sm text-dls-text outline-none focus:ring-3 focus:ring-ring/30"
            >
              <option value="minutes">{t("automation.interval_minutes")}</option>
              <option value="hours">{t("automation.interval_hours")}</option>
              <option value="days">{t("automation.interval_days")}</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-1">
            {weekdays.map((weekday) => {
              const selected = props.form.weekdays.includes(weekday);
              return (
                <SegmentedTabButton
                  key={weekday}
                  type="button"
                  active={selected}
                  size="compact"
                  onClick={() => setForm({
                    weekdays: selected
                      ? props.form.weekdays.filter((item) => item !== weekday)
                      : [...props.form.weekdays, weekday].sort((left, right) => left - right),
                  })}
                >
                  {automationWeekdayLabel(weekday)}
                </SegmentedTabButton>
              );
            })}
          </div>
        </div>
      ) : null}

      {props.form.frequencyMode === "once" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            type="time"
            variant="dlsMono"
            value={props.form.time}
            onClick={openNativePicker}
            onChange={(event) => setForm({ time: event.currentTarget.value })}
            aria-label={t("automation.field_time")}
          />
          <Input
            type="date"
            variant="dls"
            value={props.form.onceDate}
            onClick={openNativePicker}
            onChange={(event) => setForm({ onceDate: event.currentTarget.value })}
            aria-label={t("automation.once_date")}
          />
        </div>
      ) : null}

      {!isScheduleValid(props.form) ? (
        <div className="text-xs text-dls-status-danger-fg">{t("automation.invalid_schedule")}</div>
      ) : null}
    </div>
  );
}

function AutomationDialog(props: {
  open: boolean;
  mode: AutomationDialogMode;
  form: AutomationFormState;
  item: OnMyAgentAutomationTaskItem | null;
  registry: AgentRegistry;
  workspaceRoot: string;
  onOpenChange: (open: boolean) => void;
  onFormChange: (form: AutomationFormState) => void;
  onSubmit: () => void;
  onDelete: () => void;
  onRunNow: () => void;
  onToggleEnabled: () => void;
  busy: boolean;
}) {
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const statusLabel = props.item?.running
    ? t("automation.status_running")
    : props.item?.enabled
      ? t("automation.status_scheduled")
      : t("automation.status_paused");
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-[880px] flex-col gap-4 overflow-hidden rounded-xl border border-dls-border bg-dls-surface p-7 text-dls-text sm:max-w-[880px]"
      >
        <DialogHeader className="flex-row items-center justify-between gap-4">
          <DialogTitle className="text-xl font-semibold text-dls-text">
            {props.mode === "edit" ? t("automation.edit_task_title") : t("automation.add_task_title")}
          </DialogTitle>
          {props.mode === "edit" && props.item ? (
            <div className="flex shrink-0 items-center gap-3 text-sm text-dls-secondary">
              <span>{t("automation.created_at", { date: automationCreatedDate(props.item.createdAt) })}</span>
              <span>{t("automation.run_count", { count: props.item.runs.length })}</span>
              <span className="flex items-center gap-1.5">
                <StatusDot
                  tone={props.item.running ? "success" : props.item.enabled ? "muted" : "warning"}
                  size="sm"
                />
                {statusLabel}
              </span>
            </div>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <AutomationField label={t("automation.field_name")}>
            <Input
              variant="dls"
              value={props.form.title}
              onChange={(event) => props.onFormChange({ ...props.form, title: event.currentTarget.value })}
            />
          </AutomationField>
          <AutomationField label={t("automation.field_workspace")} hint={t("automation.optional_hint")}>
            <WorkspaceField
              value={props.form.workspaceDirectory}
              defaultPath={props.workspaceRoot}
              onChange={(workspaceDirectory) => props.onFormChange({ ...props.form, workspaceDirectory })}
            />
          </AutomationField>
          <AutomationField label={t("automation.field_prompt")}>
            <div className="rounded-xl border border-dls-border bg-dls-surface">
              <Textarea
                value={props.form.prompt}
                onChange={(event) => props.onFormChange({ ...props.form, prompt: event.currentTarget.value })}
                className="min-h-48 border-0 bg-transparent text-sm text-dls-text focus-visible:ring-0"
              />
              <div className="flex flex-nowrap items-center gap-2 border-t border-dls-border px-3 py-2 text-sm text-dls-secondary">
                <ModelSelectContainer
                  open={modelPickerOpen}
                  value={props.form.model ?? { providerID: "", modelID: "" }}
                  onOpenChange={setModelPickerOpen}
                  onChange={(model) => props.onFormChange({ ...props.form, model })}
                />
                <AgentSelect
                  registry={props.registry}
                  value={props.form.agentId}
                  onChange={(agentId) => props.onFormChange({ ...props.form, agentId })}
                />
                <AccessPermissionSelect
                  value={props.form.accessMode}
                  onChange={(accessMode) => props.onFormChange({ ...props.form, accessMode })}
                />
                <span className="ml-auto flex min-w-0 items-center gap-2 text-xs text-dls-secondary">
                  <StatusBadge tone={props.form.accessMode === "full" ? "warning" : "neutral"} size="sm" shape="soft" className="gap-1.5">
                    {props.form.accessMode === "full" ? <TriangleAlert className="size-3.5" /> : <Shield className="size-3.5" />}
                    {accessModeLabel(props.form.accessMode)}
                  </StatusBadge>
                  <span className="hidden max-w-40 truncate xl:inline">{modelLabel(props.form.model)}</span>
                </span>
              </div>
            </div>
          </AutomationField>
          <FrequencyFields form={props.form} onFormChange={props.onFormChange} />
          <AutomationField label={t("automation.field_effective_range")} hint={t("automation.effective_range_hint")}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                type="date"
                variant="dls"
                value={props.form.effectiveStartDate}
                onClick={openNativePicker}
                onChange={(event) => props.onFormChange({ ...props.form, effectiveStartDate: event.currentTarget.value })}
              />
              <Input
                type="date"
                variant="dls"
                value={props.form.effectiveEndDate}
                onClick={openNativePicker}
                onChange={(event) => props.onFormChange({ ...props.form, effectiveEndDate: event.currentTarget.value })}
              />
            </div>
          </AutomationField>
        </div>

        <DialogFooter className="mt-4 shrink-0 flex-row items-center justify-between border-t border-dls-border pt-4">
          <div className="flex flex-nowrap items-center gap-2">
            {props.mode === "edit" ? (
              <>
                <Button type="button" variant="destructive" size="lg" onClick={props.onDelete} disabled={props.busy}>
                  <Trash2 className="size-4" />
                  {t("automation.delete")}
                </Button>
                <Button type="button" variant="outline" size="lg" onClick={props.onRunNow} disabled={props.busy}>
                  <Play className="size-4" />
                  {t("automation.test_run")}
                </Button>
                <Button type="button" variant="outline" size="lg" onClick={props.onToggleEnabled} disabled={props.busy}>
                  <Pause className="size-4" />
                  {props.item?.enabled ? t("automation.pause") : t("automation.resume")}
                </Button>
              </>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => props.onOpenChange(false)}>
              {t("automation.cancel")}
            </Button>
            <Button type="button" size="lg" disabled={!isFormValid(props.form) || props.busy} onClick={props.onSubmit}>
              {props.mode === "edit" ? t("automation.save") : t("automation.add")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AutomationRiskDialog(props: {
  open: boolean;
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent className="max-w-xl rounded-xl">
        <AlertDialogHeader>
          <AlertDialogMedia className="size-12 rounded-xl bg-dls-status-warning-soft text-dls-status-warning-fg">
            <ShieldAlert className="size-6" />
          </AlertDialogMedia>
          <AlertDialogTitle>{t("automation.risk_title")}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3 text-left">
            <span className="block">{t("automation.risk_description")}</span>
            <span className="block">• {t("automation.risk_files")}</span>
            <span className="block">• {t("automation.risk_connectors")}</span>
            <span className="block">• {t("automation.risk_commands")}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex items-center gap-3 text-sm text-dls-text">
          <Checkbox checked={props.accepted} onCheckedChange={props.onAcceptedChange} />
          <span>{t("automation.risk_accept")}</span>
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel size="lg">{t("automation.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            size="lg"
            variant="destructive"
            disabled={!props.accepted}
            onClick={props.onConfirm}
          >
            {t("automation.confirm_create")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function AutomationPage(props: {
  scene: AutomationScene;
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
}) {
  const workspace = useWorkspace();
  const registry = useAgentRegistryStore((state) => state.registry) ?? createDefaultAgentRegistry();
  const [automations, setAutomations] = useState<OnMyAgentAutomationTaskItem[]>([]);
  const [templateViewOpen, setTemplateViewOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<AutomationDialogMode>("create");
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);
  const [form, setForm] = useState<AutomationFormState>(() => createEmptyFormState());
  const [riskOpen, setRiskOpen] = useState(false);
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStatusTab, setActiveStatusTab] = useState<AutomationStatusTab>("scheduled");

  const visibleTemplates = useMemo(() => getAutomationTemplatesForScene(props.scene), [props.scene]);
  const visibleAutomations = automations.filter((item) => item.scene === props.scene);
  const scheduled = visibleAutomations.filter((item) => (
    !item.running &&
    (
      item.schedule.mode !== "once" ||
      item.enabled ||
      !item.runs.some((run) => run.source === "scheduled")
    )
  ));
  const running = visibleAutomations.filter((item) => item.running);
  const completed = visibleAutomations
    .flatMap((task) => task.runs.map((run) => ({ task, run })))
    .sort((left, right) => right.run.ranAt - left.run.ranAt);
  const hasAutomations = visibleAutomations.length > 0;
  const statusTabCounts: Record<AutomationStatusTab, number> = {
    scheduled: scheduled.length,
    running: running.length,
    completed: completed.length,
  };

  const refreshAutomations = () => {
    const workspaceId = props.workspaceId.trim();
    if (!props.client || !workspaceId) {
      setAutomations([]);
      return;
    }
    setLoading(true);
    setError(null);
    void props.client.listAutomations(workspaceId)
      .then((result) => {
        setAutomations(result.items);
        syncAutomationSessionRecords(workspaceId, result.items);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false));
  };

  useEffect(refreshAutomations, [props.client, props.workspaceId]);
  useEffect(() => {
    const timer = window.setInterval(refreshAutomations, running.length > 0 ? 2_000 : 15_000);
    return () => window.clearInterval(timer);
  }, [props.client, props.workspaceId, running.length]);

  const editingItem = editingAutomationId
    ? visibleAutomations.find((item) => item.id === editingAutomationId) ?? null
    : null;

  const openBlankDialog = () => {
    setDialogMode("create");
    setEditingAutomationId(null);
    setForm(createEmptyFormState());
    setDialogOpen(true);
  };

  const openTemplateDialog = (template: AutomationTemplate) => {
    setDialogMode("create");
    setEditingAutomationId(null);
    setForm(formStateFromTemplate(template));
    setDialogOpen(true);
  };

  const openEditDialog = (item: OnMyAgentAutomationTaskItem) => {
    setDialogMode("edit");
    setEditingAutomationId(item.id);
    setForm(formStateFromAutomation(item));
    setDialogOpen(true);
  };

  const payload = () => {
    const interval = intervalMinutes(form);
    const timestamp = onceAt(form);
    const agentTemplate = selectedAgentTemplate(registry, form.agentId);
    const pendingAgent = agentTemplate ? buildPendingAgentFromRecord(agentTemplate, registry) : null;
    return {
      scene: props.scene,
      title: form.title.trim(),
      prompt: form.prompt.trim(),
      workspaceDirectory: form.workspaceDirectory.trim() || null,
      model: form.model,
      agent: pendingAgent
        ? {
          id: pendingAgent.id,
          name: pendingAgent.name,
          description: pendingAgent.description,
          systemPrompt: pendingAgent.systemPrompt,
          tools: pendingAgent.tools,
          model: pendingAgent.model,
        }
        : null,
      accessMode: form.accessMode === "delegate" ? "default" : form.accessMode,
      schedule: {
        mode: form.frequencyMode,
        day: form.day,
        time: form.time,
        ...(form.frequencyMode === "interval" && interval ? {
          intervalMinutes: interval,
          weekdays: form.weekdays,
        } : {}),
        ...(form.frequencyMode === "once" && timestamp ? { onceAt: timestamp } : {}),
      },
      effectiveRange: {
        ...(form.effectiveStartDate ? { startDate: form.effectiveStartDate } : {}),
        ...(form.effectiveEndDate ? { endDate: form.effectiveEndDate } : {}),
      },
    };
  };

  const persistAutomation = () => {
    const workspaceId = props.workspaceId.trim();
    if (!props.client || !workspaceId || !isFormValid(form)) {
      setError(t("automation.server_unavailable"));
      return;
    }
    setBusy(true);
    setError(null);
    const request = dialogMode === "edit" && editingAutomationId
      ? props.client.updateAutomation(workspaceId, editingAutomationId, payload())
      : props.client.createAutomation(workspaceId, { ...payload(), enabled: true });
    void request
      .then((result) => {
        setAutomations(result.items);
        syncAutomationSessionRecords(workspaceId, result.items);
        setDialogOpen(false);
        setRiskOpen(false);
        setEditingAutomationId(null);
        setTemplateViewOpen(false);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  const submitAutomation = () => {
    if (dialogMode === "edit" || window.localStorage.getItem(riskAcceptedStorageKey) === "1") {
      persistAutomation();
      return;
    }
    setRiskAccepted(false);
    setRiskOpen(true);
  };

  const confirmRiskAndCreate = () => {
    window.localStorage.setItem(riskAcceptedStorageKey, "1");
    persistAutomation();
  };

  const updateItem = (item: OnMyAgentAutomationTaskItem, update: { enabled: boolean }) => {
    if (!props.client || !props.workspaceId.trim()) return;
    setBusy(true);
    void props.client.updateAutomation(props.workspaceId, item.id, update)
      .then((result) => {
        setAutomations(result.items);
        syncAutomationSessionRecords(props.workspaceId, result.items);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  const deleteItem = (item: OnMyAgentAutomationTaskItem) => {
    if (!props.client || !props.workspaceId.trim()) return;
    setBusy(true);
    void props.client.deleteAutomation(props.workspaceId, item.id)
      .then((result) => {
        setAutomations(result.items);
        syncAutomationSessionRecords(props.workspaceId, result.items);
        setDialogOpen(false);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  const runNow = (item: OnMyAgentAutomationTaskItem) => {
    if (!props.client || !props.workspaceId.trim()) return;
    setBusy(true);
    setDialogOpen(false);
    window.setTimeout(refreshAutomations, 300);
    window.setTimeout(refreshAutomations, 1_200);
    void props.client.runAutomation(props.workspaceId, item.id)
      .then((result) => {
        setAutomations(result.items);
        syncAutomationSessionRecords(props.workspaceId, result.items);
        const sessionId = result.item.lastRun?.sessionId;
        if (sessionId) props.onOpenSession(props.workspaceId, sessionId);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        refreshAutomations();
      })
      .finally(() => setBusy(false));
  };

  const openSession = (sessionId: string) => props.onOpenSession(props.workspaceId, sessionId);
  const showTemplates = !hasAutomations || templateViewOpen;

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-surface text-dls-text">
      <div className="flex shrink-0 items-start justify-between gap-4 px-8 pb-6 pt-8">
        <div>
          <h1 className="text-xl font-semibold">{t("automation.title")}</h1>
          <p className="mt-3 text-sm text-dls-secondary">{t("automation.subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={openBlankDialog}>
            {t("automation.add_with_plus")}
          </Button>
          {hasAutomations && !templateViewOpen ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setTemplateViewOpen(true)}>
              {t("automation.add_from_template")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
        {error ? (
          <NoticeBox tone="error" size="content" className="mb-4">
            {error}
          </NoticeBox>
        ) : null}
        {loading && automations.length === 0 ? (
          <div className="mb-4 flex items-center gap-2 text-sm text-dls-secondary">
            <LoadingSpinner />
            {t("automation.loading")}
          </div>
        ) : null}

        {showTemplates ? (
          <div className="space-y-5">
            {hasAutomations ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setTemplateViewOpen(false)}>
                {t("automation.back")}
              </Button>
            ) : null}
            <section>
              <h2 className="text-sm font-medium text-dls-secondary">{t("automation.start_from_template")}</h2>
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {visibleTemplates.map((template) => (
                  <AutomationTemplateCard key={template.id} template={template} onSelect={openTemplateDialog} />
                ))}
              </div>
            </section>
          </div>
        ) : (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {automationStatusTabs.map((tab) => (
                <NavTabButton
                  key={tab}
                  type="button"
                  active={activeStatusTab === tab}
                  shape="tab"
                  size="tab"
                  className={activeStatusTab === tab ? "bg-dls-accent text-white hover:bg-dls-accent hover:text-white" : ""}
                  onClick={() => setActiveStatusTab(tab)}
                >
                  {tab === "scheduled"
                    ? t("automation.scheduled_section")
                    : tab === "running"
                      ? t("automation.running_section")
                      : t("automation.completed_section")}
                  <StatusBadge
                    tone={activeStatusTab === tab ? "surface" : "neutral"}
                    size="sm"
                    shape="soft"
                    className={activeStatusTab === tab ? "bg-white/20 text-white ring-white/20" : ""}
                  >
                    {statusTabCounts[tab]}
                  </StatusBadge>
                </NavTabButton>
              ))}
            </div>
            <div className="space-y-1">
              {activeStatusTab === "scheduled"
                ? scheduled.map((item) => <ScheduledAutomationRow key={item.id} item={item} onEdit={openEditDialog} />)
                : null}
              {activeStatusTab === "running"
                ? running.map((item) => <RunningAutomationRow key={item.id} item={item} onOpenSession={openSession} />)
                : null}
              {activeStatusTab === "completed"
                ? completed.map((entry) => (
                    <CompletedAutomationRow
                      key={`${entry.task.id}-${entry.run.ranAt}-${entry.run.sessionId ?? entry.run.status}`}
                      entry={entry}
                      onOpenSession={openSession}
                    />
                  ))
                : null}
              {statusTabCounts[activeStatusTab] === 0 ? (
                <EmptyStateBox size="default" tone="muted" className="text-sm">
                  {t("automation.empty_title")}
                </EmptyStateBox>
              ) : null}
            </div>
          </section>
        )}
      </div>

      <AutomationDialog
        open={dialogOpen}
        mode={dialogMode}
        form={form}
        item={editingItem}
        registry={registry}
        workspaceRoot={workspace.selectedWorkspaceRoot}
        onOpenChange={setDialogOpen}
        onFormChange={setForm}
        onSubmit={submitAutomation}
        onDelete={() => {
          if (editingItem) deleteItem(editingItem);
        }}
        onRunNow={() => {
          if (editingItem) runNow(editingItem);
        }}
        onToggleEnabled={() => {
          if (editingItem) updateItem(editingItem, { enabled: !editingItem.enabled });
        }}
        busy={busy}
      />
      <AutomationRiskDialog
        open={riskOpen}
        accepted={riskAccepted}
        onAcceptedChange={setRiskAccepted}
        onOpenChange={setRiskOpen}
        onConfirm={confirmRiskAndCreate}
      />
    </div>
  );
}
