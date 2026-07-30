/** @jsxImportSource react */
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  Folder,
  Pause,
  Pencil,
  Play,
  Plus,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import type { ModelRef } from "@/app/types";
import { pickDirectory } from "@/app/lib/desktop";
import { ModelSelectContainer } from "../../capabilities/model-selection/model-select-container";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox, EmptyStateBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/react-app/shell";
import { useStatusToasts } from "../shell-feedback";
import { AccessPermissionSelect } from "../../design-system/access-permission-select";
import { AutomationPromptTools } from "./automation-prompt-tools";
import type {
  OnMyAgentAutomationTaskItem,
  OnMyAgentServerClient,
} from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import { useLocal } from "../../kernel/local-provider";
import {
  automationPayloadFromTemplate,
  buildPersonalizationPlan,
  planFingerprint,
  rankTemplatesForPlan,
  selectTemplatesToCreate,
  shouldOfferPersonalizationApply,
  writeAppliedPlanFingerprint,
} from "../shared";
import { installExpertPackage } from "../../../app/lib/desktop";
import { isElectronRuntime } from "../../../app/utils";
import {
  getAutomationTemplatesForScene,
  type AutomationCycle,
  type AutomationFrequencyMode,
  type AutomationScene,
  type AutomationTemplate,
} from "./automation-model";
import {
  buildPendingAgentFromRecord,
  createDefaultAgentRegistry,
  useAgentRegistryStore,
  type AgentRegistry,
} from "../agents";
import {
  automationRunArchiveKey,
  filterOutArchivedRuns,
  groupCompletedRunsByDay,
  partitionAutomationTasks,
  resolvePostRunStatusTab,
  resolveRunDayLabel,
  shouldShowAutomationListLoading,
  shouldShowAutomationTemplates,
  type CompletedRunEntry,
} from "./automation-list-model";
import {
  archiveAutomationRunKey,
  readArchivedAutomationRunKeys,
  removeAutomationSessionRecord,
  syncAutomationSessionRecords,
  automationArchivedRunsChangedEvent,
} from "./automation-session-groups";
import { archiveAssistantTask } from "../shared";
import {
  ALL_WEEKDAYS,
  automationCreatedDate,
  automationCycleLabel,
  automationDisplayId,
  automationFrequencyLabel,
  automationWeekdayLabel,
  createEmptyFormState,
  effectiveRangeLabel,
  formStateFromAutomation,
  formStateFromTemplate as formStateFromTemplateKeys,
  hasAutomationModel,
  intervalMinutes,
  isFormValid,
  isIntervalUnit,
  isScheduleValid,
  nextRunLabel,
  onceAt,
  optimizeAutomationPromptWithI18n,
  relativeRunTime,
  scheduleLabel,
  workspaceDirectoryLabel,
  type AutomationFormState,
  type IntervalUnit,
} from "./automation-form-model";

type AutomationDialogMode = "create" | "edit";
/** Primary chrome: task definitions vs flat run history (reference IA). */
type AutomationStatusTab = "tasks" | "runs";

type CompletedRun = CompletedRunEntry<OnMyAgentAutomationTaskItem>;

const frequencyModes: AutomationFrequencyMode[] = ["weekly", "interval", "once"];
const automationCycles: AutomationCycle[] = ["daily", "weekly", "biweekly", "monthly", "yearly"];
const weekdays = [...ALL_WEEKDAYS];
const automationStatusTabs: AutomationStatusTab[] = ["tasks", "runs"];
const riskAcceptedStorageKey = "onmyagent.automationFullAccessRiskAccepted.v1";

function formStateFromTemplate(
  template: AutomationTemplate,
  defaultModel: ModelRef | null = null,
): AutomationFormState {
  return formStateFromTemplateKeys(
    template,
    defaultModel,
    t(template.titleKey),
    t(template.promptKey),
  );
}

function AutomationField(props: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <div className="text-sm font-medium text-dls-secondary">
        {props.label}
        {props.required ? (
          <span aria-hidden="true" className="ml-0.5 text-dls-status-danger-fg">
            *
          </span>
        ) : null}
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

function selectedAgentTemplate(registry: AgentRegistry, agentId: string) {
  return registry.templates.find((template) => template.id === agentId) ?? null;
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
        <Folder className="size-4 shrink-0 text-dls-secondary" />
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

function AutomationTemplateCard(props: {
  template: AutomationTemplate;
  onSelect: (template: AutomationTemplate) => void;
  recommended?: boolean;
}) {
  const Icon = props.template.icon;
  return (
    <button
      type="button"
      onClick={() => props.onSelect(props.template)}
      className="group flex min-h-20 items-center gap-4 rounded-xl border border-dls-border bg-dls-surface px-5 py-4 text-left transition-colors hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
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

function ScheduledAutomationRow(props: {
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
      {/* Inline actions (no dropdown) — popup position was clipped by the shell. */}
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

function RunningAutomationRow(props: {
  item: OnMyAgentAutomationTaskItem;
  onOpenSession: (sessionId: string) => void;
}) {
  return (
    <div className="flex min-h-16 items-center gap-3 rounded-xl bg-dls-subtle px-3 py-2 text-sm text-dls-text">
      <LoadingSpinner />
      <div className="min-w-0 flex flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium">{props.item.title}</span>
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
    // Reference: run-history rows — idle shows time + status icon; hover swaps
    // to open / archive / delete actions.
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

function FrequencyFields(props: {
  form: AutomationFormState;
  onFormChange: (form: AutomationFormState) => void;
}) {
  const setForm = (patch: Partial<AutomationFormState>) => props.onFormChange({ ...props.form, ...patch });
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-dls-secondary">{t("automation.field_frequency")}</div>
      <SegmentedTabGroup density="filter">
        {frequencyModes.map((mode) => (
          <SegmentedTabButton
            key={mode}
            type="button"
            active={props.form.frequencyMode === mode}
            size="chip"
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
          <div className="flex flex-wrap gap-0.5">
            {weekdays.map((weekday) => {
              const selected = props.form.weekdays.includes(weekday);
              return (
                <SegmentedTabButton
                  key={weekday}
                  type="button"
                  active={selected}
                  tone="chip"
                  size="chip"
                  width="hug"
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
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  workspaceRoot: string;
  listOpenCodeCommands?: () => Promise<
    Array<{ id?: string; name: string; description?: string; source?: string }>
  >;
  listSkills?: () => Promise<
    Array<{ name: string; description?: string; path?: string }>
  >;
  listMcp?: () => Promise<{ servers: Array<{ name?: string; id?: string }> }>;
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
  const canOptimizePrompt = props.form.prompt.trim().length > 0;
  const lastRunError = props.item?.lastRun?.status === "failed"
    ? props.item.lastRun.error?.trim()
    : "";
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[min(820px,calc(100vh-3rem))] w-full max-w-[min(720px,calc(100vw-2rem))] flex-col gap-3 overflow-hidden rounded-xl border border-dls-border bg-dls-surface p-5 text-dls-text sm:max-w-[720px]"
      >
        <DialogHeader className="flex-row items-center justify-between gap-3 pe-9">
          <DialogTitle className="min-w-0 truncate text-base font-medium leading-6 text-dls-text">
            {props.mode === "edit" ? t("automation.edit_task_title") : t("automation.add_task_title")}
          </DialogTitle>
          {props.mode === "edit" && props.item ? (
            <div className="flex min-w-0 shrink items-center gap-2 text-xs text-dls-secondary">
              <span className="hidden truncate sm:inline">
                {t("automation.created_at", { date: automationCreatedDate(props.item.createdAt) })}
              </span>
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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden [scrollbar-gutter:auto] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-dls-border [&::-webkit-scrollbar-track]:bg-transparent">
          {lastRunError ? (
            <NoticeBox tone="error" size="content">
              {t("automation.last_run_error", { error: lastRunError })}
            </NoticeBox>
          ) : null}
          {!hasAutomationModel(props.form.model) ? (
            <NoticeBox tone="warning" size="content">
              {t("automation.model_required_hint")}
            </NoticeBox>
          ) : null}
          <AutomationField label={t("automation.field_name")} required>
            <Input
              name="automation-title"
              required
              aria-required="true"
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
                className="min-h-28 max-h-48 resize-y border-0 bg-transparent text-sm text-dls-text focus-visible:ring-0"
              />
              {/* Match session chrome: model + skills + permission (simple chips). */}
              <div className="flex flex-nowrap items-center gap-0.5 border-t border-dls-border px-1.5 py-1 text-sm text-dls-secondary">
                <ModelSelectContainer
                  open={modelPickerOpen}
                  value={props.form.model ?? { providerID: "", modelID: "" }}
                  onOpenChange={setModelPickerOpen}
                  onChange={(model) => props.onFormChange({ ...props.form, model })}
                />
                <AutomationPromptTools
                  client={props.client}
                  workspaceId={props.workspaceId}
                  workspaceRoot={props.workspaceRoot}
                  prompt={props.form.prompt}
                  onPromptChange={(prompt) => props.onFormChange({ ...props.form, prompt })}
                  listOpenCodeCommands={props.listOpenCodeCommands}
                  listSkills={props.listSkills}
                  listMcp={props.listMcp}
                />
                <AccessPermissionSelect
                  density="compact"
                  value={props.form.accessMode}
                  onChange={(accessMode) => props.onFormChange({ ...props.form, accessMode })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-8 shrink-0 text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                  disabled={!canOptimizePrompt || props.busy}
                  title={
                    canOptimizePrompt
                      ? t("automation.optimize_prompt")
                      : t("automation.optimize_prompt_empty")
                  }
                  aria-label={t("automation.optimize_prompt")}
                  onClick={() => {
                    const next = optimizeAutomationPromptWithI18n(props.form.prompt);
                    if (next !== props.form.prompt) {
                      props.onFormChange({ ...props.form, prompt: next });
                    }
                  }}
                >
                  <Sparkles className="size-3.5" />
                </Button>
              </div>
            </div>
          </AutomationField>
          <FrequencyFields form={props.form} onFormChange={props.onFormChange} />
          {/* Once already picks a concrete datetime — no separate effective range. */}
          {props.form.frequencyMode === "once" ? null : (
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
          )}
        </div>

        <DialogFooter
          className={
            props.mode === "edit"
              ? "mt-3 shrink-0 flex-row items-center justify-between gap-2 border-t border-dls-border pt-3"
              : "mt-3 shrink-0 flex-row items-center justify-end gap-2 border-t border-dls-border pt-3"
          }
        >
          {props.mode === "edit" ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Button type="button" variant="destructive" size="sm" onClick={props.onDelete} disabled={props.busy}>
                <Trash2 className="size-3.5" />
                {t("automation.delete")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={props.onRunNow} disabled={props.busy}>
                <Play className="size-3.5" />
                {t("automation.test_run")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={props.onToggleEnabled} disabled={props.busy}>
                {props.item?.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                {props.item?.enabled ? t("automation.pause") : t("automation.resume")}
              </Button>
            </div>
          ) : null}
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => props.onOpenChange(false)}>
              {t("automation.cancel")}
            </Button>
            <Button type="button" size="sm" disabled={!isFormValid(props.form) || props.busy} onClick={props.onSubmit}>
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
  /** When set, open the edit dialog for this automation after list load. */
  focusAutomationId?: string | null;
  onFocusAutomationConsumed?: () => void;
  /** Same OpenCode command.list path as the session composer + menu. */
  listOpenCodeCommands?: () => Promise<
    Array<{ id?: string; name: string; description?: string; source?: string }>
  >;
  listSkills?: () => Promise<
    Array<{ name: string; description?: string; path?: string }>
  >;
  listMcp?: () => Promise<{ servers: Array<{ name?: string; id?: string }> }>;
}) {
  const workspace = useWorkspace();
  const local = useLocal();
  const { showToast } = useStatusToasts();
  const registry = useAgentRegistryStore((state) => state.registry) ?? createDefaultAgentRegistry();
  const [automations, setAutomations] = useState<OnMyAgentAutomationTaskItem[]>([]);
  const [templateViewOpen, setTemplateViewOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<AutomationDialogMode>("create");
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);
  const defaultModel = local.prefs.defaultModel ?? null;
  const [form, setForm] = useState<AutomationFormState>(() => createEmptyFormState(defaultModel));
  const [riskOpen, setRiskOpen] = useState(false);
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStatusTab, setActiveStatusTab] = useState<AutomationStatusTab>("tasks");
  const [listReady, setListReady] = useState(false);
  const [archivedRunKeys, setArchivedRunKeys] = useState<string[]>(() =>
    readArchivedAutomationRunKeys(props.workspaceId),
  );
  const [personalizationBannerDismissed, setPersonalizationBannerDismissed] = useState(false);
  const [personalizationNotice, setPersonalizationNotice] = useState<string | null>(null);

  const personalizationPlan = useMemo(() => {
    const profile = local.prefs.onboardingProfile;
    if (!profile || profile.skipped) return null;
    if (
      !profile.roles.length &&
      !profile.industries.length &&
      !profile.tasks.length &&
      !profile.tools.length
    ) {
      return null;
    }
    return buildPersonalizationPlan({
      roles: profile.roles,
      industries: profile.industries,
      tools: profile.tools,
      tasks: profile.tasks,
    });
  }, [local.prefs.onboardingProfile]);

  const sceneTemplates = useMemo(
    () => getAutomationTemplatesForScene(props.scene),
    [props.scene],
  );
  const { recommended: recommendedTemplates, rest: restTemplates } = useMemo(
    () => rankTemplatesForPlan(sceneTemplates, personalizationPlan),
    [sceneTemplates, personalizationPlan],
  );
  const visibleTemplates = useMemo(
    () => [...recommendedTemplates, ...restTemplates],
    [recommendedTemplates, restTemplates],
  );
  const recommendedIdSet = useMemo(
    () => new Set(recommendedTemplates.map((item) => item.id)),
    [recommendedTemplates],
  );
  const showPersonalizationOffer =
    !personalizationBannerDismissed &&
    shouldOfferPersonalizationApply(props.workspaceId, personalizationPlan) &&
    Boolean(personalizationPlan);

  const {
    visible: visibleAutomations,
    scheduled,
    running,
    completed,
  } = useMemo(
    () => partitionAutomationTasks(automations, props.scene),
    [automations, props.scene],
  );
  const visibleCompleted = useMemo(
    () => filterOutArchivedRuns(completed, archivedRunKeys),
    [archivedRunKeys, completed],
  );
  const completedByDay = useMemo(
    () => groupCompletedRunsByDay(visibleCompleted),
    [visibleCompleted],
  );
  const hasAutomations = visibleAutomations.length > 0;
  const statusTabCounts: Record<AutomationStatusTab, number> = {
    tasks: scheduled.length + running.length,
    runs: visibleCompleted.length,
  };
  const showListLoading = shouldShowAutomationListLoading({
    listReady,
    loading,
    hasAutomations,
  });
  const showTemplates = shouldShowAutomationTemplates({
    listReady,
    hasAutomations,
    templateViewOpen,
  });

  const refreshAutomations = (options?: { silent?: boolean }) => {
    const workspaceId = props.workspaceId.trim();
    if (!props.client || !workspaceId) {
      setAutomations([]);
      setListReady(true);
      setLoading(false);
      return;
    }
    if (!options?.silent) setLoading(true);
    // Don't clear error on silent poll — keeps failed-load banner stable.
    if (!options?.silent) setError(null);
    void props.client.listAutomations(workspaceId)
      .then((result) => {
        setAutomations(result.items);
        syncAutomationSessionRecords(workspaceId, result.items);
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message.trim() || t("automation.list_load_failed"));
      })
      .finally(() => {
        setLoading(false);
        setListReady(true);
      });
  };

  useEffect(() => {
    setListReady(false);
    setArchivedRunKeys(readArchivedAutomationRunKeys(props.workspaceId));
    refreshAutomations();
  }, [props.client, props.workspaceId]);
  useEffect(() => {
    const timer = window.setInterval(
      () => refreshAutomations({ silent: true }),
      running.length > 0 ? 2_000 : 15_000,
    );
    return () => window.clearInterval(timer);
  }, [props.client, props.workspaceId, running.length]);
  useEffect(() => {
    const onArchived = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail;
      if (detail?.workspaceId && detail.workspaceId !== props.workspaceId.trim()) {
        return;
      }
      setArchivedRunKeys(readArchivedAutomationRunKeys(props.workspaceId));
    };
    window.addEventListener(automationArchivedRunsChangedEvent, onArchived);
    return () => {
      window.removeEventListener(automationArchivedRunsChangedEvent, onArchived);
    };
  }, [props.workspaceId]);

  useEffect(() => {
    const focusId = props.focusAutomationId?.trim();
    if (!focusId || loading || busy) return;
    const item = automations.find((entry) => entry.id === focusId) ?? null;
    if (!item) return;
    setDialogMode("edit");
    setEditingAutomationId(item.id);
    setForm(formStateFromAutomation(item, local.prefs.defaultModel ?? null));
    setDialogOpen(true);
    props.onFocusAutomationConsumed?.();
  }, [
    automations,
    busy,
    loading,
    local.prefs.defaultModel,
    props.focusAutomationId,
    props.onFocusAutomationConsumed,
  ]);

  const editingItem = editingAutomationId
    ? visibleAutomations.find((item) => item.id === editingAutomationId) ?? null
    : null;

  const openBlankDialog = () => {
    setDialogMode("create");
    setEditingAutomationId(null);
    setForm(createEmptyFormState(local.prefs.defaultModel ?? null));
    setDialogOpen(true);
  };

  const openTemplateDialog = (template: AutomationTemplate) => {
    setDialogMode("create");
    setEditingAutomationId(null);
    setForm(formStateFromTemplate(template, local.prefs.defaultModel ?? null));
    setDialogOpen(true);
  };

  const openEditDialog = (item: OnMyAgentAutomationTaskItem) => {
    setDialogMode("edit");
    setEditingAutomationId(item.id);
    setForm(formStateFromAutomation(item, local.prefs.defaultModel ?? null));
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

  /** Soft-hide one run from history; archive session for sidebar/archived tasks. */
  const archiveRun = (entry: CompletedRun) => {
    const workspaceId = props.workspaceId.trim();
    if (!workspaceId) return;
    const key = automationRunArchiveKey(entry.task.id, entry.run);
    archiveAutomationRunKey(workspaceId, key);
    setArchivedRunKeys(readArchivedAutomationRunKeys(workspaceId));
    const sessionId = entry.run.sessionId?.trim();
    if (sessionId) {
      // Soft-delete from 定时 records + assistant archive so sidebar drops the run.
      removeAutomationSessionRecord(workspaceId, sessionId);
      archiveAssistantTask(workspaceId, {
        sessionId,
        title: entry.task.title,
        directory: entry.run.outputDirectory ?? null,
        archivedAt: Date.now(),
        category: entry.task.scene,
      });
    }
    showToast({
      title: t("automation.archive_success"),
      description: t("automation.archive_success_desc", {
        title: entry.task.title,
      }),
      tone: "success",
    });
  };

  const runNow = (item: OnMyAgentAutomationTaskItem) => {
    if (!props.client || !props.workspaceId.trim()) return;
    if (!hasAutomationModel(item.model) && !hasAutomationModel(item.agent?.model ?? null)) {
      setError(t("automation.model_required_run"));
      setActiveStatusTab("tasks");
      openEditDialog({
        ...item,
        model: item.model ?? local.prefs.defaultModel ?? undefined,
      });
      return;
    }
    setBusy(true);
    setError(null);
    setDialogOpen(false);
    setActiveStatusTab("tasks");
    window.setTimeout(() => refreshAutomations({ silent: true }), 200);
    window.setTimeout(() => refreshAutomations({ silent: true }), 1_200);
    void props.client.runAutomation(props.workspaceId, item.id)
      .then((result) => {
        setAutomations(result.items);
        syncAutomationSessionRecords(props.workspaceId, result.items);
        const tab = resolvePostRunStatusTab(result.item);
        if (tab === "running") {
          setActiveStatusTab("tasks");
          return;
        }
        const lastRun = result.item.lastRun;
        if (lastRun?.status === "failed") {
          setActiveStatusTab("runs");
          setError(lastRun.error?.trim() || t("automation.run_failed"));
          return;
        }
        const sessionId = lastRun?.sessionId;
        if (sessionId) props.onOpenSession(props.workspaceId, sessionId);
        setActiveStatusTab("runs");
      })
      .catch((cause: unknown) => {
        setActiveStatusTab("runs");
        setError(cause instanceof Error ? cause.message : String(cause));
        refreshAutomations({ silent: true });
      })
      .finally(() => setBusy(false));
  };

  const openSession = (sessionId: string) => props.onOpenSession(props.workspaceId, sessionId);

  const applyPersonalization = async () => {
    const plan = personalizationPlan;
    const workspaceId = props.workspaceId.trim();
    if (!plan || !props.client || !workspaceId) return;
    setBusy(true);
    setError(null);
    setPersonalizationNotice(null);
    try {
      const existingTitles = new Set(
        visibleAutomations.map((item) => item.title.trim()).filter(Boolean),
      );
      const toCreate = selectTemplatesToCreate(plan, sceneTemplates, existingTitles)
        .map((template) => {
          const title = t(template.titleKey);
          if (existingTitles.has(title)) return null;
          return template;
        })
        .filter((item): item is AutomationTemplate => Boolean(item));

      let created = 0;
      let lastItems = automations;
      for (const template of toCreate) {
        const payload = automationPayloadFromTemplate(props.scene, template, t);
        const result = await props.client.createAutomation(workspaceId, payload);
        lastItems = result.items;
        created += 1;
        existingTitles.add(t(template.titleKey));
      }
      if (lastItems !== automations) {
        setAutomations(lastItems);
        syncAutomationSessionRecords(workspaceId, lastItems);
      }

      if (plan.defaultAutoInstallExpert && isElectronRuntime()) {
        try {
          await installExpertPackage({
            source: "builtin",
            marketplace: "experts",
            packageName: plan.defaultAutoInstallExpert,
          });
        } catch {
          // Expert install is best-effort (desktop only); automations still apply.
        }
      }

      writeAppliedPlanFingerprint(workspaceId, planFingerprint(plan));
      setPersonalizationBannerDismissed(true);
      setTemplateViewOpen(false);
      setPersonalizationNotice(
        t("automation.personalization_applied", { count: created }),
      );
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background text-dls-text">
      <div className="flex shrink-0 items-center justify-between gap-4 px-8 pb-4 pt-6">
        <div className="flex min-w-0 items-center gap-2">
          {hasAutomations && templateViewOpen ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-dls-secondary hover:text-dls-text"
              onClick={() => setTemplateViewOpen(false)}
              title={t("automation.back")}
              aria-label={t("automation.back")}
            >
              <ArrowLeft className="size-4" />
            </Button>
          ) : null}
          <h1 className="min-w-0 truncate text-lg font-medium leading-7 text-dls-text">
            {t("automation.title")}
          </h1>
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
        {personalizationNotice ? (
          <NoticeBox tone="info" size="content" className="mb-4">
            {personalizationNotice}
          </NoticeBox>
        ) : null}
        {showPersonalizationOffer && personalizationPlan ? (
          <NoticeBox tone="info" size="content" className="mb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium text-dls-text">
                  {t("automation.personalization_title")}
                </div>
                <p className="text-xs leading-5 text-dls-secondary">
                  {t("automation.personalization_desc", {
                    count: personalizationPlan.defaultAutoCreateTemplateIds.length,
                  })}
                </p>
                {personalizationPlan.defaultAutoInstallExpert ? (
                  <p className="text-xs text-dls-secondary">
                    {t("automation.personalization_expert", {
                      name: personalizationPlan.defaultAutoInstallExpert,
                    })}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void applyPersonalization()}
                  disabled={busy || !props.client}
                >
                  {busy ? <LoadingSpinner /> : null}
                  {t("automation.personalization_apply")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPersonalizationBannerDismissed(true);
                    if (personalizationPlan) {
                      writeAppliedPlanFingerprint(
                        props.workspaceId,
                        planFingerprint(personalizationPlan),
                      );
                    }
                  }}
                >
                  {t("automation.personalization_dismiss")}
                </Button>
              </div>
            </div>
          </NoticeBox>
        ) : null}
        {showListLoading ? (
          <div className="mb-4 flex items-center gap-2 text-sm text-dls-secondary">
            <LoadingSpinner />
            {t("automation.loading")}
          </div>
        ) : null}

        {showTemplates ? (
          <div className="space-y-5">
            {recommendedTemplates.length > 0 ? (
              <section>
                <h2 className="text-sm font-medium text-dls-text">
                  {t("automation.personalization_recommended")}
                </h2>
                <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                  {recommendedTemplates.map((template) => (
                    <AutomationTemplateCard
                      key={template.id}
                      template={template}
                      recommended
                      onSelect={openTemplateDialog}
                    />
                  ))}
                </div>
              </section>
            ) : null}
            <section>
              <h2 className="text-sm font-medium text-dls-text">
                {recommendedTemplates.length > 0
                  ? t("automation.personalization_all_templates")
                  : t("automation.start_from_template")}
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {(recommendedTemplates.length > 0 ? restTemplates : visibleTemplates).map((template) => (
                  <AutomationTemplateCard
                    key={template.id}
                    template={template}
                    recommended={recommendedIdSet.has(template.id)}
                    onSelect={openTemplateDialog}
                  />
                ))}
              </div>
            </section>
          </div>
        ) : (
          <section className="space-y-4">
            {/* Reference IA: scheduled tasks | run history */}
            <SegmentedTabGroup density="bare">
              {automationStatusTabs.map((tab) => {
                const active = activeStatusTab === tab;
                const label =
                  tab === "tasks"
                    ? t("automation.tab_tasks")
                    : t("automation.tab_runs");
                return (
                  <NavTabButton
                    key={tab}
                    type="button"
                    active={active}
                    size="tab"
                    shape="tab"
                    aria-pressed={active}
                    onClick={() => setActiveStatusTab(tab)}
                  >
                    <span>{label}</span>
                    <span
                      className={
                        active
                          ? "tabular-nums text-xs font-medium opacity-70"
                          : "tabular-nums text-xs font-medium text-dls-secondary"
                      }
                    >
                      {statusTabCounts[tab]}
                    </span>
                  </NavTabButton>
                );
              })}
            </SegmentedTabGroup>
            <div className="space-y-3">
              {activeStatusTab === "tasks" ? (
                <div className="space-y-1">
                  {running.map((item) => (
                    <RunningAutomationRow
                      key={item.id}
                      item={item}
                      onOpenSession={openSession}
                    />
                  ))}
                  {scheduled.map((item) => (
                    <ScheduledAutomationRow
                      key={item.id}
                      item={item}
                      busy={busy}
                      onEdit={openEditDialog}
                      onRunNow={runNow}
                      onToggleEnabled={(task) =>
                        updateItem(task, { enabled: !task.enabled })
                      }
                      onDelete={deleteItem}
                    />
                  ))}
                  {statusTabCounts.tasks === 0 ? (
                    <EmptyStateBox size="default" tone="muted" className="text-sm">
                      {t("automation.empty_tasks_title")}
                    </EmptyStateBox>
                  ) : null}
                </div>
              ) : null}
              {activeStatusTab === "runs" ? (
                <div className="space-y-4">
                  {completedByDay.map((group) => (
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
                          busy={busy}
                          onOpenSession={openSession}
                          onArchive={archiveRun}
                          onDelete={deleteItem}
                        />
                      ))}
                    </div>
                  ))}
                  {statusTabCounts.runs === 0 ? (
                    <EmptyStateBox size="default" tone="muted" className="text-sm">
                      {t("automation.empty_runs_title")}
                    </EmptyStateBox>
                  ) : null}
                </div>
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
        client={props.client}
        workspaceId={props.workspaceId}
        workspaceRoot={workspace.selectedWorkspaceRoot}
        listOpenCodeCommands={props.listOpenCodeCommands}
        listSkills={props.listSkills}
        listMcp={props.listMcp}
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
