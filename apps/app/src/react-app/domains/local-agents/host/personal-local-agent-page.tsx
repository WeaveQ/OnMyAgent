import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Activity,
  Bot,
  CircleStop,
  Clock3,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActionRowButton, SessionRowButton } from "@/components/ui/action-row";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NoticeBox } from "@/components/ui/notice-box";
import { CountBadge, StatusBadge } from "@/components/ui/status-badge";
import { StatusPing } from "@/components/ui/status-dot";
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
  personalLocalAgentConversationGetById,
  personalLocalAgentConversationStatus,
  personalLocalAgentChannelConversationsList,
  personalLocalAgentConversationsList,
  personalLocalAgentConversationsListByProvider,
  personalLocalAgentConversationImportFromArchive,
  personalLocalAgentHeartbeatCreate,
  personalLocalAgentHeartbeatDelete,
  personalLocalAgentHeartbeatRunNow,
  personalLocalAgentHeartbeatsList,
  personalLocalAgentHeartbeatUpdate,
  personalLocalAgentResetConversation,
  personalLocalAgentValidate,
  personalLocalAgentStatus,
  pickDirectory,
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
import { type OpenTarget } from "../../../capabilities/artifacts/open-target";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import { resolveAgentIconUrlFor } from "../agent-icon-map";
import { latestContextUsage } from "../context-usage-indicator";
import { useAcpInitialMessage } from "../hooks/use-acp-initial-message";
import { useAcpModelInfo } from "../hooks/use-acp-model-info";
import { useConversationHistoryHydration } from "../hooks/use-conversation-history-hydration";
import {
  LocalAgentDraftComposer,
  buildLocalAgentPrompt,
  type LocalAgentComposerSubmit,
  type LocalAgentSlashCommand,
} from "../local-agent-draft-composer";
import { elapsedSeconds, shortTime } from "../local-agent-formatters";
import {
  APPROVAL_MODE_OPTIONS,
  DEFAULT_HEALTH_RESULT,
  DEFAULT_HEARTBEAT_PROMPT,
  LOCAL_AGENT_LIST_DEFAULT_WIDTH,
  LOCAL_AGENT_LIST_MAX_WIDTH,
  LOCAL_AGENT_LIST_MIN_WIDTH,
  agentFromAcpMetadata,
  agentIdFromChatKey,
  builtinSlashCommands,
  chooseInitialModel,
  compactMessagesByAgent,
  isUnsupportedNativeTranscriptError,
  localAgentChatKey,
  mergeSlashCommands,
  modelSelectorLabel,
  nativeSessionResumeOnlyMessage,
  normalizeAcpSlashCommandList,
  normalizeAcpSlashCommands,
  personalAgentApprovalModeKey,
  personalAgentChatStateKey,
  personalAgentModelPrefKey,
  recoverActiveRunIds,
  safeReadApprovalMode,
  safeReadCachedAgents,
  safeReadPersistedChatState,
  safeWriteCachedAgents,
  transcriptMessagesForAgent,
  welcomeMessageForAgent,
  type PersistedLocalAgentChatState,
} from "../local-agent-page-model";
import type { AgentHealthResult } from "../local-agent-page-types";
import type { LocalAgentRepairAction } from "../local-agent-repair-panel";
import { LocalAgentStatusRail } from "../local-agent-status-rail";
import { ChatBubble } from "../messages/chat-bubble";
import type { ChatMessage } from "../messages/message-types";
import { collectRunOpenTargets, isRunFinal } from "../messages/message-utils";
import { lastEventTime } from "../messages/timeline-messages";
import {
  HeartbeatPanel,
  conversationTitle,
  heartbeatClass,
  scheduledRunMessage,
  scheduledTaskSessionContext,
  type HeartbeatDraft,
} from "../personal-local-agent-scheduled-tasks";
import {
  addRecentWorkspace,
  getRecentWorkspaces,
  readWorkspaceOverride,
  writeWorkspaceOverride,
} from "../workspace-picker/recent-workspaces";
import { WorkspaceFootnote } from "../workspace-picker/workspace-footnote";
import type { SessionArchiveResumeRequest } from "./archive-resume-types";
import { ListPaneCollapseToggle } from "./list-pane-collapse-toggle";
import { ActiveRunsOverview } from "./personal-local-agent-active-runs";
import {
  agentSubtitle,
  lastRunForAgent,
  localAgentLayoutClass,
  localAgentTextClass,
  messageTextForRun,
  nowId,
  placeholderRunFromProcess,
} from "./personal-local-agent-page-helpers";
import { PersonalLocalAgentModelSelector } from "./personal-local-agent-model-selector";
import { useArchiveResume } from "./use-archive-resume";
import { useWorkspaceOverride } from "./use-workspace-override";
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
  /** Navigate to the Agent Management tab (skills panel by default). */
  onOpenAgentManagement?: (panel?: "skills" | "mcp" | "providers" | "agents") => void;
  resumeRequest?: SessionArchiveResumeRequest | null;
  onResumeConsumed?: () => void;
  /** OnMyAgent server client used to fetch archived session messages when
   *  resuming a cross-workspace / server-side session (see 诉求2). */
  onmyagentServerClient?: OnMyAgentServerClient | null;
  /** Workspace id used to query the session-archive API (may differ from the
   *  local filesystem workspaceRoot). */
  runtimeWorkspaceId?: string | null;
};
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
  // Drop orphaned run errors cached from a previous process restart. These are
  // stale false failures — the run may have since completed on disk — and their
  // persisted error text misleads the user on every app restart.
  const sanitizedMessagesByAgent: Record<string, ChatMessage[]> = {};
  for (const [key, messages] of Object.entries(persistedState.messagesByAgent ?? {})) {
    sanitizedMessagesByAgent[key] = (messages ?? []).filter((message) => {
      const run = message.run;
      if (run?.errorInfo?.code === "orphaned") return false;
      if (run?.status === "failed" && typeof message.text === "string" && message.text.includes("\u8BE5 run \u56E0\u4E3B\u8FDB\u7A0B\u91CD\u542F")) return false;
      return true;
    });
  }
  const sanitizedErrorsByAgent: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(persistedState.errorsByAgent ?? {})) {
    sanitizedErrorsByAgent[key] = typeof value === "string" && value.includes("\u8BE5 run \u56E0\u4E3B\u8FDB\u7A0B\u91CD\u542F") ? null : value;
  }
  const initialAgents = initialAgentsRef.current;
  const [agents, setAgents] = useState<PersonalLocalAgent[]>(initialAgents);
  const [selectedAgentId, setSelectedAgentId] = useState(persistedState.selectedAgentId || "opencode");
  const [query, setQuery] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [agentListCollapsed, setAgentListCollapsed] = useState(false);
  const [agentListWidth, setAgentListWidth] = useState(LOCAL_AGENT_LIST_DEFAULT_WIDTH);
  const [draftsByAgent, setDraftsByAgent] = useState<Record<string, string>>(persistedState.draftsByAgent ?? {});
  const [refreshing, setRefreshing] = useState(initialAgents.length === 0);
  const [startingByAgent, setStartingByAgent] = useState<Record<string, boolean>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [errorsByAgent, setErrorsByAgent] = useState<Record<string, string | null>>(sanitizedErrorsByAgent);
  const [activeRunIdByAgent, setActiveRunIdByAgent] = useState<Record<string, string | null>>(
    recoverActiveRunIds(sanitizedMessagesByAgent, persistedState.activeRunIdByAgent),
  );
  const [healthResults, setHealthResults] = useState<Record<string, AgentHealthResult>>(persistedState.healthResults ?? {});
  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, ChatMessage[]>>(sanitizedMessagesByAgent);
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
  const [showActiveRunsPanel, setShowActiveRunsPanel] = useState(false);
  const [selectedConversationIdByAgent, setSelectedConversationIdByAgent] = useState<Record<string, string>>(persistedState.selectedConversationIdByAgent ?? {});
  const [loadingConversationsByAgent, setLoadingConversationsByAgent] = useState<Record<string, boolean>>({});
  // Channel-bound conversations (source:"channel") live under scoped agents
  // not present in the ACP agent list, so they are tracked separately and
  // surfaced in a dedicated "Channel sessions" group above the agent list.
  const [channelConversations, setChannelConversations] = useState<PersonalLocalAgentConversation[]>([]);
  const [loadingChannelConversations, setLoadingChannelConversations] = useState(false);
  const [selectedChannelConversationId, setSelectedChannelConversationId] = useState<string | null>(null);
  // When a channel conversation is the active view, the rest of the page reads
  // from these "virtual" selections instead of the ACP agent partition.
  const activeChannelConversation = channelConversations.find((item) => item.id === selectedChannelConversationId) ?? null;
  // Channel conversations live under scoped agents (`-feishu-<hash>` etc.) that
  // are intentionally NOT surfaced in the ACP agent list. To make them
  // selectable/switchable like normal sessions we surface them through a single
  // synthetic "Channel sessions" agent that is kept in its own state so it is
  // never overwritten by `setAgents` (agent refreshes / re-detects).
  const CHANNEL_AGENT_ID = "__channel_sessions__";
  const channelAgent = useMemo<PersonalLocalAgent | null>(() => {
    if (channelConversations.length === 0) return null;
    // Synthetic entry: rendered in its own "Channel sessions" section, never
    // in the ACP agent list. Use `custom` provider so it satisfies the shared
    // PersonalLocalAgent shape without polluting real provider enums.
    return {
      id: CHANNEL_AGENT_ID,
      name: t("local_agent.channel_sessions_title"),
      provider: "custom",
      status: "online",
      executablePath: "",
      model: null,
      customArgs: [],
      modelOptions: [],
      defaultModel: null,
      version: null,
      error: null,
      lastCheckedAt: null,
    };
  }, [channelConversations.length]);
  // The agent list used everywhere (rendering + selection) is the merged view of
  // real ACP agents plus the synthetic channel agent.
  const allAgents = useMemo(() => {
    const base = channelAgent ? [...agents, channelAgent] : agents;
    return base;
  }, [agents, channelAgent]);
  const [approvalMode, setApprovalMode] = useState<PersonalLocalAgentApprovalMode>(() => safeReadApprovalMode(props.workspaceRoot));
  const [workspaceOverride, setWorkspaceOverrideState] = useState<string>(() => readWorkspaceOverride());
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>(() => getRecentWorkspaces());
  const effectiveWorkspaceRoot = (workspaceOverride.trim() || props.workspaceRoot || "").trim();

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
    () => allAgents.find((agent) => agent.id === selectedAgentId) ?? allAgents[0] ?? null,
    [allAgents, selectedAgentId],
  );
  // When the synthetic channel agent is selected, the conversation list is the
  // channel conversations (driven by selectedChannelConversationId) rather than
  // the per-ACP-agent partition.
  const isChannelView = selectedAgentId === CHANNEL_AGENT_ID;
  const selectedConversations = isChannelView
    ? channelConversations
    : selectedAgent
      ? (conversationsByAgent[selectedAgent.id] ?? [])
      : [];
  const selectedConversationId = isChannelView
    ? selectedChannelConversationId
    : selectedAgent
      ? selectedConversationIdByAgent[selectedAgent.id] ?? selectedConversations[0]?.id ?? null
      : null;
  const selectedConversation = isChannelView
    ? activeChannelConversation
    : selectedConversations.find((item) => item.id === selectedConversationId) ?? selectedConversations[0] ?? null;
  // Per-conversation workspace binding: an existing conversation shows its own
  // `workdir` and locks the chip (read-only). A not-yet-created / empty
  // conversation uses the page-level override (editable) so the user can pick a
  // directory before the first message. This matches Upstream's per-navigation
  // workspace semantics instead of a single global override.
  const selectedConversationWorkdir = selectedConversation?.workdir?.trim() || "";
  const displayWorkspaceRoot = selectedConversationWorkdir || effectiveWorkspaceRoot;
  const selectedAcpModelInfo = useAcpModelInfo(selectedAgent);
  const selectedHeartbeatJobs = selectedAgent ? heartbeatJobs.filter((job) => job.agent?.id === selectedAgent.id) : [];
  const selectedChatKey = selectedAgent ? localAgentChatKey(selectedAgent.id, selectedConversationId) : "";
  // The workspace chip stays editable ONLY while the conversation is truly
  // fresh: it has no committed `workdir` AND no real messages yet. Before the
  // first message the user may freely pick / re-pick a project (so a wrong
  // choice can be corrected). Sending the first message commits the workdir on
  // the server and permanently locks the chip. This keeps the chip's editable
  // state consistent with `selectedIsFreshConversation()` (the rebase guard),
  // avoiding the case where the chip looks editable but re-picking silently
  // does nothing.
  const handleWarmupResult = useCallback((result: { ok: boolean; providerSessionId?: string | null }) => {
    if (!result.ok || !selectedAgent || !selectedConversationId) return;
    if (result.providerSessionId) {
      setConversationsByAgent((current) => ({
        ...current,
        [selectedAgent.id]: (current[selectedAgent.id] ?? []).map((conversation) => conversation.id === selectedConversationId ? { ...conversation, providerSessionId: result.providerSessionId ?? conversation.providerSessionId, resumeKey: result.providerSessionId ?? conversation.resumeKey } : conversation),
      }));
    }
    // After the ACP warmup handshake completes, the runtime has persisted the
    // session metadata (available_models, config options, commands) into the
    // session-store. Re-pull the agent list so `listAgents` hydrates that
    // metadata into `agent.handshake` — this is what makes the model selector
    // appear for custom/ACP agents (which have no static `modelOptions`),
    // matching Upstream's "models become selectable after the session handshake"
    // behavior. Without this the handshake stays cold and the selector never
    // shows. `useAcpInitialMessage` de-dupes warmups by key, so refreshing the
    // agents here cannot cause a warmup loop.
    void personalLocalAgentAcpAgentsList({ workspaceRoot: effectiveWorkspaceRoot, includeModels: false })
      .then((listed) => {
        const nextAgents = listed.agents.map(agentFromAcpMetadata);
        setAgents(nextAgents);
        safeWriteCachedAgents(props.workspaceRoot, nextAgents);
      })
      .catch(() => undefined);
  }, [effectiveWorkspaceRoot, props.workspaceRoot, selectedAgent, selectedConversationId]);
  useAcpInitialMessage({ workspaceRoot: effectiveWorkspaceRoot, agent: selectedAgent, conversationId: selectedConversationId, approvalMode, model: selectedModel, disabled: isChannelView, onWarmup: handleWarmupResult }); useConversationHistoryHydration({ workspaceRoot: effectiveWorkspaceRoot, agent: isChannelView ? null : selectedAgent, conversationId: selectedConversationId, messagesByAgent, setMessagesByAgent });
  const filteredAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    // The synthetic channel agent is rendered in its own section below, not as
    // a normal agent row.
    const realAgents = allAgents.filter((agent) => agent.id !== CHANNEL_AGENT_ID);
    if (!normalized) return realAgents;
    return realAgents.filter((agent) =>
      `${agent.name} ${agent.executablePath} ${agent.version ?? ""}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [allAgents, query]);
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
  const selectedSlashCommands = useMemo(() => {
    // Fold live `available_commands` events (last one wins) on top of the
    // handshake snapshot so slash suggestions stay in sync when the CLI adds
    // or removes commands mid-session — this matches Upstream's behavior.
    let liveCommands: unknown = null;
    for (let index = selectedMessages.length - 1; index >= 0 && !liveCommands; index -= 1) {
      const runMessages = selectedMessages[index]?.run?.conversationMessages;
      if (!runMessages?.length) continue;
      for (let inner = runMessages.length - 1; inner >= 0; inner -= 1) {
        const candidate = runMessages[inner];
        if (candidate?.type === "available_commands" && Array.isArray(candidate.commands)) {
          liveCommands = candidate.commands;
          break;
        }
      }
    }
    const hasConversation = Boolean(selectedConversation);
    const acp = liveCommands ? normalizeAcpSlashCommandList(liveCommands) : normalizeAcpSlashCommands(selectedAgent);
    return mergeSlashCommands([...builtinSlashCommands(selectedAgent, { hasConversation }), ...acp]);
  }, [selectedAgent, selectedConversation, selectedMessages]);
  const draft = selectedAgent ? draftsByAgent[selectedChatKey] ?? "" : "";
  const activeRunId = selectedAgent ? activeRunIdByAgent[selectedChatKey] ?? null : null;
  const activeRun = useMemo(
    () => selectedMessages.find((message) => message.run?.runId === activeRunId)?.run ?? null,
    [activeRunId, selectedMessages],
  );
  const running = Boolean(activeRun?.status === "running" || (selectedAgent && startingByAgent[selectedChatKey]));
  const selectedError = selectedAgent ? errorsByAgent[selectedAgent.id] ?? null : null;
  const selectedCapability = selectedAgent?.capability ?? null;
  const selectedAgentIconUrl = selectedAgent ? resolveAgentIconUrlFor(selectedAgent) : null;
  const composerContextUsage = useMemo(() => {
    for (let index = selectedMessages.length - 1; index >= 0; index -= 1) {
      const message = selectedMessages[index];
      const usage = latestContextUsage(message?.run?.conversationMessages ?? []);
      if (usage) return usage;
    }
    return null;
  }, [selectedMessages]);
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
      const result = await personalLocalAgentConversationsListByProvider({ workspaceRoot: effectiveWorkspaceRoot, agent });
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
  }, [effectiveWorkspaceRoot, selectedConversationIdByAgent]);
  useEffect(() => {
    if (!selectedAgent) return;
    if (conversationsByAgent[selectedAgent.id]) return;
    void loadConversationsForAgent(selectedAgent);
  }, [conversationsByAgent, loadConversationsForAgent, selectedAgent]);
  // Channel conversations are not tied to any ACP agent, so load them directly
  // from the runtime (which scans every partition for source:"channel").
  const loadChannelConversations = useCallback(async () => {
    setLoadingChannelConversations(true);
    try {
      const result = await personalLocalAgentChannelConversationsList({ workspaceRoot: effectiveWorkspaceRoot });
      setChannelConversations(result.conversations ?? []);
    } catch {
      setChannelConversations([]);
    } finally {
      setLoadingChannelConversations(false);
    }
  }, [props.workspaceRoot, effectiveWorkspaceRoot]);
  useEffect(() => {
    void loadChannelConversations();
  }, [loadChannelConversations]);
  // Keep a valid channel selection whenever the channel set changes.
  useEffect(() => {
    if (channelConversations.length === 0) {
      if (selectedChannelConversationId !== null) setSelectedChannelConversationId(null);
      return;
    }
    if (!channelConversations.some((item) => item.id === selectedChannelConversationId)) {
      setSelectedChannelConversationId(channelConversations[0].id);
    }
  }, [channelConversations, selectedChannelConversationId]);
  useArchiveResume({
    resumeRequest: props.resumeRequest,
    agents,
    conversationsByAgent,
    channelConversations,
    effectiveWorkspaceRoot,
    workspaceRoot: props.workspaceRoot,
    channelAgentId: CHANNEL_AGENT_ID,
    onResumeConsumed: props.onResumeConsumed,
    onmyagentServerClient: props.onmyagentServerClient,
    runtimeWorkspaceId: props.runtimeWorkspaceId,
    setChannelConversations,
    setSelectedAgentId,
    setSelectedChannelConversationId,
    setConversationsByAgent,
    setSelectedConversationIdByAgent,
    setErrorsByAgent,
  });
  const loadHeartbeats = useCallback(async () => {
    try {
      const result = await personalLocalAgentHeartbeatsList({ workspaceRoot: effectiveWorkspaceRoot });
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
        workspaceRoot: effectiveWorkspaceRoot,
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
      const result = await personalLocalAgentAcpAgentsList({ workspaceRoot: effectiveWorkspaceRoot, includeModels: false });
      const nextAgents = result.agents.map(agentFromAcpMetadata);
      setAgents(nextAgents);
      safeWriteCachedAgents(props.workspaceRoot, nextAgents);
      if (nextAgents.length && selectedAgentId !== CHANNEL_AGENT_ID && !nextAgents.some((agent) => agent.id === selectedAgentId)) {
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
      void personalLocalAgentStatus({ runId, workspaceRoot: effectiveWorkspaceRoot })
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
          setMessagesByAgent((current) => {
            const list = current[chatKey] ?? (fallbackAgent ? [welcomeMessageForAgent(fallbackAgent)] : []);
            // For channel-initiated runs there is no renderer-side optimistic
            // user input, so the user's message would be invisible. Extract it
            // from the run's conversationMessages (recorded by the runtime as a
            // `user` event) and surface it as a real user ChatMessage bubble
            // right before the assistant reply. Dedup by a stable id so polling
            // never duplicates it.
            const userText = effectiveSnapshot.conversationMessages
              ?.find((m) => m.role === "user" && String(m.text ?? "").trim())
              ?.text?.trim() ?? "";
            const userMessageId = `user-${runId}`;
            const next = list.map((message) =>
              message.run?.runId === runId
                ? { ...message, text: messageTextForRun(effectiveSnapshot, message.text), run: effectiveSnapshot }
                : message,
            );
            if (!userText || next.some((m) => m.id === userMessageId)) {
              return { ...current, [chatKey]: next };
            }
            const assistantIndex = next.findIndex((m) => m.run?.runId === runId);
            if (assistantIndex === -1) return { ...current, [chatKey]: next };
            const userMessage = {
              id: userMessageId,
              role: "user" as const,
              text: userText,
              createdAt: effectiveSnapshot.startedAt ?? Date.now(),
            };
            const withUser = [...next.slice(0, assistantIndex), userMessage, ...next.slice(assistantIndex)];
            return { ...current, [chatKey]: withUser };
          });
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
        workspaceRoot: effectiveWorkspaceRoot,
        prompt,
        approvalMode,
        conversationId: runConversationId,
        workdir: effectiveWorkspaceRoot || null,
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
          snapshot = await personalLocalAgentStatus({ runId: started.runId, workspaceRoot: effectiveWorkspaceRoot });
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
  const clearCurrentAgentChat = useCallback(async () => {
    if (!selectedAgent || running) return;
    const agent = selectedAgent;
    setErrorsByAgent((current) => ({ ...current, [agent.id]: null }));
    try {
      const result = await personalLocalAgentResetConversation({
        workspaceRoot: effectiveWorkspaceRoot,
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
  // Workspace freshness + override logic (chip editable state, re-base into a
  // different project partition, recent-workspace list). Extracted into
  // `useWorkspaceOverride` so this page stays below the god-file line gate while
  // keeping the original behavior identical.
  const {
    chipEditable,
    applyWorkspaceOverride,
    clearWorkspaceOverride,
    browseWorkspaceOverride,
    workspaceRecentList,
  } = useWorkspaceOverride({
    selectedConversation,
    selectedConversationId,
    selectedAgent,
    running,
    effectiveWorkspaceRoot,
    propsWorkspaceRoot: props.workspaceRoot,
    selectedChatKey,
    selectedConversationWorkdir,
    messagesByAgent,
    recentWorkspaces,
    setConversationsByAgent,
    setSelectedConversationIdByAgent,
    setMessagesByAgent,
    setDraftsByAgent,
    setActiveRunIdByAgent,
    setWorkspaceOverrideState,
    setRecentWorkspaces,
  });
  const createNewConversation = useCallback(async () => {
    if (!selectedAgent || running) return;
    const agent = selectedAgent;
    setLoadingConversationsByAgent((current) => ({ ...current, [agent.id]: true }));
    setErrorsByAgent((current) => ({ ...current, [agent.id]: null }));
    try {
      const result = await personalLocalAgentConversationCreate({
        workspaceRoot: effectiveWorkspaceRoot,
        agent,
        // Do NOT pre-commit a `workdir` here. A brand-new conversation must stay
        // "fresh" (no committed workdir) so the workspace chip stays editable and
        // the user can mount a project. The run commits the workdir later based
        // on the page-level override (see `startAgentRun` -> `workdir`).
        workdir: null,
      });
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
  }, [effectiveWorkspaceRoot, props.workspaceRoot, running, selectedAgent]);
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
        workspaceRoot: effectiveWorkspaceRoot,
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
        workspaceRoot: effectiveWorkspaceRoot,
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
      const result = await personalLocalAgentHeartbeatRunNow({ workspaceRoot: effectiveWorkspaceRoot, jobId: job.id });
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
      const result = await personalLocalAgentHeartbeatDelete({ workspaceRoot: effectiveWorkspaceRoot, jobId: job.id });
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
        workspaceRoot: effectiveWorkspaceRoot,
        conversationId: conversation.id,
        providerSessionId: conversation.providerSessionId,
        resumeKey: conversation.resumeKey,
        agent,
        limit: 80,
      });
      setMessagesByAgent((current) => {
        // Preserve any history already hydrated from Studio's own persisted
        // transcript (conversation-events). The native provider transcript is
        // often unavailable (e.g. "Codex session transcript file was not found"),
        // and in that case we must NOT overwrite the real Studio history with a
        // "this agent does not expose a transcript" placeholder.
        const existing = current[key];
        const hasExisting = Array.isArray(existing) && existing.length > 0;
        const next = result.messages.length
          ? transcriptMessagesForAgent(agent, result.messages)
          : isUnsupportedNativeTranscriptError(result.error)
            ? (hasExisting ? existing : [nativeSessionResumeOnlyMessage(agent, conversation)])
            : (hasExisting ? existing : [welcomeMessageForAgent(agent)]);
        return { ...current, [key]: next };
      });
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
  const submitComposerPayload = useCallback(async (payload: LocalAgentComposerSubmit) => {
    const trimmed = payload.text.trim();
    if (trimmed.startsWith("/") && payload.attachments.length === 0 && payload.quotes.length === 0) {
      const acpMatch = selectedSlashCommands.find((command) => command.source === "acp" && command.name.toLowerCase() === trimmed.toLowerCase());
      if (acpMatch) {
        // ACP-provided commands (including /compact) are transparently forwarded
        // to the CLI as a normal prompt. Upstream does the same: the CLI itself
        // owns the compaction/summarization semantics.
      } else if (trimmed === "/new") {
        await createNewConversation();
        return;
      } else if (trimmed === "/clear") {
        await clearCurrentAgentChat();
        return;
      } else if (trimmed === "/sessions") {
        await refreshAgents();
        return;
      } else if (trimmed === "/open") {
        const key = selectedChatKey;
        if (key) document.getElementById(`local-agent-file-input-${key}`)?.click();
        return;
      } else if (trimmed === "/copy") {
        const messages = selectedMessages;
        const text = messages
          .map((message) => {
            if (!message.text) return "";
            const role = message.role === "user" ? "User" : "Agent";
            return `${role}: ${message.text}`;
          })
          .filter(Boolean)
          .join("\n\n")
          .trim();
        if (!text) {
          setErrorsByAgent((current) => ({ ...current, [selectedAgentId]: t("local_agent.slash_copy_empty") }));
        } else if (typeof navigator !== "undefined" && navigator.clipboard) {
          try {
            await navigator.clipboard.writeText(text);
            setErrorsByAgent((current) => ({ ...current, [selectedAgentId]: t("local_agent.slash_copy_success") }));
          } catch {
            setErrorsByAgent((current) => ({ ...current, [selectedAgentId]: t("local_agent.slash_unknown", { command: trimmed }) }));
          }
        }
        return;
      } else {
        setErrorsByAgent((current) => ({ ...current, [selectedAgentId]: t("local_agent.slash_unknown", { command: trimmed }) }));
        return;
      }
    }
    if (payload.unresolvedMentions.length) {
      setErrorsByAgent((current) => ({
        ...current,
        [selectedAgentId]: t("local_agent.composer_unresolved_mentions", { tokens: payload.unresolvedMentions.join(", ") }),
      }));
      return;
    }
    const augmented = buildLocalAgentPrompt(payload);
    if (!augmented) return;
    await startAgentRun(augmented);
  }, [clearCurrentAgentChat, createNewConversation, selectedAgentId, startAgentRun]);
  const submitComposerValue = useCallback(async (value: string) => {
    await submitComposerPayload({ text: value, attachments: [], mentions: {}, quotes: [], unresolvedMentions: [] });
  }, [submitComposerPayload]);
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
      const snapshot = await personalLocalAgentStatus({ runId, workspaceRoot: effectiveWorkspaceRoot });
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
      const snapshot = await personalLocalAgentStatus({ runId: approval.runId, workspaceRoot: effectiveWorkspaceRoot });
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
  <div
    data-onmyagent-view="personal-assistant"
    className="relative flex h-full min-h-0 overflow-hidden bg-dls-background text-dls-text"
  >
    <aside
      className="flex shrink-0 flex-col overflow-hidden bg-dls-sidebar pb-5 mac:bg-dls-sidebar"
      style={{
        width: agentListCollapsed ? 0 : agentListWidth,
      }}
    >
      {agentListCollapsed ? null : (
        <>
          <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-dls-mist px-4">
            <InputGroup
              controlSize="sm"
              radius="md"
              tone="surfaceMuted"
              className="flex-1"
            >
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
              onClick={() => setShowActiveRunsPanel(true)}
              className="relative shrink-0 rounded-md border border-dls-border bg-dls-surface-muted text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
              title={t("local_agent.active_runs_title")}
              aria-label={t("local_agent.active_runs_title")}
              aria-expanded={showActiveRunsPanel}
            >
              <Activity className="size-4.5" />
              {activeRuns.length ? (
                <CountBadge
                  size="dot"
                  className="absolute right-0 top-0 translate-x-1/2 -translate-y-1/2 bg-dls-accent text-dls-surface"
                >
                  {activeRuns.length}
                </CountBadge>
              ) : null}
            </Button>

            <Button
              type="button"
              size="icon-sm"
              onClick={() => void createNewConversation()}
              className="relative shrink-0 rounded-md border border-dls-border bg-dls-surface-muted text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
              title={t("local_agent.new_conversation")}
              aria-label={t("local_agent.new_conversation")}
            >
              <Plus className="size-4.5" />
            </Button>

            <Button
              type="button"
              size="icon-sm"
              onClick={() => setShowAddForm((value) => !value)}
              className="relative shrink-0 rounded-md border border-dls-border bg-dls-surface-muted text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
              title={t("local_agent.add")}
              aria-label={t("local_agent.add")}
            >
              <Bot className="size-4.5" />
              <Plus
                className="absolute right-1.5 top-1.5 size-2.5"
                strokeWidth={3}
              />
            </Button>
          </div>

          {showAddForm ? (
            <div className="mx-4 mt-3 rounded-lg border border-dls-border bg-dls-surface-muted p-3">
              <div className={localAgentTextClass.panelTitle}>
                {t("local_agent.add")}
              </div>

              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() => void refreshAgents()}
                disabled={refreshing}
              >
                {refreshing ? (
                  <LoadingSpinner size="sm" className="mr-1.5" />
                ) : null}
                {t("local_agent.redetect")}
              </Button>
            </div>
          ) : null}

          {props.onOpenAgentManagement ? (
            <div className="mx-4 mt-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-auto p-0 text-dls-accent hover:bg-transparent hover:text-dls-accent"
                onClick={() => props.onOpenAgentManagement?.("agents")}
              >
                {t("local_agent.manage_agents")}…
              </Button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredAgents.length > 0 ? (
              <div>
                {filteredAgents.map((agent) => {
                  const agentActiveRunKey =
                    Object.entries(activeRunIdByAgent).find(
                      ([chatKey, runId]) =>
                        Boolean(runId) &&
                        agentIdFromChatKey(chatKey) === agent.id,
                    )?.[0] ?? null;

                  const lastRun = agentActiveRunKey
                    ? lastRunForAgent(messagesByAgent[agentActiveRunKey])
                    : lastRunForAgent(messagesByAgent[agent.id]);

                  const iconUrl = resolveAgentIconUrlFor(agent);

                  const hasActiveRun = Boolean(
                    agentActiveRunKey &&
                      lastRun &&
                      lastRun.runId === activeRunIdByAgent[agentActiveRunKey] &&
                      lastRun.status === "running",
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
                            <img
                              src={iconUrl}
                              alt=""
                              className="size-7 object-contain"
                              loading="lazy"
                              draggable={false}
                            />
                          ) : (
                            <Bot className="size-5" />
                          )}
                        </div>

                        <span
                          className={cn(
                            localAgentLayoutClass.agentStatusDot,
                            selectedAgentId === agent.id
                              ? "border-dls-list-selected"
                              : "border-dls-sidebar",
                            agent.status === "online"
                              ? "bg-dls-online"
                              : "bg-dls-secondary",
                          )}
                        />

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
                          <div className={localAgentTextClass.rowTitle}>
                            {agent.name}
                          </div>
                        </div>

                        <div className="mt-1 flex min-w-0 items-center gap-1.5">
                          <div className="min-w-0 flex-1 truncate text-xs leading-5 text-dls-secondary">
                            {agent.status === "online"
                              ? agentSubtitle(agent)
                              : agent.error ||
                                t("local_agent.check_install_or_login")}
                          </div>

                          {hasActiveRun ? (
                            <StatusDot size="md" tone="active" />
                          ) : null}
                        </div>
                      </div>
                    </SessionRowButton>
                  );
                })}
              </div>
            ) : refreshing ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm leading-5 text-dls-secondary">
                <LoadingSpinner size="default" className="text-dls-accent" />
                <div>
                  {t("local_agent.detecting")}
                  <div className="mt-1 text-xs text-dls-secondary/75">
                    {t("local_agent.detecting_desc")}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm leading-5 text-dls-secondary">
                {t("local_agent.empty")}
              </div>
            )}
          </div>
        </>
      )}
    </aside>

    {agentListCollapsed ? null : (
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
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-focus-visible:bg-dls-accent" />
      </div>
    )}

    <ListPaneCollapseToggle
      collapsed={agentListCollapsed}
      onToggle={() => setAgentListCollapsed((value) => !value)}
      style={{
        left: agentListCollapsed ? 0 : agentListWidth,
      }}
    />

    <main className="flex min-w-0 flex-1 flex-col bg-dls-background">
   <header className={localAgentLayoutClass.header}>
  <div className="flex h-12 items-center gap-2 px-4 mac:titlebar-no-drag">
    <div className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dls-border bg-dls-surface-muted text-dls-accent">
      {isChannelView ? (
        <MessageSquare className="size-4" />
      ) : selectedAgentIconUrl ? (
        <img src={selectedAgentIconUrl} alt="" className="size-5 object-contain" loading="lazy" draggable={false} />
      ) : (
        <UserRound className="size-4" />
      )}
      {selectedAgent && !isChannelView ? (
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
          if (isChannelView) {
            setSelectedChannelConversationId(value);
            return;
          }
          setSelectedConversationIdByAgent((current) => ({ ...current, [selectedAgent.id]: value }));
        }}
        disabled={!selectedAgent || running || Boolean(selectedAgent && !isChannelView && loadingConversationsByAgent[selectedAgent.id])}
      />
    </div>
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => void createNewConversation()}
      disabled={!selectedAgent || running || isChannelView || Boolean(selectedAgent && loadingConversationsByAgent[selectedAgent.id])}
      title={t("local_agent.new_conversation")}
      aria-label={t("local_agent.new_conversation")}
    >
      {selectedAgent && loadingConversationsByAgent[selectedAgent.id] ? <LoadingSpinner size="default" /> : <Plus className="size-4" />}
    </Button>
    {!isChannelView && selectedAcpModelInfo.supportsModelOverride ? (
      <PersonalLocalAgentModelSelector
        agent={selectedAgent}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        workspaceRoot={effectiveWorkspaceRoot}
        disabled={!selectedAgent || running}
        acpModelInfo={selectedAcpModelInfo}
      />
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
</header><LocalAgentStatusRail workspaceRoot={effectiveWorkspaceRoot} agent={selectedAgent ?? null} conversationId={selectedConversationId ?? null} onOpenManagement={() => props.onOpenAgentManagement?.("skills")} /><div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6" onScroll={(event) => { if (programmaticScrollRef.current) return; const el = event.currentTarget; const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight; stickToBottomRef.current = distanceFromBottom <= 80; }} ><div className={localAgentLayoutClass.pageContent}> {selectedMessages.map((message) => ( <ChatBubble key={message.id} message={message} workspaceRoot={effectiveWorkspaceRoot} agent={selectedAgent} selectedModel={selectedModel} onOpenArtifact={props.onOpenArtifact} onResolveApproval={resolveApproval} onResolveTip={() => props.onOpenAgentManagement?.("skills")} /> ))} {selectedError ? <NoticeBox tone="error">{selectedError}</NoticeBox> : null} </div></div><footer className="shrink-0 bg-dls-surface px-6 pb-5 pt-2">
        <div className={localAgentLayoutClass.chatPanel}>
          <div className="flex flex-wrap items-center gap-2 px-1 pb-2 pt-1">
            <WorkspaceFootnote
              workspaceRoot={displayWorkspaceRoot}
              recentWorkspaces={workspaceRecentList}
              disabled={running || !chipEditable}
              readOnly={!chipEditable}
              onSelect={applyWorkspaceOverride}
              onClear={clearWorkspaceOverride}
              onBrowse={() => { void browseWorkspaceOverride(); }}
            />
          </div>
          <LocalAgentDraftComposer
            draftKey={selectedChatKey}
            workspaceRoot={effectiveWorkspaceRoot}
            initialDraft={draft}
            disabled={!selectedAgent || isChannelView || selectedAgent.status !== "online"}
            submitting={running}
            placeholder={isChannelView ? t("local_agent.channel_session_readonly") : selectedAgent?.status === "online" ? t("local_agent.input_placeholder") : t("local_agent.input_placeholder_unavailable")}
            slashCommands={selectedSlashCommands}
            onDraftCommit={updateDraftForChat}
            onSlashCommandExecute={handleSlashCommandExecute}
            contextUsage={composerContextUsage}
            onSubmit={(payload) => { updateDraftForChat(selectedChatKey, ""); void submitComposerPayload(payload); }}
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
      </footer></main>
      <Dialog open={showActiveRunsPanel} onOpenChange={setShowActiveRunsPanel}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("local_agent.active_runs_title")}</DialogTitle>
          </DialogHeader>
          <ActiveRunsOverview
            activeRuns={activeRuns}
            selectedChatKey={selectedChatKey}
            showTitle={false}
            onSelectAgent={(chatKey) => {
              setShowActiveRunsPanel(false);
              const [agentId, conversationId] = chatKey.split("::");
              if (agentId) setSelectedAgentId(agentId);
              if (agentId && conversationId) {
                setSelectedConversationIdByAgent((current) => ({ ...current, [agentId]: conversationId }));
              }
            }}
            onCancelRun={(runId, chatKey) => void cancelAgentRun(runId, chatKey)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
