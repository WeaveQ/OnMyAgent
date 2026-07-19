import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe2,
  Info,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Wrench,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconTile, MatrixButton, MenuRowButton, NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { Input } from "@/components/ui/input";
import { EmptyStateBox } from "@/components/ui/notice-box";
import { CountBadge, StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  AgentManagementFetchedModel,
  AgentManagementManagedProvider,
  AgentManagementProviderActionInput,
  AgentManagementSnapshot,
} from "../../../../app/lib/desktop";
import { agentManagementFetchModels, agentManagementProviderAction } from "../../../../app/lib/desktop";
import { t } from "../../../../i18n";
import claudeIconUrl from "../../../../assets/agent-icons/claude.svg";
import codexIconUrl from "../../../../assets/agent-icons/openai.svg";
import hermesIconUrl from "../../../../assets/agent-icons/hermes.png";
import openclawIconUrl from "../../../../assets/agent-icons/claw.svg";
import opencodeIconUrl from "../../../../assets/agent-icons/opencode-logo-light.svg";

export const AGENT_MANAGER_PROVIDER_LABELS: Record<string, string> = {
  opencode: "OpenCode CLI",
  codex: "Codex CLI",
  claude: "Claude Code CLI",
  openclaw: "OpenClaw CLI",
  hermes: "Hermes CLI",
  custom: "Custom",
};

// Discoverable catalog agents (gemini/kiro/goose/kimi/...) are stored with the
// shared provider "custom" so the ACP test-connection path works, but each keeps
// its own real identity in `agent.id`. Mirror AionUi: surface that identity for
// display instead of the collapsed "Custom" marker. Keyed by the same ids the
// card icon map uses (see AgentManagementAgentIcon in agent-management-agent-card).
// Names ending in "CLI" are command-line agents; desktop clients (e.g. WorkBuddy)
// omit the suffix.
export const AGENT_TYPE_LABELS_BY_ID: Record<string, string> = {
  gemini: "Gemini CLI",
  kiro: "Kiro CLI",
  goose: "Goose CLI",
  "cursor-agent": "Cursor Agent CLI",
  qwen: "Qwen Code CLI",
  kimi: "Kimi CLI",
  copilot: "GitHub Copilot CLI",
  qoder: "Qoder CLI",
  augment: "Augment Code CLI",
  snow: "Snow CLI",
  nanobot: "Nano Bot CLI",
  codebuddy: "CodeBuddy CLI",
  workbuddy: "WorkBuddy",
  trae: "Trae CLI",
  mimo: "MiMo Code CLI",
  grok: "Grok Build CLI",
};

export function localAgentTypeLabel(agent: { id?: string; provider?: string; name?: string }): string {
  const id = String(agent.id ?? "").trim();
  if (id && AGENT_TYPE_LABELS_BY_ID[id]) return AGENT_TYPE_LABELS_BY_ID[id];
  const provider = String(agent.provider ?? "").trim();
  // Prefer product-family brand labels (OpenCode CLI / Claude Code CLI / …).
  // Skip generic "custom" so user-named agents keep their stored display name.
  if (provider && provider !== "custom" && AGENT_MANAGER_PROVIDER_LABELS[provider]) {
    return AGENT_MANAGER_PROVIDER_LABELS[provider];
  }
  const name = String(agent.name ?? "").trim();
  if (name) return name;
  return provider || id || "Custom";
}

const SKILL_AGENT_LABELS: Record<string, string> = {
  opencode: "OpenCode",
  claude: "Claude Code",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  codex: "Codex",
  onmyagent: "OnMyAgent",
  unknown: t("agent_manager.skill_agent_unknown"),
};

function skillAgentLabel(agent: string) {
  if (agent === "unknown") return t("agent_manager.skill_agent_unknown");
  return SKILL_AGENT_LABELS[agent] ?? agent;
}

const providerTextClass = {
  sectionTitle: "text-sm font-medium uppercase tracking-[0.08em] text-dls-secondary",
};

function ProviderModelNotice(props: { tone: "danger" | "warning" | "success"; children: ReactNode }) {
  return (
    <StatusBadge tone={props.tone} shape="soft" size="notice">
      {props.children}
    </StatusBadge>
  );
}


export type AgentManagementProviderApp = AgentManagementManagedProvider["appType"];

type CodexCatalogDraftRow = {
  rowId: string;
  displayName: string;
  model: string;
  contextWindow: string;
};

type ProviderModelDraftRow = {
  rowId: string;
  id: string;
  name: string;
  contextWindow: string;
  outputTokenLimit: string;
};

export type ProviderDraft = {
  editingId: string | null;
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string;
  modelRows: ProviderModelDraftRow[];
  claudeHaikuModel: string;
  claudeHaikuName: string;
  claudeSonnetModel: string;
  claudeSonnetName: string;
  claudeOpusModel: string;
  claudeOpusName: string;
  claudeFableModel: string;
  claudeFableName: string;
  codexCatalogRows: CodexCatalogDraftRow[];
  settingsJson: string;
};

const PROVIDER_APP_OPTIONS: AgentManagementProviderApp[] = ["opencode", "claude", "codex", "openclaw", "hermes"];

function redactProviderText(value: unknown) {
  return JSON.stringify(value ?? {}, (key, innerValue) => {
    if (/api.?key|token|secret|authorization|auth/i.test(key)) return innerValue ? "***" : innerValue;
    return innerValue;
  }, 2);
}

function createCodexCatalogDraftRow(seed?: Partial<CodexCatalogDraftRow>): CodexCatalogDraftRow {
  const fallbackId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    rowId: seed?.rowId || (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : fallbackId),
    displayName: seed?.displayName ?? "",
    model: seed?.model ?? "",
    contextWindow: seed?.contextWindow ?? "",
  };
}

function createProviderModelDraftRow(seed?: Partial<ProviderModelDraftRow>): ProviderModelDraftRow {
  const fallbackId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    rowId: seed?.rowId || (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : fallbackId),
    id: seed?.id ?? "",
    name: seed?.name ?? seed?.id ?? "",
    contextWindow: seed?.contextWindow ?? "",
    outputTokenLimit: seed?.outputTokenLimit ?? "",
  };
}

function providerModelRowsFromText(value: string) {
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((id) => createProviderModelDraftRow({ id, name: id }));
}

export function serializeProviderModelRows(rows: ProviderModelDraftRow[]) {
  return rows.map((row) => row.id.trim()).filter(Boolean).join("\n");
}

export function serializeProviderModelCapabilities(rows: ProviderModelDraftRow[]) {
  return rows.flatMap((row) => {
    const id = row.id.trim();
    if (!id) return [];
    const contextWindow = Number.parseInt(row.contextWindow, 10);
    const outputTokenLimit = Number.parseInt(row.outputTokenLimit, 10);
    return [{
      id,
      name: row.name.trim() || id,
      ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
      ...(Number.isFinite(outputTokenLimit) && outputTokenLimit > 0 ? { outputTokenLimit } : {}),
    }];
  });
}

export function serializeCodexCatalogRows(rows: CodexCatalogDraftRow[]) {
  return rows
    .map((row) => {
      const model = row.model.trim();
      if (!model) return "";
      return `${row.displayName.trim() || model} | ${model} | ${row.contextWindow.trim()}`.trimEnd();
    })
    .filter(Boolean)
    .join("\n");
}

function parseCodexCatalogRowsFromText(value: string) {
  return value
    .split(/\r?\n/g)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      const model = parts.length > 1 ? parts[1] : parts[0];
      if (!model) return null;
      return createCodexCatalogDraftRow({
        displayName: parts.length > 1 ? parts[0] : model,
        model,
        contextWindow: parts[2] ?? "",
      });
    })
    .filter((row): row is CodexCatalogDraftRow => Boolean(row));
}

export function defaultProviderDraft(appType: AgentManagementProviderApp): ProviderDraft {
  const defaultModel = appType === "claude" ? "claude-sonnet-4-5" : appType === "codex" ? "gpt-5.1" : "";
  const defaultModelRows = defaultModel
    ? [createProviderModelDraftRow({ id: defaultModel, name: defaultModel })]
    : appType === "opencode" || appType === "openclaw" || appType === "hermes"
      ? [createProviderModelDraftRow()]
      : [];
  return {
    editingId: null,
    id: "",
    name: "",
    baseUrl: "",
    apiKey: "",
    models: defaultModel,
    modelRows: defaultModelRows,
    claudeHaikuModel: appType === "claude" ? defaultModel : "",
    claudeHaikuName: appType === "claude" ? defaultModel : "",
    claudeSonnetModel: appType === "claude" ? defaultModel : "",
    claudeSonnetName: appType === "claude" ? defaultModel : "",
    claudeOpusModel: appType === "claude" ? defaultModel : "",
    claudeOpusName: appType === "claude" ? defaultModel : "",
    claudeFableModel: appType === "claude" ? defaultModel : "",
    claudeFableName: appType === "claude" ? defaultModel : "",
    codexCatalogRows: appType === "codex" ? [createCodexCatalogDraftRow({ displayName: "GPT 5.1", model: defaultModel })] : [],
    settingsJson: "",
  };
}

function extractCodexBaseUrlFromToml(config: string) {
  return config.match(/^\s*base_url\s*=\s*["']([^"']+)["']/m)?.[1] ?? "";
}

function isRecordStringUnknown(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatCodexCatalog(settings: Record<string, unknown>) {
  const modelCatalog = isRecordStringUnknown(settings.modelCatalog) ? settings.modelCatalog : null;
  const rows = Array.isArray(modelCatalog?.models) ? modelCatalog.models : [];
  return rows
    .map((row) => {
      if (!isRecordStringUnknown(row)) return "";
      const displayName = String(row.displayName ?? row.display_name ?? "").trim();
      const model = String(row.model ?? "").trim();
      const contextWindow = String(row.contextWindow ?? row.context_window ?? "").trim();
      if (!model) return "";
      return `${displayName || model} | ${model} | ${contextWindow}`.trimEnd();
    })
    .filter(Boolean)
    .join("\n");
}

function codexCatalogRowsFromSettings(settings: Record<string, unknown>, fallbackModels: AgentManagementManagedProvider["models"]) {
  const formatted = formatCodexCatalog(settings);
  const parsed = parseCodexCatalogRowsFromText(formatted);
  if (parsed.length) return parsed;
  return fallbackModels.map((model) => createCodexCatalogDraftRow({
    displayName: model.name || model.id,
    model: model.id,
  }));
}

export function providerDraftFromProvider(provider: AgentManagementManagedProvider): ProviderDraft {
  const settings = provider.settingsConfig ?? {};
  const options = isRecordStringUnknown(settings.options) ? settings.options : {};
  const env = isRecordStringUnknown(settings.env) ? settings.env : {};
  const codexAuth = isRecordStringUnknown(settings.auth) ? settings.auth : {};
  const codexConfig = typeof settings.config === "string" ? settings.config : "";
  const baseUrl =
    provider.appType === "codex"
      ? extractCodexBaseUrlFromToml(codexConfig)
      : "baseURL" in options
      ? String(options.baseURL ?? "")
      : String(settings.baseUrl ?? settings.base_url ?? env.ANTHROPIC_BASE_URL ?? "");
  const apiKey =
    provider.appType === "codex"
      ? String(codexAuth.OPENAI_API_KEY ?? codexAuth.CODEX_API_KEY ?? Object.values(codexAuth)[0] ?? "")
      : "apiKey" in options
      ? String(options.apiKey ?? "")
      : String(settings.apiKey ?? settings.api_key ?? env.ANTHROPIC_AUTH_TOKEN ?? "");
  const fallbackClaudeModel = String(env.ANTHROPIC_MODEL ?? env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? provider.models[0]?.id ?? "");
  return {
    editingId: provider.id,
    id: provider.id,
    name: provider.name,
    baseUrl,
    apiKey,
    models: provider.models.map((model) => model.id).join("\n"),
    modelRows: provider.models.length
      ? provider.models.map((model) => createProviderModelDraftRow({
        id: model.id,
        name: model.name || model.id,
        contextWindow: model.contextWindow == null ? "" : String(model.contextWindow),
        outputTokenLimit: model.outputTokenLimit == null ? "" : String(model.outputTokenLimit),
      }))
      : provider.appType === "opencode" || provider.appType === "openclaw" || provider.appType === "hermes"
        ? [createProviderModelDraftRow()]
        : [],
    claudeHaikuModel: String(env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? fallbackClaudeModel),
    claudeHaikuName: String(env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME ?? env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? fallbackClaudeModel),
    claudeSonnetModel: String(env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? fallbackClaudeModel),
    claudeSonnetName: String(env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME ?? env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? fallbackClaudeModel),
    claudeOpusModel: String(env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? fallbackClaudeModel),
    claudeOpusName: String(env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME ?? env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? fallbackClaudeModel),
    claudeFableModel: String(env.ANTHROPIC_DEFAULT_FABLE_MODEL ?? env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? fallbackClaudeModel),
    claudeFableName: String(env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME ?? env.ANTHROPIC_DEFAULT_FABLE_MODEL ?? env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? fallbackClaudeModel),
    codexCatalogRows: codexCatalogRowsFromSettings(settings, provider.models),
    settingsJson: JSON.stringify(provider.settingsConfig ?? {}, null, 2),
  };
}

function providerModelSummary(provider: AgentManagementManagedProvider) {
  if (provider.models.length === 0) return t("agent_manager.provider_no_models");
  const first = provider.models[0]?.name || provider.models[0]?.id;
  if (provider.models.length === 1) return first;
  return t("agent_manager.provider_models_more", { name: first, count: provider.models.length });
}

function ProviderBrandIcon(props: { provider?: AgentManagementManagedProvider; appType: AgentManagementProviderApp }) {
  const appIcon = {
    opencode: opencodeIconUrl,
    claude: claudeIconUrl,
    codex: codexIconUrl,
    openclaw: openclawIconUrl,
    hermes: hermesIconUrl,
  }[props.appType];
  return <img src={appIcon} alt="" className="size-4 object-contain" loading="lazy" />;
}

function ProviderActionIconButton(props: {
  label: string;
  tooltipLabel?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={props.disabled}
            onClick={props.onClick}
            className={cn(
              "bg-dls-surface text-dls-secondary ring-1 ring-dls-border-strong hover:bg-dls-hover",
              props.danger && "text-dls-status-danger-fg ring-dls-status-danger/25 hover:bg-dls-status-danger/10",
            )}
            aria-label={props.label}
          >
            {props.children}
          </Button>
        }
      />
      <TooltipContent side="bottom"><span>{props.tooltipLabel ?? props.label}</span></TooltipContent>
    </Tooltip>
  );
}

export function AgentManagementProviderModal(props: {
  open: boolean;
  appType: AgentManagementProviderApp;
  draft: ProviderDraft;
  busy: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: ProviderDraft) => void;
  onSubmit: () => void;
}) {
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<AgentManagementFetchedModel[]>([]);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [fetchModelsNotice, setFetchModelsNotice] = useState<string | null>(null);
  const fetchModelsRunRef = useRef(0);
  const modalOpenRef = useRef(props.open);
  const updateDraft = (patch: Partial<ProviderDraft>) => props.onDraftChange({ ...props.draft, ...patch });
  const canSubmit = props.draft.name.trim() && (props.draft.id.trim() || props.draft.name.trim());
  const editing = Boolean(props.draft.editingId);
  const providerKeyInvalid = props.draft.id.trim() !== "" && !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(props.draft.id.trim());
  const fieldClass = "h-9 bg-dls-surface placeholder:text-dls-secondary disabled:bg-dls-hover disabled:text-dls-secondary";
  const textareaClass = "resize-y bg-dls-surface py-2.5 leading-5 placeholder:text-dls-secondary";
  // Compact default height so empty JSON does not dominate the modal.
  const jsonTextareaClass = `${textareaClass} min-h-36 max-h-56 font-mono text-xs leading-5`;
  const labelClass = "text-xs font-medium text-dls-text";
  const hintClass = "text-xs leading-4 text-dls-secondary";
  const panelClass =
    "flex h-full min-h-0 flex-col gap-3 rounded-xl border border-dls-border bg-dls-surface p-4";
  const modelSelectButtonClass = "relative flex h-9 w-9 items-center justify-center rounded-lg border border-dls-border bg-dls-surface text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text focus-within:border-dls-border";
  const requiredMark = <span className="ml-1 text-dls-status-danger-fg">*</span>;

  useEffect(() => {
    modalOpenRef.current = props.open;
    fetchModelsRunRef.current += 1;
    setFetchingModels(false);
    setFetchedModels([]);
    setFetchModelsError(null);
    setFetchModelsNotice(null);
  }, [props.open, props.appType, props.draft.editingId]);

  const renderFetchedModelSelect = (onSelect: (model: AgentManagementFetchedModel) => void) => {
    if (!fetchedModels.length) return <span className="hidden md:block" />;
    return (
      <div className={modelSelectButtonClass} title={t("agent_manager.provider_modal.select_fetched_model")}>
        <ChevronDown className="size-4" />
        <select
          value=""
          onChange={(event) => {
            const model = fetchedModels.find((item) => item.id === event.currentTarget.value);
            event.currentTarget.value = "";
            if (!model) return;
            onSelect(model);
          }}
          aria-label={t("agent_manager.provider_modal.select_fetched_model")}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          <option value="">{t("agent_manager.provider_modal.select")}</option>
          {fetchedModels.map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}
        </select>
      </div>
    );
  };

  const claudeMappingRows = [
    { label: t("agent_manager.provider_modal.claude_haiku"), modelKey: "claudeHaikuModel", nameKey: "claudeHaikuName", hint: t("agent_manager.provider_modal.claude_haiku_hint") },
    { label: t("agent_manager.provider_modal.claude_sonnet"), modelKey: "claudeSonnetModel", nameKey: "claudeSonnetName", hint: t("agent_manager.provider_modal.claude_sonnet_hint") },
    { label: t("agent_manager.provider_modal.claude_opus"), modelKey: "claudeOpusModel", nameKey: "claudeOpusName", hint: t("agent_manager.provider_modal.claude_opus_hint") },
    { label: t("agent_manager.provider_modal.claude_fable"), modelKey: "claudeFableModel", nameKey: "claudeFableName", hint: t("agent_manager.provider_modal.claude_fable_hint") },
  ] as const;
  const updateCodexCatalogRow = (rowId: string, patch: Partial<CodexCatalogDraftRow>) => {
    updateDraft({
      codexCatalogRows: props.draft.codexCatalogRows.map((row) => row.rowId === rowId ? { ...row, ...patch } : row),
    });
  };
  const addCodexCatalogRow = () => updateDraft({ codexCatalogRows: [...props.draft.codexCatalogRows, createCodexCatalogDraftRow()] });
  const removeCodexCatalogRow = (rowId: string) => updateDraft({ codexCatalogRows: props.draft.codexCatalogRows.filter((row) => row.rowId !== rowId) });
  const updateModelRow = (rowId: string, patch: Partial<ProviderModelDraftRow>) => {
    updateDraft({
      modelRows: props.draft.modelRows.map((row) => row.rowId === rowId ? { ...row, ...patch } : row),
    });
  };
  const addModelRow = () => updateDraft({ modelRows: [...props.draft.modelRows, createProviderModelDraftRow()] });
  const removeModelRow = (rowId: string) => updateDraft({ modelRows: props.draft.modelRows.filter((row) => row.rowId !== rowId) });
  const fetchProviderModels = async () => {
    if (fetchingModels || !props.draft.baseUrl.trim()) return;
    const runId = fetchModelsRunRef.current + 1;
    fetchModelsRunRef.current = runId;
    setFetchModelsError(null);
    setFetchModelsNotice(null);
    setFetchingModels(true);
    try {
      const result = await agentManagementFetchModels({
        appType: props.appType,
        baseUrl: props.draft.baseUrl,
        apiKey: props.draft.apiKey,
      });
      if (fetchModelsRunRef.current !== runId || !modalOpenRef.current) return;
      setFetchedModels(result.models);
      if (result.models.length === 0) setFetchModelsError(t("agent_manager.provider_modal.no_models_found"));
    } catch (error) {
      if (fetchModelsRunRef.current !== runId || !modalOpenRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      const hasLocalModels = props.appType === "codex"
        ? props.draft.codexCatalogRows.some((row) => row.model.trim())
        : props.appType === "claude"
          ? Boolean(props.draft.models.trim() || props.draft.claudeHaikuModel.trim() || props.draft.claudeSonnetModel.trim() || props.draft.claudeOpusModel.trim() || props.draft.claudeFableModel.trim())
          : props.draft.modelRows.some((row) => row.id.trim());
      if (hasLocalModels) {
        setFetchModelsNotice(t("agent_manager.provider_modal.remote_models_unavailable", { message }));
      } else {
        setFetchModelsError(message);
      }
    } finally {
      if (fetchModelsRunRef.current === runId && modalOpenRef.current) setFetchingModels(false);
    }
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex max-h-[90vh] !w-[min(920px,calc(100vw-32px))] !max-w-none flex-col gap-0 overflow-hidden rounded-xl bg-dls-surface p-0 text-dls-text sm:!max-w-none">
        <DialogHeader className="shrink-0 border-b border-dls-border bg-dls-surface px-5 py-3.5">
          <div className="flex items-center gap-3">
            <IconTile size="md" shape="lg" border><ProviderBrandIcon appType={props.appType} /></IconTile>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-medium text-dls-text">{editing ? t("agent_manager.provider_modal.edit_provider") : t("agent_manager.provider_modal.add_provider")}</DialogTitle>
              <div className="mt-0.5 text-xs text-dls-secondary">{skillAgentLabel(props.appType)}{editing ? ` / ${props.draft.editingId}` : ""}</div>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-dls-background px-5 py-4">
          <div className="flex flex-col gap-4">
            <div className="grid items-stretch gap-4 lg:grid-cols-2">
            <section className={panelClass}>
              <div>
                <h3 className={providerTextClass.sectionTitle}>{t("agent_manager.provider_modal.basic_config")}</h3>
                <p className="mt-1 text-xs leading-4 text-dls-secondary">{t("agent_manager.provider_modal.basic_config_desc")}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 sm:col-span-2">
                  <span className={labelClass}>Provider Key{requiredMark}</span>
                  <Input
                    value={props.draft.id}
                    onChange={(event) => updateDraft({ id: event.currentTarget.value.toLowerCase().replace(/[^a-z0-9_.-]/g, "") })}
                    disabled={editing}
                    placeholder="token-plan"
                    className={cn(fieldClass, providerKeyInvalid && "border-dls-status-danger-border focus:border-dls-status-danger")}
                  />
                  <span className={cn(hintClass, providerKeyInvalid && "text-dls-status-danger-fg")}>{editing ? t("agent_manager.provider_modal.provider_key_locked") : providerKeyInvalid ? t("agent_manager.provider_modal.provider_key_invalid") : t("agent_manager.provider_modal.provider_key_hint")}</span>
                </label>

                <label className="block space-y-1.5 sm:col-span-2">
                  <span className={labelClass}>{t("agent_manager.provider_modal.display_name")}{requiredMark}</span>
                  <Input
                    value={props.draft.name}
                    onChange={(event) => updateDraft({ name: event.currentTarget.value })}
                    placeholder={t("agent_manager.provider_modal.provider_name_placeholder")}
                    className={fieldClass}
                  />
                </label>

                <label className="block space-y-1.5 sm:col-span-2">
                  <span className={labelClass}>API Endpoint</span>
                  <Input
                    value={props.draft.baseUrl}
                    onChange={(event) => updateDraft({ baseUrl: event.currentTarget.value })}
                    placeholder="https://api.example.com/v1"
                    className={fieldClass}
                  />
                </label>

                <label className="block space-y-1.5 sm:col-span-2">
                  <span className={labelClass}>API Key</span>
                  <Input
                    value={props.draft.apiKey}
                    onChange={(event) => updateDraft({ apiKey: event.currentTarget.value })}
                    placeholder="sk-..."
                    type="password"
                    className={fieldClass}
                  />
                </label>
              </div>
            </section>

            <section className={panelClass}>
              <div>
                <h3 className={providerTextClass.sectionTitle}>{t("agent_manager.provider_modal.models_config")}</h3>
                <p className="mt-1 text-xs leading-4 text-dls-secondary">{t("agent_manager.provider_modal.models_config_desc")}</p>
              </div>

              {props.appType === "claude" ? (
                <div className="space-y-3 rounded-lg border border-dls-border bg-dls-surface-muted p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-medium text-dls-text">{t("agent_manager.provider_modal.claude_mapping")}</h4>
                      <p className="mt-1 text-xs leading-4 text-dls-secondary">{t("agent_manager.provider_modal.claude_mapping_desc")}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={!props.draft.baseUrl.trim()}
                        aria-busy={fetchingModels}
                        onClick={fetchProviderModels}
                      >
                        {fetchingModels ? <LoadingSpinner size="sm" className="mr-1" /> : <Download className="mr-1 size-3" />}
                        {t("agent_manager.provider_modal.fetch_models")}
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          const value = fetchedModels[0]?.id || props.draft.models.split(/[\n,]/g).map((item) => item.trim()).find(Boolean) || props.draft.claudeSonnetModel;
                          if (!value) return;
                          updateDraft({
                            claudeHaikuModel: value,
                            claudeHaikuName: value,
                            claudeSonnetModel: value,
                            claudeSonnetName: value,
                            claudeOpusModel: value,
                            claudeOpusName: value,
                            claudeFableModel: value,
                            claudeFableName: value,
                          });
                        }}
                      >
                        {t("agent_manager.provider_modal.fill_all")}
                      </Button>
                    </div>
                  </div>
                  {fetchModelsError ? <ProviderModelNotice tone="danger">{fetchModelsError}</ProviderModelNotice> : null}
                  {fetchModelsNotice ? <ProviderModelNotice tone="warning">{fetchModelsNotice}</ProviderModelNotice> : null}
                  <div className="hidden grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-1 text-xs font-medium text-dls-secondary md:grid">
                    <span>{t("agent_manager.provider_modal.role")}</span>
                    <span>{t("agent_manager.provider_modal.request_model")}</span>
                    <span>{t("agent_manager.provider_modal.menu_display_name")}</span>
                  </div>
                  <div className="space-y-2">
                    {claudeMappingRows.map((row) => (
                      <div key={row.label} className="grid gap-2 md:grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                        <div className="text-xs font-medium text-dls-text">
                          {row.label}
                          <div className="text-xs font-normal text-dls-secondary">{row.hint}</div>
                        </div>
                        <Input
                          value={props.draft[row.modelKey]}
                          onChange={(event) => updateDraft({ [row.modelKey]: event.currentTarget.value })}
                          list={fetchedModels.length ? `agent-provider-models-${props.appType}` : undefined}
                          placeholder="claude-sonnet-4-5-20250929"
                          className={fieldClass}
                        />
                        <Input
                          value={props.draft[row.nameKey]}
                          onChange={(event) => updateDraft({ [row.nameKey]: event.currentTarget.value })}
                          placeholder={props.draft[row.modelKey] || row.label}
                          className={fieldClass}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : props.appType === "codex" ? (
                <div className="space-y-3 rounded-lg border border-dls-border bg-dls-surface-muted p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-medium text-dls-text">{t("agent_manager.provider_modal.codex_mapping")}</h4>
                      <p className="mt-1 text-xs leading-4 text-dls-secondary">{t("agent_manager.provider_modal.codex_mapping_desc")}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button type="button" size="xs" variant="outline" disabled={!props.draft.baseUrl.trim()} aria-busy={fetchingModels} onClick={fetchProviderModels}>
                        {fetchingModels ? <LoadingSpinner size="sm" className="mr-1" /> : <Download className="mr-1 size-3" />}
                        {t("agent_manager.provider_modal.fetch_models")}
                      </Button>
                      <Button type="button" size="xs" variant="outline" onClick={addCodexCatalogRow}>
                        <Plus className="mr-1 size-3" />
                        {t("agent_manager.provider_modal.add_model")}
                      </Button>
                    </div>
                  </div>
                  {fetchModelsError ? <ProviderModelNotice tone="danger">{fetchModelsError}</ProviderModelNotice> : null}
                  {fetchModelsNotice ? <ProviderModelNotice tone="warning">{fetchModelsNotice}</ProviderModelNotice> : null}
                  {fetchedModels.length ? <ProviderModelNotice tone="success">{t("agent_manager.provider_modal.fetched_models", { count: fetchedModels.length })}</ProviderModelNotice> : null}
                  <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_36px_32px] gap-2 px-1 text-xs font-medium text-dls-secondary md:grid">
                    <span>{t("agent_manager.provider_modal.menu_display_name")}</span>
                    <span>{t("agent_manager.provider_modal.request_model")}</span>
                    <span>{t("agent_manager.provider_modal.context_window")}</span>
                    <span />
                    <span />
                  </div>
                  <div className="space-y-2">
                    {props.draft.codexCatalogRows.map((row) => (
                      <div key={row.rowId} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_36px_32px] md:items-center">
                        <Input
                          value={row.displayName}
                          onChange={(event) => updateCodexCatalogRow(row.rowId, { displayName: event.currentTarget.value })}
                          placeholder={t("agent_manager.provider_modal.example_model_name", { name: "DeepSeek V4 Pro" })}
                          className={fieldClass}
                        />
                        <Input
                          value={row.model}
                          onChange={(event) => updateCodexCatalogRow(row.rowId, { model: event.currentTarget.value })}
                          list={fetchedModels.length ? `agent-provider-models-${props.appType}` : undefined}
                          placeholder={t("agent_manager.provider_modal.example_model_id", { name: "deepseek-v4-pro" })}
                          className={fieldClass}
                        />
                        <Input
                          value={row.contextWindow}
                          onChange={(event) => updateCodexCatalogRow(row.rowId, { contextWindow: event.currentTarget.value.replace(/[^\d]/g, "") })}
                          inputMode="numeric"
                          placeholder="128000"
                          className={fieldClass}
                        />
                        {renderFetchedModelSelect((model) => updateCodexCatalogRow(row.rowId, {
                          model: model.id,
                          displayName: row.displayName.trim() ? row.displayName : model.name || model.id,
                          contextWindow: row.contextWindow.trim() || (model.contextWindow == null ? "" : String(model.contextWindow)),
                        }))}
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button variant="ghost" size="icon-sm"
                                type="button"
                                onClick={() => removeCodexCatalogRow(row.rowId)}
                                className="text-dls-secondary hover:bg-dls-status-danger/10 hover:text-dls-status-danger-fg"
                                aria-label={t("agent_manager.provider_modal.delete_model")}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            }
                          />
                          <TooltipContent side="bottom"><span>{t("agent_manager.provider_modal.delete_model")}</span></TooltipContent>
                        </Tooltip>
                      </div>
                    ))}
                    {props.draft.codexCatalogRows.length === 0 ? (
                      <Button variant="dashed" size="sm" type="button" onClick={addCodexCatalogRow} className="w-full">
                        <Plus className="mr-1.5 size-3.5" />
                        {t("agent_manager.provider_modal.add_first_model")}
                      </Button>
                    ) : null}
                  </div>
                  <span className={hintClass}>{t("agent_manager.provider_modal.codex_default_hint")}</span>
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border border-dls-border bg-dls-surface-muted p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-medium text-dls-text">{t("agent_manager.provider_modal.model_list")}</h4>
                      <p className="mt-1 text-xs leading-4 text-dls-secondary">{t("agent_manager.provider_modal.model_list_desc", { name: skillAgentLabel(props.appType) })}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button type="button" size="xs" variant="outline" disabled={!props.draft.baseUrl.trim()} aria-busy={fetchingModels} onClick={fetchProviderModels}>
                        {fetchingModels ? <LoadingSpinner size="sm" className="mr-1" /> : <Download className="mr-1 size-3" />}
                        {t("agent_manager.provider_modal.fetch_models")}
                      </Button>
                      <Button type="button" size="xs" variant="outline" onClick={addModelRow}>
                        <Plus className="mr-1 size-3" />
                        {t("agent_manager.provider_modal.add_model")}
                      </Button>
                    </div>
                  </div>
                  {fetchModelsError ? <ProviderModelNotice tone="danger">{fetchModelsError}</ProviderModelNotice> : null}
                  {fetchModelsNotice ? <ProviderModelNotice tone="warning">{fetchModelsNotice}</ProviderModelNotice> : null}
                  {fetchedModels.length ? <ProviderModelNotice tone="success">{t("agent_manager.provider_modal.fetched_models", { count: fetchedModels.length })}</ProviderModelNotice> : null}
                  <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px_32px] gap-2 px-1 text-xs font-medium text-dls-secondary md:grid">
                    <span>{t("agent_manager.provider_modal.model_id")}</span>
                    <span>{t("agent_manager.provider_modal.display_name")}</span>
                    <span />
                    <span />
                  </div>
                  <div className="space-y-2">
                    {props.draft.modelRows.map((row) => (
                      <div key={row.rowId} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px_32px] md:items-center">
                        <Input
                          value={row.id}
                          onChange={(event) => updateModelRow(row.rowId, {
                            id: event.currentTarget.value,
                            contextWindow: "",
                            outputTokenLimit: "",
                          })}
                          list={fetchedModels.length ? `agent-provider-models-${props.appType}` : undefined}
                          placeholder="qwen3.6-plus"
                          className={fieldClass}
                        />
                        <Input
                          value={row.name}
                          onChange={(event) => updateModelRow(row.rowId, { name: event.currentTarget.value })}
                          placeholder={row.id || t("agent_manager.provider_modal.model_display_name_placeholder")}
                          className={fieldClass}
                        />
                        {renderFetchedModelSelect((model) => updateModelRow(row.rowId, {
                          id: model.id,
                          name: row.name.trim() ? row.name : model.name || model.id,
                          contextWindow: model.contextWindow == null ? "" : String(model.contextWindow),
                          outputTokenLimit: model.outputTokenLimit == null ? "" : String(model.outputTokenLimit),
                        }))}
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeModelRow(row.rowId)} className="text-dls-secondary hover:bg-dls-status-danger/10 hover:text-dls-status-danger-fg" aria-label={t("agent_manager.provider_modal.delete_model")}>
                                <Trash2 className="size-3.5" />
                              </Button>
                            }
                          />
                          <TooltipContent side="bottom"><span>{t("agent_manager.provider_modal.delete_model")}</span></TooltipContent>
                        </Tooltip>
                      </div>
                    ))}
                    {props.draft.modelRows.length === 0 ? (
                      <Button variant="dashed" size="sm" type="button" onClick={addModelRow} className="w-full">
                        <Plus className="mr-1.5 size-3.5" />
                        {t("agent_manager.provider_modal.add_first_model")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}

              {fetchedModels.length ? (
                <datalist id={`agent-provider-models-${props.appType}`}>
                  {fetchedModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </datalist>
              ) : null}

              {(props.appType === "claude" || props.appType === "codex") && (
                <label className="block space-y-1.5">
                  <span className={labelClass}>{t("agent_manager.provider_modal.default_model")}</span>
                  <Textarea
                    value={props.draft.models}
                    onChange={(event) => updateDraft({ models: event.currentTarget.value })}
                    placeholder={props.appType === "codex" ? "gpt-5.1" : "claude-sonnet-4-5"}
                    className={`${textareaClass} min-h-[72px]`}
                  />
                  <span className={hintClass}>{props.appType === "codex" ? t("agent_manager.provider_modal.default_model_codex_hint") : t("agent_manager.provider_modal.default_model_claude_hint")}</span>
                </label>
              )}
            </section>
            </div>

            <section className="rounded-xl border border-dls-border bg-dls-surface p-4">
              <label className="block space-y-1.5">
                <span className={labelClass}>
                  {t("agent_manager.provider_modal.advanced_json_config")}
                </span>
                <Textarea
                  value={props.draft.settingsJson}
                  onChange={(event) =>
                    updateDraft({ settingsJson: event.currentTarget.value })
                  }
                  placeholder={
                    props.appType === "opencode"
                      ? '{\n  "npm": "@ai-sdk/openai-compatible",\n  "options": {\n    "baseURL": "https://api.example.com/v1",\n    "apiKey": ""\n  },\n  "models": {}\n}'
                      : props.appType === "openclaw"
                        ? '{\n  "baseUrl": "https://api.example.com/v1",\n  "apiKey": "",\n  "api": "openai-completions",\n  "models": []\n}'
                        : '{\n  "base_url": "https://api.example.com/v1",\n  "api_key": "",\n  "model": "qwen3.6-plus"\n}'
                  }
                  className={jsonTextareaClass}
                  spellCheck={false}
                />
              </label>
            </section>
          </div>
        </div>

        {props.error ? (
          <div className="shrink-0 border-t border-dls-border bg-dls-surface px-5 py-3">
            <ProviderModelNotice tone="danger">{props.error}</ProviderModelNotice>
          </div>
        ) : null}

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-dls-border bg-dls-surface px-5 py-3">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)} disabled={props.busy}>{t("common.cancel")}</Button>
          <Button size="sm" disabled={!canSubmit || providerKeyInvalid || props.busy} onClick={props.onSubmit}>
            {props.busy ? <LoadingSpinner size="sm" className="mr-1.5" /> : editing ? <Pencil className="mr-1.5 size-3.5" /> : <Plus className="mr-1.5 size-3.5" />}
            {editing ? t("agent_manager.provider_modal.save_changes") : t("agent_manager.provider_modal.save_and_write")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function OpenCodeProviderConfigDialog(props: {
  workspaceRoot: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void | Promise<void>;
}) {
  const { open, onOpenChange, onSaved, workspaceRoot } = props;
  const [draft, setDraft] = useState<ProviderDraft>(() => defaultProviderDraft("opencode"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(defaultProviderDraft("opencode"));
    setError(null);
  }, [open]);

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await agentManagementProviderAction({
        action: "save",
        appType: "opencode",
        syncLive: true,
        workspaceRoot,
        provider: {
          id: draft.id,
          name: draft.name,
          settingsConfig: draft.settingsJson.trim() ? draft.settingsJson : undefined,
          simple: {
            id: draft.id,
            name: draft.name,
            baseUrl: draft.baseUrl,
            apiKey: draft.apiKey,
            models: serializeProviderModelRows(draft.modelRows),
            modelCapabilities: serializeProviderModelCapabilities(draft.modelRows),
            claudeHaikuModel: draft.claudeHaikuModel,
            claudeHaikuName: draft.claudeHaikuName,
            claudeSonnetModel: draft.claudeSonnetModel,
            claudeSonnetName: draft.claudeSonnetName,
            claudeOpusModel: draft.claudeOpusModel,
            claudeOpusName: draft.claudeOpusName,
            claudeFableModel: draft.claudeFableModel,
            claudeFableName: draft.claudeFableName,
            codexCatalog: serializeCodexCatalogRows(draft.codexCatalogRows),
          },
        },
      });
      setDraft(defaultProviderDraft("opencode"));
      onOpenChange(false);
      await onSaved?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  }, [busy, draft, onOpenChange, onSaved, workspaceRoot]);

  return (
    <AgentManagementProviderModal
      open={open}
      appType="opencode"
      draft={draft}
      busy={busy}
      error={error}
      onOpenChange={onOpenChange}
      onDraftChange={setDraft}
      onSubmit={submit}
    />
  );
}

export function AgentManagementProviderPanel(props: {
  snapshot: AgentManagementSnapshot | null;
  busyKey: string | null;
  selectedApp: AgentManagementProviderApp;
  onCreateProvider: () => void;
  onEditProvider: (provider: AgentManagementManagedProvider) => void;
  onSelectApp: (app: AgentManagementProviderApp) => void;
  onProviderAction: (input: AgentManagementProviderActionInput, busyKey: string) => void;
}) {
  const providers = props.snapshot?.providers.byAgent[props.selectedApp] ?? [];
  const activeProvider = providers.find((provider) => provider.isCurrent) ?? providers.find((provider) => provider.livePresent);
  const appLabel = skillAgentLabel(props.selectedApp);

  return (
    <section className="grid h-full min-h-0 gap-4 lg:grid-cols-[232px_minmax(0,1fr)]">
      {/* Agent runtime picker */}
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
        <div className="flex shrink-0 items-center justify-between border-b border-dls-border px-3 py-2.5">
          <span className="text-xs font-medium uppercase tracking-[0.06em] text-dls-secondary">
            Agent
          </span>
          <CountBadge size="dot" className="bg-dls-hover text-dls-secondary">
            {props.snapshot?.providers.total ?? 0}
          </CountBadge>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {PROVIDER_APP_OPTIONS.map((app) => {
            const count = props.snapshot?.providers.byAgent[app]?.length ?? 0;
            const selected = props.selectedApp === app;
            return (
              <Tooltip key={app}>
                <TooltipTrigger
                  render={
                    <MenuRowButton
                      align="center"
                      type="button"
                      onClick={() => props.onSelectApp(app)}
                      active={selected}
                      className={cn(
                        "w-full cursor-pointer gap-2.5 rounded-lg px-2 py-2 titlebar-no-drag",
                        selected
                          ? "bg-dls-list-selected text-dls-text"
                          : "text-dls-secondary hover:bg-dls-list-hover hover:text-dls-text",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-md",
                          selected ? "bg-dls-surface" : "bg-dls-surface-muted",
                        )}
                      >
                        <ProviderBrandIcon appType={app} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
                        {skillAgentLabel(app)}
                      </span>
                      <CountBadge
                        size="dot"
                        className={
                          selected
                            ? "bg-dls-surface text-dls-secondary"
                            : "bg-dls-hover text-dls-secondary"
                        }
                      >
                        {count}
                      </CountBadge>
                    </MenuRowButton>
                  }
                />
                <TooltipContent side="right">
                  <span>{skillAgentLabel(app)}</span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        {props.snapshot?.providers.databasePath ? (
          <div className="shrink-0 border-t border-dls-border px-3 py-2.5">
            <div className="text-2xs font-medium uppercase tracking-[0.06em] text-dls-secondary">
              {t("agent_manager.provider_studio_db_title")}
            </div>
            <div
              className="mt-1 truncate font-mono text-2xs leading-4 text-dls-secondary/80"
              title={props.snapshot.providers.databasePath}
            >
              {props.snapshot.providers.databasePath}
            </div>
          </div>
        ) : null}
      </aside>

      {/* Selected agent provider workspace */}
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-dls-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-dls-surface-muted ring-1 ring-dls-border/60">
              <ProviderBrandIcon appType={props.selectedApp} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium text-dls-text">
                {t("agent_manager.provider_suffix", { name: appLabel })}
              </h3>
              <p className="truncate text-xs text-dls-secondary">
                {activeProvider
                  ? t("agent_manager.current_provider", { name: activeProvider.name })
                  : t("agent_manager.no_current_provider")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={props.busyKey === `provider:${props.selectedApp}:import`}
              onClick={() =>
                props.onProviderAction(
                  { action: "importLive", appType: props.selectedApp },
                  `provider:${props.selectedApp}:import`,
                )
              }
            >
              {props.busyKey === `provider:${props.selectedApp}:import` ? (
                <LoadingSpinner size="sm" className="mr-1.5" />
              ) : (
                <Download className="mr-1.5 size-3.5" />
              )}
              {t("agent_manager.import_current")}
            </Button>
            <Button size="sm" onClick={props.onCreateProvider}>
              <Plus className="mr-1.5 size-3.5" />
              {t("agent_manager.add_provider")}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {providers.length ? (
            <div className="divide-y divide-dls-border">
              {providers.map((provider) => {
                const busy = props.busyKey?.startsWith(
                  `provider:${provider.appType}:${provider.id}:`,
                );
                return (
                  <div
                    key={`${provider.appType}:${provider.id}`}
                    className="px-4 py-3.5 transition-colors hover:bg-dls-list-hover/40"
                  >
                    <div className="flex items-start gap-3">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-dls-surface-muted ring-1 ring-dls-border">
                              <ProviderBrandIcon
                                provider={provider}
                                appType={provider.appType}
                              />
                            </span>
                          }
                        />
                        <TooltipContent side="bottom">
                          <span>{provider.name}</span>
                        </TooltipContent>
                      </Tooltip>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-dls-text">
                            {provider.name}
                          </span>
                          {provider.isCurrent ? (
                            <StatusBadge size="tiny" tone="success">
                              {t("agent_manager.current")}
                            </StatusBadge>
                          ) : null}
                          {provider.livePresent ? (
                            <StatusBadge size="tiny" tone="accent">
                              {t("agent_manager.written")}
                            </StatusBadge>
                          ) : null}
                          <StatusBadge size="tiny" tone="surface">
                            {provider.id}
                          </StatusBadge>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-dls-secondary">
                          {providerModelSummary(provider)}
                        </div>
                        <div
                          className="mt-0.5 truncate font-mono text-xs text-dls-secondary/75"
                          title={provider.configPath}
                        >
                          {provider.configPath}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <ProviderActionIconButton
                          label={t("agent_manager.provider_modal.edit_provider")}
                          disabled={busy}
                          onClick={() => props.onEditProvider(provider)}
                        >
                          <Pencil className="size-3.5" />
                        </ProviderActionIconButton>
                        <ProviderActionIconButton
                          label={t("agent_manager.provider_modal.enable_provider")}
                          disabled={busy}
                          onClick={() =>
                            props.onProviderAction(
                              {
                                action: "switch",
                                appType: provider.appType,
                                providerId: provider.id,
                              },
                              `provider:${provider.appType}:${provider.id}:switch`,
                            )
                          }
                        >
                          {props.busyKey ===
                          `provider:${provider.appType}:${provider.id}:switch` ? (
                            <LoadingSpinner size="sm" />
                          ) : (
                            <Zap className="size-3.5" />
                          )}
                        </ProviderActionIconButton>
                        <ProviderActionIconButton
                          label={t("agent_manager.provider_modal.write_config")}
                          disabled={busy}
                          onClick={() =>
                            props.onProviderAction(
                              {
                                action: "syncLive",
                                appType: provider.appType,
                                providerId: provider.id,
                              },
                              `provider:${provider.appType}:${provider.id}:sync`,
                            )
                          }
                        >
                          {props.busyKey ===
                          `provider:${provider.appType}:${provider.id}:sync` ? (
                            <LoadingSpinner size="sm" />
                          ) : (
                            <RefreshCw className="size-3.5" />
                          )}
                        </ProviderActionIconButton>
                        <ProviderActionIconButton
                          label={t("agent_manager.provider_modal.delete_provider")}
                          tooltipLabel={
                            provider.isCurrent
                              ? t("agent_manager.provider_modal.current_provider_cannot_delete")
                              : t("agent_manager.provider_modal.delete_provider")
                          }
                          disabled={busy || provider.isCurrent}
                          danger
                          onClick={() =>
                            props.onProviderAction(
                              {
                                action: "delete",
                                appType: provider.appType,
                                providerId: provider.id,
                              },
                              `provider:${provider.appType}:${provider.id}:delete`,
                            )
                          }
                        >
                          {props.busyKey ===
                          `provider:${provider.appType}:${provider.id}:delete` ? (
                            <LoadingSpinner size="sm" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </ProviderActionIconButton>
                      </div>
                    </div>
                    <details className="mt-2.5 rounded-lg border border-dls-border bg-dls-background px-3 py-2 text-xs text-dls-secondary">
                      <summary className="cursor-pointer font-medium text-dls-secondary hover:text-dls-text">
                        {t("agent_manager.config_preview")}
                      </summary>
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-4 text-dls-secondary">
                        {redactProviderText(provider.settingsConfig)}
                      </pre>
                    </details>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-5 px-6 py-12">
              <EmptyStateBox
                size="spacious"
                tone="surface"
                className="max-w-md border-dashed text-center text-sm leading-6"
              >
                {t("agent_manager.no_managed_providers")}
              </EmptyStateBox>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={props.busyKey === `provider:${props.selectedApp}:import`}
                  onClick={() =>
                    props.onProviderAction(
                      { action: "importLive", appType: props.selectedApp },
                      `provider:${props.selectedApp}:import`,
                    )
                  }
                >
                  {props.busyKey === `provider:${props.selectedApp}:import` ? (
                    <LoadingSpinner size="sm" className="mr-1.5" />
                  ) : (
                    <Download className="mr-1.5 size-3.5" />
                  )}
                  {t("agent_manager.import_current")}
                </Button>
                <Button size="sm" onClick={props.onCreateProvider}>
                  <Plus className="mr-1.5 size-3.5" />
                  {t("agent_manager.add_provider")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
