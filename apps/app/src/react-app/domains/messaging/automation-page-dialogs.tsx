/** @jsxImportSource react */
import { Folder, Pause, Play, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useState } from "react";

import { pickDirectory } from "@/app/lib/desktop";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelectContainer } from "../../capabilities/model-selection/model-select-container";
import { AccessPermissionSelect } from "../../design-system/access-permission-select";
import type {
  OnMyAgentAutomationTaskItem,
  OnMyAgentServerClient,
} from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import type { AgentRegistry } from "../agents";
import { FrequencyFields } from "./automation-frequency-fields";
import {
  automationCreatedDate,
  hasAutomationModel,
  isFormValid,
  optimizeAutomationPromptWithI18n,
  workspaceDirectoryLabel,
  type AutomationFormState,
} from "./automation-form-model";
import type { AutomationTemplate } from "./automation-model";
import { AutomationPromptTools } from "./automation-prompt-tools";

export type AutomationDialogMode = "create" | "edit";

export function AutomationField(props: {
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

export function WorkspaceField(props: {
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
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="min-w-0 flex-1 justify-start px-3 text-dls-secondary"
        onClick={pickWorkspace}
      >
        <Folder className="size-4 shrink-0 text-dls-secondary" />
        <span className="min-w-0 truncate text-left">{workspaceDirectoryLabel(props.value)}</span>
      </Button>
      {props.value ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => props.onChange("")}>
          {t("automation.workspace_clear")}
        </Button>
      ) : null}
    </div>
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
      className="group flex min-h-20 items-center gap-4 rounded-xl border border-dls-border bg-dls-surface px-5 py-4 text-left transition-colors hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-focus focus-visible:ring-offset-2"
    >
      <Icon className="size-5 shrink-0 text-dls-secondary group-hover:text-dls-text" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="block truncate text-sm font-medium text-dls-text">
            {t(props.template.titleKey)}
          </span>
          {props.recommended ? (
            <StatusBadge tone="accent" size="tiny" shape="soft" className="shrink-0">
              {t("automation.personalization_recommended")}
            </StatusBadge>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-dls-secondary">
          {t(props.template.descriptionKey)}
        </span>
      </span>
    </button>
  );
}

export function AutomationDialog(props: {
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
  listSkills?: () => Promise<Array<{ name: string; description?: string; path?: string }>>;
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
  const lastRunError =
    props.item?.lastRun?.status === "failed" ? props.item.lastRun.error?.trim() : "";
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[min(820px,calc(100vh-3rem))] w-full max-w-[min(720px,calc(100vw-2rem))] flex-col gap-3 overflow-hidden rounded-xl border border-dls-border bg-dls-surface p-5 text-dls-text sm:max-w-[720px]"
      >
        <DialogHeader className="flex-row items-center justify-between gap-3 pe-9">
          <DialogTitle className="min-w-0 truncate text-base font-medium leading-6 text-dls-text">
            {props.mode === "edit"
              ? t("automation.edit_task_title")
              : t("automation.add_task_title")}
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3">
            <AutomationField label={t("automation.field_name")} required>
              <Input
                name="automation-title"
                required
                aria-required="true"
                variant="dls"
                value={props.form.title}
                onChange={(event) =>
                  props.onFormChange({ ...props.form, title: event.currentTarget.value })
                }
              />
            </AutomationField>
            <AutomationField
              label={t("automation.field_workspace")}
              hint={t("automation.optional_hint")}
            >
              <WorkspaceField
                value={props.form.workspaceDirectory}
                defaultPath={props.workspaceRoot}
                onChange={(workspaceDirectory) =>
                  props.onFormChange({ ...props.form, workspaceDirectory })
                }
              />
            </AutomationField>
          </div>
          <AutomationField label={t("automation.field_prompt")}>
            <div className="rounded-xl border border-dls-border bg-dls-surface">
              <Textarea
                value={props.form.prompt}
                onChange={(event) =>
                  props.onFormChange({ ...props.form, prompt: event.currentTarget.value })
                }
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
            <AutomationField
              label={t("automation.field_effective_range")}
              hint={t("automation.effective_range_hint")}
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  type="date"
                  variant="dls"
                  value={props.form.effectiveStartDate}
                  onClick={openNativePicker}
                  onChange={(event) =>
                    props.onFormChange({
                      ...props.form,
                      effectiveStartDate: event.currentTarget.value,
                    })
                  }
                />
                <Input
                  type="date"
                  variant="dls"
                  value={props.form.effectiveEndDate}
                  onClick={openNativePicker}
                  onChange={(event) =>
                    props.onFormChange({
                      ...props.form,
                      effectiveEndDate: event.currentTarget.value,
                    })
                  }
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
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={props.onDelete}
                disabled={props.busy}
              >
                <Trash2 className="size-3.5" />
                {t("automation.delete")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={props.onRunNow}
                disabled={props.busy}
              >
                <Play className="size-3.5" />
                {t("automation.test_run")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={props.onToggleEnabled}
                disabled={props.busy}
              >
                {props.item?.enabled ? (
                  <Pause className="size-3.5" />
                ) : (
                  <Play className="size-3.5" />
                )}
                {props.item?.enabled ? t("automation.pause") : t("automation.resume")}
              </Button>
            </div>
          ) : null}
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => props.onOpenChange(false)}
            >
              {t("automation.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!isFormValid(props.form) || props.busy}
              onClick={props.onSubmit}
            >
              {props.mode === "edit" ? t("automation.save") : t("automation.add")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AutomationRiskDialog(props: {
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
