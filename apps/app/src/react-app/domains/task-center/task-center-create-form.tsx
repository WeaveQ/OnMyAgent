/** @jsxImportSource react */
import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import type { TaskOrchestratorTaskCreateInput } from "@onmyagent/types";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { TaskCenterAgentPicker, TaskCenterModelPicker } from "./task-center-catalog-picker";
import {
  buildTaskCenterCreateInput,
  clearTaskCenterDraft,
  createTaskCenterDraft,
  TASK_CENTER_DRAFT_MAX_IDEA_LENGTH,
  TASK_CENTER_DRAFT_MAX_WORKERS,
  hydrateTaskCenterDraftSelectionsFromCatalog,
  hydrateTaskCenterDraftFromCatalog,
  isTaskCenterDraftValid,
  persistTaskCenterDraft,
  readTaskCenterDraftRecord,
  taskCenterDraftFromStoredRecord,
  taskCenterModelsForAgent,
  taskCenterEndConditionsForPreset,
  usableTaskCenterAgents,
  type TaskCenterAgentChoice,
  type TaskCenterCatalog,
  type TaskCenterDraft,
  type TaskCenterDraftRecord,
  type TaskCenterDraftStorage,
} from "./task-center-model";

function dateTimeLocalValue(value: number | null): string {
  if (value === null) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function TaskCenterField(props: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="block text-sm font-medium text-dls-secondary">
        {props.label}
        {props.required ? <span aria-hidden className="ml-0.5 text-dls-status-danger-fg">*</span> : null}
      </span>
      {props.children}
      {props.hint ? <span className="block text-xs leading-5 text-dls-secondary">{props.hint}</span> : null}
    </label>
  );
}

function AgentSelectionCard(props: {
  choice: TaskCenterAgentChoice | null;
  agents: TaskCenterCatalog["agents"];
  label: string;
  onChange: (choice: TaskCenterAgentChoice) => void;
  onRemove?: () => void;
}) {
  const models = taskCenterModelsForAgent(props.choice?.agent);
  return (
    <Card variant="outline" size="sm" data-task-selection-card={props.choice?.agent.id ?? "empty"}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Users className="mt-0.5 size-4 shrink-0 text-dls-secondary" aria-hidden />
            <div className="min-w-0">
              <CardTitle className="text-sm">{props.label}</CardTitle>
              <CardDescription className="mt-1">{t("task_center.personal_runtime")}</CardDescription>
            </div>
          </div>
          {props.onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("task_center.remove_worker")}
              onClick={props.onRemove}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <TaskCenterField label={t("task_center.agent_selector")} required>
          <TaskCenterAgentPicker
            agents={props.agents}
            value={props.choice?.agent ?? null}
            label={t("task_center.agent_selector")}
            onChange={(agent) => {
              const nextModel = taskCenterModelsForAgent(agent)[0] ?? null;
              props.onChange({ agent, model: nextModel });
            }}
          />
        </TaskCenterField>
        <TaskCenterField
          label={t("task_center.model_selector")}
          hint={models.length ? t("task_center.model_selector_hint") : t("task_center.no_models_for_agent")}
          required
        >
          <TaskCenterModelPicker
            agent={props.choice?.agent ?? null}
            value={props.choice?.model ?? null}
            label={t("task_center.model_selector")}
            onChange={(model) => {
              if (props.choice) props.onChange({ ...props.choice, model });
            }}
          />
        </TaskCenterField>
      </CardContent>
    </Card>
  );
}

export function EndConditionCard(props: {
  draft: TaskCenterDraft;
  onChange: (draft: TaskCenterDraft) => void;
}) {
  const conditions = props.draft.endConditions;
  const updateDuration = (
    key: "maxElapsedMs" | "stallTimeoutMs" | "maxTurnRuntimeMs",
    raw: string,
    unit: number,
    minimum: number,
    maximum: number,
  ) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const value = Math.min(maximum, Math.max(minimum, Math.round(parsed))) * unit;
    props.onChange({
      ...props.draft,
      endConditionPreset: "custom",
      endConditions: { ...conditions, [key]: value },
    });
  };
  const updateInteger = (
    key: "maxPrimaryTurns" | "maxWorkerAttempts" | "maxWorkerConcurrency" | "maxConsecutiveFailures" | "contextRolloverPercent" | "maxTransportRetries",
    raw: string,
    minimum: number,
    maximum: number,
  ) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const value = Math.min(maximum, Math.max(minimum, Math.round(parsed)));
    props.onChange({
      ...props.draft,
      endConditionPreset: "custom",
      endConditions: { ...conditions, [key]: value },
    });
  };
  const updateNullableInteger = (
    key: "maxTokens" | "maxCostMicros",
    raw: string,
    minimum: number,
    maximum: number,
  ) => {
    if (!raw.trim()) {
      props.onChange({
        ...props.draft,
        endConditionPreset: "custom",
        endConditions: { ...conditions, [key]: null },
      });
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const value = Math.min(maximum, Math.max(minimum, Math.round(parsed)));
    props.onChange({
      ...props.draft,
      endConditionPreset: "custom",
      endConditions: { ...conditions, [key]: value },
    });
  };

  return (
    <Card size="sm" data-end-condition-preset={props.draft.endConditionPreset}>
      <CardHeader>
        <CardTitle>{t("task_center.end_conditions_title")}</CardTitle>
        <CardDescription>{t("task_center.end_conditions_description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <TaskCenterField label={t("task_center.end_condition_preset")} hint={t("task_center.end_condition_preset_hint")}>
          <Select
            value={props.draft.endConditionPreset}
            onValueChange={(value) => {
              const preset = value as TaskCenterDraft["endConditionPreset"];
              props.onChange({
                ...props.draft,
                endConditionPreset: preset,
                endConditions: preset === "custom" ? props.draft.endConditions : taskCenterEndConditionsForPreset(preset),
              });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{(value) => value === "quick" ? t("task_center.end_condition_quick") : value === "custom" ? t("task_center.end_condition_custom") : t("task_center.end_condition_recommended_overnight")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recommended-overnight">{t("task_center.end_condition_recommended_overnight")}</SelectItem>
              <SelectItem value="quick">{t("task_center.end_condition_quick")}</SelectItem>
              <SelectItem value="custom">{t("task_center.end_condition_custom")}</SelectItem>
            </SelectContent>
          </Select>
        </TaskCenterField>
        {props.draft.endConditionPreset !== "custom" ? (
          <NoticeBox tone="info" data-end-condition-summary>
            {props.draft.endConditionPreset === "quick"
              ? t("task_center.end_condition_quick_summary")
              : t("task_center.end_condition_overnight_summary")}
          </NoticeBox>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-end-condition-fields>
            <TaskCenterField label={t("task_center.end_condition_elapsed_hours")} hint={t("task_center.end_condition_elapsed_hint")}>
              <Input type="number" min={1} max={168} step={1} value={Math.round((conditions.maxElapsedMs ?? 86_400_000) / 3_600_000)} onChange={(event) => updateDuration("maxElapsedMs", event.currentTarget.value, 3_600_000, 1, 168)} />
            </TaskCenterField>
            <TaskCenterField label={t("task_center.end_condition_primary_turns")}>
              <Input type="number" min={1} max={100} step={1} value={conditions.maxPrimaryTurns} onChange={(event) => updateInteger("maxPrimaryTurns", event.currentTarget.value, 1, 100)} />
            </TaskCenterField>
            <TaskCenterField label={t("task_center.end_condition_worker_attempts")}>
              <Input type="number" min={0} max={500} step={1} value={conditions.maxWorkerAttempts} onChange={(event) => updateInteger("maxWorkerAttempts", event.currentTarget.value, 0, 500)} />
            </TaskCenterField>
            <TaskCenterField label={t("task_center.end_condition_worker_concurrency")}>
              <Input type="number" min={1} max={20} step={1} value={conditions.maxWorkerConcurrency} onChange={(event) => updateInteger("maxWorkerConcurrency", event.currentTarget.value, 1, 20)} />
            </TaskCenterField>
            <TaskCenterField label={t("task_center.end_condition_failures")}>
              <Input type="number" min={1} max={20} step={1} value={conditions.maxConsecutiveFailures} onChange={(event) => updateInteger("maxConsecutiveFailures", event.currentTarget.value, 1, 20)} />
            </TaskCenterField>
            <TaskCenterField label={t("task_center.end_condition_context_percent")} hint={t("task_center.end_condition_context_hint")}>
              <Input type="number" min={50} max={95} step={1} value={conditions.contextRolloverPercent} onChange={(event) => updateInteger("contextRolloverPercent", event.currentTarget.value, 50, 95)} />
            </TaskCenterField>
            <TaskCenterField label={t("task_center.end_condition_stall_minutes")}>
              <Input type="number" min={1} max={240} step={1} value={Math.round(conditions.stallTimeoutMs / 60_000)} onChange={(event) => updateDuration("stallTimeoutMs", event.currentTarget.value, 60_000, 1, 240)} />
            </TaskCenterField>
            <TaskCenterField label={t("task_center.end_condition_turn_minutes")}>
              <Input type="number" min={1} max={240} step={1} value={Math.round(conditions.maxTurnRuntimeMs / 60_000)} onChange={(event) => updateDuration("maxTurnRuntimeMs", event.currentTarget.value, 60_000, 1, 240)} />
            </TaskCenterField>
            <TaskCenterField label={t("task_center.end_condition_transport_retries")}>
              <Input type="number" min={0} max={10} step={1} value={conditions.maxTransportRetries} onChange={(event) => updateInteger("maxTransportRetries", event.currentTarget.value, 0, 10)} />
            </TaskCenterField>
            <TaskCenterField label={t("task_center.end_condition_max_tokens")} hint={t("task_center.end_condition_optional_hint")}>
              <Input type="number" min={1000} max={2_000_000_000} step={1000} value={conditions.maxTokens ?? ""} onChange={(event) => updateNullableInteger("maxTokens", event.currentTarget.value, 1000, 2_000_000_000)} />
            </TaskCenterField>
            <TaskCenterField label={t("task_center.end_condition_max_cost")} hint={t("task_center.end_condition_optional_hint")}>
              <Input type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1} value={conditions.maxCostMicros ?? ""} onChange={(event) => updateNullableInteger("maxCostMicros", event.currentTarget.value, 1, Number.MAX_SAFE_INTEGER)} />
            </TaskCenterField>
            <TaskCenterField label={t("task_center.end_condition_deadline")} hint={t("task_center.end_condition_deadline_hint")}>
              <Input
                type="datetime-local"
                value={dateTimeLocalValue(conditions.deadlineAt)}
                onChange={(event) => {
                  const parsed = event.currentTarget.value ? Date.parse(event.currentTarget.value) : Number.NaN;
                  props.onChange({
                    ...props.draft,
                    endConditionPreset: "custom",
                    endConditions: { ...conditions, deadlineAt: Number.isFinite(parsed) ? parsed : null },
                  });
                }}
              />
            </TaskCenterField>
            <TaskCenterField label={t("task_center.end_condition_completion_authority")}>
              <Select value={conditions.completionAuthority} onValueChange={(value) => props.onChange({ ...props.draft, endConditionPreset: "custom", endConditions: { ...conditions, completionAuthority: value as TaskCenterDraft["endConditions"]["completionAuthority"] } })}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(value) => value === "user-confirm" ? t("task_center.end_condition_user_confirm") : t("task_center.end_condition_model_recommended")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="model-recommended">{t("task_center.end_condition_model_recommended")}</SelectItem>
                  <SelectItem value="user-confirm">{t("task_center.end_condition_user_confirm")}</SelectItem>
                </SelectContent>
              </Select>
            </TaskCenterField>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TaskCenterCreateForm(props: {
  workspaceRoot: string;
  catalog: TaskCenterCatalog | null;
  draftStorage?: TaskCenterDraftStorage | null;
  catalogLoading: boolean;
  catalogError: unknown;
  busy: boolean;
  onRefreshCatalog: () => void;
  onCancel: () => void;
  onCreate: (input: TaskOrchestratorTaskCreateInput) => Promise<void>;
}) {
  const restoredRecordRef = useRef<TaskCenterDraftRecord | null>(
    readTaskCenterDraftRecord(props.workspaceRoot, props.draftStorage),
  );
  const draftWorkspaceRef = useRef(props.workspaceRoot.trim());
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draft, setDraft] = useState<TaskCenterDraft>(() =>
    taskCenterDraftFromStoredRecord(restoredRecordRef.current, props.catalog),
  );
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(() => restoredRecordRef.current?.savedAt ?? null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const initializedCatalog = useRef(Boolean(props.catalog));
  const agents = usableTaskCenterAgents(props.catalog?.agents ?? []);

  useEffect(() => {
    const catalog = props.catalog;
    if (!catalog || initializedCatalog.current) return;
    const stored = restoredRecordRef.current;
    setDraft((current) => stored
      ? hydrateTaskCenterDraftSelectionsFromCatalog(current, stored, catalog)
      : hydrateTaskCenterDraftFromCatalog(current, catalog));
    restoredRecordRef.current = null;
    initializedCatalog.current = true;
  }, [props.catalog]);

  useEffect(() => {
    const workspaceRoot = props.workspaceRoot.trim();
    if (workspaceRoot === draftWorkspaceRef.current) return;
    const stored = readTaskCenterDraftRecord(workspaceRoot, props.draftStorage);
    draftWorkspaceRef.current = workspaceRoot;
    restoredRecordRef.current = stored;
    initializedCatalog.current = Boolean(props.catalog);
    setDraft(taskCenterDraftFromStoredRecord(stored, props.catalog));
    setDraftSavedAt(stored?.savedAt ?? null);
    setDraftDirty(false);
    setDraftSaveError(false);
  }, [props.catalog, props.draftStorage, props.workspaceRoot]);

  useEffect(() => {
    if (!draftDirty) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      const savedAt = persistTaskCenterDraft(props.workspaceRoot, draft, props.draftStorage);
      if (savedAt) {
        setDraftSavedAt(savedAt);
        setDraftDirty(false);
        setDraftSaveError(false);
      } else {
        setDraftSaveError(true);
      }
    }, 250);
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    };
  }, [draft, draftDirty, props.draftStorage, props.workspaceRoot]);

  const updateDraft = (next: TaskCenterDraft | ((current: TaskCenterDraft) => TaskCenterDraft)) => {
    setDraft(next);
    setDraftDirty(true);
    setDraftSaveError(false);
  };

  const update = <K extends keyof TaskCenterDraft>(key: K, value: TaskCenterDraft[K]) =>
    updateDraft((current) => ({ ...current, [key]: value }));

  const discardDraft = () => {
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = null;
    clearTaskCenterDraft(props.workspaceRoot, props.draftStorage);
    restoredRecordRef.current = null;
    setDraft(createTaskCenterDraft(props.catalog));
    initializedCatalog.current = Boolean(props.catalog);
    setDraftSavedAt(null);
    setDraftDirty(false);
    setDraftSaveError(false);
    setAdvancedOpen(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isTaskCenterDraftValid(draft, props.workspaceRoot)) return;
    void props.onCreate(buildTaskCenterCreateInput(draft, props.workspaceRoot, props.catalog?.catalogRevision ?? null)).then(
      () => {
        if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
        clearTaskCenterDraft(props.workspaceRoot, props.draftStorage);
        restoredRecordRef.current = null;
        setDraft(createTaskCenterDraft(props.catalog));
        initializedCatalog.current = Boolean(props.catalog);
        setDraftSavedAt(null);
        setDraftDirty(false);
        setDraftSaveError(false);
      },
      () => {
        // The action error panel owns the rejected mutation and offers retry/dismiss.
      },
    );
  };

  const addWorker = () => {
    const choice = agents[0]
      ? { agent: agents[0], model: taskCenterModelsForAgent(agents[0])[0] ?? null }
      : null;
    if (choice && draft.workers.length < TASK_CENTER_DRAFT_MAX_WORKERS) update("workers", [...draft.workers, choice]);
  };

  return (
    <form className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6" data-task-center-create-form onSubmit={submit}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-heading text-xl font-semibold text-dls-text">{t("task_center.create_title")}</h2>
          <p className="mt-1 text-sm leading-6 text-dls-secondary">{t("task_center.create_description")}</p>
        </div>
        <Button type="button" variant="ghost" onClick={props.onCancel}>{t("task_center.cancel")}</Button>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{t("task_center.idea_section")}</CardTitle>
          <CardDescription>{t("task_center.idea_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <TaskCenterField label={t("task_center.idea_label")} hint={t("task_center.idea_hint")} required>
            <Textarea
              data-task-center-idea
              value={draft.idea}
              placeholder={t("task_center.idea_placeholder")}
              maxLength={TASK_CENTER_DRAFT_MAX_IDEA_LENGTH}
              onChange={(event) => update("idea", event.currentTarget.value.slice(0, TASK_CENTER_DRAFT_MAX_IDEA_LENGTH))}
              aria-required="true"
              autoFocus
              className="min-h-32"
            />
          </TaskCenterField>
          <TaskCenterField label={t("task_center.workspace")} hint={t("task_center.workspace_read_only")}>
            <div className="rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2.5 text-sm text-dls-secondary" data-workspace-root>
              {props.workspaceRoot || t("task_center.no_workspace")}
            </div>
          </TaskCenterField>
          <div className="rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2.5 text-sm" data-primary-summary>
            <span className="text-xs text-dls-secondary">{t("task_center.primary_agent")}</span>
            <span className="mt-1 block font-medium text-dls-text">{draft.primary ? `${draft.primary.agent.name} · ${draft.primary.model?.label ?? t("task_center.default_model")}` : t("task_center.catalog_loading")}</span>
          </div>
        </CardContent>
      </Card>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="space-y-3" data-advanced-settings data-advanced-open={advancedOpen ? "true" : "false"}>
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t("task_center.advanced_settings")}</CardTitle>
            <CardDescription>{t("task_center.advanced_settings_description")}</CardDescription>
            <CollapsibleTrigger render={<Button type="button" variant="ghost" size="sm" className="w-full justify-between" />}>
              <span>{advancedOpen ? t("task_center.hide_advanced_settings") : t("task_center.show_advanced_settings")}</span>
              <ChevronDown className="size-4 transition-transform data-[panel-open]:rotate-180" aria-hidden />
            </CollapsibleTrigger>
          </CardHeader>
        </Card>
        <CollapsibleContent className="space-y-4">
          <Card size="sm">
            <CardHeader>
              <CardTitle>{t("task_center.agent_configuration")}</CardTitle>
              <CardDescription>{t("task_center.agent_configuration_description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
          {props.catalogLoading ? (
            <div className="flex items-center gap-2 text-sm text-dls-secondary" role="status">
              <LoadingSpinner size="sm" />
              {t("task_center.catalog_loading")}
            </div>
          ) : props.catalogError ? (
            <NoticeBox tone="error" className="flex items-center justify-between gap-3">
              <span>{t("task_center.catalog_error")}</span>
              <Button type="button" variant="outline" size="sm" onClick={props.onRefreshCatalog}>
                <RefreshCw className="size-3.5" aria-hidden />
                {t("task_center.refresh_catalog")}
              </Button>
            </NoticeBox>
          ) : !agents.length ? (
            <NoticeBox tone="warning" className="flex items-center justify-between gap-3">
              <span>{t("task_center.catalog_empty")}</span>
              <Button type="button" variant="outline" size="sm" onClick={props.onRefreshCatalog}>
                <RefreshCw className="size-3.5" aria-hidden />
                {t("task_center.refresh_catalog")}
              </Button>
            </NoticeBox>
          ) : (
            <>
              <AgentSelectionCard
                choice={draft.primary}
                agents={agents}
                label={t("task_center.primary_agent")}
                onChange={(choice) => update("primary", choice)}
              />
              <div className="space-y-3" data-allowed-workers>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-dls-text">{t("task_center.allowed_workers")}</h3>
                    <p className="mt-1 text-xs text-dls-secondary">{t("task_center.allowed_workers_hint")}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addWorker}
                    disabled={draft.workers.length >= TASK_CENTER_DRAFT_MAX_WORKERS}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    {t("task_center.add_worker")}
                  </Button>
                </div>
                {draft.workers.length ? draft.workers.map((choice, index) => (
                  <AgentSelectionCard
                    key={`${choice.agent.id}-${index}`}
                    choice={choice}
                    agents={agents}
                    label={t("task_center.worker_number", { count: index + 1 })}
                    onChange={(nextChoice) => {
                      update("workers", draft.workers.map((worker, workerIndex) => workerIndex === index ? nextChoice : worker));
                    }}
                    onRemove={() => update("workers", draft.workers.filter((_, workerIndex) => workerIndex !== index))}
                  />
                )) : (
                  <NoticeBox tone="neutral">{t("task_center.no_workers_selected")}</NoticeBox>
                )}
              </div>
              <Card variant="outline" size="sm" data-independent-checker={draft.independentCheckerMode}>
                <CardHeader>
                  <CardTitle>{t("task_center.independent_checker")}</CardTitle>
                  <CardDescription>{t("task_center.independent_checker_description")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <TaskCenterField label={t("task_center.independent_checker_mode")} hint={t("task_center.independent_checker_mode_hint")}>
                    <Select
                      value={draft.independentCheckerMode}
                      onValueChange={(value) => {
                        const mode = value as TaskCenterDraft["independentCheckerMode"];
                        updateDraft((current) => ({
                          ...current,
                          independentCheckerMode: mode,
                          checker: mode === "independent"
                            ? current.checker ?? current.primary ?? (agents[0] ? { agent: agents[0], model: taskCenterModelsForAgent(agents[0])[0] ?? null } : null)
                            : null,
                        }));
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>{(value) => value === "independent" ? t("task_center.independent_checker_enabled") : t("task_center.independent_checker_primary_only")}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="primary-only">{t("task_center.independent_checker_primary_only")}</SelectItem>
                        <SelectItem value="independent">{t("task_center.independent_checker_enabled")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </TaskCenterField>
                  {draft.independentCheckerMode === "independent" ? (
                    <>
                      <AgentSelectionCard
                        choice={draft.checker}
                        agents={agents}
                        label={t("task_center.independent_checker_agent")}
                        onChange={(choice) => update("checker", choice)}
                      />
                      <TaskCenterField label={t("task_center.independent_checker_rounds")} hint={t("task_center.independent_checker_rounds_hint")}>
                        <Select value={String(draft.checkerMaxRounds)} onValueChange={(value) => update("checkerMaxRounds", Number(value))}>
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1</SelectItem>
                            <SelectItem value="2">2</SelectItem>
                            <SelectItem value="3">3</SelectItem>
                          </SelectContent>
                        </Select>
                      </TaskCenterField>
                    </>
                  ) : <NoticeBox tone="neutral">{t("task_center.independent_checker_primary_only_hint")}</NoticeBox>}
                </CardContent>
              </Card>
            </>
          )}
            </CardContent>
          </Card>

          <EndConditionCard
            draft={draft}
            onChange={updateDraft}
          />

          <div className="grid gap-4 md:grid-cols-2">
        <Card size="sm" data-task-permission-mode={draft.permissionMode}>
          <CardHeader>
            <CardTitle>{t("task_center.permission_mode")}</CardTitle>
            <CardDescription>{t("task_center.permission_mode_description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={draft.permissionMode} onValueChange={(value) => update("permissionMode", value as TaskCenterDraft["permissionMode"])}>
              <SelectTrigger className="w-full">
                <SelectValue>{(value) => value === "full-allow" ? t("task_center.permission_full_allow") : t("task_center.permission_restricted")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="restricted">{t("task_center.permission_restricted")}</SelectItem>
                <SelectItem value="full-allow">{t("task_center.permission_full_allow")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs leading-5 text-dls-secondary">
              {draft.permissionMode === "restricted" ? t("task_center.permission_restricted_hint") : t("task_center.permission_full_allow_hint")}
            </p>
          </CardContent>
        </Card>
        <Card size="sm" data-contract-finalization={draft.contractFinalization}>
          <CardHeader>
            <CardTitle>{t("task_center.contract_finalization")}</CardTitle>
            <CardDescription>{t("task_center.contract_finalization_description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={draft.contractFinalization} onValueChange={(value) => update("contractFinalization", value as TaskCenterDraft["contractFinalization"])}>
              <SelectTrigger className="w-full">
                <SelectValue>{(value) => value === "model-recommended-auto" ? t("task_center.contract_model_auto") : t("task_center.contract_manual_confirm")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual-confirm">{t("task_center.contract_manual_confirm")}</SelectItem>
                <SelectItem value="model-recommended-auto">{t("task_center.contract_model_auto")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs leading-5 text-dls-secondary">
              {draft.contractFinalization === "manual-confirm" ? t("task_center.contract_manual_hint") : t("task_center.contract_auto_hint")}
            </p>
          </CardContent>
        </Card>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {draftSaveError ? (
        <NoticeBox tone="warning" data-task-center-draft-save-error>
          {t("task_center.draft_save_failed")}
        </NoticeBox>
      ) : draftSavedAt ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2.5 text-sm"
          data-task-center-draft-status
          role="status"
        >
          <span className="text-dls-secondary">{t("task_center.draft_saved_locally")}</span>
          <Button type="button" variant="ghost" size="sm" onClick={discardDraft}>
            {t("task_center.discard_draft")}
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end gap-2 border-t border-dls-border pt-5">
        <Button type="button" variant="outline" onClick={props.onCancel}>{t("task_center.cancel")}</Button>
        <Button type="submit" data-task-center-create-submit disabled={props.busy || !isTaskCenterDraftValid(draft, props.workspaceRoot) || !agents.length}>
          {props.busy ? t("task_center.creating") : t("task_center.create_action")}
        </Button>
      </div>
    </form>
  );
}
