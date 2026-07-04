/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import {
  Activity,
  Bot,
  CircleStop,
  Clock3,
  Loader2,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionRowButton, SessionRowButton } from "@/components/ui/action-row";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NoticeBox } from "@/components/ui/notice-box";
import { CountBadge, StatusBadge } from "@/components/ui/status-badge";
import { StatusDot, StatusPing } from "@/components/ui/status-dot";
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
  personalLocalAgentResetConversation,
  personalLocalAgentSideQuestion,
  personalLocalAgentValidate,
  personalLocalAgentStatus,
  type PersonalLocalAgent,
  type PersonalLocalAgentConversation,
  type PersonalLocalAgentHeartbeatJob,
  type PersonalLocalAgentProvider,
  type PersonalLocalAgentProcessRecord,
  type PersonalLocalAgentApprovalDecision,
  type PersonalLocalAgentApprovalMode,
  type PersonalLocalAgentApprovalRequest,
  type PersonalLocalAgentRunResult,
} from "../../../../app/lib/desktop";
import { type OpenTarget } from "../artifacts/open-target";
import {
  conversationTitle,
  HeartbeatPanel,
  heartbeatClass,
  scheduledRunMessage,
  scheduledTaskSessionContext,
  type HeartbeatDraft,
} from "./personal-local-agent-scheduled-tasks";
import { LocalAgentManagementPanel } from "../../local-agents/local-agent-management-panel";
import { LocalAgentDraftComposer, type LocalAgentSlashCommand } from "../../local-agents/local-agent-draft-composer";
import { elapsedSeconds, shortTime } from "../../local-agents/local-agent-formatters";
import { APPROVAL_MODE_OPTIONS, DEFAULT_HEALTH_RESULT, DEFAULT_HEARTBEAT_PROMPT, LOCAL_AGENT_LIST_DEFAULT_WIDTH, LOCAL_AGENT_LIST_MAX_WIDTH, LOCAL_AGENT_LIST_MIN_WIDTH, PROVIDER_LABELS, agentFromAcpMetadata, agentIdFromChatKey, builtinSlashCommands, chooseInitialModel, compactMessagesByAgent, isUnsupportedNativeTranscriptError, localAgentChatKey, mergeSlashCommands, nativeSessionResumeOnlyMessage, normalizeAcpSlashCommands, personalAgentApprovalModeKey, personalAgentChatStateKey, personalAgentModelPrefKey, recoverActiveRunIds, safeReadApprovalMode, safeReadCachedAgents, safeReadPersistedChatState, isPersonalLocalAgentProvider, safeWriteCachedAgents, transcriptMessagesForAgent, welcomeMessageForAgent, providerIconUrl, modelSelectorLabel, type PersistedLocalAgentChatState } from "../../local-agents/local-agent-page-model";
import type { AgentHealthResult } from "../../local-agents/local-agent-page-types";
import { ChatBubble } from "../../local-agents/messages/chat-bubble";
import type { ChatMessage } from "../../local-agents/messages/message-types";
import { collectRunOpenTargets, isRunFinal } from "../../local-agents/messages/message-utils";
import { lastEventTime } from "../../local-agents/messages/timeline-messages";
import { useAcpModelInfo } from "../../local-agents/hooks/use-acp-model-info";
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
  chatPanel: "mx-auto w-full max-w-[1120px] rounded-xl border border-dls-border bg-dls-surface p-2",
  chatMessage: "max-w-[86%] rounded-xl border border-dls-border px-4 py-3 text-sm leading-6",
  userChatMessage: "bg-dls-chat-user-bg text-dls-text",
  assistantChatMessage: "bg-dls-surface text-dls-chat-agent-text",
  artifactPanel: "rounded-xl border border-dls-border bg-dls-surface-muted px-3 py-2",
  artifactButton: "min-w-0 max-w-[260px] justify-start rounded-none text-dls-status-success-fg hover:bg-dls-status-success-soft",
  artifactIconButton: "shrink-0 rounded-none text-dls-status-success-fg hover:bg-dls-status-success-soft",
};
const activeRunClass = {
  overview: "rounded-xl border border-dls-accent/30 bg-dls-accent/5 p-3 text-xs text-dls-text",
  item: "flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors",
  itemSelected: "border-dls-accent/35 bg-dls-surface",
  itemDefault: "border-dls-accent/15 bg-dls-surface/70 hover:bg-dls-surface",
  runId: "font-mono text-xs text-dls-accent",
  meta: "mt-1 flex flex-wrap gap-2 text-xs text-dls-secondary",
  cancel: "h-7 shrink-0 border-dls-accent/30 bg-dls-surface text-xs text-dls-text hover:bg-dls-accent/10",
};
function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function agentSubtitle(agent: PersonalLocalAgent) {
  if (agent.status !== "online") return agent.error || t("common.unavailable");
  const mode = agent.connectionMode;
  return [mode, agent.version || agent.executablePath || t("config.status_connected")].filter(Boolean).join(" · ");
}
function lastRunForAgent(messages: ChatMessage[] | undefined) {
  return [...(messages ?? [])].reverse().find((message) => message.run)?.run ?? null;
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
  const [showAddForm, setShowAddForm] = useState(false);
  const [errorsByAgent, setErrorsByAgent] = useState<Record<string, string | null>>(persistedState.errorsByAgent ?? {});
  const [activeRunIdByAgent, setActiveRunIdByAgent] = useState<Record<string, string | null>>(
    recoverActiveRunIds(persistedState.messagesByAgent, persistedState.activeRunIdByAgent),
  );
  const [healthResults, setHealthResults] = useState<Record<string, AgentHealthResult>>(persistedState.healthResults ?? {});
  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, ChatMessage[]>>(persistedState.messagesByAgent ?? {});
  const [conversationsByAgent, setConversationsByAgent] = useState<Record<string, PersonalLocalAgentConversation[]>>({});
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
  const selectedAcpModelInfo = useAcpModelInfo(selectedAgent);
  const selectedSlashCommands = useMemo(
    () => mergeSlashCommands([...builtinSlashCommands(selectedAgent), ...normalizeAcpSlashCommands(selectedAgent)]),
    [selectedAgent],
  );
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
  const running = Boolean(activeRun?.status === "running" || (selectedAgent && startingByAgent[selectedChatKey]));
  const selectedModelOptions = selectedAcpModelInfo.options;
  const loadingSelectedModels = Boolean(selectedAgent && selectedAgent.status === "online" && selectedModelOptions.length === 0);
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
  const clearCurrentAgentChat = useCallback(async () => {
    if (!selectedAgent || running) return;
    const agent = selectedAgent;
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
      setErrorsByAgent((current) => ({ ...current, [selectedAgentId]: t("local_agent.slash_unknown", { command: prompt }) }));
      return;
    }
    await startAgentRun(prompt);
  }, [clearCurrentAgentChat, createNewConversation, selectedAgentId, startAgentRun]);
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
 return ( <div data-onmyagent-view="personal-assistant" className="relative flex h-full min-h-0 overflow-hidden bg-dls-surface text-dls-text"><aside className="flex shrink-0 flex-col overflow-hidden bg-dls-background pb-5" style={{ width: agentListWidth }} ><div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-dls-mist px-4"><InputGroup controlSize="sm" radius="md" tone="surfaceMuted" className="flex-1"><InputGroupAddon align="inline-start" inset="tight"><Search className="size-4.5" /></InputGroupAddon><InputGroupInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("local_agent.search")} className="text-sm placeholder:text-dls-secondary/75" /></InputGroup><Button type="button" size="icon-sm" onClick={() => setShowAddForm((value) => !value)} className="relative shrink-0 rounded-md border border-dls-border bg-dls-surface-muted text-dls-secondary hover:bg-dls-hover hover:text-dls-text" title={t("local_agent.add")} aria-label={t("local_agent.add")} ><Bot className="size-4.5" /><Plus className="absolute right-1.5 top-1.5 size-2.5" strokeWidth={3} /></Button></div> {showAddForm ? ( <div className="mx-4 mt-3 rounded-lg border border-dls-border bg-dls-surface-muted p-3"><div className={localAgentTextClass.panelTitle}>{t("local_agent.add")}</div><Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => void refreshAgents()} disabled={refreshing}>
  {refreshing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
  {t("local_agent.redetect")}
</Button></div> ) : null} <div className="min-h-0 flex-1 overflow-y-auto"> {filteredAgents.length > 0 ? ( <div> {filteredAgents.map((agent) => { const agentActiveRunKey = Object.entries(activeRunIdByAgent).find(([chatKey, runId]) => Boolean(runId) && agentIdFromChatKey(chatKey) === agent.id)?.[0] ?? null; const lastRun = agentActiveRunKey ? lastRunForAgent(messagesByAgent[agentActiveRunKey]) : lastRunForAgent(messagesByAgent[agent.id]); const iconUrl = providerIconUrl(agent.provider); const hasActiveRun = Boolean( agentActiveRunKey && lastRun && lastRun.runId === activeRunIdByAgent[agentActiveRunKey] && lastRun.status === "running", ); return ( <SessionRowButton key={agent.id} type="button" onClick={() => setSelectedAgentId(agent.id)} active={selectedAgentId === agent.id} className={localAgentLayoutClass.agentRow} ><div className="relative shrink-0"><div className={cn( localAgentLayoutClass.agentAvatar, selectedAgentId === agent.id ? localAgentLayoutClass.agentAvatarSelected : localAgentLayoutClass.agentAvatarDefault, )} > {iconUrl ? ( <img src={iconUrl} alt="" className="size-7 object-contain" loading="lazy" draggable={false} /> ) : ( <Bot className="size-5" /> )} </div><span className={cn(localAgentLayoutClass.agentStatusDot, selectedAgentId === agent.id ? "border-dls-list-selected" : "border-dls-surface", agent.status === "online" ? "bg-dls-online" : "bg-dls-secondary")} /> {hasActiveRun ? ( <StatusPing inset size="md" className="absolute -right-0.5 -top-0.5 items-center justify-center" title={t("local_agent.background_run_title")} aria-label={t("local_agent.background_run_aria")} /> ) : null} </div><div className="min-w-0 flex-1"><div className="flex min-w-0 items-baseline gap-2"><div className={localAgentTextClass.rowTitle}>{agent.name}</div></div><div className="mt-1 flex min-w-0 items-center gap-1.5"><div className="min-w-0 flex-1 truncate text-xs leading-5 text-dls-secondary">{agent.status === "online" ? agentSubtitle(agent) : agent.error || t("local_agent.check_install_or_login")}</div> {hasActiveRun ? <StatusDot size="md" tone="active" /> : null} </div></div></SessionRowButton> ); })} </div> ) : refreshing ? ( <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm leading-5 text-dls-secondary"><Loader2 className="size-5 animate-spin text-dls-accent" /><div> {t("local_agent.detecting")} <div className="mt-1 text-xs text-dls-secondary/75">{t("local_agent.detecting_desc")}</div></div></div> ) : ( <div className="flex h-full items-center justify-center px-4 text-center text-sm leading-5 text-dls-secondary"> {t("local_agent.empty")} </div> )} </div></aside><div role="separator" aria-label={t("session.resize_agent_list")} aria-orientation="vertical" tabIndex={0} onPointerDown={startAgentListResize} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setAgentListWidth((width) => Math.min( LOCAL_AGENT_LIST_MAX_WIDTH, Math.max( LOCAL_AGENT_LIST_MIN_WIDTH, width + (event.key === "ArrowLeft" ? -16 : 16), ), ), ); } }} className="group absolute inset-y-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none" style={{ left: agentListWidth }} ><div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-dls-border transition-colors group-hover:bg-dls-border-strong group-focus-visible:bg-dls-accent" /></div><main className="flex min-w-0 flex-1 flex-col bg-dls-surface"><header className={localAgentLayoutClass.header}>
  <div className="flex h-12 items-center gap-2 px-4 mac:titlebar-no-drag">
    <div className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dls-border bg-dls-surface-muted text-dls-accent">
      {selectedAgentIconUrl ? (
        <img src={selectedAgentIconUrl} alt="" className="size-5 object-contain" loading="lazy" draggable={false} />
      ) : (
        <UserRound className="size-4" />
      )}
      {selectedAgent ? (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2 rounded-full border-2 border-dls-surface",
            selectedAgent.status === "online" ? "bg-dls-online" : "bg-dls-secondary",
          )}
          aria-hidden
        />
      ) : null}
    </div>
    <div className="min-w-0 truncate text-sm font-medium text-dls-text">
      {selectedAgent?.name}
    </div>
    <div className="mx-2 h-4 w-px shrink-0 bg-dls-mist" aria-hidden />
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
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => void createNewConversation()}
      disabled={!selectedAgent || running || Boolean(selectedAgent && loadingConversationsByAgent[selectedAgent.id])}
      title={t("local_agent.new_conversation")}
      aria-label={t("local_agent.new_conversation")}
    >
      {selectedAgent && loadingConversationsByAgent[selectedAgent.id] ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
    </Button>
    {selectedAcpModelInfo.supportsModelOverride ? (
      <div className="min-w-[160px] max-w-[220px]">
        <SelectMenu
          size="compact"
          ariaLabel={modelSelectorLabel(selectedAgent)}
          options={[
            { value: "", label: t("local_agent.use_default_config") },
            ...(loadingSelectedModels ? [{ value: "__loading", label: t("local_agent.loading_models") }] : []),
            ...selectedModelOptions.map((option) => ({ value: option.id, label: option.label })),
          ]}
          value={selectedModel}
          onChange={(value) => {
            if (value === "__loading") return;
            setSelectedModel(value);
            if (value && selectedAgent && selectedAcpModelInfo.supportsModelOverride) {
              void personalLocalAgentSetAcpConfigOption({
                workspaceRoot: props.workspaceRoot,
                agent: selectedAgent,
                optionId: selectedAcpModelInfo.modelOptionId,
                value,
              });
            }
          }}
          disabled={!selectedAgent || running}
        />
      </div>
    ) : null}
    <Button
      ref={scheduledTasksButtonRef}
      variant="ghost"
      size="icon-sm"
      className="relative"
      onClick={() => setShowScheduledTasks((open) => !open)}
      disabled={!selectedAgent}
      data-testid="local-agent-scheduled-tasks-button"
      aria-expanded={showScheduledTasks}
      title={t("local_agent.heartbeat_title")}
      aria-label={t("local_agent.heartbeat_title")}
    >
      <Clock3 className="size-4" />
      {selectedHeartbeatJobs.length ? (
        <CountBadge size="dot" className="absolute right-0 top-0 translate-x-1/2 -translate-y-1/2 bg-dls-accent text-dls-surface">
          {selectedHeartbeatJobs.length}
        </CountBadge>
      ) : null}
    </Button>
    {props.headerActions ? <div className="ml-1 flex items-center border-l border-dls-border pl-2">{props.headerActions}</div> : null}
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
</header><div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6" onScroll={(event) => { if (programmaticScrollRef.current) return; const el = event.currentTarget; const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight; stickToBottomRef.current = distanceFromBottom <= 80; }} ><div className={localAgentLayoutClass.pageContent}> {showManagement ? ( <LocalAgentManagementPanel agents={agents} workspaceRoot={props.workspaceRoot} selectedAgentId={selectedAgentId} refreshing={refreshing} providerLabel={(agent) => PROVIDER_LABELS[agent.provider] ?? agent.provider} providerIconUrl={(agent) => providerIconUrl(agent.provider)} onSelectAgent={(agentId) => setSelectedAgentId(agentId)} onAgentsChange={setAgents} onRefresh={() => void refreshAgents()} onConfigure={() => setShowManagement(false)} onRepairAction={(action: LocalAgentRepairAction) => { if (action === "recheck") void refreshAgents(); }} supportedRepairActions={["recheck"]} /> ) : null} {activeRuns.length ? ( <ActiveRunsOverview activeRuns={activeRuns} selectedChatKey={selectedChatKey} onSelectAgent={(chatKey) => { const [agentId, conversationId] = chatKey.split("::"); if (agentId) setSelectedAgentId(agentId); if (agentId && conversationId) { setSelectedConversationIdByAgent((current) => ({ ...current, [agentId]: conversationId })); } }} onCancelRun={(runId, chatKey) => void cancelAgentRun(runId, chatKey)} /> ) : null} {selectedMessages.map((message) => ( <ChatBubble key={message.id} message={message} workspaceRoot={props.workspaceRoot} agent={selectedAgent} selectedModel={selectedModel} onOpenArtifact={props.onOpenArtifact} onResolveApproval={resolveApproval} onResolveTip={() => setShowManagement(true)} onSideQuestion={(value) => void sendSideQuestion(value)} /> ))} {selectedError ? <NoticeBox tone="error">{selectedError}</NoticeBox> : null} </div></div><footer className="shrink-0 bg-dls-surface px-6 pb-5 pt-2">
        <div className={localAgentLayoutClass.chatPanel}>
          <LocalAgentDraftComposer
            draftKey={selectedChatKey}
            initialDraft={draft}
            disabled={!selectedAgent || selectedAgent.status !== "online"}
            submitting={running}
            placeholder={selectedAgent?.status === "online" ? t("local_agent.input_placeholder") : t("local_agent.input_placeholder_unavailable")}
            slashCommands={selectedSlashCommands}
            onDraftCommit={updateDraftForChat}
            onSlashCommandExecute={handleSlashCommandExecute}
            onSubmit={(value) => { updateDraftForChat(selectedChatKey, value); void submitComposerValue(value); }}
            toolbarLeft={
              <div className="min-w-[136px]">
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
            }
            toolbarRight={
              <>
                {selectedAgent && agentSupportsSideQuestion(selectedAgent) ? (
                  <BtwOverlay
                    disabled={!selectedAgent || selectedAgent.status !== "online"}
                    submitting={false}
                    onSubmit={(value) => void sendSideQuestion(value)}
                  />
                ) : null}
                {activeRun?.status === "running" ? (
                  <Button variant="outline" size="sm" onClick={() => void cancelRun()}>
                    <CircleStop className="mr-1.5 size-3.5" />
                    {t("composer.stop")}
                  </Button>
                ) : null}
              </>
            }
          />
        </div>
      </footer></main></div> );
}
function ActiveRunsOverview(props: { activeRuns: Array<{ chatKey: string; agentId: string; agent: PersonalLocalAgent | null; run: PersonalLocalAgentRunResult }>; selectedChatKey: string | null; onSelectAgent: (chatKey: string) => void; onCancelRun?: (runId: string, chatKey: string) => void;
}) { return ( <section className={activeRunClass.overview}><div className={localAgentTextClass.runSectionTitle}><Activity className="size-4" />{t("local_agent.active_runs")} <CountBadge size="dot" className="bg-dls-accent/10 text-dls-accent">{props.activeRuns.length}</CountBadge></div><div className="grid gap-2"> {props.activeRuns.map(({ chatKey, agentId, agent, run }) => { const isSelected = props.selectedChatKey === chatKey; return ( <div key={run.runId} className={cn( activeRunClass.item, isSelected ? activeRunClass.itemSelected : activeRunClass.itemDefault, )} ><ActionRowButton type="button" onClick={() => props.onSelectAgent(chatKey)} density="compact" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left hover:bg-transparent" title={isSelected ? t("local_agent.current_agent_running") : t("local_agent.switch_to_agent_detail")} ><div className="flex flex-wrap items-center justify-between gap-2"><span className={localAgentTextClass.runItemTitle}><StatusPing /><span className="truncate">{agent?.name ?? agentId}</span></span><span className={activeRunClass.runId}>Run {run.runId}</span></div><div className={activeRunClass.meta}><span>{run.pendingApprovals?.length ? t("local_agent.waiting_approval_count", { count: run.pendingApprovals.length }) : t("local_agent.elapsed", { value: elapsedSeconds(run.startedAt, null) })}</span><span>{t("local_agent.latest_event", { time: shortTime(lastEventTime(run)) })}</span><span>{t("local_agent.connection", { value: run.connectionMode || "--" })}</span></div></ActionRowButton> {props.onCancelRun ? ( <Button variant="outline" size="sm" className={activeRunClass.cancel} onClick={() => props.onCancelRun?.(run.runId, chatKey)} title={t("local_agent.stop_run")} ><CircleStop className="mr-1 size-3.5" />{t("composer.stop")} </Button> ) : null} </div> ); })} </div></section> );
}
