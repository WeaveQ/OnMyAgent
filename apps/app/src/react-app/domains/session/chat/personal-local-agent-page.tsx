/** @jsxImportSource react */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Clock3,
  Clipboard,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  KeyRound,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  TerminalSquare,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ActionRowButton, SessionRowButton } from "@/components/ui/action-row";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NoticeBox } from "@/components/ui/notice-box";
import { SendButton } from "@/components/ui/send-button";
import { CountBadge, StatusBadge, type StatusBadgeTone } from "@/components/ui/status-badge";
import { StatusDot, StatusPing } from "@/components/ui/status-dot";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { SelectMenu } from "../../../design-system/select-menu";
import {
  personalLocalAgentAcpCancel,
  personalLocalAgentAcpAgentsList,
  personalLocalAgentAcpProcessesList,
  personalLocalAgentAcpResolveApproval,
  personalLocalAgentAcpSend,
  personalLocalAgentConversationCreate,
  personalLocalAgentConversationTranscript,
  personalLocalAgentConversationsList,
  personalLocalAgentHeartbeatCreate,
  personalLocalAgentHeartbeatDelete,
  personalLocalAgentHeartbeatRunNow,
  personalLocalAgentHeartbeatsList,
  personalLocalAgentHeartbeatUpdate,
  personalLocalAgentNativeSessionsList,
  personalLocalAgentResetConversation,
  personalLocalAgentValidate,
  personalLocalAgentStatus,
  type PersonalLocalAgent,
  type PersonalLocalAgentConversation,
  type PersonalLocalAgentHeartbeatJob,
  type PersonalLocalAgentNativeSession,
  type PersonalLocalAgentProvider,
  type PersonalLocalAgentProcessRecord,
  type PersonalLocalAgentApprovalDecision,
  type PersonalLocalAgentApprovalMode,
  type PersonalLocalAgentApprovalRequest,
  type PersonalLocalAgentConversationMessage,
  type PersonalLocalAgentMetadata,
  type PersonalLocalAgentRunResult,
} from "../../../../app/lib/desktop";
import { openDesktopPath, revealDesktopItemInDir } from "../../../../app/lib/desktop";
import claudeIconUrl from "../../../../assets/agent-icons/claude.svg";
import codexIconUrl from "../../../../assets/agent-icons/openai.svg";
import hermesIconUrl from "../../../../assets/agent-icons/hermes.png";
import openclawIconUrl from "../../../../assets/agent-icons/claw.svg";
import opencodeIconUrl from "../../../../assets/agent-icons/opencode-logo-light.svg";
import {
  classifyOpenTarget,
  type OpenTarget,
} from "../artifacts/open-target";
import { MarkdownBlock } from "../surface/markdown";
import {
  conversationTitle,
  HeartbeatPanel,
  heartbeatClass,
  scheduledRunMessage,
  scheduledTaskSessionContext,
  shortDateTime,
  type HeartbeatDraft,
} from "./personal-local-agent-scheduled-tasks";

type PersonalLocalAgentPageProps = {
  workspaceRoot: string;
  workspaceName?: string | null;
  onOpenArtifact?: (target: OpenTarget) => Promise<void> | void;
  /**
   * Forward this run's artifacts (URLs / files) to the host so they show up
   * in the global Workspace/Artifacts panel and Browser, exactly like the
   * expert and assistant surfaces do.
   */
  onOpenTargetsChange?: (targets: OpenTarget[]) => void;
  /** Right-aligned controls injected by the host page (Browser/Workspace toggles). */
  headerActions?: ReactNode;
};

const localAgentTextClass = {
  panelTitle: "text-sm font-medium leading-5 text-dls-text",
  rowTitle: "min-w-0 flex-1 truncate text-sm font-medium leading-5",
  pageTitle: "truncate text-base font-medium leading-6 text-dls-text",
  debugMeta: "font-mono text-xs text-dls-secondary",
  runSectionTitle: "mb-2 flex items-center gap-2 font-medium",
  runItemTitle: "flex min-w-0 items-center gap-1.5 font-medium",
  approvalTitle: "text-xs font-medium",
  artifactTitle: "mb-2 flex items-center gap-1.5 text-xs font-medium text-dls-status-success-fg",
};

const localAgentLayoutClass = {
  refreshIcon: "mr-1.5 size-3.5",
  agentRow: "flex h-[68px] w-full items-center gap-3 px-4 text-left transition-colors",
  agentAvatar: "flex size-11 items-center justify-center overflow-hidden rounded-lg border text-base font-medium",
  agentAvatarSelected: "border-dls-border bg-dls-surface text-dls-accent",
  agentAvatarDefault: "border-dls-border bg-dls-decision-soft text-dls-accent",
  agentStatusDot: "absolute -right-0.5 bottom-0 size-2.5 rounded-full border-2",
  header: "shrink-0 border-b border-dls-border bg-dls-surface mac:titlebar-drag",
  pageContent: "mx-auto flex w-full max-w-[1120px] flex-col gap-5",
  chatPanel: "mx-auto w-full max-w-[1120px] rounded-2xl border border-dls-border bg-dls-surface p-2",
  chatMessage: "max-w-[86%] rounded-2xl border border-dls-border px-4 py-3 text-sm leading-6",
  userChatMessage: "bg-dls-chat-user-bg text-dls-text",
  assistantChatMessage: "bg-dls-surface text-dls-chat-agent-text",
  artifactPanel: "rounded-xl border border-dls-border bg-dls-surface-muted px-3 py-2",
  artifactButton: "min-w-0 max-w-[260px] justify-start rounded-none text-dls-status-success-fg hover:bg-dls-status-success-soft",
  artifactIconButton: "shrink-0 rounded-none text-dls-status-success-fg hover:bg-dls-status-success-soft",
};

const activeRunClass = {
  overview: "rounded-2xl border border-dls-accent/20 bg-dls-accent/5 p-3 text-xs text-dls-text",
  item: "flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors",
  itemSelected: "border-dls-accent/35 bg-dls-surface",
  itemDefault: "border-dls-accent/15 bg-dls-surface/70 hover:bg-dls-surface",
  runId: "font-mono text-xs text-dls-accent",
  meta: "mt-1 flex flex-wrap gap-2 text-xs text-dls-secondary",
  cancel: "h-7 shrink-0 border-dls-accent/20 bg-dls-surface text-xs text-dls-text hover:bg-dls-accent/5",
};

const approvalClass = {
  panel: "space-y-2 rounded-xl border border-dls-status-warning/25 bg-dls-status-warning/12 px-3 py-2 text-dls-status-warning",
  item: "rounded-lg border border-dls-status-warning/25 bg-dls-surface/75 p-2",
  meta: "mt-0.5 text-xs leading-4 text-dls-status-warning/80",
  command: "mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-dls-status-warning/12 px-2 py-1 font-mono text-xs text-dls-status-warning",
  cwd: "mt-1 truncate font-mono text-xs text-dls-status-warning/80",
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  createdAt: number;
  run?: PersonalLocalAgentRunResult | null;
};

type AgentHealthResult = {
  status: "idle" | "running" | "passed" | "failed";
  at: number | null;
  runId: string | null;
  output: string;
  error: string | null;
};

type PersistedLocalAgentChatState = {
  version: 1;
  selectedAgentId?: string;
  selectedConversationIdByAgent?: Record<string, string>;
  messagesByAgent?: Record<string, ChatMessage[]>;
  draftsByAgent?: Record<string, string>;
  activeRunIdByAgent?: Record<string, string | null>;
  healthResults?: Record<string, AgentHealthResult>;
  errorsByAgent?: Record<string, string | null>;
};

const PROVIDER_LABELS: Record<PersonalLocalAgent["provider"], string> = {
  opencode: "OpenCode",
  codex: "Codex",
  claude: "Claude Code",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  custom: "Custom",
};

const PROVIDER_ICON_URLS: Partial<Record<PersonalLocalAgentProvider, string>> = {
  opencode: opencodeIconUrl,
  codex: codexIconUrl,
  claude: claudeIconUrl,
  openclaw: openclawIconUrl,
  hermes: hermesIconUrl,
};

function providerIconUrl(provider: PersonalLocalAgentProvider) {
  return PROVIDER_ICON_URLS[provider] ?? null;
}

function modelSelectorLabel(agent: PersonalLocalAgent | null) {
  if (!agent) return t("local_agent.model");
  const targetKind = agent.capability?.targetKind ?? (agent.provider === "openclaw" ? "agent" : "model");
  if (agent.provider === "openclaw") return t("local_agent.openclaw_agent");
  return targetKindLabel(targetKind);
}

function runStatusLabel(status: PersonalLocalAgentRunResult["status"]) {
  switch (status) {
    case "running":
      return t("local_agent.status_running");
    case "completed":
      return t("local_agent.status_completed");
    case "failed":
      return t("local_agent.status_failed");
    case "cancelled":
      return t("local_agent.status_cancelled");
    case "missing":
      return t("local_agent.status_missing");
  }
}

const PERSONAL_AGENT_MODEL_PREF_PREFIX = "onmyagent.personalLocalAgent.model";
const PERSONAL_AGENT_CHAT_STATE_PREFIX = "onmyagent.personalLocalAgent.chatState";
const PERSONAL_AGENT_LIST_CACHE_PREFIX = "onmyagent.personalLocalAgent.agentList";
const PERSONAL_AGENT_APPROVAL_MODE_PREFIX = "onmyagent.personalLocalAgent.approvalMode";
const LOCAL_AGENT_LIST_MIN_WIDTH = 180;
const LOCAL_AGENT_LIST_MAX_WIDTH = 320;
const LOCAL_AGENT_LIST_DEFAULT_WIDTH = 240;
const OPENCODE_PREFERRED_MODEL = "ark-coding-openai/ark-code-latest";

const HEALTH_CHECK_PROMPT =
  "Local Agent health check: reply with HEALTH_CHECK_OK only and keep it short.";

function agentFromAcpMetadata(metadata: PersonalLocalAgentMetadata): PersonalLocalAgent {
  const provider = metadata.backend === "opencode" || metadata.backend === "codex" || metadata.backend === "claude" || metadata.backend === "openclaw" || metadata.backend === "hermes" || metadata.backend === "custom"
    ? metadata.backend
    : "custom";
  const availableModels = Array.isArray(metadata.handshake?.available_models)
    ? metadata.handshake.available_models
    : [];
  const modelOptions = availableModels.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) return [];
    const label = typeof record.label === "string" ? record.label : typeof record.name === "string" ? record.name : id;
    return [{ id, label }];
  });
  const binaryName = metadata.agent_source_info?.binary_name?.trim() || provider;
  return {
    id: metadata.id,
    name: metadata.name,
    provider,
    executablePath: metadata.command?.trim() || binaryName,
    model: null,
    customArgs: Array.isArray(metadata.args) ? metadata.args : [],
    modelOptions,
    defaultModel: modelOptions[0]?.id ?? null,
    connectionMode: metadata.connectionMode ?? null,
    status: metadata.status ?? (metadata.available ? "online" : "offline"),
    version: metadata.agent_source_info?.version ?? null,
    error: metadata.error ?? null,
    capability: metadata.capability ?? null,
    lastCheckedAt: Date.now(),
  };
}
const DEFAULT_HEARTBEAT_PROMPT =
  "Run this scheduled task. Describe the goal, expected output, and whether file changes are allowed.";

function targetKindLabel(targetKind: "model" | "agent" | "profile" | "command") {
  switch (targetKind) {
    case "model":
      return t("local_agent.target_model");
    case "agent":
      return t("local_agent.target_agent");
    case "profile":
      return t("local_agent.target_profile");
    case "command":
      return t("local_agent.target_command");
  }
}

const APPROVAL_MODE_OPTIONS: Array<{ id: PersonalLocalAgentApprovalMode; label: string; description: string }> = [
  { id: "auto", get label() { return t("local_agent.approval_auto"); }, get description() { return t("local_agent.approval_auto_desc"); } },
  { id: "ask", get label() { return t("local_agent.approval_ask"); }, get description() { return t("local_agent.approval_ask_desc"); } },
  { id: "read-only-auto", get label() { return t("local_agent.approval_readonly_auto"); }, get description() { return t("local_agent.approval_readonly_auto_desc"); } },
];

const DEFAULT_HEALTH_RESULT: AgentHealthResult = {
  status: "idle",
  at: null,
  runId: null,
  output: "",
  error: null,
};

function welcomeMessageForAgent(agent: PersonalLocalAgent | null): ChatMessage {
  const name = agent?.name ?? t("nav.local_agent");
  return {
    id: `welcome-${agent?.id ?? "empty"}`,
    role: "assistant",
    createdAt: Date.now(),
    text: t("local_agent.switched_message", { name }),
    run: null,
  };
}

function personalAgentModelPrefKey(agentId: string) {
  return `${PERSONAL_AGENT_MODEL_PREF_PREFIX}.${agentId}`;
}

function personalAgentChatStateKey(workspaceRoot: string) {
  return `${PERSONAL_AGENT_CHAT_STATE_PREFIX}.${workspaceRoot}`;
}

function personalAgentListCacheKey(workspaceRoot: string) {
  return `${PERSONAL_AGENT_LIST_CACHE_PREFIX}.${workspaceRoot}`;
}

function personalAgentApprovalModeKey(workspaceRoot: string) {
  return `${PERSONAL_AGENT_APPROVAL_MODE_PREFIX}.${workspaceRoot}`;
}

function localAgentChatKey(agentId: string, conversationId?: string | null) {
  return conversationId ? `${agentId}::${conversationId}` : agentId;
}

function agentIdFromChatKey(chatKey: string) {
  return chatKey.split("::")[0] ?? chatKey;
}

function transcriptMessagesForAgent(
  agent: PersonalLocalAgent,
  messages: Array<{ id: string; role: "user" | "assistant"; text: string; createdAt: number }>,
) {
  if (!messages.length) return [welcomeMessageForAgent(agent)];
  return messages.map((message) => ({
    id: `history-${message.id}`,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
  } satisfies ChatMessage));
}

function nativeSessionResumeOnlyMessage(agent: PersonalLocalAgent, conversation: PersonalLocalAgentConversation): ChatMessage {
  return {
    id: `native-session-${conversation.id}`,
    role: "assistant",
    text: t("local_agent.native_session_resume_only", { name: agent.name, title: conversationTitle(conversation) }),
    createdAt: Date.now(),
  };
}

function isUnsupportedNativeTranscriptError(error: string | null | undefined) {
  return error === "This provider does not expose a stable native transcript.";
}

function safeReadApprovalMode(workspaceRoot: string): PersonalLocalAgentApprovalMode {
  if (typeof window === "undefined") return "ask";
  const raw = window.localStorage.getItem(personalAgentApprovalModeKey(workspaceRoot));
  if (raw === "auto" || raw === "ask" || raw === "read-only-auto") return raw;
  return "ask";
}

function safeReadPersistedChatState(workspaceRoot: string): PersistedLocalAgentChatState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(personalAgentChatStateKey(workspaceRoot));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedLocalAgentChatState;
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function safeReadCachedAgents(workspaceRoot: string): PersonalLocalAgent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(personalAgentListCacheKey(workspaceRoot));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PersonalLocalAgent =>
        Boolean(item && typeof item === "object" && "id" in item),
    );
  } catch {
    return [];
  }
}

function safeWriteCachedAgents(workspaceRoot: string, agents: PersonalLocalAgent[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(personalAgentListCacheKey(workspaceRoot), JSON.stringify(agents));
  } catch {
  }
}

function compactMessagesByAgent(messagesByAgent: Record<string, ChatMessage[]>) {
  const next: Record<string, ChatMessage[]> = {};
  for (const [agentId, messages] of Object.entries(messagesByAgent)) {
    next[agentId] = messages.slice(-80);
  }
  return next;
}

function recoverActiveRunIds(
  messagesByAgent: Record<string, ChatMessage[]> | undefined,
  persistedActiveRunIds: Record<string, string | null> | undefined,
) {
  const next: Record<string, string | null> = { ...(persistedActiveRunIds ?? {}) };
  for (const [agentId, messages] of Object.entries(messagesByAgent ?? {})) {
    const persistedRunId = next[agentId];
    const persistedRun = persistedRunId
      ? messages.find((message) => message.run?.runId === persistedRunId)?.run
      : null;
    if (persistedRun?.status === "running") continue;
    const runningRun = [...messages].reverse().find((message) => message.run?.status === "running")?.run;
    next[agentId] = runningRun?.runId ?? null;
  }
  return next;
}

function chooseInitialModel(agent: PersonalLocalAgent | null) {
  if (!agent || typeof window === "undefined") return "";
  const saved = window.localStorage.getItem(personalAgentModelPrefKey(agent.id))?.trim() ?? "";
  if (saved && agent.modelOptions.some((option) => option.id === saved)) return saved;
  if (agent.provider === "opencode" && agent.modelOptions.some((option) => option.id === OPENCODE_PREFERRED_MODEL)) {
    return OPENCODE_PREFERRED_MODEL;
  }
  return "";
}

function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shortTime(value: number | null | undefined) {
  if (!value) return "--";
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function elapsedSeconds(startedAt: number | null | undefined, finishedAt: number | null | undefined) {
  if (!startedAt) return "--";
  const end = finishedAt ?? Date.now();
  return t("local_agent.elapsed_seconds", { count: Math.max(0, Math.round((end - startedAt) / 1000)) });
}

function runStatusTone(status: PersonalLocalAgentRunResult["status"] | undefined) {
  if (status === "completed") return "success";
  if (status === "running") return "accent";
  if (status === "cancelled") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

function isRunFinal(status: PersonalLocalAgentRunResult["status"] | undefined) {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "missing";
}

function structuredArtifactTargets(run: PersonalLocalAgentRunResult | undefined | null): OpenTarget[] {
  if (!run?.artifacts?.length) return [];
  const map = new Map<string, OpenTarget>();
  for (const entry of run.artifacts) {
    const value = entry.path || entry.relPath;
    if (!value) continue;
    const id = `file:${value.toLowerCase()}`;
    if (map.has(id)) continue;
    map.set(id, {
      id,
      kind: "file",
      value,
      name: entry.name || value.split(/[\\/]/).filter(Boolean).pop() || value,
      preview: classifyOpenTarget(value, "file"),
      confidence: 0.96,
      reason: entry.source === "adapter" ? t("local_agent.artifact_source_adapter") : t("local_agent.artifact_source_reply"),
      exists: entry.exists,
    });
  }
  return [...map.values()];
}

function extractArtifactTargets(output: string, workspaceRoot: string): OpenTarget[] {
  const map = new Map<string, OpenTarget>();
  const pattern = /(?:产物文件：|^|[\s"'`([{])((?:\.{1,2}[/\\]|~[/\\]|[/\\])?[\w.\-]+(?:[/\\][\w.\-]+)*\.(?:md|markdown|mdx|txt|log|json|csv|tsv|xlsx|html|pdf|png|jpg|jpeg|webp|svg))/gim;
  for (const match of output.matchAll(pattern)) {
    const raw = match[1]?.trim().replace(/[.,;:]+$/, "");
    if (!raw) continue;
    const cleaned = raw.replace(/^\.\//, "");
    if (!cleaned || cleaned.startsWith("..")) continue;
    // Keep the original raw string so the open handler can decide between
    // workspace-relative artifacts and absolute filesystem paths.
    const value = cleaned;
    const target: OpenTarget = {
      id: `file:${value.toLowerCase()}`,
      kind: "file",
      value,
      name: value.split(/[\\/]/).filter(Boolean).pop() ?? value,
      preview: classifyOpenTarget(value, "file"),
      confidence: 0.92,
      reason: t("local_agent.artifact_source_file"),
      exists: true,
    };
    map.set(target.id, target);
  }
  void workspaceRoot;
  return [...map.values()];
}

const URL_TARGET_PATTERN = /(?:https?|wss?):\/\/[^\s)\]}>"'`]+/gi;

function extractUrlTargets(output: string): OpenTarget[] {
  if (!output) return [];
  const map = new Map<string, OpenTarget>();
  for (const match of output.matchAll(URL_TARGET_PATTERN)) {
    const raw = match[0]?.replace(/[.,;:`\\]+$/, "");
    if (!raw) continue;
    let clean = raw;
    try {
      const parsed = new URL(raw.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:"));
      if (parsed.pathname === "/" && !parsed.search && !parsed.hash) clean = parsed.origin;
    } catch {
      // Keep raw value if it cannot be parsed; the regex already validated shape.
    }
    const id = `url:${clean}`;
    if (map.has(id)) continue;
    const name = (() => {
      try {
        return new URL(clean).host || clean;
      } catch {
        return clean;
      }
    })();
    map.set(id, {
      id,
      kind: "url",
      value: clean,
      name,
      preview: "browser",
      confidence: 0.9,
      reason: t("local_agent.artifact_source_url"),
    });
  }
  return [...map.values()];
}

function collectRunOpenTargets(
  run: PersonalLocalAgentRunResult | undefined | null,
  workspaceRoot: string,
  fallbackText = "",
): OpenTarget[] {
  const sourceText = run?.output ?? fallbackText ?? "";
  const fileFromStructured = structuredArtifactTargets(run);
  const fileTargets = fileFromStructured.length
    ? fileFromStructured
    : extractArtifactTargets(sourceText, workspaceRoot);
  const urlTargets = extractUrlTargets(sourceText);
  const seen = new Set<string>();
  const out: OpenTarget[] = [];
  for (const target of [...urlTargets, ...fileTargets]) {
    if (seen.has(target.id)) continue;
    seen.add(target.id);
    out.push(target);
  }
  return out;
}

function agentSubtitle(agent: PersonalLocalAgent) {
  if (agent.status !== "online") return agent.error || t("common.unavailable");
  const mode = agent.connectionMode;
  return [mode, agent.version || agent.executablePath || t("config.status_connected")].filter(Boolean).join(" · ");
}

function agentDefaultLabel(agent: PersonalLocalAgent | null, selectedModel = "") {
  if (!agent) return "--";
  const defaultConfig = t("local_agent.use_default_config");
  const current = selectedModel || agent.model || agent.defaultModel || defaultConfig;
  if (agent.provider === "openclaw") {
    return current === defaultConfig ? t("local_agent.openclaw_default_agent") : current;
  }
  return current;
}

function agentMemoryProfile(agent: PersonalLocalAgent | null) {
  if (!agent) {
    return {
      mode: t("local_agent.memory_none_mode"),
      summary: t("local_agent.memory_none_summary"),
      detail: t("local_agent.memory_none_detail"),
    };
  }
  switch (agent.provider) {
    case "opencode":
      return {
        mode: t("local_agent.memory_opencode_mode"),
        summary: t("local_agent.memory_opencode_summary"),
        detail: t("local_agent.memory_opencode_detail"),
      };
    case "codex":
      return {
        mode: t("local_agent.memory_codex_mode"),
        summary: t("local_agent.memory_codex_summary"),
        detail: t("local_agent.memory_codex_detail"),
      };
    case "claude":
      return {
        mode: t("local_agent.memory_claude_mode"),
        summary: t("local_agent.memory_claude_summary"),
        detail: t("local_agent.memory_claude_detail"),
      };
    case "openclaw":
      return {
        mode: t("local_agent.memory_openclaw_mode"),
        summary: t("local_agent.memory_openclaw_summary"),
        detail: t("local_agent.memory_openclaw_detail"),
      };
    case "hermes":
      return {
        mode: t("local_agent.memory_hermes_mode"),
        summary: t("local_agent.memory_hermes_summary"),
        detail: t("local_agent.memory_hermes_detail"),
      };
    default:
      return {
        mode: t("local_agent.memory_custom_mode"),
        summary: t("local_agent.memory_custom_summary"),
        detail: t("local_agent.memory_custom_detail"),
      };
  }
}

function agentWorkdirLabel(agent: PersonalLocalAgent | null) {
  if (!agent) return "--";
  return t("local_agent.runtime_state_workdir", { provider: agent.provider, id: agent.id });
}

function lastRunForAgent(messages: ChatMessage[] | undefined) {
  return [...(messages ?? [])].reverse().find((message) => message.run)?.run ?? null;
}

function lastEventTime(run: PersonalLocalAgentRunResult | null | undefined) {
  const event = run?.events?.[run.events.length - 1];
  return event?.at ?? run?.finishedAt ?? run?.startedAt ?? null;
}

function visibleRunTimelineMessages(run: PersonalLocalAgentRunResult | null | undefined) {
  const sourceMessages = run?.conversationMessages?.length
    ? run.conversationMessages
    : (run?.events ?? []).flatMap((event, index): PersonalLocalAgentConversationMessage[] => {
      const text = event.text.trim();
      if (!text) return [];
      const createdAt = event.at || Date.now();
      if (event.type === "assistant_chunk") return [{ id: `event-${index}`, type: "text", role: "assistant", text, createdAt, sourceEventType: event.type }];
      if (event.type === "assistant") return [{ id: `event-${index}`, type: "finish", role: "assistant", text, createdAt, sourceEventType: event.type }];
      if (event.type === "tool") return [{ id: `event-${index}`, type: "tool", role: "tool", text, createdAt, sourceEventType: event.type, status: /failed|error/i.test(text) ? "failed" : "running", toolCall: event.toolCall ?? null }];
      if (event.type === "approval_request") return [{ id: `event-${index}`, type: "permission", role: "system", text, createdAt, sourceEventType: event.type, approval: event.approval ?? null }];
      if (event.type === "error") return [{ id: `event-${index}`, type: "error", role: "system", text, createdAt, sourceEventType: event.type }];
      if (event.type === "status") return [{ id: `event-${index}`, type: "agent_status", role: "system", text, createdAt, sourceEventType: event.type }];
      return [];
    });
  const messages = sourceMessages.filter((message) => {
    if (!message.text.trim()) return false;
    if (message.type === "agent_status") return false;
    if (message.type === "agent_status" && /^.+ ACP flow started$/.test(message.text.trim())) return false;
    if (message.type === "available_commands" || message.type === "context_usage") return false;
    if (message.type === "tool" && !message.toolCall?.id) return false;
    return true;
  });
  const grouped: PersonalLocalAgentConversationMessage[] = [];
  for (const message of messages) {
    const previous = grouped[grouped.length - 1];
    const isAssistantChunk = message.role === "assistant" && message.type === "text";
    const previousIsAssistantChunk = previous?.role === "assistant" && previous.type === "text";
    if (isAssistantChunk && previous && previousIsAssistantChunk) {
      grouped[grouped.length - 1] = {
        ...previous,
        id: `${previous.id}-${message.id}`,
        text: shouldJoinAssistantChunkTightly(previous.text, message.text)
          ? `${previous.text}${message.text}`
          : `${previous.text}\n${message.text}`,
        createdAt: message.createdAt,
      };
      continue;
    }
    grouped.push(message);
  }
  return grouped;
}

type LocalAgentToolStatus = "running" | "completed" | "failed" | "pending";

type LocalAgentTimelineItem =
  | { kind: "message"; message: PersonalLocalAgentConversationMessage }
  | { kind: "tool_group"; id: string; messages: PersonalLocalAgentConversationMessage[] };

function resolveLocalAgentToolStatus(message: PersonalLocalAgentConversationMessage): LocalAgentToolStatus {
  const raw = `${message.toolCall?.status ?? message.status ?? ""}`.toLowerCase();
  if (raw.includes("fail") || raw.includes("error") || raw.includes("cancel")) return "failed";
  if (raw.includes("complete") || raw.includes("done") || raw === "ok" || raw === "success") return "completed";
  if (raw.includes("pending") || raw.includes("queue")) return "pending";
  return "running";
}

// 对标 AionUi getKindDisplayName：把原始 kind/泛名映射成友好工具名，确保永不为空
const LOCAL_AGENT_TOOL_KIND_LABELS: Record<string, string> = {
  edit: "File Edit",
  read: "File Read",
  write: "File Write",
  execute: "Shell Command",
  command: "Shell Command",
  commandexecution: "Shell Command",
  shell: "Shell Command",
  bash: "Shell Command",
  search: "Search",
  grep: "Search",
  glob: "Find Files",
  fetch: "Fetch",
  webfetch: "Fetch",
  think: "Thinking",
  thinking: "Thinking",
  mcp: "MCP Tool",
};

const GENERIC_TOOL_NAMES = new Set(["tool", "tool_call", "unknown", "untitled"]);

function getKindDisplayName(kind?: string): string {
  if (!kind) return "Tool";
  const key = kind.trim().toLowerCase();
  if (LOCAL_AGENT_TOOL_KIND_LABELS[key]) return LOCAL_AGENT_TOOL_KIND_LABELS[key];
  return kind.trim();
}

function inferTitleFromInput(input?: string): string | null {
  if (!input?.trim()) return null;
  const trimmed = input.trim();
  // 尝试解析 JSON，看有没有 command/path/file_path/pattern
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed) {
      if (parsed.command) return `Shell Command: ${(parsed.command as string).slice(0, 40)}`;
      if (parsed.path) return `File: ${(parsed.path as string).slice(0, 40)}`;
      if (parsed.file_path) return `File: ${(parsed.file_path as string).slice(0, 40)}`;
      if (parsed.pattern) return `Search: ${(parsed.pattern as string).slice(0, 40)}`;
    }
  } catch {
    // 不是 JSON，继续
  }
  // 不是 JSON，直接用前 50 个字符
  const preview = trimmed.slice(0, 50).replace(/\s+/g, " ").trim();
  if (preview) return preview;
  return null;
}

function localAgentToolDisplay(message: PersonalLocalAgentConversationMessage) {
  const tool = message.toolCall;
  let title: string;

  const rawName = tool?.name?.trim() ?? "";
  const rawKind = tool?.kind?.trim();
  if (rawName && !GENERIC_TOOL_NAMES.has(rawName.toLowerCase())) {
    title = rawName;
  } else if (rawKind) {
    title = getKindDisplayName(rawKind);
  } else {
    // 旧消息：没有 kind，且 name 是泛名 → 尝试从 input/description/text 推断
    const inferred =
      inferTitleFromInput(tool?.input) ||
      tool?.description?.trim() ||
      message.text.replace(/^acp_tool_call(_update)?[>:\s-]*/i, "").trim().slice(0, 50) ||
      "Tool";
    title = inferred;
  }

  const detailSections: Array<{ label: string; value: string; truncated?: boolean }> = [];
  if (tool?.input?.trim()) detailSections.push({ label: "Input", value: tool.input.trim(), truncated: tool.inputTruncated });
  if (tool?.output?.trim()) detailSections.push({ label: "Output", value: tool.output.trim(), truncated: tool.outputTruncated });

  return {
    title,
    status: resolveLocalAgentToolStatus(message),
    detail: detailSections.length ? detailSections : [],
  };
}

function groupLocalAgentTimeline(messages: PersonalLocalAgentConversationMessage[]): LocalAgentTimelineItem[] {
  const items: LocalAgentTimelineItem[] = [];
  let toolBuffer: PersonalLocalAgentConversationMessage[] = [];
  const flushTools = () => {
    if (!toolBuffer.length) return;
    items.push({ kind: "tool_group", id: toolBuffer.map((message) => message.id).join("-"), messages: toolBuffer });
    toolBuffer = [];
  };
  for (const message of messages) {
    if (message.type === "tool") {
      toolBuffer.push(message);
      continue;
    }
    flushTools();
    items.push({ kind: "message", message });
  }
  flushTools();
  return items;
}

function LocalAgentToolRow(props: { message: PersonalLocalAgentConversationMessage }) {
  const tool = localAgentToolDisplay(props.message);
  const hasDetail = tool.detail.length > 0;

  const dotClass =
    tool.status === "running"
      ? "bg-dls-accent aionui-tool-breathing"
      : tool.status === "failed"
        ? "bg-dls-status-danger"
        : tool.status === "pending"
          ? "bg-dls-border-strong"
          : "bg-dls-status-success-fg";

  return (
    <div className="flex min-w-0 flex-col overflow-hidden">
      <div className="flex w-full items-center gap-3 rounded-md py-0.5 text-left text-[13px] leading-5 text-dls-secondary overflow-hidden">
        <span className={cn("size-2 shrink-0 rounded-full", dotClass)} />
        <span className="min-w-0 flex-1 truncate font-medium text-dls-text">{tool.title}</span>
      </div>
      {hasDetail ? (
        <div className="ml-5 mt-1 space-y-2 overflow-hidden">
          {tool.detail.map((section) => (
            <div key={section.label} className="min-w-0">
              <div className="text-[11px] font-medium text-dls-tertiary">
                {section.label}
                {section.truncated ? ` · ${t("local_agent.timeline_tool_truncated")}` : ""}
              </div>
              <pre className="mt-1 max-h-48 overflow-auto rounded-xl border border-dls-border/70 bg-dls-surface px-3 py-2 text-xs leading-5 whitespace-pre-wrap break-words font-sans text-dls-secondary">{section.value}</pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LocalAgentToolGroupSummary(props: { messages: PersonalLocalAgentConversationMessage[] }) {
  const tools = props.messages.map((message) => localAgentToolDisplay(message));
  const hasRunning = tools.some((tool) => tool.status === "running");

  return (
    <div className="max-w-full rounded-2xl border border-dls-border/60 aionui-tool-container">
      <div className="flex w-full items-center gap-2 rounded-2xl px-3.5 py-2.5 text-left text-[13px] text-dls-secondary">
        {hasRunning ? <Loader2 className="size-3.5 shrink-0 animate-spin text-dls-accent" /> : <CheckCircle2 className="size-3.5 shrink-0 text-dls-status-success-fg" />}
        <span className="min-w-0 flex-1 font-medium text-dls-text">{t("local_agent.timeline_tool_group_title", { count: props.messages.length })}</span>
      </div>
      <div className="flex flex-col gap-0.5 px-3.5 pb-2.5 pt-0.5">
        {props.messages.map((message) => (
          <LocalAgentToolRow key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}

async function writeTextToClipboard(value: string | null | undefined): Promise<boolean> {
  const text = (value ?? "").toString();
  if (!text || typeof window === "undefined") return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand fallback
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function resolveDesktopPath(value: string | null | undefined, workspaceRoot: string): string | null {
  const target = (value ?? "").trim();
  if (!target) return null;
  if (target.startsWith("/") || /^[a-z]:\\/i.test(target) || target.startsWith("\\\\")) return target;
  if (!workspaceRoot) return target;
  const cleaned = target.replace(/^\.\/+/, "");
  const root = workspaceRoot.replace(/\/+$/, "");
  return `${root}/${cleaned}`;
}

function healthLabel(result: AgentHealthResult | undefined, agent: PersonalLocalAgent) {
  if (result?.status === "running") return t("local_agent.health_running");
  if (result?.status === "passed") return t("local_agent.health_passed", { time: shortDateTime(result.at) });
  if (result?.status === "failed") return t("local_agent.health_failed", { time: shortDateTime(result.at) });
  if (agent.status === "online") return t("local_agent.health_not_tested");
  return agent.errorInfo?.code === "auth_required" ? t("local_agent.health_login_required") : t("local_agent.health_unavailable");
}

function healthTone(result: AgentHealthResult | undefined, agent: PersonalLocalAgent): StatusBadgeTone {
  if (result?.status === "running") return "accent";
  if (result?.status === "passed") return "success";
  if (result?.status === "failed" || agent.status !== "online") return "danger";
  return "neutral";
}

function runHumanSummary(run: PersonalLocalAgentRunResult) {
  const status = runStatusLabel(run.status);
  const provider = run.agentProvider ? PROVIDER_LABELS[run.agentProvider] : t("nav.local_agent");
  if (run.status === "running" && run.pendingApprovals?.length) return t("local_agent.run_summary_waiting_approval", { provider, count: run.pendingApprovals.length });
  if (run.status === "running") return t("local_agent.run_summary_running", { provider, elapsed: elapsedSeconds(run.startedAt, null) });
  if (run.status === "completed") return t("local_agent.run_summary_completed", { provider, elapsed: elapsedSeconds(run.startedAt, run.finishedAt) });
  if (run.status === "failed") return t("local_agent.run_summary_failed", { provider, elapsed: elapsedSeconds(run.startedAt, run.finishedAt) });
  if (run.status === "cancelled") return t("local_agent.run_summary_cancelled", { provider, elapsed: elapsedSeconds(run.startedAt, run.finishedAt) });
  return t("local_agent.run_summary_status", { provider, status });
}

function shouldJoinAssistantChunkTightly(current: string, next: string) {
  if (!current || /^\s/.test(next) || /\s$/.test(current)) return true;
  if (/^[,.;:!?，。！？、；：）)\]}]/.test(next)) return true;
  if (/[（([{]$/.test(current)) return true;
  if (/[\u4e00-\u9fff]$/.test(current) || /^[\u4e00-\u9fff]/.test(next)) return true;
  return false;
}

function runningAssistantTextForRun(run: PersonalLocalAgentRunResult) {
  const chunks = run.events
    .filter((event) => event.type === "assistant_chunk" || event.type === "chunk")
    .map((event) => event.text)
    .filter((text) => text.trim().length > 0);

  if (!chunks.length) return "";

  if (run.agentProvider === "hermes") {
    return chunks.reduce((current, next) => {
      if (!current) return next;
      return shouldJoinAssistantChunkTightly(current, next) ? `${current}${next}` : `${current} ${next}`;
    }, "").trim();
  }

  return chunks.join("\n").trim();
}

function messageTextForRun(
  run: PersonalLocalAgentRunResult,
  fallback: string,
) {
  if (run.conversationMessages?.length) {
    const finalMessage = [...run.conversationMessages].reverse().find((message) => message.type === "finish" && message.text.trim());
    if (finalMessage) return finalMessage.text.trim();
    const latestAssistant = [...run.conversationMessages].reverse().find((message) => message.role === "assistant" && message.text.trim());
    if (latestAssistant) return latestAssistant.text.trim();
  }
  const output = run.output.trim();
  if (output) return output;
  const liveAssistantText = runningAssistantTextForRun(run);
  if (liveAssistantText) {
    if (run.status === "running" && run.pendingApprovals?.length) {
      return `${liveAssistantText}\n\n${t("local_agent.waiting_for_approval")}`;
    }
    return liveAssistantText;
  }
  if (run.status === "running" && run.pendingApprovals?.length) return t("local_agent.waiting_for_approval");
  if (run.status === "running") return t("local_agent.running");
  if (run.status === "completed") return fallback;
  if (run.status === "cancelled") return t("local_agent.cancelled");
  if (run.status === "failed") {
    return run.errorInfo?.message
      ? t("local_agent.failed_with_message", { message: run.errorInfo.message })
      : run.error
        ? t("local_agent.failed_with_message", { message: run.error })
        : t("local_agent.failed");
  }
  return fallback;
}

function classifiedRunFailureMessage(run: PersonalLocalAgentRunResult) {
  const code = run.errorInfo?.code ?? "";
  const message = run.errorInfo?.message || run.error || "";
  if (code === "codex_acp_model_format") return t("local_agent.failure_codex_model_format", { message });
  if (code === "codex_acp_mode_failed") return t("local_agent.failure_codex_mode", { message });
  if (code === "acp_bridge_interrupted" || code === "acp_bridge_interrupted_after_retry") return t("local_agent.failure_acp_interrupted", { message });
  if (code === "acp_tool_failed") return t("local_agent.failure_acp_tool", { message });
  if (code === "sandbox_or_network_refusal") return t("local_agent.failure_sandbox_network", { message });
  if (message) return message;
  return t("local_agent.failed");
}

function placeholderRunFromProcess(process: PersonalLocalAgentProcessRecord): PersonalLocalAgentRunResult | null {
  const runId = process.runId.trim();
  const provider = (process.provider ?? process.backend ?? "").trim() as PersonalLocalAgentProvider;
  if (!runId || !provider) return null;
  return {
    ok: false,
    runId,
    agentId: provider,
    agentProvider: provider,
    connectionMode: process.agentType === "acp" ? `${PROVIDER_LABELS[provider] ?? provider} ACP session` : process.agentType,
    status: "running",
    startedAt: process.startedAt,
    finishedAt: null,
    pid: process.pid,
    command: process.command ?? "",
    output: "",
    error: null,
    errorInfo: null,
    events: [{ type: "status", text: "后台运行状态已从主进程恢复。", at: process.updatedAt }],
    logPath: null,
    workdir: null,
    conversationId: process.conversationId,
    debugSummary: null,
    providerSessionId: null,
    resumeKey: null,
    metadata: null,
    approvalMode: null,
    pendingApprovals: [],
    artifacts: [],
  };
}

function runDebugBundle(run: PersonalLocalAgentRunResult, ctx?: {
  agent?: PersonalLocalAgent | null;
  selectedModel?: string;
}) {
  const agent = ctx?.agent ?? null;
  const capability = agent?.capability ?? null;
  const stderrTail = run.events
    .filter((event) => event.type === "log" && /^stderr>/.test(event.text))
    .slice(-20)
    .map((event) => `${new Date(event.at).toISOString()} ${event.text}`);
  const artifactsBlock = run.artifacts?.length
    ? ["Artifacts:", ...run.artifacts.map((entry) => `- ${entry.path}${entry.exists === false ? " (missing)" : ""} [${entry.source}]`)]
    : [];
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent || "";
  return [
    `Run ID: ${run.runId}`,
    `Provider: ${run.agentProvider ?? "unknown"}`,
    `Status: ${run.status}`,
    `Connection: ${run.connectionMode ?? "--"}`,
    `Approval mode: ${run.approvalMode ?? "--"}`,
    `Provider session ID: ${run.providerSessionId ?? "--"}`,
    `Resume key: ${run.resumeKey ?? "--"}`,
    `Workdir: ${run.workdir ?? "--"}`,
    `PID: ${run.pid ?? "--"}`,
    `Log path: ${run.logPath ?? "--"}`,
    `Started at: ${run.startedAt ? new Date(run.startedAt).toISOString() : "--"}`,
    `Finished at: ${run.finishedAt ? new Date(run.finishedAt).toISOString() : "--"}`,
    agent ? `Selected model / target: ${ctx?.selectedModel || agent.model || agent.defaultModel || t("local_agent.local_default")}` : null,
    agent ? `Agent version: ${agent.version || "--"}` : null,
    agent ? `Executable: ${agent.executablePath || "--"}` : null,
    capability ? `Capability: streaming=${capability.supportsStreaming} resume=${capability.supportsResume} approve=${capability.supportsPermissionAutoApprove} target=${capability.targetKind}` : null,
    capability?.warning ? `Capability warning: ${capability.warning}` : null,
    userAgent ? `Runtime UA: ${userAgent}` : null,
    run.errorInfo ? `Error: ${run.errorInfo.code} ${run.errorInfo.message}` : null,
    run.debugSummary ? `Debug:\n${run.debugSummary}` : null,
    stderrTail.length ? ["Stderr tail:", ...stderrTail].join("\n") : null,
    artifactsBlock.length ? artifactsBlock.join("\n") : null,
    "Command:",
    run.command || "--",
    "Events:",
    ...run.events.map((event) => `${new Date(event.at).toISOString()} ${event.type}> ${event.text}`),
  ].filter(Boolean).join("\n");
}

export function PersonalLocalAgentPage(props: PersonalLocalAgentPageProps) {
  const initialPersistedStateRef = useRef<PersistedLocalAgentChatState | null>(null);
  if (initialPersistedStateRef.current === null) {
    initialPersistedStateRef.current = safeReadPersistedChatState(props.workspaceRoot) ?? { version: 1 };
  }
  const initialAgentsRef = useRef<PersonalLocalAgent[] | null>(null);
  if (initialAgentsRef.current === null) {
    initialAgentsRef.current = safeReadCachedAgents(props.workspaceRoot);
  }
  const persistedState = initialPersistedStateRef.current;
  const initialAgents = initialAgentsRef.current;
  const [agents, setAgents] = useState<PersonalLocalAgent[]>(initialAgents);
  const [selectedAgentId, setSelectedAgentId] = useState(persistedState.selectedAgentId || "opencode");
  const [query, setQuery] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [agentListWidth, setAgentListWidth] = useState(LOCAL_AGENT_LIST_DEFAULT_WIDTH);
  const [draftsByAgent, setDraftsByAgent] = useState<Record<string, string>>(persistedState.draftsByAgent ?? {});
  const [refreshing, setRefreshing] = useState(initialAgents.length === 0);
  const [startingByAgent, setStartingByAgent] = useState<Record<string, boolean>>({});
  const [resettingByAgent, setResettingByAgent] = useState<Record<string, boolean>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [errorsByAgent, setErrorsByAgent] = useState<Record<string, string | null>>(persistedState.errorsByAgent ?? {});
  const [activeRunIdByAgent, setActiveRunIdByAgent] = useState<Record<string, string | null>>(
    recoverActiveRunIds(persistedState.messagesByAgent, persistedState.activeRunIdByAgent),
  );
  const [healthResults, setHealthResults] = useState<Record<string, AgentHealthResult>>(persistedState.healthResults ?? {});
  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, ChatMessage[]>>(persistedState.messagesByAgent ?? {});
  const [conversationsByAgent, setConversationsByAgent] = useState<Record<string, PersonalLocalAgentConversation[]>>({});
  const [nativeSessionsByAgent, setNativeSessionsByAgent] = useState<Record<string, PersonalLocalAgentNativeSession[]>>({});
  const [heartbeatJobs, setHeartbeatJobs] = useState<PersonalLocalAgentHeartbeatJob[]>([]);
  const [heartbeatDraft, setHeartbeatDraft] = useState<HeartbeatDraft>({
    title: t("local_agent.heartbeat_default_title"),
    prompt: DEFAULT_HEARTBEAT_PROMPT,
    intervalMinutes: "30",
    conversationId: "",
  });
  const [heartbeatBusy, setHeartbeatBusy] = useState<string | null>(null);
  const [heartbeatError, setHeartbeatError] = useState<string | null>(null);
  const [showScheduledTasks, setShowScheduledTasks] = useState(false);
  const [selectedConversationIdByAgent, setSelectedConversationIdByAgent] = useState<Record<string, string>>(persistedState.selectedConversationIdByAgent ?? {});
  const [loadingConversationsByAgent, setLoadingConversationsByAgent] = useState<Record<string, boolean>>({});
  const [loadingNativeSessionsByAgent, setLoadingNativeSessionsByAgent] = useState<Record<string, boolean>>({});
  const [showNativeSessions, setShowNativeSessions] = useState(false);
  const [approvalMode, setApprovalMode] = useState<PersonalLocalAgentApprovalMode>(() => safeReadApprovalMode(props.workspaceRoot));
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Track whether the user is pinned to the bottom of the transcript. We only
  // auto-scroll on new messages when they already are — otherwise scrolling up
  // to read earlier output yanks them back down on every poll tick.
  const stickToBottomRef = useRef(true);
  const scheduledTasksButtonRef = useRef<HTMLButtonElement | null>(null);
  const scheduledTasksPanelRef = useRef<HTMLDivElement | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  );
  const selectedConversations = selectedAgent ? conversationsByAgent[selectedAgent.id] ?? [] : [];
  const selectedConversationId = selectedAgent ? selectedConversationIdByAgent[selectedAgent.id] ?? selectedConversations[0]?.id ?? null : null;
  const selectedConversation = selectedConversations.find((item) => item.id === selectedConversationId) ?? selectedConversations[0] ?? null;
  const selectedNativeSessions = selectedAgent ? nativeSessionsByAgent[selectedAgent.id] ?? [] : [];
  const selectedHeartbeatJobs = selectedAgent ? heartbeatJobs.filter((job) => job.agent?.id === selectedAgent.id) : [];
  const selectedChatKey = selectedAgent ? localAgentChatKey(selectedAgent.id, selectedConversationId) : "";
  const filteredAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return agents;
    return agents.filter((agent) =>
      `${agent.name} ${agent.executablePath} ${agent.version ?? ""}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [agents, query]);

  const startAgentListResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = agentListWidth;
    const controller = new AbortController();

    const resize = (moveEvent: PointerEvent) => {
      setAgentListWidth(
        Math.min(
          LOCAL_AGENT_LIST_MAX_WIDTH,
          Math.max(
            LOCAL_AGENT_LIST_MIN_WIDTH,
            startWidth + moveEvent.clientX - startX,
          ),
        ),
      );
    };
    const stop = () => controller.abort();

    window.addEventListener("pointermove", resize, {
      signal: controller.signal,
    });
    window.addEventListener("pointerup", stop, {
      once: true,
      signal: controller.signal,
    });
    window.addEventListener("pointercancel", stop, {
      once: true,
      signal: controller.signal,
    });
  }, [agentListWidth]);

  const selectedMessages = useMemo(() => {
    if (!selectedAgent) return [];
    return messagesByAgent[selectedChatKey] ?? messagesByAgent[selectedAgent.id] ?? [welcomeMessageForAgent(selectedAgent)];
  }, [messagesByAgent, selectedAgent, selectedChatKey]);
  const draft = selectedAgent ? draftsByAgent[selectedChatKey] ?? "" : "";
  const activeRunId = selectedAgent ? activeRunIdByAgent[selectedChatKey] ?? null : null;
  const activeRun = useMemo(
    () => selectedMessages.find((message) => message.run?.runId === activeRunId)?.run ?? null,
    [activeRunId, selectedMessages],
  );
  const resetting = Boolean(selectedAgent && resettingByAgent[selectedChatKey]);
  const running = Boolean(activeRun?.status === "running" || (selectedAgent && startingByAgent[selectedChatKey]));
  const selectedModelOptions = selectedAgent?.modelOptions ?? [];
  const loadingSelectedModels = Boolean(selectedAgent && selectedAgent.status === "online" && selectedModelOptions.length === 0);
  const selectedHealth = selectedAgent ? healthResults[selectedAgent.id] ?? DEFAULT_HEALTH_RESULT : DEFAULT_HEALTH_RESULT;
  const selectedError = selectedAgent ? errorsByAgent[selectedAgent.id] ?? null : null;
  const selectedCapability = selectedAgent?.capability ?? null;
  const selectedAgentIconUrl = selectedAgent ? providerIconUrl(selectedAgent.provider) : null;
  const activePendingApprovals = activeRun?.pendingApprovals ?? [];
  const updateDraftForChat = useCallback((chatKey: string, value: string) => {
    setDraftsByAgent((current) => current[chatKey] === value ? current : { ...current, [chatKey]: value });
  }, []);
  const activeRuns = useMemo(() => {
    return Object.entries(activeRunIdByAgent)
      .map(([chatKey, runId]) => {
        if (!runId) return null;
        const agentId = agentIdFromChatKey(chatKey);
        const agent = agents.find((item) => item.id === agentId) ?? null;
        const run = lastRunForAgent(messagesByAgent[chatKey]);
        if (!run || run.runId !== runId || run.status !== "running") return null;
        return { chatKey, agentId, agent, run };
      })
      .filter((item): item is { chatKey: string; agentId: string; agent: PersonalLocalAgent | null; run: PersonalLocalAgentRunResult } => Boolean(item));
  }, [activeRunIdByAgent, agents, messagesByAgent]);

  useEffect(() => {
    let cancelled = false;
    const syncBackgroundProcesses = async () => {
      try {
        const result = await personalLocalAgentAcpProcessesList();
        if (cancelled) return;
        for (const process of result.processes) {
          const run = placeholderRunFromProcess(process);
          if (!run) continue;
          const chatKey = localAgentChatKey(run.agentId, process.conversationId || undefined);
          setActiveRunIdByAgent((current) => current[chatKey] === run.runId ? current : { ...current, [chatKey]: run.runId });
          setMessagesByAgent((current) => {
            const existing = current[chatKey] ?? [];
            if (existing.some((message) => message.run?.runId === run.runId)) return current;
            const agent = agents.find((item) => item.id === run.agentId) ?? null;
            return {
              ...current,
              [chatKey]: [
                ...(existing.length ? existing : agent ? [welcomeMessageForAgent(agent)] : []),
                {
                  id: nowId("assistant"),
                  role: "assistant",
                  text: messageTextForRun(run, t("local_agent.running")),
                  createdAt: Date.now(),
                  run,
                },
              ],
            };
          });
        }
      } catch {
        // Background process sync is best-effort; run polling still owns final status.
      }
    };
    void syncBackgroundProcesses();
    const timer = window.setInterval(() => void syncBackgroundProcesses(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [agents]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(personalAgentApprovalModeKey(props.workspaceRoot), approvalMode);
  }, [approvalMode, props.workspaceRoot]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const healthSnapshot: Record<string, AgentHealthResult> = {};
    for (const [agentId, result] of Object.entries(healthResults)) {
      healthSnapshot[agentId] = result.status === "running"
        ? { ...result, status: "idle", error: null }
        : result;
    }
    const payload: PersistedLocalAgentChatState = {
      version: 1,
      selectedAgentId,
      selectedConversationIdByAgent,
      messagesByAgent: compactMessagesByAgent(messagesByAgent),
      draftsByAgent,
      activeRunIdByAgent,
      healthResults: healthSnapshot,
      errorsByAgent,
    };
    try {
      window.localStorage.setItem(personalAgentChatStateKey(props.workspaceRoot), JSON.stringify(payload));
    } catch {
      // Local history is best-effort; quota errors should not break chat.
    }
  }, [activeRunIdByAgent, draftsByAgent, errorsByAgent, healthResults, messagesByAgent, props.workspaceRoot, selectedAgentId, selectedConversationIdByAgent]);

  const loadConversationsForAgent = useCallback(async (agent: PersonalLocalAgent) => {
    setLoadingConversationsByAgent((current) => ({ ...current, [agent.id]: true }));
    try {
      const result = await personalLocalAgentConversationsList({ workspaceRoot: props.workspaceRoot, agent });
      setConversationsByAgent((current) => ({ ...current, [agent.id]: result.conversations }));
      const nextId = selectedConversationIdByAgent[agent.id] && result.conversations.some((item) => item.id === selectedConversationIdByAgent[agent.id])
        ? selectedConversationIdByAgent[agent.id]
        : result.activeConversationId ?? result.conversations[0]?.id ?? "";
      if (nextId) {
        setSelectedConversationIdByAgent((current) => ({ ...current, [agent.id]: current[agent.id] ?? nextId }));
      }
    } catch (nextError) {
      setErrorsByAgent((current) => ({
        ...current,
        [agent.id]: nextError instanceof Error ? nextError.message : String(nextError),
      }));
    } finally {
      setLoadingConversationsByAgent((current) => ({ ...current, [agent.id]: false }));
    }
  }, [props.workspaceRoot, selectedConversationIdByAgent]);

  useEffect(() => {
    if (!selectedAgent) return;
    if (conversationsByAgent[selectedAgent.id]) return;
    void loadConversationsForAgent(selectedAgent);
  }, [conversationsByAgent, loadConversationsForAgent, selectedAgent]);

  const loadHeartbeats = useCallback(async () => {
    try {
      const result = await personalLocalAgentHeartbeatsList({ workspaceRoot: props.workspaceRoot });
      setHeartbeatJobs(result.jobs);
      setHeartbeatError(null);
    } catch (nextError) {
      setHeartbeatError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [props.workspaceRoot]);

  useEffect(() => {
    void loadHeartbeats();
    const timer = window.setInterval(() => {
      void loadHeartbeats();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [loadHeartbeats]);

  useEffect(() => {
    if (!heartbeatJobs.length) return;
    setMessagesByAgent((current) => {
      let changed = false;
      const next = { ...current };
      for (const job of heartbeatJobs) {
        if (!job.conversationId || !job.agent?.id) continue;
        const key = localAgentChatKey(job.agent.id, job.conversationId);
        const existing = next[key] ?? [{
          id: `welcome-${job.agent.id}`,
          role: "assistant",
          createdAt: Date.now(),
          text: t("local_agent.switched_message", { name: job.agent.name ?? t("nav.local_agent") }),
          run: null,
        }];
        const additions = job.runs
          .filter((run) => isRunFinal(run.status))
          .slice()
          .reverse()
          .map((run) => scheduledRunMessage(job, run))
          .filter((message) => !existing.some((item) => item.id === message.id));
        if (!additions.length) continue;
        next[key] = [...existing, ...additions];
        changed = true;
      }
      return changed ? next : current;
    });
  }, [heartbeatJobs]);

  useEffect(() => {
    for (const job of heartbeatJobs) {
      if (!job.conversationId || !job.agent?.id) continue;
      const key = localAgentChatKey(job.agent.id, job.conversationId);
      const sessionContext = scheduledTaskSessionContext(messagesByAgent[key]);
      if (!sessionContext || sessionContext === (job.sessionContext ?? "")) continue;
      void personalLocalAgentHeartbeatUpdate({
        workspaceRoot: props.workspaceRoot,
        jobId: job.id,
        patch: { sessionContext },
      }).then(() => loadHeartbeats()).catch(() => undefined);
    }
  }, [heartbeatJobs, loadHeartbeats, messagesByAgent, props.workspaceRoot]);

  useEffect(() => {
    if (!showScheduledTasks) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (scheduledTasksButtonRef.current?.contains(target)) return;
      if (scheduledTasksPanelRef.current?.contains(target)) return;
      setShowScheduledTasks(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [showScheduledTasks]);

  useEffect(() => {
    setSelectedModel(chooseInitialModel(selectedAgent));
  }, [selectedAgent]);

  useEffect(() => {
    setHeartbeatDraft((current) => {
      const fallbackId = selectedConversationId ?? "";
      if (!fallbackId) return current.conversationId ? { ...current, conversationId: "" } : current;
      if (!current.conversationId) return { ...current, conversationId: fallbackId };
      if (selectedConversations.some((conversation) => conversation.id === current.conversationId)) return current;
      return { ...current, conversationId: fallbackId };
    });
  }, [selectedConversationId, selectedConversations]);

  // Mirror the latest run's artifacts (urls + files) into the host page so the
  // Browser/Workspace side panels and the global Workspace list pick up local
  // Agent products the same way they pick up expert/assistant artifacts.
  const onOpenTargetsChange = props.onOpenTargetsChange;
  const lastRunForSelected = useMemo(
    () => (selectedAgent ? lastRunForAgent(messagesByAgent[selectedChatKey]) : null),
    [messagesByAgent, selectedAgent, selectedChatKey],
  );
  useEffect(() => {
    if (!onOpenTargetsChange) return;
    if (!selectedAgent) {
      onOpenTargetsChange([]);
      return;
    }
    const targets = collectRunOpenTargets(lastRunForSelected, props.workspaceRoot);
    onOpenTargetsChange(targets);
  }, [lastRunForSelected, onOpenTargetsChange, props.workspaceRoot, selectedAgent]);


  const refreshAgents = useCallback(async () => {
    setRefreshing(true);
    if (selectedAgentId) {
      setErrorsByAgent((current) => ({ ...current, [selectedAgentId]: null }));
    }
    try {
      const result = await personalLocalAgentAcpAgentsList({ workspaceRoot: props.workspaceRoot, includeModels: false });
      const nextAgents = result.agents.map(agentFromAcpMetadata);
      setAgents(nextAgents);
      safeWriteCachedAgents(props.workspaceRoot, nextAgents);
      if (nextAgents.length && !nextAgents.some((agent) => agent.id === selectedAgentId)) {
        setSelectedAgentId(nextAgents[0].id);
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      if (selectedAgentId) {
        setErrorsByAgent((current) => ({ ...current, [selectedAgentId]: message }));
      }
    } finally {
      setRefreshing(false);
    }
  }, [props.workspaceRoot, selectedAgentId]);

  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  useEffect(() => {
    if (!selectedAgent || selectedAgent.status !== "online" || selectedAgent.modelOptions.length > 0) return;
    let cancelled = false;
    void personalLocalAgentValidate(selectedAgent)
      .then((updated) => {
        if (cancelled) return;
        setAgents((current) => current.map((agent) => (agent.id === updated.id ? { ...agent, ...updated } : agent)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedAgent]);

  // Switching agents/conversations should always start pinned to the latest.
  useEffect(() => {
    stickToBottomRef.current = true;
  }, [selectedChatKey]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [selectedAgentId, selectedMessages]);

  const rememberRunResult = useCallback((agentId: string, run: PersonalLocalAgentRunResult) => {
    if (run.status === "running") {
      setHealthResults((current) => ({
        ...current,
        [agentId]: {
          status: "running",
          at: Date.now(),
          runId: run.runId,
          output: run.output,
          error: run.error,
        },
      }));
      return;
    }
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled" || run.status === "missing") {
      setHealthResults((current) => ({
        ...current,
        [agentId]: {
          status: run.status === "completed" ? "passed" : "failed",
          at: run.finishedAt ?? Date.now(),
          runId: run.runId,
          output: run.output,
          error: run.error,
        },
      }));
    }
  }, []);

  useEffect(() => {
    const activeEntries = Object.entries(activeRunIdByAgent).filter(([, runId]) => Boolean(runId));
    if (!activeEntries.length) return;
    const pollRun = (chatKey: string, runId: string) => {
      void personalLocalAgentStatus({ runId, workspaceRoot: props.workspaceRoot })
        .then((snapshot) => {
          const agentId = chatKey.split("::")[0] ?? chatKey;
          if (!snapshot) {
            setActiveRunIdByAgent((current) => ({
              ...current,
              [chatKey]: current[chatKey] === runId ? null : current[chatKey] ?? null,
            }));
            return;
          }
          const fallbackAgent = agents.find((agent) => agent.id === snapshot.agentId) ?? agents.find((agent) => agent.id === agentId) ?? selectedAgent;
          setMessagesByAgent((current) => ({
            ...current,
            [chatKey]: (current[chatKey] ?? (fallbackAgent ? [welcomeMessageForAgent(fallbackAgent)] : [])).map((message) =>
              message.run?.runId === runId
                ? { ...message, text: messageTextForRun(snapshot, message.text), run: snapshot }
                : message,
            ),
          }));
          rememberRunResult(agentId, snapshot);
          if (snapshot.status !== "running") {
            setActiveRunIdByAgent((current) => ({
              ...current,
              [chatKey]: current[chatKey] === runId ? null : current[chatKey] ?? null,
            }));
          }
        })
        .catch((nextError) => {
          const agentId = chatKey.split("::")[0] ?? chatKey;
          setErrorsByAgent((current) => ({
            ...current,
            [agentId]: nextError instanceof Error ? nextError.message : String(nextError),
          }));
        });
    };

    for (const [chatKey, runId] of activeEntries) {
      if (runId) pollRun(chatKey, runId);
    }
    const timer = window.setInterval(() => {
      for (const [chatKey, runId] of activeEntries) {
        if (runId) pollRun(chatKey, runId);
      }
    }, 900);
    return () => window.clearInterval(timer);
  }, [activeRunIdByAgent, agents, rememberRunResult, selectedAgent]);
  const startAgentRun = useCallback(async (prompt: string, options?: { healthCheck?: boolean }) => {
    if (!prompt || !selectedAgent || selectedAgent.status !== "online" || running) return;
    const runAgent = selectedAgent;
    const runConversationId = selectedConversationId;
    const runChatKey = localAgentChatKey(runAgent.id, runConversationId);
    const userMessage: ChatMessage = {
      id: nowId("user"),
      role: "user",
      text: prompt,
      createdAt: Date.now(),
    };
    const assistantMessageId = nowId("assistant");
    if (!options?.healthCheck) {
      setDraftsByAgent((current) => ({ ...current, [runChatKey]: "" }));
    }
    setStartingByAgent((current) => ({ ...current, [runChatKey]: true }));
    setErrorsByAgent((current) => ({ ...current, [runAgent.id]: null }));
    if (options?.healthCheck) {
      setHealthResults((current) => ({
        ...current,
        [runAgent.id]: {
          status: "running",
          at: Date.now(),
          runId: null,
          output: "",
          error: null,
        },
      }));
    }
    if (!options?.healthCheck) {
      setMessagesByAgent((current) => ({
        ...current,
        [runChatKey]: [
          ...(current[runChatKey] ?? [welcomeMessageForAgent(runAgent)]),
          userMessage,
          {
            id: assistantMessageId,
            role: "assistant",
            text: t("local_agent.calling"),
            createdAt: Date.now(),
            run: null,
          },
        ],
      }));
    }
    try {
      const requestedModel = selectedModel || null;
      const started = await personalLocalAgentAcpSend({
        workspaceRoot: props.workspaceRoot,
        prompt,
        approvalMode,
        conversationId: runConversationId,
        agent: {
          ...runAgent,
          model: requestedModel,
        },
      });
      if (selectedModel && typeof window !== "undefined") {
        window.localStorage.setItem(personalAgentModelPrefKey(runAgent.id), selectedModel);
      }
      rememberRunResult(runAgent.id, started);
      if (options?.healthCheck) {
        let snapshot = started;
        for (let attempt = 0; snapshot.status === "running" && attempt < 180; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          snapshot = await personalLocalAgentStatus({ runId: started.runId, workspaceRoot: props.workspaceRoot });
          rememberRunResult(runAgent.id, snapshot);
        }
        return;
      }
      setActiveRunIdByAgent((current) => ({ ...current, [runChatKey]: started.runId }));
      setMessagesByAgent((current) => ({
        ...current,
        [runChatKey]: (current[runChatKey] ?? [welcomeMessageForAgent(runAgent)]).map((message) =>
          message.id === assistantMessageId
            ? { ...message, text: messageTextForRun(started, t("local_agent.running")), run: started }
            : message,
        ),
      }));
      if (started.status !== "running") {
        setActiveRunIdByAgent((current) => ({ ...current, [runChatKey]: null }));
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setErrorsByAgent((current) => ({ ...current, [runAgent.id]: message }));
      if (options?.healthCheck) {
        setHealthResults((current) => ({
          ...current,
          [runAgent.id]: {
            status: "failed",
            at: Date.now(),
            runId: null,
            output: "",
            error: message,
          },
        }));
      }
      if (!options?.healthCheck) {
        setMessagesByAgent((current) => ({
          ...current,
          [runChatKey]: (current[runChatKey] ?? [welcomeMessageForAgent(runAgent)]).map((item) =>
            item.id === assistantMessageId
              ? { ...item, text: t("local_agent.start_failed", { message }) }
              : item,
          ),
        }));
      }
    } finally {
      setStartingByAgent((current) => ({ ...current, [runChatKey]: false }));
    }
  }, [approvalMode, props.workspaceRoot, rememberRunResult, running, selectedAgent, selectedConversationId, selectedModel]);

  const resetAgentChat = useCallback((agent: PersonalLocalAgent) => {
    const welcome = welcomeMessageForAgent(agent);
    const key = localAgentChatKey(agent.id, selectedConversationIdByAgent[agent.id]);
    setMessagesByAgent((current) => ({ ...current, [key]: [welcome] }));
    setDraftsByAgent((current) => ({ ...current, [key]: "" }));
    setActiveRunIdByAgent((current) => ({ ...current, [key]: null }));
    setErrorsByAgent((current) => ({ ...current, [agent.id]: null }));
    setHealthResults((current) => ({
      ...current,
      [agent.id]: DEFAULT_HEALTH_RESULT,
    }));
  }, [selectedConversationIdByAgent]);

  const sendDraft = useCallback(async () => {
    const prompt = selectedAgent ? (draftsByAgent[selectedChatKey] ?? "").trim() : "";
    await startAgentRun(prompt);
  }, [draftsByAgent, selectedAgent, selectedChatKey, startAgentRun]);

  const clearCurrentAgentChat = useCallback(async () => {
    if (!selectedAgent || running) return;
    const agent = selectedAgent;
    setResettingByAgent((current) => ({ ...current, [agent.id]: true }));
    setErrorsByAgent((current) => ({ ...current, [agent.id]: null }));
    try {
      const result = await personalLocalAgentResetConversation({
        workspaceRoot: props.workspaceRoot,
        conversationId: selectedConversationId,
        agent,
      });
      if (!result.ok) {
        throw new Error(result.error || result.errors?.join("\n") || t("local_agent.clear_conversation_failed"));
      }
      resetAgentChat(agent);
    } catch (nextError) {
      setErrorsByAgent((current) => ({
        ...current,
        [agent.id]: nextError instanceof Error ? nextError.message : String(nextError),
      }));
    } finally {
      setResettingByAgent((current) => ({ ...current, [agent.id]: false }));
    }
  }, [props.workspaceRoot, resetAgentChat, running, selectedAgent, selectedConversationId]);

  const createNewConversation = useCallback(async () => {
    if (!selectedAgent || running) return;
    const agent = selectedAgent;
    setLoadingConversationsByAgent((current) => ({ ...current, [agent.id]: true }));
    setErrorsByAgent((current) => ({ ...current, [agent.id]: null }));
    try {
      const result = await personalLocalAgentConversationCreate({ workspaceRoot: props.workspaceRoot, agent });
      setConversationsByAgent((current) => ({
        ...current,
        [agent.id]: [result.conversation, ...(current[agent.id] ?? [])],
      }));
      setSelectedConversationIdByAgent((current) => ({ ...current, [agent.id]: result.conversation.id }));
      const key = localAgentChatKey(agent.id, result.conversation.id);
      setMessagesByAgent((current) => ({ ...current, [key]: [welcomeMessageForAgent(agent)] }));
      setDraftsByAgent((current) => ({ ...current, [key]: "" }));
      setActiveRunIdByAgent((current) => ({ ...current, [key]: null }));
    } catch (nextError) {
      setErrorsByAgent((current) => ({
        ...current,
        [agent.id]: nextError instanceof Error ? nextError.message : String(nextError),
      }));
    } finally {
      setLoadingConversationsByAgent((current) => ({ ...current, [agent.id]: false }));
    }
  }, [props.workspaceRoot, running, selectedAgent]);

  const createHeartbeat = useCallback(async () => {
    if (!selectedAgent || selectedAgent.status !== "online") return;
    const prompt = heartbeatDraft.prompt.trim();
    if (!prompt) {
      setHeartbeatError(t("local_agent.heartbeat_prompt_required"));
      return;
    }
    const intervalMinutes = Math.max(5, Math.floor(Number(heartbeatDraft.intervalMinutes) || 30));
    const conversationId = heartbeatDraft.conversationId || selectedConversationId;
    const sessionContext = conversationId && selectedAgent
      ? scheduledTaskSessionContext(messagesByAgent[localAgentChatKey(selectedAgent.id, conversationId)])
      : "";
    setHeartbeatBusy("create");
    try {
      await personalLocalAgentHeartbeatCreate({
        workspaceRoot: props.workspaceRoot,
        title: heartbeatDraft.title.trim() || t("local_agent.heartbeat_default_title"),
        prompt,
        sessionContext,
        conversationId,
        approvalMode,
        enabled: true,
        schedule: { mode: "interval", intervalMinutes },
        agent: selectedAgent,
      });
      setHeartbeatDraft((current) => ({ ...current, title: t("local_agent.heartbeat_default_title") }));
      await loadHeartbeats();
      setShowScheduledTasks(true);
      setHeartbeatError(null);
    } catch (nextError) {
      setHeartbeatError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setHeartbeatBusy(null);
    }
  }, [approvalMode, heartbeatDraft, loadHeartbeats, messagesByAgent, props.workspaceRoot, selectedAgent, selectedConversationId]);

  const updateHeartbeatEnabled = useCallback(async (job: PersonalLocalAgentHeartbeatJob, enabled: boolean) => {
    setHeartbeatBusy(job.id);
    try {
      const result = await personalLocalAgentHeartbeatUpdate({
        workspaceRoot: props.workspaceRoot,
        jobId: job.id,
        patch: { enabled },
      });
      if (!result.ok) throw new Error(result.error || "heartbeat update failed");
      await loadHeartbeats();
    } catch (nextError) {
      setHeartbeatError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setHeartbeatBusy(null);
    }
  }, [loadHeartbeats, props.workspaceRoot]);

  const runHeartbeatNow = useCallback(async (job: PersonalLocalAgentHeartbeatJob) => {
    setHeartbeatBusy(job.id);
    try {
      const result = await personalLocalAgentHeartbeatRunNow({ workspaceRoot: props.workspaceRoot, jobId: job.id });
      if (!result.ok) throw new Error(result.error || "heartbeat run failed");
      await loadHeartbeats();
    } catch (nextError) {
      setHeartbeatError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setHeartbeatBusy(null);
    }
  }, [loadHeartbeats, props.workspaceRoot]);

  const deleteHeartbeat = useCallback(async (job: PersonalLocalAgentHeartbeatJob) => {
    setHeartbeatBusy(job.id);
    try {
      const result = await personalLocalAgentHeartbeatDelete({ workspaceRoot: props.workspaceRoot, jobId: job.id });
      if (!result.ok) throw new Error(result.error || "heartbeat delete failed");
      await loadHeartbeats();
    } catch (nextError) {
      setHeartbeatError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setHeartbeatBusy(null);
    }
  }, [loadHeartbeats, props.workspaceRoot]);

  const loadNativeSessions = useCallback(async () => {
    if (!selectedAgent) return;
    const agent = selectedAgent;
    setLoadingNativeSessionsByAgent((current) => ({ ...current, [agent.id]: true }));
    setErrorsByAgent((current) => ({ ...current, [agent.id]: null }));
    try {
      const result = await personalLocalAgentNativeSessionsList({ workspaceRoot: props.workspaceRoot, agent, limit: 50 });
      setNativeSessionsByAgent((current) => ({ ...current, [agent.id]: result.sessions }));
      if (result.error) {
        setErrorsByAgent((current) => ({ ...current, [agent.id]: result.error ?? null }));
      }
    } catch (nextError) {
      setErrorsByAgent((current) => ({
        ...current,
        [agent.id]: nextError instanceof Error ? nextError.message : String(nextError),
      }));
    } finally {
      setLoadingNativeSessionsByAgent((current) => ({ ...current, [agent.id]: false }));
    }
  }, [props.workspaceRoot, selectedAgent]);

  useEffect(() => {
    if (!showNativeSessions || !selectedAgent) return;
    if (Object.prototype.hasOwnProperty.call(nativeSessionsByAgent, selectedAgent.id)) return;
    if (loadingNativeSessionsByAgent[selectedAgent.id]) return;
    void loadNativeSessions();
  }, [loadNativeSessions, loadingNativeSessionsByAgent, nativeSessionsByAgent, selectedAgent, showNativeSessions]);

  const loadConversationTranscript = useCallback(async (agent: PersonalLocalAgent, conversation: PersonalLocalAgentConversation) => {
    const key = localAgentChatKey(agent.id, conversation.id);
    const sessionId = conversation.resumeKey || conversation.providerSessionId;
    if (!sessionId) {
      setMessagesByAgent((current) => current[key] ? current : { ...current, [key]: [welcomeMessageForAgent(agent)] });
      return;
    }
    try {
      const result = await personalLocalAgentConversationTranscript({
        workspaceRoot: props.workspaceRoot,
        conversationId: conversation.id,
        providerSessionId: conversation.providerSessionId,
        resumeKey: conversation.resumeKey,
        agent,
        limit: 80,
      });
      setMessagesByAgent((current) => ({
        ...current,
        [key]: result.messages.length
          ? transcriptMessagesForAgent(agent, result.messages)
          : isUnsupportedNativeTranscriptError(result.error)
            ? [nativeSessionResumeOnlyMessage(agent, conversation)]
            : current[key] ?? [welcomeMessageForAgent(agent)],
      }));
      if (result.error && !isUnsupportedNativeTranscriptError(result.error)) {
        setErrorsByAgent((current) => ({ ...current, [agent.id]: result.error ?? null }));
      }
    } catch (nextError) {
      setErrorsByAgent((current) => ({
        ...current,
        [agent.id]: nextError instanceof Error ? nextError.message : String(nextError),
      }));
    }
  }, [props.workspaceRoot]);

  useEffect(() => {
    if (!selectedAgent || !selectedConversation) return;
    const key = localAgentChatKey(selectedAgent.id, selectedConversation.id);
    if (messagesByAgent[key]?.length) return;
    void loadConversationTranscript(selectedAgent, selectedConversation);
  }, [loadConversationTranscript, messagesByAgent, selectedAgent, selectedConversation]);

  const importNativeSession = useCallback(async (session: PersonalLocalAgentNativeSession) => {
    if (!selectedAgent || running) return;
    const agent = selectedAgent;
    setLoadingConversationsByAgent((current) => ({ ...current, [agent.id]: true }));
    setErrorsByAgent((current) => ({ ...current, [agent.id]: null }));
    try {
      const result = await personalLocalAgentConversationCreate({
        workspaceRoot: props.workspaceRoot,
        agent,
        title: session.title,
        providerSessionId: session.providerSessionId,
        resumeKey: session.resumeKey,
        workdir: session.workdir,
        source: session.source,
        metadata: session.metadata ?? null,
      });
      setConversationsByAgent((current) => ({
        ...current,
        [agent.id]: [result.conversation, ...(current[agent.id] ?? [])],
      }));
      setSelectedConversationIdByAgent((current) => ({ ...current, [agent.id]: result.conversation.id }));
      await loadConversationTranscript(agent, result.conversation);
      setShowNativeSessions(false);
    } catch (nextError) {
      setErrorsByAgent((current) => ({
        ...current,
        [agent.id]: nextError instanceof Error ? nextError.message : String(nextError),
      }));
    } finally {
      setLoadingConversationsByAgent((current) => ({ ...current, [agent.id]: false }));
    }
  }, [loadConversationTranscript, props.workspaceRoot, running, selectedAgent]);

  const runHealthCheck = useCallback(async () => {
    await startAgentRun(selectedAgent?.capability?.smokePrompt ?? HEALTH_CHECK_PROMPT, { healthCheck: true });
  }, [selectedAgent, startAgentRun]);

  const cancelAgentRun = useCallback(async (runId: string, chatKey: string) => {
    if (!runId || !chatKey) return;
    const agentId = chatKey.split("::")[0] ?? chatKey;
    const runAgent = agents.find((agent) => agent.id === agentId) ?? null;
    setErrorsByAgent((current) => ({ ...current, [agentId]: null }));
    try {
      const result = await personalLocalAgentAcpCancel(runId);
      if (!result.ok) {
        setErrorsByAgent((current) => ({ ...current, [agentId]: result.error ?? t("local_agent.cancel_failed") }));
      }
      const snapshot = await personalLocalAgentStatus({ runId, workspaceRoot: props.workspaceRoot });
      setMessagesByAgent((current) => ({
        ...current,
        [chatKey]: (current[chatKey] ?? (runAgent ? [welcomeMessageForAgent(runAgent)] : [])).map((message) =>
          message.run?.runId === runId
            ? { ...message, text: messageTextForRun(snapshot, message.text), run: snapshot }
            : message,
        ),
      }));
      setActiveRunIdByAgent((current) => ({ ...current, [chatKey]: null }));
      rememberRunResult(agentId, snapshot);
    } catch (nextError) {
      setErrorsByAgent((current) => ({
        ...current,
        [agentId]: nextError instanceof Error ? nextError.message : String(nextError),
      }));
    }
  }, [agents, props.workspaceRoot, rememberRunResult]);

  const cancelRun = useCallback(async () => {
    if (!activeRunId || !selectedAgent) return;
    await cancelAgentRun(activeRunId, selectedChatKey);
  }, [activeRunId, cancelAgentRun, selectedAgent, selectedChatKey]);

  const resolveApproval = useCallback(async (approval: PersonalLocalAgentApprovalRequest, decision: PersonalLocalAgentApprovalDecision) => {
    try {
      const result = await personalLocalAgentAcpResolveApproval({
        runId: approval.runId,
        approvalId: approval.id,
        decision,
      });
      if (!result.ok) throw new Error(result.error || t("local_agent.approval_failed"));
      const snapshot = await personalLocalAgentStatus({ runId: approval.runId, workspaceRoot: props.workspaceRoot });
      setMessagesByAgent((current) => ({
        ...current,
        [selectedChatKey]: (current[selectedChatKey] ?? []).map((message) =>
          message.run?.runId === approval.runId
            ? { ...message, text: messageTextForRun(snapshot, message.text), run: snapshot }
            : message,
        ),
      }));
      rememberRunResult(snapshot.agentId, snapshot);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setErrorsByAgent((current) => ({ ...current, [selectedAgentId]: message }));
    }
  }, [props.workspaceRoot, rememberRunResult, selectedAgentId, selectedChatKey]);

  return (
    <div data-onmyagent-view="personal-assistant" className="relative flex h-full min-h-0 overflow-hidden bg-dls-surface text-dls-text">
      <aside
        className="flex shrink-0 flex-col overflow-hidden bg-dls-background pb-5"
        style={{ width: agentListWidth }}
      >
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-dls-border/70 px-4">
          <InputGroup controlSize="sm" radius="md" tone="surfaceMuted" className="flex-1">
            <InputGroupAddon align="inline-start" inset="tight">
              <Search className="size-4.5" />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("local_agent.search")}
              className="text-sm placeholder:text-dls-secondary/75"
            />
          </InputGroup>
          <Button
            type="button"
            size="icon-sm"
            onClick={() => setShowAddForm((value) => !value)}
            className="relative shrink-0 rounded-md border border-dls-border bg-dls-surface-muted text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
            title={t("local_agent.add")}
            aria-label={t("local_agent.add")}
          >
            <Bot className="size-4.5" />
            <Plus className="absolute right-1.5 top-1.5 size-2.5" strokeWidth={3} />
          </Button>
        </div>

        {showAddForm ? (
          <div className="mx-4 mt-3 rounded-lg border border-dls-border bg-dls-surface-muted p-3">
            <div className={localAgentTextClass.panelTitle}>{t("local_agent.add")}</div>
            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => void refreshAgents()} disabled={refreshing}>
              <RefreshCw className={cn(localAgentLayoutClass.refreshIcon, refreshing && "animate-spin")} />{t("local_agent.redetect")}
            </Button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredAgents.length > 0 ? (
            <div>
              {filteredAgents.map((agent) => {
                const agentActiveRunKey = Object.entries(activeRunIdByAgent).find(([chatKey, runId]) => Boolean(runId) && agentIdFromChatKey(chatKey) === agent.id)?.[0] ?? null;
                const lastRun = agentActiveRunKey
                  ? lastRunForAgent(messagesByAgent[agentActiveRunKey])
                  : lastRunForAgent(messagesByAgent[agent.id]);
                const iconUrl = providerIconUrl(agent.provider);
                const hasActiveRun = Boolean(
                  agentActiveRunKey && lastRun && lastRun.runId === activeRunIdByAgent[agentActiveRunKey] && lastRun.status === "running",
                );
                return (
                  <SessionRowButton
                    key={agent.id}
                    type="button"
                    onClick={() => setSelectedAgentId(agent.id)}
                    active={selectedAgentId === agent.id}
                    className={localAgentLayoutClass.agentRow}
                  >
                    <div className="relative shrink-0">
                      <div
                        className={cn(
                          localAgentLayoutClass.agentAvatar,
                          selectedAgentId === agent.id
                            ? localAgentLayoutClass.agentAvatarSelected
                            : localAgentLayoutClass.agentAvatarDefault,
                        )}
                      >
                        {iconUrl ? (
                          <img src={iconUrl} alt="" className="size-7 object-contain" loading="lazy" draggable={false} />
                        ) : (
                          <Bot className="size-5" />
                        )}
                      </div>
                      <span className={cn(localAgentLayoutClass.agentStatusDot, selectedAgentId === agent.id ? "border-dls-list-selected" : "border-dls-surface", agent.status === "online" ? "bg-dls-online" : "bg-dls-secondary")} />
                      {hasActiveRun ? (
                        <StatusPing
                          inset
                          size="md"
                          className="absolute -right-0.5 -top-0.5 items-center justify-center"
                          title={t("local_agent.background_run_title")}
                          aria-label={t("local_agent.background_run_aria")}
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <div className={localAgentTextClass.rowTitle}>{agent.name}</div>
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5">
                        <div className="min-w-0 flex-1 truncate text-xs leading-5 text-dls-secondary">{agent.status === "online" ? agentSubtitle(agent) : agent.error || t("local_agent.check_install_or_login")}</div>
                        {hasActiveRun ? <StatusDot size="md" tone="active" /> : null}
                      </div>
                    </div>
                  </SessionRowButton>
                );
              })}
            </div>
          ) : refreshing ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm leading-5 text-dls-secondary">
              <Loader2 className="size-5 animate-spin text-dls-accent" />
              <div>
                {t("local_agent.detecting")}
                <div className="mt-1 text-xs text-dls-secondary/75">{t("local_agent.detecting_desc")}</div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-sm leading-5 text-dls-secondary">
              {t("local_agent.empty")}
            </div>
          )}
        </div>
      </aside>

      <div
        role="separator"
        aria-label={t("session.resize_agent_list")}
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={startAgentListResize}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            setAgentListWidth((width) =>
              Math.min(
                LOCAL_AGENT_LIST_MAX_WIDTH,
                Math.max(
                  LOCAL_AGENT_LIST_MIN_WIDTH,
                  width + (event.key === "ArrowLeft" ? -16 : 16),
                ),
              ),
            );
          }
        }}
        className="group absolute inset-y-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none"
        style={{ left: agentListWidth }}
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-dls-border transition-colors group-hover:bg-dls-border-strong group-focus-visible:bg-dls-accent" />
      </div>

      <main className="flex min-w-0 flex-1 flex-col bg-dls-surface">
        <header className={localAgentLayoutClass.header}>
          <div className="flex min-h-16 items-center justify-between gap-4 px-6 py-3 mac:titlebar-no-drag">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dls-border bg-dls-surface-muted text-dls-accent">
                {selectedAgentIconUrl ? (
                  <img src={selectedAgentIconUrl} alt="" className="size-6 object-contain" loading="lazy" draggable={false} />
                ) : (
                  <UserRound className="size-4.5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className={localAgentTextClass.pageTitle}>{t("nav.local_agent")}</div>
                  {selectedAgent ? <StatusBadge tone={healthTone(selectedHealth, selectedAgent)}>{healthLabel(selectedHealth, selectedAgent)}</StatusBadge> : null}
                  {selectedAgent ? <StatusBadge tone="surface">{agentMemoryProfile(selectedAgent).mode}</StatusBadge> : null}
                </div>
                <div className="mt-0.5 truncate text-xs text-dls-secondary">
                  {selectedAgent ? t("local_agent.using_workspace", { name: selectedAgent.name, workspace: props.workspaceName || props.workspaceRoot }) : t("local_agent.select_agent")}
                </div>
                {selectedAgent ? (
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-dls-secondary">
                    <StatusBadge tone="surface">{selectedCapability?.supportsStreaming ? t("local_agent.streaming") : t("local_agent.non_streaming")}</StatusBadge>
                    <StatusBadge tone="surface">{t("local_agent.resume_chip", { status: selectedCapability?.supportsResume ? t("local_agent.available") : t("common.off") })}</StatusBadge>
                    <StatusBadge className="max-w-[360px] truncate" tone="surface">{t("local_agent.context_isolated")}</StatusBadge>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              <Button variant="outline" size="sm" className="whitespace-nowrap" onClick={() => void refreshAgents()} disabled={refreshing}>
                <RefreshCw className={cn(localAgentLayoutClass.refreshIcon, refreshing && "animate-spin")} />{t("common.refresh")}
              </Button>
              <Button variant="outline" size="sm" className="whitespace-nowrap" onClick={clearCurrentAgentChat} disabled={!selectedAgent || running || resetting} title={t("local_agent.clear_chat_title")}>
                {resetting ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Trash2 className="mr-1.5 size-3.5" />}{t("local_agent.clear_chat")}
              </Button>
              <Button variant="outline" size="sm" className="whitespace-nowrap" onClick={() => void runHealthCheck()} disabled={!selectedAgent || selectedAgent.status !== "online" || running}>
                {selectedHealth.status === "running" ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <KeyRound className="mr-1.5 size-3.5" />}{t("local_agent.health_check")}
              </Button>
              <Button ref={scheduledTasksButtonRef} variant="outline" size="sm" className="whitespace-nowrap" onClick={() => setShowScheduledTasks((open) => !open)} disabled={!selectedAgent} data-testid="local-agent-scheduled-tasks-button" aria-expanded={showScheduledTasks}>
                <Clock3 className="mr-1.5 size-3.5" />{t("local_agent.heartbeat_title")}
                {selectedHeartbeatJobs.length ? <CountBadge size="dot" className="ml-1 bg-dls-accent/10 text-dls-accent">{selectedHeartbeatJobs.length}</CountBadge> : null}
              </Button>
              {props.headerActions ? <div className="ml-1 flex items-center border-l border-dls-border pl-2">{props.headerActions}</div> : null}
            </div>
          </div>
          <div className="flex min-h-12 flex-wrap items-center gap-2 border-t border-dls-border/70 bg-dls-surface-muted/35 px-6 py-2 mac:titlebar-no-drag">
            <label className="flex min-w-[220px] flex-[1_1_280px] items-center gap-2 text-xs text-dls-secondary">
              <span className="shrink-0 whitespace-nowrap">{t("local_agent.conversation")}</span>
              <div className="min-w-0 flex-1">
                <SelectMenu
                  size="compact"
                  ariaLabel={t("local_agent.conversation")}
                  options={selectedConversations.length ? selectedConversations.map((conversation) => ({ value: conversation.id, label: conversationTitle(conversation) })) : [{ value: "", label: t("local_agent.loading_conversations") }]}
                  value={selectedConversationId ?? ""}
                  onChange={(value) => {
                    if (!selectedAgent || !value) return;
                    setSelectedConversationIdByAgent((current) => ({ ...current, [selectedAgent.id]: value }));
                  }}
                  disabled={!selectedAgent || running || Boolean(selectedAgent && loadingConversationsByAgent[selectedAgent.id])}
                />
              </div>
              <Button variant="outline" size="icon-sm" onClick={() => void createNewConversation()} disabled={!selectedAgent || running || Boolean(selectedAgent && loadingConversationsByAgent[selectedAgent.id])} title={t("local_agent.new_conversation")} aria-label={t("local_agent.new_conversation")}>
                {selectedAgent && loadingConversationsByAgent[selectedAgent.id] ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              </Button>
            </label>
            <div className="flex min-w-[240px] flex-[1_1_320px] items-center gap-1.5">
              <SelectMenu
                size="compact"
                ariaLabel={t("local_agent.native_sessions")}
                placeholder={selectedAgent && loadingNativeSessionsByAgent[selectedAgent.id] ? t("local_agent.loading_native_sessions") : t("local_agent.native_sessions")}
                options={selectedNativeSessions.length ? selectedNativeSessions.map((session) => ({ value: `${session.source}:${session.id}`, label: `${session.title} · ${shortTime(session.updatedAt)} · ${session.source}` })) : [{ value: "__empty", label: selectedAgent && loadingNativeSessionsByAgent[selectedAgent.id] ? t("local_agent.loading_native_sessions") : t("local_agent.no_native_sessions") }]}
                value=""
                onOpen={() => {
                  setShowNativeSessions(true);
                  void loadNativeSessions();
                }}
                onChange={(value) => {
                  if (value === "__empty") return;
                  const session = selectedNativeSessions.find((item) => `${item.source}:${item.id}` === value);
                  if (!session) return;
                  void importNativeSession(session);
                }}
                disabled={!selectedAgent || running}
              />
              {showNativeSessions ? (
                <Button variant="outline" size="icon-sm" onClick={() => void loadNativeSessions()} disabled={!selectedAgent || loadingNativeSessionsByAgent[selectedAgent.id]} title={t("common.refresh")} aria-label={t("common.refresh")}>
                  <RefreshCw className={cn("size-3.5", selectedAgent && loadingNativeSessionsByAgent[selectedAgent.id] && "animate-spin")} />
                </Button>
              ) : null}
            </div>
            <label className="flex min-w-[220px] flex-[1_1_280px] items-center gap-2 text-xs text-dls-secondary">
              <span className="shrink-0 whitespace-nowrap">{modelSelectorLabel(selectedAgent)}</span>
              <div className="min-w-0 flex-1">
                <SelectMenu
                  size="compact"
                  ariaLabel={modelSelectorLabel(selectedAgent)}
                  options={[{ value: "", label: t("local_agent.use_default_config") }, ...(loadingSelectedModels ? [{ value: "__loading", label: t("local_agent.loading_models") }] : []), ...selectedModelOptions.map((option) => ({ value: option.id, label: option.label }))]}
                  value={selectedModel}
                  onChange={(value) => {
                    if (value === "__loading") return;
                    setSelectedModel(value);
                  }}
                  disabled={!selectedAgent || running}
                />
              </div>
            </label>
          </div>
          {showScheduledTasks && selectedAgent ? (
            <div ref={scheduledTasksPanelRef} className={heartbeatClass.overlay} data-testid="local-agent-scheduled-tasks-panel">
              <HeartbeatPanel
                agent={selectedAgent}
                jobs={selectedHeartbeatJobs}
                draft={heartbeatDraft}
                conversations={selectedConversations}
                conversation={selectedConversation}
                busyId={heartbeatBusy}
                error={heartbeatError}
                onDraftChange={setHeartbeatDraft}
                onCreate={() => void createHeartbeat()}
                onRefresh={() => void loadHeartbeats()}
                onRunNow={(job) => void runHeartbeatNow(job)}
                onToggleEnabled={(job, enabled) => void updateHeartbeatEnabled(job, enabled)}
                onDelete={(job) => void deleteHeartbeat(job)}
                onClose={() => setShowScheduledTasks(false)}
              />
            </div>
          ) : null}
        </header>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-6"
          onScroll={(event) => {
            const el = event.currentTarget;
            // Pin to bottom only when the user is within a small threshold of
            // the end; once they scroll up, stop force-scrolling on new output.
            const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            stickToBottomRef.current = distanceFromBottom <= 80;
          }}
        >
          <div className={localAgentLayoutClass.pageContent}>
            {activeRuns.length ? (
              <ActiveRunsOverview
                activeRuns={activeRuns}
                selectedChatKey={selectedChatKey}
                onSelectAgent={(chatKey) => {
                  const [agentId, conversationId] = chatKey.split("::");
                  if (agentId) setSelectedAgentId(agentId);
                  if (agentId && conversationId) {
                    setSelectedConversationIdByAgent((current) => ({ ...current, [agentId]: conversationId }));
                  }
                }}
                onCancelRun={(runId, chatKey) => void cancelAgentRun(runId, chatKey)}
              />
            ) : null}
            {selectedMessages.map((message) => (
              <ChatBubble
                key={message.id}
                message={message}
                workspaceRoot={props.workspaceRoot}
                agent={selectedAgent}
                selectedModel={selectedModel}
                onOpenArtifact={props.onOpenArtifact}
                onResolveApproval={resolveApproval}
              />
            ))}
            {selectedError ? <NoticeBox tone="error">{selectedError}</NoticeBox> : null}
          </div>
        </div>

        <footer className="shrink-0 bg-dls-surface px-6 py-4">
          <div className={localAgentLayoutClass.chatPanel}>
            <LocalAgentDraftComposer
              draftKey={selectedChatKey}
              initialDraft={draft}
              disabled={!selectedAgent || selectedAgent.status !== "online"}
              submitting={running}
              placeholder={selectedAgent?.status === "online" ? t("local_agent.input_placeholder") : t("local_agent.input_placeholder_unavailable")}
              onDraftCommit={updateDraftForChat}
              onSubmit={(value) => {
                updateDraftForChat(selectedChatKey, value);
                void startAgentRun(value.trim());
              }}
            />
            <div className="flex items-center justify-between gap-3 px-2 pb-1">
              <div className="truncate text-xs text-dls-secondary">
                  {activePendingApprovals.length
                    ? t("local_agent.pending_approvals", { count: activePendingApprovals.length })
                    : activeRun?.status === "running"
                      ? t("local_agent.running_run", { runId: activeRun.runId })
                      : t("local_agent.chat_calls_selected")}
                </div>
                <div className="flex items-center gap-2">
                <label
                  className="flex items-center gap-1.5 text-xs text-dls-secondary"
                  title={
                    selectedCapability && selectedCapability.supportsApproval === false
                      ? t("local_agent.approval_not_supported")
                      : APPROVAL_MODE_OPTIONS.find((option) => option.id === approvalMode)?.description
                  }
                >
                  <span className="shrink-0">{t("local_agent.approval_policy")}</span>
                  <div className="min-w-[140px]">
                    <SelectMenu
                      size="compact"
                      value={approvalMode}
                      onChange={(value) => setApprovalMode(value as PersonalLocalAgentApprovalMode)}
                      disabled={running || (selectedCapability ? selectedCapability.supportsApproval === false : false)}
                      ariaLabel={t("local_agent.approval_aria")}
                      placement="top"
                      options={APPROVAL_MODE_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
                    />
                  </div>
                  {selectedCapability && selectedCapability.supportsApproval === false ? (
                    <StatusBadge size="tiny" tone="accent">{t("local_agent.cli_native_policy")}</StatusBadge>
                  ) : null}
                </label>
                  {activeRun?.status === "running" ? (
                    <Button variant="outline" size="sm" onClick={() => void cancelRun()}>
                    <CircleStop className="mr-1.5 size-3.5" />{t("composer.stop")}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

function ActiveRunsOverview(props: {
  activeRuns: Array<{ chatKey: string; agentId: string; agent: PersonalLocalAgent | null; run: PersonalLocalAgentRunResult }>;
  selectedChatKey: string | null;
  onSelectAgent: (chatKey: string) => void;
  onCancelRun?: (runId: string, chatKey: string) => void;
}) {
  return (
    <section className={activeRunClass.overview}>
      <div className={localAgentTextClass.runSectionTitle}>
        <Activity className="size-4" />{t("local_agent.active_runs")}
        <CountBadge size="dot" className="bg-dls-accent/10 text-dls-accent">{props.activeRuns.length}</CountBadge>
      </div>
      <div className="grid gap-2">
        {props.activeRuns.map(({ chatKey, agentId, agent, run }) => {
          const isSelected = props.selectedChatKey === chatKey;
          return (
            <div
              key={run.runId}
              className={cn(
                activeRunClass.item,
                isSelected ? activeRunClass.itemSelected : activeRunClass.itemDefault,
              )}
            >
              <ActionRowButton
                type="button"
                onClick={() => props.onSelectAgent(chatKey)}
                density="compact"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left hover:bg-transparent"
                title={isSelected ? t("local_agent.current_agent_running") : t("local_agent.switch_to_agent_detail")}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={localAgentTextClass.runItemTitle}>
                    <StatusPing />
                    <span className="truncate">{agent?.name ?? agentId}</span>
                  </span>
                  <span className={activeRunClass.runId}>Run {run.runId}</span>
                </div>
                <div className={activeRunClass.meta}>
                  <span>{run.pendingApprovals?.length ? t("local_agent.waiting_approval_count", { count: run.pendingApprovals.length }) : t("local_agent.elapsed", { value: elapsedSeconds(run.startedAt, null) })}</span>
                  <span>{t("local_agent.latest_event", { time: shortTime(lastEventTime(run)) })}</span>
                  <span>{t("local_agent.connection", { value: run.connectionMode || "--" })}</span>
                </div>
              </ActionRowButton>
              {props.onCancelRun ? (
                <Button
                  variant="outline"
                  size="sm"
                  className={activeRunClass.cancel}
                  onClick={() => props.onCancelRun?.(run.runId, chatKey)}
                  title={t("local_agent.stop_run")}
                >
                  <CircleStop className="mr-1 size-3.5" />{t("composer.stop")}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const LocalAgentDraftComposer = memo(function LocalAgentDraftComposer(props: {
  draftKey: string;
  initialDraft: string;
  disabled: boolean;
  submitting: boolean;
  placeholder: string;
  onDraftCommit: (draftKey: string, value: string) => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(props.initialDraft);

  useEffect(() => {
    setValue(props.initialDraft);
  }, [props.draftKey, props.initialDraft]);

  useEffect(() => {
    const timer = window.setTimeout(() => props.onDraftCommit(props.draftKey, value), 350);
    return () => window.clearTimeout(timer);
  }, [props.draftKey, props.onDraftCommit, value]);

  const submit = useCallback(() => {
    props.onDraftCommit(props.draftKey, value);
    props.onSubmit(value);
  }, [props, value]);

  return (
    <div className="contents" data-local-agent-composer-root="true">
      <Textarea
        rows={3}
        className="min-h-20 resize-none border-0 bg-transparent focus-visible:ring-0"
        aria-label={t("local_agent.input_aria")}
        data-local-agent-composer="true"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={props.placeholder}
        disabled={props.disabled || props.submitting}
      />
      <SendButton
        aria-label={t("local_agent.send_aria")}
        onClick={submit}
        disabled={!value.trim() || props.disabled || props.submitting}
        loading={props.submitting}
      />
    </div>
  );
});
LocalAgentDraftComposer.displayName = "LocalAgentDraftComposer";

const ChatBubble = memo(function ChatBubble(props: {
  message: ChatMessage;
  workspaceRoot: string;
  agent?: PersonalLocalAgent | null;
  selectedModel?: string;
  onOpenArtifact?: (target: OpenTarget) => Promise<void> | void;
  onResolveApproval?: (approval: PersonalLocalAgentApprovalRequest, decision: PersonalLocalAgentApprovalDecision) => void;
}) {
  const isUser = props.message.role === "user";
  const run = props.message.run;
  const runWorkdir = run?.workdir ?? null;
  const showRunDiagnostics = isRunFinal(run?.status);
  const [actionFeedback, setActionFeedback] = useState<{ id: string; tone: "ok" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (!actionFeedback) return;
    const timer = window.setTimeout(() => setActionFeedback(null), 2200);
    return () => window.clearTimeout(timer);
  }, [actionFeedback]);
  const showFeedback = useCallback((id: string, tone: "ok" | "error", text: string) => {
    setActionFeedback({ id, tone, text });
  }, []);
  const handleCopy = useCallback(async (id: string, value: string | null | undefined, label: string) => {
    const ok = await writeTextToClipboard(value);
    showFeedback(id, ok ? "ok" : "error", ok ? t("local_agent.copy_success", { label }) : t("local_agent.copy_failed", { label }));
  }, [showFeedback]);
  const handleOnMyAgentdir = useCallback(async () => {
    const target = resolveDesktopPath(runWorkdir, props.workspaceRoot);
    if (!target) {
      showFeedback("workdir", "error", t("local_agent.unknown_workdir"));
      return;
    }
    try {
      await openDesktopPath(target);
      showFeedback("workdir", "ok", t("local_agent.workdir_opened"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showFeedback("workdir", "error", t("local_agent.open_failed", { message }));
    }
  }, [props.workspaceRoot, runWorkdir, showFeedback]);
  const handleRevealLog = useCallback(async () => {
    const target = resolveDesktopPath(run?.logPath, props.workspaceRoot);
    if (!target) {
      showFeedback("log", "error", t("local_agent.no_log_path"));
      return;
    }
    try {
      await revealDesktopItemInDir(target);
      showFeedback("log", "ok", t("local_agent.log_revealed"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showFeedback("log", "error", t("local_agent.reveal_failed", { message }));
    }
  }, [props.workspaceRoot, run?.logPath, showFeedback]);
  const handleOpenArtifact = useCallback(async (target: OpenTarget) => {
    // Prefer the host's openTarget (used by expert/assistant/session pages).
    // It routes URLs into the in-app Browser tab and files into the
    // Workspace/Artifacts side panel, matching the rest of the product.
    if (props.onOpenArtifact) {
      try {
        await props.onOpenArtifact(target);
        showFeedback(
          `artifact-${target.id}`,
          "ok",
          target.kind === "url" ? t("local_agent.artifact_opened_browser", { name: target.name }) : t("local_agent.artifact_opened", { name: target.name }),
        );
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showFeedback(`artifact-${target.id}`, "error", t("local_agent.open_failed", { message }));
        return;
      }
    }
    if (target.kind === "url") {
      try {
        window.open(target.value, "_blank", "noopener,noreferrer");
        showFeedback(`artifact-${target.id}`, "ok", t("local_agent.artifact_opened_system_browser", { name: target.name }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showFeedback(`artifact-${target.id}`, "error", t("local_agent.open_failed", { message }));
      }
      return;
    }
    const absolute = resolveDesktopPath(target.value, props.workspaceRoot);
    if (!absolute) {
      showFeedback(`artifact-${target.id}`, "error", t("local_agent.unknown_file_path"));
      return;
    }
    try {
      await openDesktopPath(absolute);
      showFeedback(`artifact-${target.id}`, "ok", t("local_agent.opened_name", { name: target.name }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showFeedback(`artifact-${target.id}`, "error", t("local_agent.open_failed", { message }));
    }
  }, [props.onOpenArtifact, props.workspaceRoot, showFeedback]);
  const handleRevealArtifact = useCallback(async (target: OpenTarget) => {
    if (target.kind !== "file") {
      try {
        await navigator.clipboard.writeText(target.value);
        showFeedback(`artifact-${target.id}`, "ok", t("local_agent.link_copied"));
      } catch {
        showFeedback(`artifact-${target.id}`, "error", t("local_agent.copy_failed_short"));
      }
      return;
    }
    const absolute = resolveDesktopPath(target.value, props.workspaceRoot);
    if (!absolute) {
      showFeedback(`artifact-${target.id}`, "error", t("local_agent.unknown_file_path"));
      return;
    }
    try {
      await revealDesktopItemInDir(absolute);
      showFeedback(`artifact-${target.id}`, "ok", t("local_agent.revealed_name", { name: target.name }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showFeedback(`artifact-${target.id}`, "error", t("local_agent.reveal_failed", { message }));
    }
  }, [props.workspaceRoot, showFeedback]);
  const artifactTargets = useMemo(
    () => collectRunOpenTargets(run, props.workspaceRoot, props.message.text),
    [props.message.text, props.workspaceRoot, run],
  );
  const timelineMessages = useMemo(() => visibleRunTimelineMessages(run), [run]);
  const timelineItems = useMemo(() => groupLocalAgentTimeline(timelineMessages), [timelineMessages]);
  const [timelineExpanded, setTimelineExpanded] = useState(run?.status === "running");

  useEffect(() => {
    if (run?.status === "running") setTimelineExpanded(true);
  }, [run?.runId, run?.status]);

  return (
    <div className={cn("flex gap-3", isUser && "justify-end")}>
      {!isUser ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-dls-decision-soft text-dls-accent">
          <Bot className="size-4" />
        </div>
      ) : null}
      <div className={cn(localAgentLayoutClass.chatMessage, isUser ? localAgentLayoutClass.userChatMessage : localAgentLayoutClass.assistantChatMessage)}>
        {isUser ? (
          <pre className="whitespace-pre-wrap break-words font-sans">{props.message.text}</pre>
        ) : (
          <MarkdownBlock text={props.message.text} streaming={run?.status === "running"} />
        )}

        {!isUser && timelineItems.length ? (
          <div className="mt-2">
            <button
              type="button"
              className="inline-flex select-none items-center gap-1.5 text-[13px] leading-none text-dls-accent transition-colors hover:text-dls-accent-strong"
              onClick={() => setTimelineExpanded((value) => !value)}
              aria-expanded={timelineExpanded}
            >
              {run?.status === "running" ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              <span>{t("local_agent.timeline_title", { count: timelineItems.length })}</span>
              <ChevronRight className={cn("size-3 text-dls-secondary transition-transform", timelineExpanded && "rotate-90")} />
            </button>
            {timelineExpanded ? <div className="mt-2 flex flex-col gap-2.5">
              {timelineItems.map((item) => (
                <div key={item.kind === "tool_group" ? item.id : item.message.id} className="min-w-0">
                  {item.kind === "tool_group" ? (
                    <LocalAgentToolGroupSummary messages={item.messages} />
                  ) : item.message.role === "assistant" ? (
                    <div className="text-[13px] leading-6 text-dls-text">
                      <MarkdownBlock text={item.message.text} streaming={run?.status === "running" && item.message.type !== "finish"} />
                    </div>
                  ) : item.message.type === "permission" || item.message.type === "error" ? (
                    <div className="text-xs leading-5 text-dls-secondary">
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans">{item.message.text}</pre>
                    </div>
                  ) : null}
                </div>
              ))}
            </div> : null}
          </div>
        ) : null}

        {run ? (
          <div className="mt-3 space-y-2 border-t border-dls-border pt-3 text-xs text-dls-secondary">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge className="gap-1.5" tone={runStatusTone(run.status)} size="default">
                {run.status === "running" ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                {runStatusLabel(run.status)}
              </StatusBadge>
              <span>{runHumanSummary(run)}</span>
            </div>
            <details className="rounded-xl bg-dls-surface-muted px-3 py-2 text-xs leading-5 text-dls-secondary">
              <summary className="cursor-pointer select-none font-medium text-dls-secondary">
                {t("local_agent.run_details_summary", { connection: run.connectionMode || "--", started: shortTime(run.startedAt), finished: shortTime(run.finishedAt) })}
              </summary>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                <div>{t("local_agent.run_detail_run_id")}<span className="font-mono">{run.runId}</span></div>
                <div>{t("local_agent.run_detail_connection")}<span className="font-medium">{run.connectionMode || "--"}</span></div>
                <div>{t("local_agent.run_detail_provider_session")}<span className="font-mono">{run.providerSessionId ?? "--"}</span></div>
                <div>{t("local_agent.run_detail_resume_key")}<span className="font-mono">{run.resumeKey ?? "--"}</span></div>
                <div>{t("local_agent.run_detail_workdir")}<span className="font-mono">{run.workdir ?? "--"}</span></div>
                <div>{t("local_agent.run_detail_pid")}<span className="font-mono">{run.pid ?? "--"}</span></div>
                <div>{t("local_agent.run_detail_time")}{shortTime(run.startedAt)} - {shortTime(run.finishedAt)}</div>
              </div>
            </details>
            {run.errorInfo ? <NoticeBox tone="error">{classifiedRunFailureMessage(run)}<span className={`ml-2 ${localAgentTextClass.debugMeta}`}>{run.errorInfo.code}</span></NoticeBox> : run.error ? <NoticeBox tone="error">{run.error}</NoticeBox> : null}
            {run.pendingApprovals?.length ? (
              <div className={approvalClass.panel}>
                <div className={localAgentTextClass.approvalTitle}>{t("local_agent.approval_required")}</div>
                {run.pendingApprovals.map((approval) => (
                  <div key={approval.id} className={approvalClass.item}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{approval.title}</div>
                        <div className={approvalClass.meta}>{approval.readonly ? t("local_agent.approval_readonly") : t("local_agent.approval_side_effect")} · {approval.method}</div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <Button size="xs" variant="outline" className="bg-dls-surface" onClick={() => props.onResolveApproval?.(approval, "accept")}>{t("local_agent.approval_allow_once")}</Button>
                        <Button size="xs" onClick={() => props.onResolveApproval?.(approval, "acceptForSession")}>{t("local_agent.approval_allow_session")}</Button>
                        <Button size="xs" variant="destructive" onClick={() => props.onResolveApproval?.(approval, "decline")}>{t("local_agent.approval_decline")}</Button>
                      </div>
                    </div>
                    <pre className={approvalClass.command}>{approval.command || approval.summary}</pre>
                    <div className={approvalClass.cwd}>cwd: {approval.cwd || "--"}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {artifactTargets.length ? (
              <div className={localAgentLayoutClass.artifactPanel}>
                <div className={localAgentTextClass.artifactTitle}><FileText className="size-3.5" />{t("local_agent.artifacts_title")}</div>
                <div className="flex flex-wrap gap-2">
                {artifactTargets.map((target) => {
                  const isUrl = target.kind === "url";
                  const PrimaryIcon = isUrl ? Globe : ExternalLink;
                  const SecondaryIcon = isUrl ? Copy : FileText;
                  const primaryTitle = isUrl
                    ? t("local_agent.open_artifact_in_browser", { name: target.name })
                    : t("local_agent.open_artifact_in_workspace", { name: target.name });
                  const secondaryTitle = isUrl
                    ? t("local_agent.copy_artifact_url", { name: target.name })
                    : t("local_agent.reveal_artifact", { name: target.name });
                  return (
                    <div key={target.id} className="inline-flex max-w-full items-center overflow-hidden rounded-md border border-dls-border bg-dls-surface">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className={localAgentLayoutClass.artifactButton}
                        title={primaryTitle}
                        onClick={() => void handleOpenArtifact(target)}
                      >
                        <PrimaryIcon className="size-3.5 shrink-0" />
                        <span className="truncate">{target.name}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className={localAgentLayoutClass.artifactIconButton}
                        title={secondaryTitle}
                        onClick={() => void handleRevealArtifact(target)}
                      >
                        <SecondaryIcon className="size-3.5" />
                      </Button>
                    </div>
                  );
                })}
                </div>
              </div>
            ) : null}
            {showRunDiagnostics ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {run.logPath ? (
                <Button variant="outline" size="sm" onClick={() => void handleCopy("log-path", run.logPath, t("local_agent.copy_log_path"))}>
                  <Clipboard className="mr-1.5 size-3.5" />{t("local_agent.copy_log_path")}
                </Button>
              ) : null}
              {run.logPath ? (
                <Button variant="outline" size="sm" onClick={() => void handleRevealLog()}>
                  <ExternalLink className="mr-1.5 size-3.5" />{t("local_agent.reveal_log")}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => void handleCopy("debug", runDebugBundle(run, { agent: props.agent ?? null, selectedModel: props.selectedModel }), t("local_agent.copy_debug_bundle"))}>
                <Clipboard className="mr-1.5 size-3.5" />{t("local_agent.copy_debug_bundle")}
              </Button>
              {runWorkdir ? (
                <Button variant="outline" size="sm" onClick={() => void handleOnMyAgentdir()}>
                  <ExternalLink className="mr-1.5 size-3.5" />{t("local_agent.open_run_workdir")}
                </Button>
              ) : null}
              {actionFeedback ? (
                <StatusBadge tone={actionFeedback.tone === "ok" ? "success" : "danger"}>
                  {actionFeedback.text}
                </StatusBadge>
              ) : null}
            </div>
            ) : null}
            <details className="rounded-lg border border-dls-border bg-dls-surface-muted p-2">
              <summary className="flex cursor-pointer items-center gap-1.5 text-dls-secondary"><TerminalSquare className="size-3.5" />{t("local_agent.raw_log_summary")}</summary>
              <div className="mt-2 space-y-2">
                <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{run.command}</pre>
                {run.debugSummary ? <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-dls-surface px-2 py-1 font-mono text-xs">{run.debugSummary}</pre> : null}
                {run.logPath ? <div className="break-all font-mono text-xs">{run.logPath}</div> : null}
                <textarea
                  readOnly
                  value={runDebugBundle(run, { agent: props.agent ?? null, selectedModel: props.selectedModel })}
                  className="h-24 w-full resize-none rounded border border-dls-border bg-dls-surface p-2 font-mono text-xs text-dls-secondary outline-none"
                  aria-label={t("local_agent.debug_aria")}
                />
                <div className="max-h-52 space-y-1 overflow-auto">
                  {run.events.map((event, index) => (
                    <pre key={`${event.at}-${index}`} className="whitespace-pre-wrap break-words rounded bg-dls-surface px-2 py-1 font-mono text-xs">{event.type}&gt; {event.text}</pre>
                  ))}
                </div>
              </div>
            </details>
          </div>
        ) : null}
      </div>
    </div>
  );
});
ChatBubble.displayName = "ChatBubble";
