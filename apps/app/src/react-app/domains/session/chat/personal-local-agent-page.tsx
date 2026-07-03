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
  GitFork,
  Globe,
  KeyRound,
  LayoutGrid,
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
  personalLocalAgentSetAcpConfigOption,
  personalLocalAgentConversationCreate,
  personalLocalAgentConversationTranscript,
  personalLocalAgentConversationsList,
  personalLocalAgentHeartbeatCreate,
  personalLocalAgentHeartbeatDelete,
  personalLocalAgentHeartbeatRunNow,
  personalLocalAgentHeartbeatsList,
  personalLocalAgentHeartbeatUpdate,
  personalLocalAgentNativeSessionsList,
  personalLocalAgentProviderSessionsList,
  personalLocalAgentProviderSessionLoad,
  personalLocalAgentProviderSessionClose,
  personalLocalAgentProviderSessionFork,
  personalLocalAgentResetConversation,
  personalLocalAgentSideQuestion,
  personalLocalAgentValidate,
  personalLocalAgentStatus,
  type PersonalLocalAgent,
  type PersonalLocalAgentAcpConfigOptionValue,
  type PersonalLocalAgentConversation,
  type PersonalLocalAgentHeartbeatJob,
  type PersonalLocalAgentNativeSession,
  type PersonalLocalAgentProviderSession,
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
import { LocalAgentManagementPanel } from "../../local-agents/local-agent-management-panel";
import { AcpConfigOptionEditor, type LocalAgentAcpConfigOption } from "../../local-agents/acp-config-option-editor";
import { LocalAgentDraftComposer, type LocalAgentSlashCommand } from "../../local-agents/local-agent-draft-composer";
import { elapsedSeconds, runHumanSummary, runStatusLabel, shortTime } from "../../local-agents/local-agent-formatters";
import { APPROVAL_MODE_OPTIONS, DEFAULT_HEALTH_RESULT, DEFAULT_HEARTBEAT_PROMPT, HEALTH_CHECK_PROMPT, LOCAL_AGENT_LIST_DEFAULT_WIDTH, LOCAL_AGENT_LIST_MAX_WIDTH, LOCAL_AGENT_LIST_MIN_WIDTH, PROVIDER_LABELS, agentFromAcpMetadata, agentIdFromChatKey, builtinSlashCommands, chooseInitialModel, compactMessagesByAgent, isUnsupportedNativeTranscriptError, localAgentChatKey, mergeSlashCommands, nativeSessionResumeOnlyMessage, normalizeAcpSlashCommands, personalAgentApprovalModeKey, personalAgentChatStateKey, personalAgentModelPrefKey, recoverActiveRunIds, safeReadApprovalMode, safeReadCachedAgents, safeReadPersistedChatState, isPersonalLocalAgentProvider, safeWriteCachedAgents, transcriptMessagesForAgent, welcomeMessageForAgent, providerIconUrl, modelSelectorLabel, type PersistedLocalAgentChatState } from "../../local-agents/local-agent-page-model";
import type { AgentHealthResult } from "../../local-agents/local-agent-page-types";
import { ChatBubble } from "../../local-agents/messages/chat-bubble";
import type { ChatMessage } from "../../local-agents/messages/message-types";
import { collectRunOpenTargets, isRunFinal } from "../../local-agents/messages/message-utils";
import { lastEventTime } from "../../local-agents/messages/timeline-messages";
import { useAcpModelInfo } from "../../local-agents/hooks/use-acp-model-info";
import { useModeModeList } from "../../local-agents/hooks/use-mode-mode-list";
import { useAcpInitialMessage } from "../../local-agents/hooks/use-acp-initial-message"; import { useConversationHistoryHydration } from "../../local-agents/hooks/use-conversation-history-hydration";
import { BtwOverlay, agentSupportsSideQuestion } from "../../local-agents/side-question";
import type { LocalAgentRepairAction } from "../../local-agents/local-agent-repair-panel";
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
function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function runStatusTone(status: PersonalLocalAgentRunResult["status"] | undefined) {
  if (status === "completed") return "success";
  if (status === "running") return "accent";
  if (status === "cancelled") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
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
function agentSessionCapabilities(agent: PersonalLocalAgent | null) {
  const handshake = agent && "handshake" in agent ? (agent as { handshake?: { agent_capabilities?: unknown } }).handshake : null;
  const capabilities = handshake?.agent_capabilities && typeof handshake.agent_capabilities === "object"
    ? handshake.agent_capabilities as Record<string, unknown>
    : null;
  const sessionCapabilities = capabilities?.sessionCapabilities && typeof capabilities.sessionCapabilities === "object"
    ? capabilities.sessionCapabilities as Record<string, unknown>
    : capabilities?.session_capabilities && typeof capabilities.session_capabilities === "object"
      ? capabilities.session_capabilities as Record<string, unknown>
      : null;
  return {
    list: Boolean(sessionCapabilities?.list),
    load: Boolean(capabilities?.loadSession || capabilities?.load_session || sessionCapabilities?.load),
    close: Boolean(sessionCapabilities?.close),
    fork: Boolean(sessionCapabilities?.fork),
  };
}
function normalizeAcpConfigOptions(agent: PersonalLocalAgent | null): LocalAgentAcpConfigOption[] {
  const rawOptions = agent && "handshake" in agent && Array.isArray(agent.handshake?.config_options)
    ? agent.handshake.config_options
    : [];
  return rawOptions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const id = String(source.id ?? source.name ?? source.key ?? "").trim();
    if (!id) return [];
    const rawType = String(source.type ?? source.kind ?? "string").toLowerCase();
    const rawOptionsValue = Array.isArray(source.options) ? source.options : Array.isArray(source.values) ? source.values : [];
    const options = rawOptionsValue.flatMap((option) => {
      if (option && typeof option === "object") {
        const optionSource = option as Record<string, unknown>;
        const value = String(optionSource.value ?? optionSource.id ?? optionSource.name ?? "").trim();
        if (!value) return [];
        return [{ value, label: String(optionSource.label ?? optionSource.name ?? value).trim() || value }];
      }
      const value = String(option ?? "").trim();
      return value ? [{ value, label: value }] : [];
    });
    const type = rawType === "select" || options.length ? "select" : rawType === "boolean" || rawType === "bool" ? "boolean" : "string";
    const rawValue = source.value ?? source.currentValue ?? source.current_value ?? source.default ?? source.defaultValue ?? source.default_value ?? null;
    const value = type === "boolean" ? Boolean(rawValue) : rawValue === null || rawValue === undefined ? null : String(rawValue);
    return [{ id, label: String(source.label ?? source.title ?? id).trim() || id, type, value, options }];
  });
}
function lastRunForAgent(messages: ChatMessage[] | undefined) {
  return [...(messages ?? [])].reverse().find((message) => message.run)?.run ?? null;
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
function placeholderRunFromProcess(process: PersonalLocalAgentProcessRecord): PersonalLocalAgentRunResult | null {
  const runId = process.runId.trim();
  const providerRaw = (process.provider ?? process.backend ?? "").trim();
  if (!runId || !providerRaw || !isPersonalLocalAgentProvider(providerRaw)) return null;
  const provider: PersonalLocalAgentProvider = providerRaw;
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
  const [providerSessionsByAgent, setProviderSessionsByAgent] = useState<Record<string, PersonalLocalAgentProviderSession[]>>({});
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
  const [showManagement, setShowManagement] = useState(false);
  const [selectedConversationIdByAgent, setSelectedConversationIdByAgent] = useState<Record<string, string>>(persistedState.selectedConversationIdByAgent ?? {});
  const [loadingConversationsByAgent, setLoadingConversationsByAgent] = useState<Record<string, boolean>>({});
  const [loadingNativeSessionsByAgent, setLoadingNativeSessionsByAgent] = useState<Record<string, boolean>>({});
  const [loadingProviderSessionsByAgent, setLoadingProviderSessionsByAgent] = useState<Record<string, boolean>>({});
  const [providerSessionBusyByAgent, setProviderSessionBusyByAgent] = useState<Record<string, boolean>>({});
  const [configOptionBusyByAgent, setConfigOptionBusyByAgent] = useState<Record<string, string | null>>({});
  const [configOptionValuesByAgent, setConfigOptionValuesByAgent] = useState<Record<string, Record<string, PersonalLocalAgentAcpConfigOptionValue>>>({});
  const [configOptionMessageByAgent, setConfigOptionMessageByAgent] = useState<Record<string, string | null>>({});
  const [showNativeSessions, setShowNativeSessions] = useState(false);
  const [showProviderSessions, setShowProviderSessions] = useState(false);
  const [approvalMode, setApprovalMode] = useState<PersonalLocalAgentApprovalMode>(() => safeReadApprovalMode(props.workspaceRoot));
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Track whether the user is pinned to the bottom of the transcript. We only
  // auto-scroll on new messages when they already are — otherwise scrolling up
  // to read earlier output yanks them back down on every poll tick.
  const stickToBottomRef = useRef(true);
  // Once a run's terminal snapshot (finish/completed/failed/cancelled) is
  // observed we record its runId here; late chunks or stale "running" snapshots
  // for that same run are then ignored so the transcript never flips back into
  // the running state after a turn has finished.
  const turnFinishedRef = useRef<Record<string, boolean>>({});
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
  const selectedProviderSessions = selectedAgent ? providerSessionsByAgent[selectedAgent.id] ?? [] : [];
  const selectedProviderSessionId = selectedConversation?.providerSessionId || selectedConversation?.resumeKey || "";
  const selectedSessionCapabilities = agentSessionCapabilities(selectedAgent);
  const selectedAcpModelInfo = useAcpModelInfo(selectedAgent);
  const selectedAcpModeList = useModeModeList(selectedAgent);
  const selectedConfigOptions = useMemo(() => normalizeAcpConfigOptions(selectedAgent).filter((option) => option.id !== selectedAcpModelInfo.modelOptionId && (option.id !== selectedAcpModeList.optionId || selectedAcpModeList.supportsModeOverride)), [selectedAcpModeList.optionId, selectedAcpModeList.supportsModeOverride, selectedAcpModelInfo.modelOptionId, selectedAgent]);
  const selectedSlashCommands = useMemo(
    () => mergeSlashCommands([...builtinSlashCommands(selectedAgent), ...normalizeAcpSlashCommands(selectedAgent)]),
    [selectedAgent],
  );
  const selectedConfigOptionValues = selectedAgent ? configOptionValuesByAgent[selectedAgent.id] ?? {} : {};
  const selectedHeartbeatJobs = selectedAgent ? heartbeatJobs.filter((job) => job.agent?.id === selectedAgent.id) : [];
  const selectedChatKey = selectedAgent ? localAgentChatKey(selectedAgent.id, selectedConversationId) : "";
  const handleWarmupResult = useCallback((result: { ok: boolean; providerSessionId?: string | null }) => {
    if (!result.ok || !selectedAgent || !selectedConversationId || !result.providerSessionId) return;
    setConversationsByAgent((current) => ({
      ...current,
      [selectedAgent.id]: (current[selectedAgent.id] ?? []).map((conversation) => conversation.id === selectedConversationId ? { ...conversation, providerSessionId: result.providerSessionId ?? conversation.providerSessionId, resumeKey: result.providerSessionId ?? conversation.resumeKey } : conversation),
    }));
  }, [selectedAgent, selectedConversationId]);
  useAcpInitialMessage({ workspaceRoot: props.workspaceRoot, agent: selectedAgent, conversationId: selectedConversationId, approvalMode, model: selectedModel, onWarmup: handleWarmupResult }); useConversationHistoryHydration({ workspaceRoot: props.workspaceRoot, agent: selectedAgent, conversationId: selectedConversationId, messagesByAgent, setMessagesByAgent });
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
  const selectedModelOptions = selectedAcpModelInfo.options;
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
    const timer = window.setInterval(() => void syncBackgroundProcesses(), 5_000);
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
  useEffect(() => {
    setSelectedModel(selectedAcpModelInfo.currentModelId || selectedAgent?.defaultModel || "");
  }, [selectedAcpModelInfo.currentModelId, selectedAgent?.defaultModel, selectedAgent?.id]);
  // Switching agents/conversations should always start pinned to the latest.
  useEffect(() => {
    stickToBottomRef.current = true;
    // Clear stale turn-finish guards when switching agents. Completed
    // runs are no longer polled, so their guards are dead weight; clearing here
    // bounds the ref to the active agent's runs only.
    turnFinishedRef.current = {};
  }, [selectedChatKey]);
  // Auto-scroll to the newest content only while the user is pinned to the
  // bottom. Streaming re-renders the transcript on every poll tick, so
  // we (a) use instant scrolling — a smooth animation would still be running
  // when the next tick fires and emit its own onScroll events, and (b) mark the
  // scroll as programmatic so the onScroll handler does not treat our own jump
  // as the user leaving the bottom. Without this guard the viewport fights any
  // attempt to scroll up and feels locked to the top of the transcript.
  const programmaticScrollRef = useRef(false);
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    // Release the guard on the next frame, after the scroll event has fired.
    const id = window.requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
    return () => window.cancelAnimationFrame(id);
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
          // If this turn already finished, ignore any late snapshot
          // that still reports "running" so the transcript cannot flip back into
          // the running state after the finish event.
          const alreadyFinished = turnFinishedRef.current[runId] === true;
          const effectiveSnapshot = alreadyFinished && snapshot.status === "running"
            ? { ...snapshot, status: "completed" as const }
            : snapshot;
          if (effectiveSnapshot.status !== "running") {
            turnFinishedRef.current[runId] = true;
          }
          const fallbackAgent = agents.find((agent) => agent.id === effectiveSnapshot.agentId) ?? agents.find((agent) => agent.id === agentId) ?? selectedAgent;
          setMessagesByAgent((current) => ({
            ...current,
            [chatKey]: (current[chatKey] ?? (fallbackAgent ? [welcomeMessageForAgent(fallbackAgent)] : [])).map((message) =>
              message.run?.runId === runId
                ? { ...message, text: messageTextForRun(effectiveSnapshot, message.text), run: effectiveSnapshot }
                : message,
            ),
          }));
          rememberRunResult(agentId, effectiveSnapshot);
          if (effectiveSnapshot.status !== "running") {
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
    }, 1500);
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
      // A fresh turn starts unfinished; clear any prior guard for this runId.
      if (started.status === "running") {
        turnFinishedRef.current[started.runId] = false;
      } else {
        turnFinishedRef.current[started.runId] = true;
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
  const sendSideQuestion = useCallback(async (prompt: string) => {
    if (!prompt || !selectedAgent) return;
    const runAgent = selectedAgent;
    const runConversationId = selectedConversationId;
    const runChatKey = localAgentChatKey(runAgent.id, runConversationId);
    setErrorsByAgent((current) => ({ ...current, [runAgent.id]: null }));
    const userMessage: ChatMessage = { id: nowId("side-user"), role: "user", text: prompt, createdAt: Date.now() };
    const assistantMessageId = nowId("side-assistant");
    setMessagesByAgent((current) => ({
      ...current,
      [runChatKey]: [
        ...(current[runChatKey] ?? [welcomeMessageForAgent(runAgent)]),
        userMessage,
        { id: assistantMessageId, role: "assistant", text: t("local_agent.calling"), createdAt: Date.now(), run: null },
      ],
    }));
    try {
      const started = await personalLocalAgentSideQuestion({
        workspaceRoot: props.workspaceRoot,
        prompt,
        approvalMode,
        conversationId: runConversationId,
        agent: { ...runAgent, model: selectedModel || null },
      });
      if (!started.ok || !started.run) throw new Error(started.error || "side question failed");
      rememberRunResult(runAgent.id, started.run);
      const answer = messageTextForRun(started.run, "");
      setMessagesByAgent((current) => ({
        ...current,
        [runChatKey]: (current[runChatKey] ?? [welcomeMessageForAgent(runAgent)]).map((message) =>
          message.id === assistantMessageId ? { ...message, text: messageTextForRun(started.run!, t("local_agent.running")), run: started.run } : message,
        ),
      }));
      return { answer };
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setErrorsByAgent((current) => ({ ...current, [runAgent.id]: message }));
      setMessagesByAgent((current) => ({
        ...current,
        [runChatKey]: (current[runChatKey] ?? [welcomeMessageForAgent(runAgent)]).map((item) =>
          item.id === assistantMessageId ? { ...item, text: t("local_agent.start_failed", { message }) } : item,
        ),
      }));
      return { error: message };
    }
  }, [approvalMode, props.workspaceRoot, rememberRunResult, selectedAgent, selectedConversationId, selectedModel]);
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
  const loadProviderSessions = useCallback(async () => {
    if (!selectedAgent || !selectedAgent.capability?.supportsAcp) return;
    const agent = selectedAgent;
    setLoadingProviderSessionsByAgent((current) => ({ ...current, [agent.id]: true }));
    setErrorsByAgent((current) => ({ ...current, [agent.id]: null }));
    try {
      const result = await personalLocalAgentProviderSessionsList({ workspaceRoot: props.workspaceRoot, agent });
      setProviderSessionsByAgent((current) => ({ ...current, [agent.id]: result.sessions }));
      if (result.unsupportedReason) setErrorsByAgent((current) => ({ ...current, [agent.id]: result.unsupportedReason ?? null }));
    } catch (nextError) {
      setErrorsByAgent((current) => ({ ...current, [agent.id]: nextError instanceof Error ? nextError.message : String(nextError) }));
    } finally {
      setLoadingProviderSessionsByAgent((current) => ({ ...current, [agent.id]: false }));
    }
  }, [props.workspaceRoot, selectedAgent]);
  useEffect(() => {
    if (!showProviderSessions || !selectedAgent) return;
    if (Object.prototype.hasOwnProperty.call(providerSessionsByAgent, selectedAgent.id)) return;
    if (loadingProviderSessionsByAgent[selectedAgent.id]) return;
    void loadProviderSessions();
  }, [loadProviderSessions, loadingProviderSessionsByAgent, providerSessionsByAgent, selectedAgent, showProviderSessions]);
  const loadProviderSession = useCallback(async (session: PersonalLocalAgentProviderSession) => {
    if (!selectedAgent || running) return;
    const agent = selectedAgent;
    setProviderSessionBusyByAgent((current) => ({ ...current, [agent.id]: true }));
    setErrorsByAgent((current) => ({ ...current, [agent.id]: null }));
    try {
      const result = await personalLocalAgentProviderSessionLoad({ workspaceRoot: props.workspaceRoot, agent, sessionId: session.sessionId, title: session.title });
      if (!result.conversation) throw new Error("session/load returned no conversation");
      const conversation = result.conversation;
      setConversationsByAgent((current) => ({ ...current, [agent.id]: [conversation, ...(current[agent.id] ?? [])] }));
      setSelectedConversationIdByAgent((current) => ({ ...current, [agent.id]: conversation.id }));
      await loadConversationTranscript(agent, conversation);
      setShowProviderSessions(false);
    } catch (nextError) {
      setErrorsByAgent((current) => ({ ...current, [agent.id]: nextError instanceof Error ? nextError.message : String(nextError) }));
    } finally {
      setProviderSessionBusyByAgent((current) => ({ ...current, [agent.id]: false }));
    }
  }, [loadConversationTranscript, props.workspaceRoot, running, selectedAgent]);
  const closeProviderSession = useCallback(async () => {
    if (!selectedAgent || !selectedProviderSessionId || running) return;
    const agent = selectedAgent;
    setProviderSessionBusyByAgent((current) => ({ ...current, [agent.id]: true }));
    setErrorsByAgent((current) => ({ ...current, [agent.id]: null }));
    try {
      const result = await personalLocalAgentProviderSessionClose({ workspaceRoot: props.workspaceRoot, agent, conversationId: selectedConversation?.id ?? null, sessionId: selectedProviderSessionId });
      if (!result.ok) throw new Error(result.error || "session/close failed");
      await loadConversationsForAgent(agent);
      await loadProviderSessions();
    } catch (nextError) {
      setErrorsByAgent((current) => ({ ...current, [agent.id]: nextError instanceof Error ? nextError.message : String(nextError) }));
    } finally {
      setProviderSessionBusyByAgent((current) => ({ ...current, [agent.id]: false }));
    }
  }, [loadConversationsForAgent, loadProviderSessions, props.workspaceRoot, running, selectedAgent, selectedConversation?.id, selectedProviderSessionId]);
  const forkProviderSession = useCallback(async () => {
    if (!selectedAgent || !selectedProviderSessionId || running) return;
    const agent = selectedAgent;
    setProviderSessionBusyByAgent((current) => ({ ...current, [agent.id]: true }));
    setErrorsByAgent((current) => ({ ...current, [agent.id]: null }));
    try {
      const result = await personalLocalAgentProviderSessionFork({ workspaceRoot: props.workspaceRoot, agent, sessionId: selectedProviderSessionId, title: selectedConversation ? `${conversationTitle(selectedConversation)} fork` : undefined });
      if (!result.conversation) throw new Error("session/fork returned no conversation");
      const conversation = result.conversation;
      setConversationsByAgent((current) => ({ ...current, [agent.id]: [conversation, ...(current[agent.id] ?? [])] }));
      setSelectedConversationIdByAgent((current) => ({ ...current, [agent.id]: conversation.id }));
      await loadConversationTranscript(agent, conversation);
    } catch (nextError) {
      setErrorsByAgent((current) => ({ ...current, [agent.id]: nextError instanceof Error ? nextError.message : String(nextError) }));
    } finally {
      setProviderSessionBusyByAgent((current) => ({ ...current, [agent.id]: false }));
    }
  }, [loadConversationTranscript, props.workspaceRoot, running, selectedAgent, selectedConversation, selectedProviderSessionId]);
  const setAcpConfigOption = useCallback(async (option: LocalAgentAcpConfigOption, value: PersonalLocalAgentAcpConfigOptionValue) => {
    if (!selectedAgent) return;
    setConfigOptionBusyByAgent((current) => ({ ...current, [selectedAgent.id]: option.id }));
    setConfigOptionMessageByAgent((current) => ({ ...current, [selectedAgent.id]: null }));
    try {
      const result = await personalLocalAgentSetAcpConfigOption({
        workspaceRoot: props.workspaceRoot,
        agent: selectedAgent,
        sessionId: selectedProviderSessionId || undefined,
        optionId: option.id,
        value,
      });
      setConfigOptionValuesByAgent((current) => ({
        ...current,
        [selectedAgent.id]: { ...(current[selectedAgent.id] ?? {}), [option.id]: result.value ?? value },
      }));
      if (Array.isArray(result.configOptions) && result.configOptions.length) {
        setAgents((current) => current.map((agent) => agent.id === selectedAgent.id ? {
          ...agent,
          handshake: {
            ...(agent.handshake ?? {}),
            config_options: result.configOptions,
            ...(option.id === selectedAcpModelInfo.modelOptionId ? { currentModelId: String(result.value ?? value), current_model_id: String(result.value ?? value) } : {}),
          },
        } : agent));
      } else if (option.id === selectedAcpModelInfo.modelOptionId) {
        setAgents((current) => current.map((agent) => agent.id === selectedAgent.id ? {
          ...agent,
          handshake: {
            ...(agent.handshake ?? {}),
            currentModelId: String(result.value ?? value),
            current_model_id: String(result.value ?? value),
          },
        } : agent));
      }
      setConfigOptionMessageByAgent((current) => ({ ...current, [selectedAgent.id]: result.confirmation || t("local_agent.config_option_saved") }));
    } catch (error) {
      setConfigOptionMessageByAgent((current) => ({ ...current, [selectedAgent.id]: error instanceof Error ? error.message : String(error) }));
    } finally {
      setConfigOptionBusyByAgent((current) => ({ ...current, [selectedAgent.id]: null }));
    }
  }, [props.workspaceRoot, selectedAcpModelInfo.modelOptionId, selectedAgent, selectedProviderSessionId]);
  const runHealthCheck = useCallback(async () => {
    await startAgentRun(selectedAgent?.capability?.smokePrompt ?? HEALTH_CHECK_PROMPT, { healthCheck: true });
  }, [selectedAgent, startAgentRun]);
  const submitComposerValue = useCallback(async (value: string) => {
    const prompt = value.trim();
    if (prompt.startsWith("/")) {
      if (prompt === "/new") {
        await createNewConversation();
        return;
      }
      if (prompt === "/clear") {
        await clearCurrentAgentChat();
        return;
      }
      if (prompt === "/sessions") {
        setShowProviderSessions(true);
        await loadProviderSessions();
        return;
      }
      setErrorsByAgent((current) => ({ ...current, [selectedAgentId]: t("local_agent.slash_unknown", { command: prompt }) }));
      return;
    }
    await startAgentRun(prompt);
  }, [clearCurrentAgentChat, createNewConversation, loadProviderSessions, selectedAgentId, startAgentRun]);
  const handleSlashCommandExecute = useCallback((command: LocalAgentSlashCommand) => { void submitComposerValue(command.name); }, [submitComposerValue]);
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
  const resolveApproval = useCallback(async (approval: PersonalLocalAgentApprovalRequest, decision: PersonalLocalAgentApprovalDecision, options?: { alwaysAllow?: boolean }) => {
    try {
      const result = await personalLocalAgentAcpResolveApproval({
        runId: approval.runId,
        approvalId: approval.id,
        decision,
        alwaysAllow: options?.alwaysAllow,
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
 return ( <div data-onmyagent-view="personal-assistant" className="relative flex h-full min-h-0 overflow-hidden bg-dls-surface text-dls-text"><aside className="flex shrink-0 flex-col overflow-hidden bg-dls-background pb-5" style={{ width: agentListWidth }} ><div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-dls-border/70 px-4"><InputGroup controlSize="sm" radius="md" tone="surfaceMuted" className="flex-1"><InputGroupAddon align="inline-start" inset="tight"><Search className="size-4.5" /></InputGroupAddon><InputGroupInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("local_agent.search")} className="text-sm placeholder:text-dls-secondary/75" /></InputGroup><Button type="button" size="icon-sm" onClick={() => setShowAddForm((value) => !value)} className="relative shrink-0 rounded-md border border-dls-border bg-dls-surface-muted text-dls-secondary hover:bg-dls-hover hover:text-dls-text" title={t("local_agent.add")} aria-label={t("local_agent.add")} ><Bot className="size-4.5" /><Plus className="absolute right-1.5 top-1.5 size-2.5" strokeWidth={3} /></Button></div> {showAddForm ? ( <div className="mx-4 mt-3 rounded-lg border border-dls-border bg-dls-surface-muted p-3"><div className={localAgentTextClass.panelTitle}>{t("local_agent.add")}</div><Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => void refreshAgents()} disabled={refreshing}><RefreshCw className={cn(localAgentLayoutClass.refreshIcon, refreshing && "animate-spin")} />{t("local_agent.redetect")} </Button></div> ) : null} <div className="min-h-0 flex-1 overflow-y-auto"> {filteredAgents.length > 0 ? ( <div> {filteredAgents.map((agent) => { const agentActiveRunKey = Object.entries(activeRunIdByAgent).find(([chatKey, runId]) => Boolean(runId) && agentIdFromChatKey(chatKey) === agent.id)?.[0] ?? null; const lastRun = agentActiveRunKey ? lastRunForAgent(messagesByAgent[agentActiveRunKey]) : lastRunForAgent(messagesByAgent[agent.id]); const iconUrl = providerIconUrl(agent.provider); const hasActiveRun = Boolean( agentActiveRunKey && lastRun && lastRun.runId === activeRunIdByAgent[agentActiveRunKey] && lastRun.status === "running", ); return ( <SessionRowButton key={agent.id} type="button" onClick={() => setSelectedAgentId(agent.id)} active={selectedAgentId === agent.id} className={localAgentLayoutClass.agentRow} ><div className="relative shrink-0"><div className={cn( localAgentLayoutClass.agentAvatar, selectedAgentId === agent.id ? localAgentLayoutClass.agentAvatarSelected : localAgentLayoutClass.agentAvatarDefault, )} > {iconUrl ? ( <img src={iconUrl} alt="" className="size-7 object-contain" loading="lazy" draggable={false} /> ) : ( <Bot className="size-5" /> )} </div><span className={cn(localAgentLayoutClass.agentStatusDot, selectedAgentId === agent.id ? "border-dls-list-selected" : "border-dls-surface", agent.status === "online" ? "bg-dls-online" : "bg-dls-secondary")} /> {hasActiveRun ? ( <StatusPing inset size="md" className="absolute -right-0.5 -top-0.5 items-center justify-center" title={t("local_agent.background_run_title")} aria-label={t("local_agent.background_run_aria")} /> ) : null} </div><div className="min-w-0 flex-1"><div className="flex min-w-0 items-baseline gap-2"><div className={localAgentTextClass.rowTitle}>{agent.name}</div></div><div className="mt-1 flex min-w-0 items-center gap-1.5"><div className="min-w-0 flex-1 truncate text-xs leading-5 text-dls-secondary">{agent.status === "online" ? agentSubtitle(agent) : agent.error || t("local_agent.check_install_or_login")}</div> {hasActiveRun ? <StatusDot size="md" tone="active" /> : null} </div></div></SessionRowButton> ); })} </div> ) : refreshing ? ( <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm leading-5 text-dls-secondary"><Loader2 className="size-5 animate-spin text-dls-accent" /><div> {t("local_agent.detecting")} <div className="mt-1 text-xs text-dls-secondary/75">{t("local_agent.detecting_desc")}</div></div></div> ) : ( <div className="flex h-full items-center justify-center px-4 text-center text-sm leading-5 text-dls-secondary"> {t("local_agent.empty")} </div> )} </div></aside><div role="separator" aria-label={t("session.resize_agent_list")} aria-orientation="vertical" tabIndex={0} onPointerDown={startAgentListResize} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setAgentListWidth((width) => Math.min( LOCAL_AGENT_LIST_MAX_WIDTH, Math.max( LOCAL_AGENT_LIST_MIN_WIDTH, width + (event.key === "ArrowLeft" ? -16 : 16), ), ), ); } }} className="group absolute inset-y-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none" style={{ left: agentListWidth }} ><div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-dls-border transition-colors group-hover:bg-dls-border-strong group-focus-visible:bg-dls-accent" /></div><main className="flex min-w-0 flex-1 flex-col bg-dls-surface"><header className={localAgentLayoutClass.header}><div className="flex min-h-16 items-center justify-between gap-4 px-6 py-3 mac:titlebar-no-drag"><div className="flex min-w-0 flex-1 items-center gap-3"><div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dls-border bg-dls-surface-muted text-dls-accent"> {selectedAgentIconUrl ? ( <img src={selectedAgentIconUrl} alt="" className="size-6 object-contain" loading="lazy" draggable={false} /> ) : ( <UserRound className="size-4.5" /> )} </div><div className="min-w-0 flex-1"><div className="flex min-w-0 flex-wrap items-center gap-2"><div className={localAgentTextClass.pageTitle}>{t("nav.local_agent")}</div> {selectedAgent ? <StatusBadge tone={healthTone(selectedHealth, selectedAgent)}>{healthLabel(selectedHealth, selectedAgent)}</StatusBadge> : null} {selectedAgent ? <StatusBadge tone="surface">{agentMemoryProfile(selectedAgent).mode}</StatusBadge> : null} </div><div className="mt-0.5 truncate text-xs text-dls-secondary"> {selectedAgent ? t("local_agent.using_workspace", { name: selectedAgent.name, workspace: props.workspaceName || props.workspaceRoot }) : t("local_agent.select_agent")} </div> {selectedAgent ? ( <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-dls-secondary"><StatusBadge tone="surface">{selectedCapability?.supportsStreaming ? t("local_agent.streaming") : t("local_agent.non_streaming")}</StatusBadge><StatusBadge tone="surface">{t("local_agent.resume_chip", { status: selectedCapability?.supportsResume ? t("local_agent.available") : t("common.off") })}</StatusBadge><StatusBadge className="max-w-[360px] truncate" tone="surface">{t("local_agent.context_isolated")}</StatusBadge></div> ) : null} </div></div><div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5"><Button variant={showManagement ? "default" : "outline"} size="sm" className="whitespace-nowrap" onClick={() => setShowManagement((open) => !open)} data-testid="local-agent-manage-button" aria-pressed={showManagement}><LayoutGrid className="mr-1.5 size-3.5" />{t("local_agent.manage_agents")} </Button><Button variant="outline" size="sm" className="whitespace-nowrap" onClick={() => void refreshAgents()} disabled={refreshing}><RefreshCw className={cn(localAgentLayoutClass.refreshIcon, refreshing && "animate-spin")} />{t("common.refresh")} </Button><Button variant="outline" size="sm" className="whitespace-nowrap" onClick={clearCurrentAgentChat} disabled={!selectedAgent || running || resetting} title={t("local_agent.clear_chat_title")}> {resetting ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Trash2 className="mr-1.5 size-3.5" />}{t("local_agent.clear_chat")} </Button><Button variant="outline" size="sm" className="whitespace-nowrap" onClick={() => void runHealthCheck()} disabled={!selectedAgent || selectedAgent.status !== "online" || running}> {selectedHealth.status === "running" ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <KeyRound className="mr-1.5 size-3.5" />}{t("local_agent.health_check")} </Button><Button ref={scheduledTasksButtonRef} variant="outline" size="sm" className="whitespace-nowrap" onClick={() => setShowScheduledTasks((open) => !open)} disabled={!selectedAgent} data-testid="local-agent-scheduled-tasks-button" aria-expanded={showScheduledTasks}><Clock3 className="mr-1.5 size-3.5" />{t("local_agent.heartbeat_title")} {selectedHeartbeatJobs.length ? <CountBadge size="dot" className="ml-1 bg-dls-accent/10 text-dls-accent">{selectedHeartbeatJobs.length}</CountBadge> : null} </Button> {props.headerActions ? <div className="ml-1 flex items-center border-l border-dls-border pl-2">{props.headerActions}</div> : null} </div></div><div className="flex min-h-12 flex-wrap items-center gap-2 border-t border-dls-border/70 bg-dls-surface-muted/35 px-6 py-2 mac:titlebar-no-drag"><label className="flex min-w-[220px] flex-[1_1_280px] items-center gap-2 text-xs text-dls-secondary"><span className="shrink-0 whitespace-nowrap">{t("local_agent.conversation")}</span><div className="min-w-0 flex-1"><SelectMenu size="compact" ariaLabel={t("local_agent.conversation")} options={selectedConversations.length ? selectedConversations.map((conversation) => ({ value: conversation.id, label: conversationTitle(conversation) })) : [{ value: "", label: t("local_agent.loading_conversations") }]} value={selectedConversationId ?? ""} onChange={(value) => { if (!selectedAgent || !value) return; setSelectedConversationIdByAgent((current) => ({ ...current, [selectedAgent.id]: value })); }} disabled={!selectedAgent || running || Boolean(selectedAgent && loadingConversationsByAgent[selectedAgent.id])} /></div><Button variant="outline" size="icon-sm" onClick={() => void createNewConversation()} disabled={!selectedAgent || running || Boolean(selectedAgent && loadingConversationsByAgent[selectedAgent.id])} title={t("local_agent.new_conversation")} aria-label={t("local_agent.new_conversation")}> {selectedAgent && loadingConversationsByAgent[selectedAgent.id] ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} </Button></label><div className="flex min-w-[240px] flex-[1_1_320px] items-center gap-1.5"><SelectMenu size="compact" ariaLabel={t("local_agent.native_sessions")} placeholder={selectedAgent && loadingNativeSessionsByAgent[selectedAgent.id] ? t("local_agent.loading_native_sessions") : t("local_agent.native_sessions")} options={selectedNativeSessions.length ? selectedNativeSessions.map((session) => ({ value: `${session.source}:${session.id}`, label: `${session.title} · ${shortTime(session.updatedAt)} · ${session.source}` })) : [{ value: "__empty", label: selectedAgent && loadingNativeSessionsByAgent[selectedAgent.id] ? t("local_agent.loading_native_sessions") : t("local_agent.no_native_sessions") }]} value="" onOpen={() => { setShowNativeSessions(true); void loadNativeSessions(); }} onChange={(value) => { if (value === "__empty") return; const session = selectedNativeSessions.find((item) => `${item.source}:${item.id}` === value); if (!session) return; void importNativeSession(session); }} disabled={!selectedAgent || running} /> {showNativeSessions ? ( <Button variant="outline" size="icon-sm" onClick={() => void loadNativeSessions()} disabled={!selectedAgent || loadingNativeSessionsByAgent[selectedAgent.id]} title={t("common.refresh")} aria-label={t("common.refresh")}><RefreshCw className={cn("size-3.5", selectedAgent && loadingNativeSessionsByAgent[selectedAgent.id] && "animate-spin")} /></Button> ) : null} </div> {selectedAgent?.capability?.supportsAcp && selectedSessionCapabilities.list && selectedSessionCapabilities.load ? ( <div className="flex min-w-[260px] flex-[1_1_360px] items-center gap-1.5"><SelectMenu size="compact" ariaLabel={t("local_agent.provider_sessions")} placeholder={selectedAgent && loadingProviderSessionsByAgent[selectedAgent.id] ? t("local_agent.loading_provider_sessions") : t("local_agent.provider_sessions")} options={selectedProviderSessions.length ? selectedProviderSessions.map((session) => ({ value: session.sessionId, label: `${session.title} · ${shortTime(session.updatedAt)} · ACP` })) : [{ value: "__empty", label: selectedAgent && loadingProviderSessionsByAgent[selectedAgent.id] ? t("local_agent.loading_provider_sessions") : t("local_agent.no_provider_sessions") }]} value="" onOpen={() => { setShowProviderSessions(true); void loadProviderSessions(); }} onChange={(value) => { if (value === "__empty") return; const session = selectedProviderSessions.find((item) => item.sessionId === value); if (!session) return; void loadProviderSession(session); }} disabled={!selectedAgent || running || providerSessionBusyByAgent[selectedAgent.id]} /><Button variant="outline" size="icon-sm" onClick={() => void loadProviderSessions()} disabled={!selectedAgent || loadingProviderSessionsByAgent[selectedAgent.id] || providerSessionBusyByAgent[selectedAgent.id]} title={t("common.refresh")} aria-label={t("common.refresh")}><RefreshCw className={cn("size-3.5", selectedAgent && loadingProviderSessionsByAgent[selectedAgent.id] && "animate-spin")} /></Button> {selectedSessionCapabilities.close && selectedProviderSessionId ? ( <Button variant="outline" size="icon-sm" onClick={() => void closeProviderSession()} disabled={!selectedAgent || running || providerSessionBusyByAgent[selectedAgent.id]} title={t("local_agent.close_provider_session")} aria-label={t("local_agent.close_provider_session")}> {selectedAgent && providerSessionBusyByAgent[selectedAgent.id] ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />} </Button> ) : null} {selectedSessionCapabilities.fork && selectedProviderSessionId ? ( <Button variant="outline" size="icon-sm" onClick={() => void forkProviderSession()} disabled={!selectedAgent || running || providerSessionBusyByAgent[selectedAgent.id]} title={t("local_agent.fork_provider_session")} aria-label={t("local_agent.fork_provider_session")}><GitFork className="size-3.5" /></Button> ) : null} </div> ) : null} <label className="flex min-w-[220px] flex-[1_1_280px] items-center gap-2 text-xs text-dls-secondary"><span className="shrink-0 whitespace-nowrap">{modelSelectorLabel(selectedAgent)}</span><div className="min-w-0 flex-1"><SelectMenu size="compact" ariaLabel={modelSelectorLabel(selectedAgent)} options={[{ value: "", label: t("local_agent.use_default_config") }, ...(loadingSelectedModels ? [{ value: "__loading", label: t("local_agent.loading_models") }] : []), ...selectedModelOptions.map((option) => ({ value: option.id, label: option.label }))]} value={selectedModel} onChange={(value) => { if (value === "__loading") return; setSelectedModel(value); if (value && selectedAcpModelInfo.supportsModelOverride) { void setAcpConfigOption({ id: selectedAcpModelInfo.modelOptionId, label: modelSelectorLabel(selectedAgent), type: "select", value: selectedModel, options: selectedModelOptions.map((option) => ({ value: option.id, label: option.label })) }, value); } }} disabled={!selectedAgent || running || !selectedAcpModelInfo.supportsModelOverride} /></div></label> {selectedConfigOptions.slice(0, 3).map((option) => ( <AcpConfigOptionEditor key={option.id} option={option} value={selectedConfigOptionValues[option.id] ?? option.value} busy={Boolean(selectedAgent && configOptionBusyByAgent[selectedAgent.id] === option.id)} disabled={!selectedAgent || running} onChange={(value) => void setAcpConfigOption(option, value)} /> ))} {selectedAgent && configOptionMessageByAgent[selectedAgent.id] ? ( <div className="min-w-[180px] flex-[1_1_240px] truncate text-xs text-dls-secondary" role="status"> {configOptionMessageByAgent[selectedAgent.id]} </div> ) : null} </div> {showScheduledTasks && selectedAgent ? ( <div ref={scheduledTasksPanelRef} className={heartbeatClass.overlay} data-testid="local-agent-scheduled-tasks-panel"><HeartbeatPanel agent={selectedAgent} jobs={selectedHeartbeatJobs} draft={heartbeatDraft} conversations={selectedConversations} conversation={selectedConversation} busyId={heartbeatBusy} error={heartbeatError} onDraftChange={setHeartbeatDraft} onCreate={() => void createHeartbeat()} onRefresh={() => void loadHeartbeats()} onRunNow={(job) => void runHeartbeatNow(job)} onToggleEnabled={(job, enabled) => void updateHeartbeatEnabled(job, enabled)} onDelete={(job) => void deleteHeartbeat(job)} onClose={() => setShowScheduledTasks(false)} /></div> ) : null} </header><div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6" onScroll={(event) => { if (programmaticScrollRef.current) return; const el = event.currentTarget; const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight; stickToBottomRef.current = distanceFromBottom <= 80; }} ><div className={localAgentLayoutClass.pageContent}> {showManagement ? ( <LocalAgentManagementPanel agents={agents} workspaceRoot={props.workspaceRoot} selectedAgentId={selectedAgentId} refreshing={refreshing} providerLabel={(agent) => PROVIDER_LABELS[agent.provider] ?? agent.provider} providerIconUrl={(agent) => providerIconUrl(agent.provider)} onSelectAgent={(agentId) => setSelectedAgentId(agentId)} onAgentsChange={setAgents} onRefresh={() => void refreshAgents()} onConfigure={() => setShowManagement(false)} onRepairAction={(action: LocalAgentRepairAction) => { if (action === "recheck") void refreshAgents(); }} supportedRepairActions={["recheck"]} /> ) : null} {activeRuns.length ? ( <ActiveRunsOverview activeRuns={activeRuns} selectedChatKey={selectedChatKey} onSelectAgent={(chatKey) => { const [agentId, conversationId] = chatKey.split("::"); if (agentId) setSelectedAgentId(agentId); if (agentId && conversationId) { setSelectedConversationIdByAgent((current) => ({ ...current, [agentId]: conversationId })); } }} onCancelRun={(runId, chatKey) => void cancelAgentRun(runId, chatKey)} /> ) : null} {selectedMessages.map((message) => ( <ChatBubble key={message.id} message={message} workspaceRoot={props.workspaceRoot} agent={selectedAgent} selectedModel={selectedModel} onOpenArtifact={props.onOpenArtifact} onResolveApproval={resolveApproval} onResolveTip={() => setShowManagement(true)} onSideQuestion={(value) => void sendSideQuestion(value)} /> ))} {selectedError ? <NoticeBox tone="error">{selectedError}</NoticeBox> : null} </div></div><footer className="shrink-0 bg-dls-surface px-6 py-4"><div className={localAgentLayoutClass.chatPanel}><LocalAgentDraftComposer draftKey={selectedChatKey} initialDraft={draft} disabled={!selectedAgent || selectedAgent.status !== "online"} submitting={running} placeholder={selectedAgent?.status === "online" ? t("local_agent.input_placeholder") : t("local_agent.input_placeholder_unavailable")} slashCommands={selectedSlashCommands} onDraftCommit={updateDraftForChat} onSlashCommandExecute={handleSlashCommandExecute} onSubmit={(value) => { updateDraftForChat(selectedChatKey, value); void submitComposerValue(value); }} /><div className="flex items-center justify-between gap-3 px-2 pb-1"><div className="truncate text-xs text-dls-secondary"> {activePendingApprovals.length ? t("local_agent.pending_approvals", { count: activePendingApprovals.length }) : activeRun?.status === "running" ? t("local_agent.running_run", { runId: activeRun.runId }) : t("local_agent.chat_calls_selected")} </div><div className="flex items-center gap-2"> {selectedAgent && agentSupportsSideQuestion(selectedAgent) ? <BtwOverlay disabled={!selectedAgent || selectedAgent.status !== "online"} submitting={false} onSubmit={(value) => void sendSideQuestion(value)} /> : null}<label className="flex items-center gap-1.5 text-xs text-dls-secondary" title={ selectedCapability && selectedCapability.supportsApproval === false ? t("local_agent.approval_not_supported") : APPROVAL_MODE_OPTIONS.find((option) => option.id === approvalMode)?.description } ><span className="shrink-0">{t("local_agent.approval_policy")}</span><div className="min-w-[140px]"><SelectMenu size="compact" value={approvalMode} onChange={(value) => setApprovalMode(value as PersonalLocalAgentApprovalMode)} disabled={running || (selectedCapability ? selectedCapability.supportsApproval === false : false)} ariaLabel={t("local_agent.approval_aria")} placement="top" options={APPROVAL_MODE_OPTIONS.map((option) => ({ value: option.id, label: option.label }))} /></div> {selectedCapability && selectedCapability.supportsApproval === false ? ( <StatusBadge size="tiny" tone="accent">{t("local_agent.cli_native_policy")}</StatusBadge> ) : null} </label> {activeRun?.status === "running" ? ( <Button variant="outline" size="sm" onClick={() => void cancelRun()}><CircleStop className="mr-1.5 size-3.5" />{t("composer.stop")} </Button> ) : null} </div></div></div></footer></main></div> );
}
function ActiveRunsOverview(props: { activeRuns: Array<{ chatKey: string; agentId: string; agent: PersonalLocalAgent | null; run: PersonalLocalAgentRunResult }>; selectedChatKey: string | null; onSelectAgent: (chatKey: string) => void; onCancelRun?: (runId: string, chatKey: string) => void;
}) { return ( <section className={activeRunClass.overview}><div className={localAgentTextClass.runSectionTitle}><Activity className="size-4" />{t("local_agent.active_runs")} <CountBadge size="dot" className="bg-dls-accent/10 text-dls-accent">{props.activeRuns.length}</CountBadge></div><div className="grid gap-2"> {props.activeRuns.map(({ chatKey, agentId, agent, run }) => { const isSelected = props.selectedChatKey === chatKey; return ( <div key={run.runId} className={cn( activeRunClass.item, isSelected ? activeRunClass.itemSelected : activeRunClass.itemDefault, )} ><ActionRowButton type="button" onClick={() => props.onSelectAgent(chatKey)} density="compact" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left hover:bg-transparent" title={isSelected ? t("local_agent.current_agent_running") : t("local_agent.switch_to_agent_detail")} ><div className="flex flex-wrap items-center justify-between gap-2"><span className={localAgentTextClass.runItemTitle}><StatusPing /><span className="truncate">{agent?.name ?? agentId}</span></span><span className={activeRunClass.runId}>Run {run.runId}</span></div><div className={activeRunClass.meta}><span>{run.pendingApprovals?.length ? t("local_agent.waiting_approval_count", { count: run.pendingApprovals.length }) : t("local_agent.elapsed", { value: elapsedSeconds(run.startedAt, null) })}</span><span>{t("local_agent.latest_event", { time: shortTime(lastEventTime(run)) })}</span><span>{t("local_agent.connection", { value: run.connectionMode || "--" })}</span></div></ActionRowButton> {props.onCancelRun ? ( <Button variant="outline" size="sm" className={activeRunClass.cancel} onClick={() => props.onCancelRun?.(run.runId, chatKey)} title={t("local_agent.stop_run")} ><CircleStop className="mr-1 size-3.5" />{t("composer.stop")} </Button> ) : null} </div> ); })} </div></section> );
}
