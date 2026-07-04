/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { BarChart3, CommandIcon, Download, Ellipsis, FolderOpen, MessageSquareText, RefreshCw, Search, Settings, Star, Terminal, Trash2 } from "lucide-react";

import { t } from "../../../../i18n";
import {
  buildSessionArchiveCommandItems,
  EMPTY_SESSION_ARCHIVE_ANALYTICS_HEATMAP,
  EMPTY_SESSION_ARCHIVE_ANALYTICS_SESSIONS,
  EMPTY_SESSION_ARCHIVE_ANALYTICS_SIGNALS,
  EMPTY_SESSION_ARCHIVE_ANALYTICS_SKILLS,
  EMPTY_SESSION_ARCHIVE_ANALYTICS_TOOLS,
  EMPTY_SESSION_ARCHIVE_ANALYTICS_VELOCITY,
  SESSION_ARCHIVE_ARCHIVE_MESSAGE_LIMIT,
  SESSION_ARCHIVE_ARCHIVE_PAGE_LIMIT,
  groupSessionArchiveSessions,
  sessionArchiveImportStatsMessage,
  sessionArchiveAgentCounts,
  mergeSessionArchiveSessionPage,
  nextSessionArchiveSessionId,
  normalizeLatestSessionArchiveMessages,
  plainSessionArchiveSnippet,
  prependOlderSessionArchiveMessages,
  sessionArchiveTranscriptMessages,
  splitSessionArchiveLines,
  type SessionArchiveAnalyticsState,
  type SessionArchiveCommandItem,
  type SessionArchiveImportKind,
  type SessionArchivePanel,
} from "./session-page-session-archive-model";
import {
  AnalyticsPanel,
  ArchiveStateBlock,
  SettingsPanel,
  SessionArchiveCommandPalette,
  TrashSessionList,
  UsagePanel,
  VirtualMessageList,
  VirtualSessionList,
} from "./session-page-session-archive-components";
import type {
  OpenworkSessionArchiveBackendsStatusResponse,
  OpenworkSessionArchiveConfigSnapshot,
  OpenworkSessionArchiveExportResponse,
  OpenworkSessionArchiveLifecycleStatus,
  OpenworkSessionArchiveMessagesResponse,
  OpenworkSessionArchivePinnedMessage,
  OpenworkSessionArchiveSearchResponse,
  OpenworkSessionArchiveSessionSearchResponse,
  OpenworkSessionArchiveSecretConfidence,
  OpenworkSessionArchiveSecretFinding,
  OpenworkSessionArchiveSecretScanSummary,
  OpenworkSessionArchiveSession,
  OpenworkSessionArchiveSessionUsage,
  OpenworkSessionArchiveSyncStatus,
  OpenworkSessionArchiveTopUsageSession,
  OpenworkSessionArchiveSyncResult,
  OpenworkSessionArchiveUsageComparison,
  OpenworkSessionArchiveUsageSummaryResponse,
  OpenworkServerClient,
} from "../../../../app/lib/onmyagent-server";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

function downloadSessionArchiveExport(result: OpenworkSessionArchiveExportResponse) {
  const blob = new Blob([result.content], { type: result.content_type || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sessionArchiveInputFocused(): boolean {
  const element = document.activeElement;
  if (!element) return false;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

type SessionArchiveConfirmAction =
  | { kind: "trash"; session: OpenworkSessionArchiveSession }
  | { kind: "permanent-delete"; session: OpenworkSessionArchiveSession }
  | { kind: "empty-trash" }
  | { kind: "insight-delete"; insightId: number };

async function readSessionArchiveSse(response: Response, onEvent: (event: string, data: string) => void, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator >= 0) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const event = frame.split("\n").find((line) => line.startsWith("event: "))?.slice(7).trim() ?? "message";
      const data = frame.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
      onEvent(event, data);
      separator = buffer.indexOf("\n\n");
    }
  }
}

async function loadSessionArchiveAnalyticsDetails(input: {
  client: OpenworkServerClient | null;
  workspaceId: string;
  isCancelled: () => boolean;
  setAnalytics: Dispatch<SetStateAction<SessionArchiveAnalyticsState | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  try {
    const heatmap = await input.client?.getSessionArchiveAnalyticsHeatmap(input.workspaceId, "messages");
    if (input.isCancelled() || !heatmap) return;
    input.setAnalytics((current) => current ? { ...current, heatmap } : current);
    const sessions = await input.client?.getSessionArchiveAnalyticsSessions(input.workspaceId);
    if (input.isCancelled() || !sessions) return;
    input.setAnalytics((current) => current ? { ...current, sessions } : current);
    const velocity = await input.client?.getSessionArchiveAnalyticsVelocity(input.workspaceId);
    if (input.isCancelled() || !velocity) return;
    input.setAnalytics((current) => current ? { ...current, velocity } : current);
    const tools = await input.client?.getSessionArchiveAnalyticsTools(input.workspaceId);
    if (input.isCancelled() || !tools) return;
    input.setAnalytics((current) => current ? { ...current, tools } : current);
    const skills = await input.client?.getSessionArchiveAnalyticsSkills(input.workspaceId);
    if (input.isCancelled() || !skills) return;
    input.setAnalytics((current) => current ? { ...current, skills } : current);
    const signals = await input.client?.getSessionArchiveAnalyticsSignals(input.workspaceId);
    if (input.isCancelled() || !signals) return;
    input.setAnalytics((current) => current ? { ...current, signals } : current);
    const activityReport = await input.client?.getSessionArchiveActivityReport(input.workspaceId, { preset: "month", bucket: "1d" });
    if (input.isCancelled() || !activityReport) return;
    input.setAnalytics((current) => current ? { ...current, activityReport } : current);
    const trends = await input.client?.getSessionArchiveTrendTerms(input.workspaceId, ["error", "test", "tool"], { granularity: "week" });
    if (input.isCancelled() || !trends) return;
    input.setAnalytics((current) => current ? { ...current, trends } : current);
  } catch (loadError) {
    if (!input.isCancelled()) input.setError(loadError instanceof Error ? loadError.message : t("session_archive.analytics_failed"));
  }
}


export function SessionArchivePage(props: {
  client: OpenworkServerClient | null;
  workspaceId: string;
}) {
  const [query, setQuery] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string | null>(null);
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string | null>(null);
  const [selectedTrashAgentFilter, setSelectedTrashAgentFilter] = useState<string | null>(null);
  const [sessionGroupMode, setSessionGroupMode] = useState<"agent" | "project" | "none">("agent");
  const [sessions, setSessions] = useState<OpenworkSessionArchiveSession[]>([]);
  const [agentCounts, setAgentCounts] = useState<Array<{ agent: string; count: number }>>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionNextCursor, setSessionNextCursor] = useState<string | null>(null);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<OpenworkSessionArchiveMessagesResponse | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [sessionUsage, setSessionUsage] = useState<OpenworkSessionArchiveSessionUsage | null>(null);
  const [usageSummary, setUsageSummary] = useState<OpenworkSessionArchiveUsageSummaryResponse | null>(null);
  const [usageComparison, setUsageComparison] = useState<OpenworkSessionArchiveUsageComparison | null>(null);
  const [topUsageSessions, setTopUsageSessions] = useState<OpenworkSessionArchiveTopUsageSession[]>([]);
  const [analytics, setAnalytics] = useState<SessionArchiveAnalyticsState | null>(null);
  const [starredIds, setStarredIds] = useState<string[]>([]);
  const [pins, setPins] = useState<OpenworkSessionArchivePinnedMessage[]>([]);
  const [trashSessions, setTrashSessions] = useState<OpenworkSessionArchiveSession[]>([]);
  const [insightGenerating, setInsightGenerating] = useState(false);
  const [insightLog, setInsightLog] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<SessionArchiveConfirmAction | null>(null);
  const [searchResult, setSearchResult] = useState<OpenworkSessionArchiveSearchResponse | null>(null);
  const [sessionFindQuery, setSessionFindQuery] = useState("");
  const [sessionFindResult, setSessionFindResult] = useState<OpenworkSessionArchiveSessionSearchResponse | null>(null);
  const [sessionFindIndex, setSessionFindIndex] = useState(0);
  const [transcriptNewestFirst, setTranscriptNewestFirst] = useState(false);
  const [transcriptCompact, setTranscriptCompact] = useState(false);
  const [transcriptHideMeta, setTranscriptHideMeta] = useState(false);
  const [followLatestSignal, setFollowLatestSignal] = useState(0);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [syncResult, setSyncResult] = useState<OpenworkSessionArchiveSyncResult | null>(null);
  const [syncStatus, setSyncStatus] = useState<OpenworkSessionArchiveSyncStatus | null>(null);
  const [configSnapshot, setConfigSnapshot] = useState<OpenworkSessionArchiveConfigSnapshot | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [importKind, setImportKind] = useState<SessionArchiveImportKind>("upload");
  const [importFilename, setImportFilename] = useState("session.jsonl");
  const [importProject, setImportProject] = useState("");
  const [importAgent, setImportAgent] = useState("");
  const [importContent, setImportContent] = useState("");
  const [importing, setImporting] = useState(false);
  const [selectedAgentDirId, setSelectedAgentDirId] = useState("");
  const [agentDirText, setAgentDirText] = useState("");
  const [terminalMode, setTerminalMode] = useState<OpenworkSessionArchiveConfigSnapshot["terminal"]["mode"]>("auto");
  const [terminalBin, setTerminalBin] = useState("");
  const [terminalArgs, setTerminalArgs] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteOriginsText, setRemoteOriginsText] = useState("");
  const [remoteRequireAuth, setRemoteRequireAuth] = useState(false);
  const [remoteAuthConfigured, setRemoteAuthConfigured] = useState(false);
  const [postgresUrl, setPostgresUrl] = useState("");
  const [postgresSchema, setPostgresSchema] = useState("");
  const [postgresMachine, setPostgresMachine] = useState("");
  const [postgresAllowInsecure, setPostgresAllowInsecure] = useState(false);
  const [postgresWatch, setPostgresWatch] = useState(false);
  const [duckDbPath, setDuckDbPath] = useState("");
  const [duckDbUrl, setDuckDbUrl] = useState("");
  const [duckDbTokenConfigured, setDuckDbTokenConfigured] = useState(false);
  const [duckDbMachine, setDuckDbMachine] = useState("");
  const [duckDbAllowInsecure, setDuckDbAllowInsecure] = useState(false);
  const [backendsStatus, setBackendsStatus] = useState<OpenworkSessionArchiveBackendsStatusResponse | null>(null);
  const [lifecycleStatus, setLifecycleStatus] = useState<OpenworkSessionArchiveLifecycleStatus | null>(null);
  const [mappingPath, setMappingPath] = useState("");
  const [mappingProject, setMappingProject] = useState("");
  const [mappingMachine, setMappingMachine] = useState("");
  const [secretConfidence, setSecretConfidence] = useState<OpenworkSessionArchiveSecretConfidence>("definite");
  const [secretFindings, setSecretFindings] = useState<OpenworkSessionArchiveSecretFinding[]>([]);
  const [secretScanSummary, setSecretScanSummary] = useState<OpenworkSessionArchiveSecretScanSummary | null>(null);
  const [secretScanning, setSecretScanning] = useState(false);
  const [activePanel, setActivePanel] = useState<SessionArchivePanel>("transcript");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncPolling, setSyncPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [messageRefreshKey, setMessageRefreshKey] = useState(0);
  const lastSyncListRefreshRef = useRef(0);

  const trimmedQuery = query.trim();
  const syncWarnings = syncResult?.stats?.warnings ?? syncStatus?.stats?.warnings ?? [];
  const visibleSyncWarnings = syncWarnings.slice(0, 4);

  const copyText = useCallback((value: string, successKey: string) => {
    if (!navigator.clipboard) {
      setError(t("session_archive.copy_failed"));
      return;
    }
    void navigator.clipboard.writeText(value)
      .then(() => setActionMessage(t(successKey)))
      .catch(() => setError(t("session_archive.copy_failed")));
  }, []);

  const refreshArchiveList = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    const controller = new AbortController();
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let safetyTimer: ReturnType<typeof setInterval> | null = null;
    let lastRefreshAt = 0;
    const refreshSafely = () => {
      const now = Date.now();
      if (now - lastRefreshAt < 1200) return;
      lastRefreshAt = now;
      refreshArchiveList();
    };
    const connect = () => {
      if (closed || controller.signal.aborted) return;
      void props.client?.openSessionArchiveEventsStream(props.workspaceId, { pollMs: 2500, signal: controller.signal })
        .then((response) => readSessionArchiveSse(response, (event) => {
          if (event === "data_changed") refreshSafely();
        }, controller.signal))
        .catch(() => {
          if (!closed && !controller.signal.aborted) {
            reconnectTimer = setTimeout(connect, 2500);
          }
        });
    };
    connect();
    safetyTimer = setInterval(refreshSafely, 30000);
    return () => {
      closed = true;
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (safetyTimer) clearInterval(safetyTimer);
    };
  }, [props.client, props.workspaceId, refreshArchiveList]);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim()) {
      setSessions([]);
      setAgentCounts([]);
      setSessionTotal(0);
      setSessionNextCursor(null);
      setLoadingMoreSessions(false);
      setSelectedSessionId(null);
      setSearchResult(null);
      setMessages(null);
      setHasOlderMessages(false);
      setLoadingOlderMessages(false);
      setSessionUsage(null);
      setUsageSummary(null);
      setUsageComparison(null);
      setTopUsageSessions([]);
      setAnalytics(null);
      setStarredIds([]);
      setPins([]);
      setTrashSessions([]);
      setConfigSnapshot(null);
      setLifecycleStatus(null);
      setSecretFindings([]);
      setSecretScanSummary(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const listPromise = props.client.listSessionArchiveSessions(props.workspaceId, {
      search: trimmedQuery || undefined,
      limit: SESSION_ARCHIVE_ARCHIVE_PAGE_LIMIT,
      agent: selectedAgentFilter || undefined,
    });
    const searchPromise = trimmedQuery
      ? props.client.searchSessionArchive(props.workspaceId, trimmedQuery, { limit: 20 })
      : Promise.resolve(null);
    void Promise.all([listPromise, searchPromise])
      .then(([page, result]) => {
        if (cancelled) return;
        const nextState = mergeSessionArchiveSessionPage({ sessions: [], total: 0, nextCursor: null, agentCounts: [] }, page, "replace");
        setSessions(nextState.sessions);
        setAgentCounts(nextState.agentCounts);
        setSessionTotal(nextState.total);
        setSessionNextCursor(nextState.nextCursor);
        setSearchResult(result);
        setSelectedSessionId((current) => {
          if (current && page.sessions.some((session) => session.id === current)) return current;
          return page.sessions[0]?.id ?? null;
        });
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : t("session_archive.load_failed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.client, props.workspaceId, refreshKey, selectedAgentFilter, trimmedQuery]);

  const handleLoadMoreSessions = useCallback(() => {
    if (!props.client || !props.workspaceId.trim() || !sessionNextCursor || loadingMoreSessions) return;
    setLoadingMoreSessions(true);
    setError(null);
    void props.client
      .listSessionArchiveSessions(props.workspaceId, {
        cursor: sessionNextCursor,
        search: trimmedQuery || undefined,
        limit: SESSION_ARCHIVE_ARCHIVE_PAGE_LIMIT,
        agent: selectedAgentFilter || undefined,
      })
      .then((page) => {
        setSessions((current) => {
          const nextState = mergeSessionArchiveSessionPage({ sessions: current, total: sessionTotal, nextCursor: sessionNextCursor, agentCounts }, page, "append");
          setAgentCounts(nextState.agentCounts);
          setSessionTotal(nextState.total);
          setSessionNextCursor(nextState.nextCursor);
          return nextState.sessions;
        });
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : t("session_archive.load_failed"));
      })
      .finally(() => setLoadingMoreSessions(false));
  }, [agentCounts, loadingMoreSessions, props.client, props.workspaceId, selectedAgentFilter, sessionNextCursor, sessionTotal, trimmedQuery]);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    let cancelled = false;
    void Promise.all([
      props.client.getSessionArchiveStarred(props.workspaceId),
      props.client.listSessionArchivePins(props.workspaceId),
      props.client.listSessionArchiveTrash(props.workspaceId),
    ])
      .then(([starred, pinList, trash]) => {
        if (cancelled) return;
        setStarredIds(starred.session_ids);
        setPins(pinList.pins);
        setTrashSessions(trash.sessions);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t("session_archive.load_failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [props.client, props.workspaceId, refreshKey]);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim() || activePanel !== "settings") {
      setConfigSnapshot(null);
      setLifecycleStatus(null);
      return;
    }
    let cancelled = false;
    setConfigLoading(true);
    void Promise.all([
      props.client.getSessionArchiveConfig(props.workspaceId),
      props.client.getSessionArchiveLifecycleStatus(props.workspaceId),
    ])
      .then(([snapshot, lifecycle]) => {
        if (cancelled) return;
        setConfigSnapshot(snapshot);
        setLifecycleStatus(lifecycle);
        setTerminalMode(snapshot.terminal.mode);
        setTerminalBin(snapshot.terminal.custom_bin ?? "");
        setTerminalArgs(snapshot.terminal.custom_args ?? "");
        setRemoteUrl(snapshot.remote.public_url ?? "");
        setRemoteOriginsText(snapshot.remote.public_origins.join("\n"));
        setRemoteRequireAuth(snapshot.remote.require_auth);
        setRemoteAuthConfigured(snapshot.remote.auth_configured);
        setPostgresSchema(snapshot.postgres.schema ?? "");
        setPostgresMachine(snapshot.postgres.machine_name ?? "");
        setPostgresAllowInsecure(snapshot.postgres.allow_insecure);
        setPostgresWatch(snapshot.postgres.watch);
        setDuckDbPath(snapshot.duckdb.path ?? "");
        setDuckDbMachine(snapshot.duckdb.machine_name ?? "");
        setDuckDbAllowInsecure(snapshot.duckdb.allow_insecure);
        setDuckDbTokenConfigured(snapshot.duckdb.token_configured);
        setBackendsStatus({ backends: snapshot.backends });
        const selected = snapshot.agent_dirs.find((item) => item.agent === selectedAgentDirId) ?? snapshot.agent_dirs[0];
        setSelectedAgentDirId(selected?.agent ?? "");
        setAgentDirText(selected?.dirs.join("\n") ?? "");
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t("session_archive.config_failed"));
      })
      .finally(() => {
        if (!cancelled) setConfigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activePanel, props.client, props.workspaceId, refreshKey, selectedAgentDirId]);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim() || activePanel !== "settings") {
      setSecretFindings([]);
      return;
    }
    let cancelled = false;
    void props.client
      .listSessionArchiveSecrets(props.workspaceId, { confidence: secretConfidence, limit: 25 })
      .then((result) => {
        if (!cancelled) setSecretFindings(result.findings);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t("session_archive.secrets_failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [activePanel, props.client, props.workspaceId, refreshKey, secretConfidence]);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim() || !selectedSessionId) {
      setMessages(null);
      setSessionFindResult(null);
      setHasOlderMessages(false);
      setLoadingOlderMessages(false);
      return;
    }
    let cancelled = false;
    setMessagesLoading(true);
    void props.client
      .getSessionArchiveMessages(props.workspaceId, selectedSessionId, { limit: SESSION_ARCHIVE_ARCHIVE_MESSAGE_LIMIT, direction: "desc" })
      .then((result) => {
        if (!cancelled) {
          const nextState = normalizeLatestSessionArchiveMessages(result, SESSION_ARCHIVE_ARCHIVE_MESSAGE_LIMIT);
          setMessages(nextState.messages);
          setHasOlderMessages(nextState.hasOlder);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t("session_archive.messages_failed"));
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [messageRefreshKey, props.client, props.workspaceId, selectedSessionId]);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim() || !selectedSessionId) return;
    const controller = new AbortController();
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastRefreshAt = 0;
    const refreshCurrentSession = () => {
      const now = Date.now();
      if (now - lastRefreshAt < 1200) return;
      lastRefreshAt = now;
      refreshArchiveList();
      setMessageRefreshKey((value) => value + 1);
    };
    const connect = () => {
      if (closed || controller.signal.aborted) return;
      void props.client?.openSessionArchiveSessionWatchStream(props.workspaceId, selectedSessionId, { pollMs: 2000, signal: controller.signal })
        .then((response) => readSessionArchiveSse(response, (event) => {
          if (event === "session_updated") refreshCurrentSession();
        }, controller.signal))
        .catch(() => {
          if (!closed && !controller.signal.aborted) {
            reconnectTimer = setTimeout(connect, 2500);
          }
        });
    };
    connect();
    return () => {
      closed = true;
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [props.client, props.workspaceId, refreshArchiveList, selectedSessionId]);

  const handleLoadOlderMessages = useCallback(() => {
    if (!props.client || !props.workspaceId.trim() || !selectedSessionId || !messages?.messages.length || loadingOlderMessages) return;
    const oldestOrdinal = messages.messages[0]?.ordinal ?? 0;
    if (oldestOrdinal <= 0) {
      setHasOlderMessages(false);
      return;
    }
    setLoadingOlderMessages(true);
    setError(null);
    void props.client
      .getSessionArchiveMessages(props.workspaceId, selectedSessionId, {
        limit: SESSION_ARCHIVE_ARCHIVE_MESSAGE_LIMIT,
        direction: "desc",
        from: oldestOrdinal - 1,
      })
      .then((result) => {
        setMessages((current) => {
          if (!current) {
            const latest = normalizeLatestSessionArchiveMessages(result, SESSION_ARCHIVE_ARCHIVE_MESSAGE_LIMIT);
            setHasOlderMessages(latest.hasOlder);
            return latest.messages;
          }
          const nextState = prependOlderSessionArchiveMessages(current, result, SESSION_ARCHIVE_ARCHIVE_MESSAGE_LIMIT);
          setHasOlderMessages(nextState.hasOlder);
          return nextState.messages;
        });
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : t("session_archive.messages_failed"));
      })
      .finally(() => setLoadingOlderMessages(false));
  }, [loadingOlderMessages, messages, props.client, props.workspaceId, selectedSessionId]);

  useEffect(() => {
    const trimmed = sessionFindQuery.trim();
    if (!props.client || !props.workspaceId.trim() || !selectedSessionId || !trimmed) {
      setSessionFindResult(null);
      setSessionFindIndex(0);
      return;
    }
    let cancelled = false;
    void props.client.searchSessionArchiveSession(props.workspaceId, selectedSessionId, trimmed)
      .then((result) => {
        if (cancelled) return;
        setSessionFindResult(result);
        setSessionFindIndex(0);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t("session_archive.search_failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [props.client, props.workspaceId, selectedSessionId, sessionFindQuery]);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim() || activePanel !== "usage") {
      setUsageSummary(null);
      setUsageComparison(null);
      setTopUsageSessions([]);
      return;
    }
    let cancelled = false;
    setUsageLoading(true);
    void props.client
      .getSessionArchiveUsageSummary(props.workspaceId)
      .then((summary) => {
        if (cancelled) return;
        setUsageSummary(summary);
        return Promise.all([
          props.client?.getSessionArchiveUsageComparison(props.workspaceId, summary.totals.totalCost, { from: summary.from, to: summary.to }),
          props.client?.getSessionArchiveTopUsageSessions(props.workspaceId, { from: summary.from, to: summary.to, limit: 5 }),
        ]);
      })
      .then((results) => {
        if (cancelled || !results) return;
        const [comparison, topSessions] = results;
        if (comparison) setUsageComparison(comparison);
        if (topSessions) setTopUsageSessions(topSessions);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t("session_archive.usage_failed"));
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activePanel, props.client, props.workspaceId, refreshKey]);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim() || activePanel !== "analytics") {
      setAnalytics(null);
      return;
    }
    let cancelled = false;
    setAnalyticsLoading(true);
    void Promise.all([
      props.client.getSessionArchiveAnalyticsSummary(props.workspaceId),
      props.client.getSessionArchiveAnalyticsActivity(props.workspaceId),
      props.client.getSessionArchiveAnalyticsProjects(props.workspaceId),
      props.client.getSessionArchiveAnalyticsTopSessions(props.workspaceId, { metric: "messages", limit: 5 }),
      props.client.listSessionArchiveInsights(props.workspaceId),
    ])
      .then(([summary, activity, projects, topSessions, insights]) => {
        if (cancelled) return;
        setAnalytics((current) => ({
          summary,
          activity,
          heatmap: current?.heatmap ?? EMPTY_SESSION_ARCHIVE_ANALYTICS_HEATMAP,
          projects,
          sessions: current?.sessions ?? EMPTY_SESSION_ARCHIVE_ANALYTICS_SESSIONS,
          velocity: current?.velocity ?? EMPTY_SESSION_ARCHIVE_ANALYTICS_VELOCITY,
          tools: current?.tools ?? EMPTY_SESSION_ARCHIVE_ANALYTICS_TOOLS,
          skills: current?.skills ?? EMPTY_SESSION_ARCHIVE_ANALYTICS_SKILLS,
          topSessions,
          signals: current?.signals ?? EMPTY_SESSION_ARCHIVE_ANALYTICS_SIGNALS,
          activityReport: current?.activityReport ?? null,
          trends: current?.trends ?? null,
          insights,
        }));
        setAnalyticsLoading(false);
        void loadSessionArchiveAnalyticsDetails({
          client: props.client,
          workspaceId: props.workspaceId,
          isCancelled: () => cancelled,
          setAnalytics,
          setError,
        });
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t("session_archive.analytics_failed"));
      })
      .finally(() => {
        if (!cancelled) setAnalyticsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activePanel, props.client, props.workspaceId, refreshKey]);

  const handleGenerateInsight = useCallback(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    setInsightGenerating(true);
    setInsightLog(null);
    void props.client
      .generateSessionArchiveInsight(props.workspaceId, {
        type: "daily_activity",
        date_from: from,
        date_to: today,
        prompt: "Summarize archive activity, trends, tools, and risk signals.",
      })
      .then((text) => {
        setInsightLog(text.split("\n").filter((line) => line.startsWith("event:")).join(" / "));
        setRefreshKey((value) => value + 1);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : t("session_archive.insight_generate_failed"));
      })
      .finally(() => setInsightGenerating(false));
  }, [props.client, props.workspaceId]);

  const handleDeleteInsight = useCallback((insightId: number) => {
    setConfirmAction({ kind: "insight-delete", insightId });
  }, []);

  const confirmDeleteInsight = useCallback((insightId: number) => {
    if (!props.client || !props.workspaceId.trim()) return;
    void props.client
      .deleteSessionArchiveInsight(props.workspaceId, insightId)
      .then(() => setRefreshKey((value) => value + 1))
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : t("session_archive.insight_delete_failed"));
      });
  }, [props.client, props.workspaceId]);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim() || !selectedSessionId || activePanel !== "usage") {
      setSessionUsage(null);
      return;
    }
    let cancelled = false;
    void props.client
      .getSessionArchiveSessionUsage(props.workspaceId, selectedSessionId)
      .then((usage) => {
        if (!cancelled) setSessionUsage(usage);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t("session_archive.usage_failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [activePanel, props.client, props.workspaceId, selectedSessionId]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  const sessionGroups = useMemo(() => groupSessionArchiveSessions(sessions, sessionGroupMode), [sessionGroupMode, sessions]);

  const agentGroups = useMemo(() => (
    sessionGroupMode === "agent"
      ? sessionArchiveAgentCounts(agentCounts, sessionGroups)
      : sessionGroups.filter((group) => group.label).map((group) => ({ agent: group.label, count: group.sessions.length }))
  ), [agentCounts, sessionGroupMode, sessionGroups]);

  const visibleAgentGroups = useMemo(
    () => selectedGroupFilter && sessionGroupMode !== "agent"
      ? sessionGroups.filter((group) => group.label === selectedGroupFilter)
      : sessionGroups,
    [selectedGroupFilter, sessionGroupMode, sessionGroups],
  );

  const visibleSessionCount = useMemo(
    () => visibleAgentGroups.reduce((total, group) => total + group.sessions.length, 0),
    [visibleAgentGroups],
  );

  const trashAgentGroups = useMemo(() => groupSessionArchiveSessions(trashSessions, "agent"), [trashSessions]);

  const visibleTrashAgentGroups = useMemo(
    () => selectedTrashAgentFilter
      ? trashAgentGroups.filter((group) => group.label === selectedTrashAgentFilter)
      : trashAgentGroups,
    [selectedTrashAgentFilter, trashAgentGroups],
  );

  const sessionFindMatches = sessionFindResult?.matches ?? [];
  const currentSessionFindMatch = sessionFindMatches[sessionFindIndex] ?? null;
  const transcriptMessages = useMemo(
    () => sessionArchiveTranscriptMessages(messages?.messages ?? [], transcriptNewestFirst),
    [messages, transcriptNewestFirst],
  );

  const moveSessionFind = useCallback((delta: number) => {
    setSessionFindIndex((current) => {
      const total = sessionFindMatches.length;
      if (!total) return 0;
      return (current + delta + total) % total;
    });
  }, [sessionFindMatches.length]);

  const handleSelectAgentFilter = useCallback((agent: string | null) => {
    setShowTrash(false);
    setSelectedGroupFilter(agent);
    setSelectedAgentFilter(sessionGroupMode === "agent" ? agent : null);
    setSelectedSessionId(null);
    setActivePanel("transcript");
  }, [sessionGroupMode]);

  const handleSessionGroupModeChange = useCallback((mode: "agent" | "project" | "none") => {
    setSessionGroupMode(mode);
    setSelectedGroupFilter(null);
    setSelectedAgentFilter(null);
  }, []);

  const handleShowArchive = useCallback(() => {
    setShowTrash(false);
    setSelectedSessionId((current) => current ?? sessions[0]?.id ?? null);
  }, [sessions]);

  const handleShowTrash = useCallback(() => {
    setShowTrash(true);
    setSelectedTrashAgentFilter(null);
    setSelectedSessionId(null);
    setMessages(null);
    setSessionUsage(null);
    setActivePanel("transcript");
  }, []);

  const handleSelectTrashAgentFilter = useCallback((agent: string | null) => {
    setSelectedTrashAgentFilter(agent);
    setSelectedSessionId(null);
    setMessages(null);
    setSessionUsage(null);
  }, []);

  const handleSync = useCallback(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    setSyncing(true);
    setError(null);
    setSyncStatus(null);
    void props.client
      .syncSessionArchive(props.workspaceId)
      .then((result) => {
        setSyncResult(result);
        setSyncStatus({
          ok: result.ok,
          status: result.status ?? "completed",
          started_at: result.started_at,
          finished_at: result.finished_at,
          last_sync: result.finished_at,
          progress: result.progress,
          stats: result.stats,
          error: result.error,
          dbPath: result.dbPath,
        });
        refreshArchiveList();
        setSyncing(false);
        setSyncPolling(result.status === "running");
      })
      .catch((syncError: unknown) => {
        setError(syncError instanceof Error ? syncError.message : t("session_archive.sync_failed"));
        setSyncing(false);
        setSyncPolling(false);
      })
  }, [props.client, props.workspaceId, refreshArchiveList]);

  const commandPaletteItems = useMemo<SessionArchiveCommandItem[]>(() => {
    const close = () => setCommandPaletteOpen(false);
    return buildSessionArchiveCommandItems({
      sessions,
      searchResults: searchResult?.results ?? [],
      selectedSession,
      showTrash,
      trashCount: trashSessions.length,
      labels: {
        sync: t("session_archive.sync"),
        archive: t("session_archive.archive_tab"),
        trash: t("session_archive.trash"),
        trashMeta: t("session_archive.trash_tab", { count: trashSessions.length }),
        settings: t("session_archive.settings_tab"),
        copySessionId: t("session_archive.copy_session_id"),
      },
      actions: {
        sync: () => {
          close();
          handleSync();
        },
        toggleArchiveTrash: () => {
          close();
          if (showTrash) handleShowArchive();
          else handleShowTrash();
        },
        openSettings: () => {
          close();
          setActivePanel("settings");
        },
        copySessionId: (sessionId) => {
          close();
          copyText(sessionId, "session_archive.session_id_copied");
        },
        selectSession: (sessionId) => {
          close();
          setShowTrash(false);
          setSelectedSessionId(sessionId);
          setActivePanel("transcript");
        },
      },
    });
  }, [copyText, handleShowArchive, handleShowTrash, handleSync, searchResult, selectedSession, sessions, showTrash, trashSessions.length]);

  useEffect(() => {
    if (!syncPolling || !props.client || !props.workspaceId.trim()) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const pollStatus = () => {
      void props.client?.getSessionArchiveSyncStatus(props.workspaceId)
        .then((status) => {
          if (cancelled) return;
          setSyncStatus(status);
          if (status.stats) {
            setSyncResult({
              ok: status.ok ?? status.status !== "failed",
              status: status.status === "idle" ? "completed" : status.status,
              started_at: status.started_at,
              finished_at: status.finished_at,
              progress: status.progress,
              stats: status.stats,
              error: status.error,
              dbPath: status.dbPath ?? "",
            });
          }
          const now = Date.now();
          if (status.status !== "running" || now - lastSyncListRefreshRef.current > 5000) {
            lastSyncListRefreshRef.current = now;
            refreshArchiveList();
          }
          if (status.status === "completed" || status.status === "failed" || status.status === "idle") {
            setSyncPolling(false);
            if (status.status === "failed") {
              setError(status.error || t("session_archive.sync_failed"));
            }
          }
        })
        .catch((loadError: unknown) => {
          if (cancelled) return;
          setError(loadError instanceof Error ? loadError.message : t("session_archive.sync_failed"));
          setSyncPolling(false);
        });
    };
    intervalId = setInterval(pollStatus, 1500);
    pollStatus();
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [props.client, props.workspaceId, refreshArchiveList, syncPolling]);

  const runSessionAction = useCallback((action: () => Promise<unknown>, successKey: string) => {
    setError(null);
    setActionMessage(null);
    void action()
      .then((result) => {
        if (typeof result === "object" && result && "command" in result) {
          const command = Reflect.get(result, "command");
          setActionMessage(typeof command === "string" ? command : t(successKey));
        } else if (typeof result === "object" && result && "message" in result) {
          const message = Reflect.get(result, "message");
          setActionMessage(typeof message === "string" ? message : t(successKey));
        } else if (typeof result === "object" && result && "filename" in result) {
          const filename = Reflect.get(result, "filename");
          setActionMessage(typeof filename === "string" ? t(successKey, { filename }) : t(successKey));
        } else {
          setActionMessage(t(successKey));
        }
        setRefreshKey((value) => value + 1);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : t("session_archive.action_failed"));
      });
  }, []);

  const handleToggleStar = useCallback((sessionId: string) => {
    if (!props.client || !props.workspaceId.trim()) return;
    const starred = starredIds.includes(sessionId);
    runSessionAction(
      () => starred
        ? props.client?.unstarSessionArchiveSession(props.workspaceId, sessionId) ?? Promise.resolve()
        : props.client?.starSessionArchiveSession(props.workspaceId, sessionId) ?? Promise.resolve(),
      starred ? "session_archive.unstarred" : "session_archive.starred",
    );
  }, [props.client, props.workspaceId, runSessionAction, starredIds]);

  const startRename = useCallback((session: OpenworkSessionArchiveSession) => {
    setRenamingSessionId(session.id);
    setRenameValue(session.display_name || session.first_message || session.id);
  }, []);

  const submitRename = useCallback(() => {
    if (!props.client || !props.workspaceId.trim() || !renamingSessionId) return;
    const name = renameValue.trim();
    setRenamingSessionId(null);
    if (!name) return;
    runSessionAction(() => props.client?.renameSessionArchiveSession(props.workspaceId, renamingSessionId, name) ?? Promise.resolve(), "session_archive.renamed");
  }, [props.client, props.workspaceId, renameValue, renamingSessionId, runSessionAction]);

  const requestTrash = useCallback((session: OpenworkSessionArchiveSession) => {
    setConfirmAction({ kind: "trash", session });
  }, []);

  const handleTrash = useCallback((sessionId: string) => {
    if (!props.client || !props.workspaceId.trim()) return;
    runSessionAction(() => props.client?.trashSessionArchiveSession(props.workspaceId, sessionId) ?? Promise.resolve(), "session_archive.trashed");
  }, [props.client, props.workspaceId, runSessionAction]);

  const handleRestore = useCallback((sessionId: string) => {
    if (!props.client || !props.workspaceId.trim()) return;
    runSessionAction(() => props.client?.restoreSessionArchiveSession(props.workspaceId, sessionId) ?? Promise.resolve(), "session_archive.restored");
  }, [props.client, props.workspaceId, runSessionAction]);

  const requestPermanentDelete = useCallback((session: OpenworkSessionArchiveSession) => {
    setConfirmAction({ kind: "permanent-delete", session });
  }, []);

  const handlePermanentDelete = useCallback((sessionId: string) => {
    if (!props.client || !props.workspaceId.trim()) return;
    runSessionAction(() => props.client?.permanentlyDeleteSessionArchiveSession(props.workspaceId, sessionId) ?? Promise.resolve(), "session_archive.permanently_deleted");
  }, [props.client, props.workspaceId, runSessionAction]);

  const requestEmptyTrash = useCallback(() => {
    setConfirmAction({ kind: "empty-trash" });
  }, []);

  const handleEmptyTrash = useCallback(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    runSessionAction(() => props.client?.emptySessionArchiveTrash(props.workspaceId) ?? Promise.resolve(), "session_archive.trash_emptied");
  }, [props.client, props.workspaceId, runSessionAction]);

  const handleConfirmAction = useCallback(() => {
    if (!confirmAction) return;
    if (confirmAction.kind === "trash") handleTrash(confirmAction.session.id);
    if (confirmAction.kind === "permanent-delete") handlePermanentDelete(confirmAction.session.id);
    if (confirmAction.kind === "empty-trash") handleEmptyTrash();
    if (confirmAction.kind === "insight-delete") confirmDeleteInsight(confirmAction.insightId);
    setConfirmAction(null);
  }, [confirmAction, confirmDeleteInsight, handleEmptyTrash, handlePermanentDelete, handleTrash]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (meta && key === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (meta && key === "f" && selectedSessionId && !showTrash) {
        event.preventDefault();
        setActivePanel("transcript");
        window.setTimeout(() => document.querySelector<HTMLInputElement>("[data-session-archive-find-input='true']")?.focus(), 0);
        return;
      }
      if (meta && key === "g" && sessionFindMatches.length > 0) {
        event.preventDefault();
        moveSessionFind(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === "Escape") {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
          return;
        }
        if (confirmAction) {
          setConfirmAction(null);
          return;
        }
        if (sessionFindQuery) {
          setSessionFindQuery("");
          return;
        }
      }
      if (meta || event.altKey || sessionArchiveInputFocused() || commandPaletteOpen || confirmAction) return;
      if (event.key === "[" || event.key === "]") {
        const nextId = nextSessionArchiveSessionId(sessions, selectedSessionId, event.key === "]" ? 1 : -1);
        if (nextId) {
          event.preventDefault();
          setShowTrash(false);
          setSelectedSessionId(nextId);
          setActivePanel("transcript");
        }
        return;
      }
      if (key === "r") {
        event.preventDefault();
        handleSync();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedSession) {
        event.preventDefault();
        requestTrash(selectedSession);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, confirmAction, handleSync, moveSessionFind, requestTrash, selectedSession, selectedSessionId, sessionFindMatches.length, sessionFindQuery, sessions, showTrash]);

  const handlePin = useCallback((sessionId: string, ordinal: number, pinned: boolean) => {
    if (!props.client || !props.workspaceId.trim()) return;
    runSessionAction(
      () => pinned
        ? props.client?.unpinSessionArchiveMessage(props.workspaceId, sessionId, ordinal) ?? Promise.resolve()
        : props.client?.pinSessionArchiveMessage(props.workspaceId, sessionId, ordinal) ?? Promise.resolve(),
      pinned ? "session_archive.unpinned" : "session_archive.pinned",
    );
  }, [props.client, props.workspaceId, runSessionAction]);

  const handleOpenDirectory = useCallback((sessionId: string) => {
    if (!props.client || !props.workspaceId.trim()) return;
    runSessionAction(() => props.client?.openSessionArchiveSessionDirectory(props.workspaceId, sessionId) ?? Promise.resolve(), "session_archive.opened_directory");
  }, [props.client, props.workspaceId, runSessionAction]);

  const handleResume = useCallback((sessionId: string) => {
    if (!props.client || !props.workspaceId.trim()) return;
    runSessionAction(() => props.client?.resumeSessionArchiveSession(props.workspaceId, sessionId) ?? Promise.resolve(), "session_archive.resume_ready");
  }, [props.client, props.workspaceId, runSessionAction]);

  const handleExport = useCallback((sessionId: string, format: "html" | "md") => {
    if (!props.client || !props.workspaceId.trim()) return;
    setError(null);
    setActionMessage(null);
    const request = format === "html"
      ? props.client.exportSessionArchiveSessionHtml(props.workspaceId, sessionId)
      : props.client.exportSessionArchiveSessionMarkdown(props.workspaceId, sessionId);
    void request
      .then((result) => {
        downloadSessionArchiveExport(result);
        setActionMessage(t("session_archive.export_ready", { filename: result.filename }));
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : t("session_archive.action_failed"));
      });
  }, [props.client, props.workspaceId]);

  const handleImport = useCallback(() => {
    if (!props.client || !props.workspaceId.trim() || !importFilename.trim() || !importContent.trim()) return;
    const input = {
      filename: importFilename.trim(),
      content: importContent,
      agent: importAgent.trim() || undefined,
      project: importProject.trim() || undefined,
    };
    setImporting(true);
    setError(null);
    setActionMessage(null);
    const runImport = importKind === "claude-ai"
      ? props.client.importSessionArchiveClaudeAi(props.workspaceId, input)
      : importKind === "chatgpt"
        ? props.client.importSessionArchiveChatGpt(props.workspaceId, input)
        : props.client.uploadSessionArchiveExport(props.workspaceId, input);
    void runImport
      .then((result) => {
        if (typeof result === "string") {
          setActionMessage(t("session_archive.import_done"));
        } else {
          setActionMessage(sessionArchiveImportStatsMessage(result));
        }
        setImportContent("");
        setRefreshKey((value) => value + 1);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : t("session_archive.import_failed"));
      })
      .finally(() => setImporting(false));
  }, [importAgent, importContent, importFilename, importKind, importProject, props.client, props.workspaceId]);

  const handleSelectAgentDir = useCallback((agent: string) => {
    setSelectedAgentDirId(agent);
    const selected = configSnapshot?.agent_dirs.find((item) => item.agent === agent);
    setAgentDirText(selected?.dirs.join("\n") ?? "");
  }, [configSnapshot]);

  const handleSaveAgentDirs = useCallback(() => {
    if (!props.client || !props.workspaceId.trim() || !configSnapshot) return;
    const selected = configSnapshot.agent_dirs.find((item) => item.agent === selectedAgentDirId);
    if (!selected) return;
    const dirs = splitSessionArchiveLines(agentDirText);
    runSessionAction(
      () => props.client?.updateSessionArchiveConfig(props.workspaceId, { agent_dirs: [{ agent: selected.agent, dirs }] }) ?? Promise.resolve(),
      "session_archive.config_saved",
    );
  }, [agentDirText, configSnapshot, props.client, props.workspaceId, runSessionAction, selectedAgentDirId]);

  const handleSaveTerminal = useCallback(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    runSessionAction(
      () => props.client?.updateSessionArchiveConfig(props.workspaceId, {
        terminal: {
          mode: terminalMode,
          custom_bin: terminalBin.trim() || undefined,
          custom_args: terminalArgs.trim() || undefined,
        },
      }) ?? Promise.resolve(),
      "session_archive.config_saved",
    );
  }, [props.client, props.workspaceId, runSessionAction, terminalArgs, terminalBin, terminalMode]);

  const handleSaveGithub = useCallback(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    runSessionAction(
      () => props.client?.updateSessionArchiveConfig(props.workspaceId, { github_token: githubToken }) ?? Promise.resolve(),
      "session_archive.github_saved",
    );
    setGithubToken("");
  }, [githubToken, props.client, props.workspaceId, runSessionAction]);

  const handleSaveRemote = useCallback(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    runSessionAction(
      () => props.client?.updateSessionArchiveConfig(props.workspaceId, {
        remote: {
          public_url: remoteUrl.trim() || undefined,
          public_origins: splitSessionArchiveLines(remoteOriginsText),
          require_auth: remoteRequireAuth,
          auth_token_configured: remoteAuthConfigured,
        },
      }) ?? Promise.resolve(),
      "session_archive.config_saved",
    );
  }, [props.client, props.workspaceId, remoteAuthConfigured, remoteOriginsText, remoteRequireAuth, remoteUrl, runSessionAction]);

  const handleSavePostgres = useCallback(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    runSessionAction(
      () => props.client?.updateSessionArchiveConfig(props.workspaceId, {
        postgres: {
          url: postgresUrl.trim() || undefined,
          schema: postgresSchema.trim() || undefined,
          machine_name: postgresMachine.trim() || undefined,
          allow_insecure: postgresAllowInsecure,
          watch: postgresWatch,
        },
      }) ?? Promise.resolve(),
      "session_archive.config_saved",
    );
    setPostgresUrl("");
  }, [postgresAllowInsecure, postgresMachine, postgresSchema, postgresUrl, postgresWatch, props.client, props.workspaceId, runSessionAction]);

  const handleSaveDuckDb = useCallback(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    runSessionAction(
      () => props.client?.updateSessionArchiveConfig(props.workspaceId, {
        duckdb: {
          path: duckDbPath.trim() || undefined,
          url: duckDbUrl.trim() || undefined,
          token_configured: duckDbTokenConfigured,
          machine_name: duckDbMachine.trim() || undefined,
          allow_insecure: duckDbAllowInsecure,
        },
      }) ?? Promise.resolve(),
      "session_archive.config_saved",
    );
    setDuckDbUrl("");
  }, [duckDbAllowInsecure, duckDbMachine, duckDbPath, duckDbTokenConfigured, duckDbUrl, props.client, props.workspaceId, runSessionAction]);

  const handleAddMapping = useCallback(() => {
    if (!props.client || !props.workspaceId.trim() || !mappingPath.trim() || !mappingProject.trim()) return;
    runSessionAction(
      () => props.client?.upsertSessionArchiveWorktreeMapping(props.workspaceId, {
        path_prefix: mappingPath.trim(),
        project: mappingProject.trim(),
        machine: mappingMachine.trim() || undefined,
        enabled: true,
      }) ?? Promise.resolve(),
      "session_archive.mapping_saved",
    );
    setMappingPath("");
    setMappingProject("");
    setMappingMachine("");
  }, [mappingMachine, mappingPath, mappingProject, props.client, props.workspaceId, runSessionAction]);

  const handleDeleteMapping = useCallback((mappingId: string) => {
    if (!props.client || !props.workspaceId.trim()) return;
    runSessionAction(
      () => props.client?.deleteSessionArchiveWorktreeMapping(props.workspaceId, mappingId) ?? Promise.resolve(),
      "session_archive.mapping_deleted",
    );
  }, [props.client, props.workspaceId, runSessionAction]);

  const handleApplyMappings = useCallback(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    runSessionAction(
      () => props.client?.applySessionArchiveWorktreeMappings(props.workspaceId) ?? Promise.resolve(),
      "session_archive.mapping_applied",
    );
  }, [props.client, props.workspaceId, runSessionAction]);

  const handleScanSecrets = useCallback(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    setSecretScanning(true);
    setError(null);
    void props.client
      .scanSessionArchiveSecrets(props.workspaceId)
      .then((summary) => {
        setSecretScanSummary(summary);
        setActionMessage(t("session_archive.secrets_scan_done", {
          scanned: summary.scanned,
          total: summary.total_findings,
        }));
        setRefreshKey((value) => value + 1);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : t("session_archive.secrets_scan_failed"));
      })
      .finally(() => setSecretScanning(false));
  }, [props.client, props.workspaceId]);

  const confirmTitle = confirmAction?.kind === "trash"
    ? t("session_archive.trash_action")
    : confirmAction?.kind === "permanent-delete"
      ? t("session_archive.delete_permanent")
      : confirmAction?.kind === "empty-trash"
        ? t("session_archive.empty_trash")
      : t("session_archive.insight_delete");
  const confirmTarget = confirmAction?.kind === "trash" || confirmAction?.kind === "permanent-delete"
    ? (confirmAction.session.display_name || confirmAction.session.first_message || confirmAction.session.id)
    : confirmAction?.kind === "empty-trash"
      ? t("session_archive.trash")
    : t("session_archive.insights");
  const confirmDescription = confirmAction?.kind === "insight-delete"
    ? t("session_archive.insights")
    : confirmAction?.kind === "empty-trash"
    ? t("session_archive.empty_trash_help")
    : confirmAction?.kind === "trash"
    ? t("session_archive.trash_help")
    : t("session_archive.trash_help");

  return (
    <>
    <div className="flex h-full min-h-0 flex-col bg-dls-background text-dls-text">
      <header className="shrink-0 border-b border-dls-border bg-dls-surface px-5 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-medium text-dls-text">{t("session_archive.title")}</h1>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-dls-secondary">
              <span className="truncate">{t("session_archive.description")}</span>
              <StatusBadge tone="neutral">{t("session_archive.agent_group_count", { count: sessions.length })}</StatusBadge>
              <StatusBadge tone={showTrash ? "warning" : "neutral"}>{showTrash ? t("session_archive.trash_tab", { count: trashSessions.length }) : t("session_archive.archive_tab")}</StatusBadge>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button type="button" variant="default" size="sm" onClick={handleSync} disabled={!props.client || syncing}>
              <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
              {syncing ? t("session_archive.syncing") : t("session_archive.sync")}
            </Button>
            <Button type="button" variant="outline" size="icon-sm" aria-label={t("session_archive.command_palette_title")} onClick={() => setCommandPaletteOpen(true)}>
              <CommandIcon className="size-4" />
            </Button>
            <Button type="button" variant={showTrash ? "secondary" : "outline"} size="icon-sm" aria-label={t("session_archive.trash_tab", { count: trashSessions.length })} onClick={handleShowTrash}>
              <Trash2 className="size-4" />
            </Button>
            <Button type="button" variant={activePanel === "settings" ? "secondary" : "outline"} size="icon-sm" aria-label={t("session_archive.settings_tab")} onClick={() => setActivePanel("settings")}>
              <Settings className="size-4" />
            </Button>
          </div>
        </div>
        {syncPolling || syncStatus?.status === "running" ? (
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-dls-secondary">
            <StatusBadge tone="warning">
              {t("session_archive.sync_running_status", {
                done: syncStatus?.progress?.sessions_done ?? 0,
                total: syncStatus?.progress?.sessions_total ?? 0,
              })}
            </StatusBadge>
          </div>
        ) : syncResult?.stats ? (
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-dls-secondary">
            <StatusBadge tone="success">{t("session_archive.synced_count", { count: syncResult.stats.synced })}</StatusBadge>
            <StatusBadge tone={syncResult.stats.failed > 0 ? "warning" : "neutral"}>
              {t("session_archive.failed_count", { count: syncResult.stats.failed })}
            </StatusBadge>
          </div>
        ) : null}
        {visibleSyncWarnings.length ? (
          <NoticeBox tone="warning" size="default" className="mt-3 text-xs">
            <details>
              <summary className="cursor-pointer text-dls-text">{t("session_archive.sync_warnings_title")}</summary>
              <ul className="mt-2 space-y-1 text-dls-secondary">
                {visibleSyncWarnings.map((warning) => (
                  <li key={warning} className="break-all">{warning}</li>
                ))}
              </ul>
              {syncWarnings.length > visibleSyncWarnings.length ? (
                <div className="mt-2 text-dls-muted">
                  {t("session_archive.sync_warnings_more", { count: syncWarnings.length - visibleSyncWarnings.length })}
                </div>
              ) : null}
            </details>
          </NoticeBox>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-72 shrink-0 flex-col border-r border-dls-border bg-dls-surface">
          <div className="shrink-0 border-b border-dls-border p-2.5">
            <InputGroup radius="lg">
              <InputGroupInput
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={t("session_archive.search_placeholder")}
              />
              <InputGroupAddon align="inline-start">
                <Search className="size-4 text-dls-secondary" />
              </InputGroupAddon>
            </InputGroup>
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-dls-border bg-dls-muted p-1">
              <Button type="button" variant={showTrash ? "ghost" : "secondary"} size="sm" className="justify-center" onClick={handleShowArchive}>
                {t("session_archive.archive_tab")}
              </Button>
              <Button type="button" variant={showTrash ? "secondary" : "ghost"} size="sm" className="justify-center" onClick={handleShowTrash}>
                {t("session_archive.trash_tab", { count: trashSessions.length })}
              </Button>
            </div>
            {!showTrash ? (
              <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-dls-border bg-dls-muted p-1">
                <Button type="button" variant={sessionGroupMode === "agent" ? "secondary" : "ghost"} size="sm" className="justify-center" onClick={() => handleSessionGroupModeChange("agent")}>
                  {t("session_archive.group_by_agent")}
                </Button>
                <Button type="button" variant={sessionGroupMode === "project" ? "secondary" : "ghost"} size="sm" className="justify-center" onClick={() => handleSessionGroupModeChange("project")}>
                  {t("session_archive.group_by_project")}
                </Button>
                <Button type="button" variant={sessionGroupMode === "none" ? "secondary" : "ghost"} size="sm" className="justify-center" onClick={() => handleSessionGroupModeChange("none")}>
                  {t("session_archive.group_none")}
                </Button>
              </div>
            ) : null}
            {!showTrash && agentGroups.length > 0 ? (
              <div className="mt-2 space-y-1.5" data-session-archive-agent-filter="root">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium uppercase text-dls-secondary">{t("session_archive.agent_filter_title")}</div>
                  <span className="text-xs text-dls-secondary">{t("session_archive.agent_group_count", { count: visibleSessionCount })}</span>
                </div>
                <div className="max-h-24 overflow-y-auto rounded-lg border border-dls-border bg-dls-muted p-1">
                  <div className="grid grid-cols-2 gap-1">
                    <Button
                      type="button"
                      variant={selectedGroupFilter ? "ghost" : "secondary"}
                      size="sm"
                      className="w-full justify-between gap-2 px-2"
                      data-session-archive-agent-filter-option="__all__"
                      title={t("session_archive.agent_filter_all")}
                      onClick={() => handleSelectAgentFilter(null)}
                    >
                      <span className="min-w-0 truncate">{t("session_archive.agent_filter_all")}</span>
                      <span className="shrink-0 text-xs text-dls-secondary">{visibleSessionCount}</span>
                    </Button>
                    {agentGroups.map((group) => (
                      <Button
                        key={group.agent}
                        type="button"
                        variant={selectedGroupFilter === group.agent ? "secondary" : "ghost"}
                        size="sm"
                        className="w-full justify-between gap-2 px-2"
                        data-session-archive-agent-filter-option={group.agent}
                        title={group.agent}
                        onClick={() => handleSelectAgentFilter(group.agent)}
                      >
                        <span className="min-w-0 truncate">{group.agent}</span>
                        <span className="shrink-0 text-xs text-dls-secondary">{group.count}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto py-1.5">
            {showTrash ? (
              <TrashSessionList
                groups={trashAgentGroups}
                visibleGroups={visibleTrashAgentGroups}
                totalCount={trashSessions.length}
                selectedAgent={selectedTrashAgentFilter}
                onSelectAgent={handleSelectTrashAgentFilter}
                onRestore={handleRestore}
                onDelete={requestPermanentDelete}
                onEmptyTrash={requestEmptyTrash}
              />
            ) : loading && sessions.length === 0 ? (
              <div className="px-4 py-6 text-sm text-dls-secondary">{t("session_archive.loading")}</div>
            ) : visibleSessionCount > 0 ? (
              <VirtualSessionList
                groups={visibleAgentGroups}
                showGroupHeaders={sessionGroupMode !== "none"}
                selectedSessionId={selectedSessionId}
                starredIds={starredIds}
                onSelectSession={(sessionId) => {
                  setSelectedSessionId(sessionId);
                  setActivePanel("transcript");
                }}
                onRenameSession={startRename}
                onOpenSessionDirectory={handleOpenDirectory}
                onTrashSession={requestTrash}
              />
            ) : (
              <div className="px-4 py-6 text-sm text-dls-secondary">{t("session_archive.empty")}</div>
            )}
            {!showTrash && sessions.length > 0 ? (
              <div className="border-t border-dls-border px-3 py-3">
                <div className="mb-2 text-center text-xs text-dls-secondary">
                  {t("session_archive.loaded_count", { loaded: sessions.length, total: sessionTotal })}
                </div>
                {sessionNextCursor ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-center"
                    onClick={handleLoadMoreSessions}
                    disabled={loadingMoreSessions}
                  >
                    {loadingMoreSessions ? t("session_archive.loading_more") : t("session_archive.load_more")}
                  </Button>
                ) : (
                  <div className="text-center text-xs text-dls-muted">{t("session_archive.loaded_all")}</div>
                )}
              </div>
            ) : null}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-dls-background">
          {error ? <NoticeBox tone="error" className="m-4">{error}</NoticeBox> : null}
          {actionMessage ? <NoticeBox tone="info" className="m-4">{actionMessage}</NoticeBox> : null}
          {searchResult && searchResult.results.length > 0 ? (
            <section className="shrink-0 border-b border-dls-border bg-dls-surface px-5 py-3">
              <div className="mb-2 text-xs font-medium uppercase text-dls-secondary">{t("session_archive.search_matches")}</div>
              <div className="flex gap-2 overflow-x-auto">
                {searchResult.results.map((result) => (
                  <button
                    key={`${result.session_id}:${result.ordinal}`}
                    type="button"
                    className="min-w-56 rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-left text-xs text-dls-secondary hover:bg-dls-hover"
                    onClick={() => {
                      setSelectedSessionId(result.session_id);
                      setActivePanel("transcript");
                      setQuery("");
                      setSearchResult(null);
                    }}
                  >
                    <div className="truncate font-medium text-dls-text">{result.name || result.session_id}</div>
                    <div className="mt-1 line-clamp-2">{plainSessionArchiveSnippet(result.snippet)}</div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <section className={cn("min-h-0 flex-1 px-5 py-4", activePanel === "settings" ? "overflow-auto" : "overflow-hidden")}>
            {activePanel === "settings" ? (
              <SettingsPanel
                config={configSnapshot}
                loading={configLoading}
                importKind={importKind}
                importFilename={importFilename}
                importProject={importProject}
                importAgent={importAgent}
                importContent={importContent}
                importing={importing}
                selectedAgentDirId={selectedAgentDirId}
                agentDirText={agentDirText}
                terminalMode={terminalMode}
                terminalBin={terminalBin}
                terminalArgs={terminalArgs}
                githubToken={githubToken}
                remoteUrl={remoteUrl}
                remoteOriginsText={remoteOriginsText}
                remoteRequireAuth={remoteRequireAuth}
                remoteAuthConfigured={remoteAuthConfigured}
                postgresUrl={postgresUrl}
                postgresSchema={postgresSchema}
                postgresMachine={postgresMachine}
                postgresAllowInsecure={postgresAllowInsecure}
                postgresWatch={postgresWatch}
                duckDbPath={duckDbPath}
                duckDbUrl={duckDbUrl}
                duckDbTokenConfigured={duckDbTokenConfigured}
                duckDbMachine={duckDbMachine}
                duckDbAllowInsecure={duckDbAllowInsecure}
                backendsStatus={backendsStatus}
                lifecycleStatus={lifecycleStatus}
                mappingPath={mappingPath}
                mappingProject={mappingProject}
                mappingMachine={mappingMachine}
                secretConfidence={secretConfidence}
                secretFindings={secretFindings}
                secretScanSummary={secretScanSummary}
                secretScanning={secretScanning}
                onImportKindChange={setImportKind}
                onImportFilenameChange={setImportFilename}
                onImportProjectChange={setImportProject}
                onImportAgentChange={setImportAgent}
                onImportContentChange={setImportContent}
                onImport={handleImport}
                onSelectAgentDir={handleSelectAgentDir}
                onAgentDirTextChange={setAgentDirText}
                onSaveAgentDirs={handleSaveAgentDirs}
                onTerminalModeChange={setTerminalMode}
                onTerminalBinChange={setTerminalBin}
                onTerminalArgsChange={setTerminalArgs}
                onSaveTerminal={handleSaveTerminal}
                onGithubTokenChange={setGithubToken}
                onSaveGithub={handleSaveGithub}
                onRemoteUrlChange={setRemoteUrl}
                onRemoteOriginsTextChange={setRemoteOriginsText}
                onRemoteRequireAuthChange={setRemoteRequireAuth}
                onRemoteAuthConfiguredChange={setRemoteAuthConfigured}
                onSaveRemote={handleSaveRemote}
                onPostgresUrlChange={setPostgresUrl}
                onPostgresSchemaChange={setPostgresSchema}
                onPostgresMachineChange={setPostgresMachine}
                onPostgresAllowInsecureChange={setPostgresAllowInsecure}
                onPostgresWatchChange={setPostgresWatch}
                onSavePostgres={handleSavePostgres}
                onDuckDbPathChange={setDuckDbPath}
                onDuckDbUrlChange={setDuckDbUrl}
                onDuckDbTokenConfiguredChange={setDuckDbTokenConfigured}
                onDuckDbMachineChange={setDuckDbMachine}
                onDuckDbAllowInsecureChange={setDuckDbAllowInsecure}
                onSaveDuckDb={handleSaveDuckDb}
                onMappingPathChange={setMappingPath}
                onMappingProjectChange={setMappingProject}
                onMappingMachineChange={setMappingMachine}
                onAddMapping={handleAddMapping}
                onDeleteMapping={handleDeleteMapping}
                onApplyMappings={handleApplyMappings}
                onSecretConfidenceChange={setSecretConfidence}
                onScanSecrets={handleScanSecrets}
              />
            ) : selectedSession ? (
              <div className="mx-auto flex h-full max-w-6xl flex-col gap-3">
                <div className="shrink-0 rounded-lg border border-dls-border bg-dls-surface px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      {renamingSessionId === selectedSession.id ? (
                        <input
                          className="w-full rounded-lg border border-dls-accent bg-dls-surface px-2 py-1 text-base font-medium text-dls-text outline-none"
                          value={renameValue}
                          autoFocus
                          onChange={(event) => setRenameValue(event.currentTarget.value)}
                          onBlur={submitRename}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") submitRename();
                            if (event.key === "Escape") setRenamingSessionId(null);
                          }}
                          aria-label={t("session_archive.rename")}
                        />
                      ) : (
                        <h2 className="line-clamp-2 text-base font-medium text-dls-text">{selectedSession.display_name || selectedSession.first_message || selectedSession.id}</h2>
                      )}
                      <div className="flex flex-wrap gap-2 text-xs text-dls-secondary">
                        <span>{selectedSession.agent}</span>
                        <span>{selectedSession.project}</span>
                        <span>{selectedSession.started_at || t("common.unknown")}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      <div className="flex rounded-lg border border-dls-border bg-dls-muted p-0.5">
                        <Button type="button" variant={activePanel === "transcript" ? "secondary" : "ghost"} size="sm" onClick={() => setActivePanel("transcript")}>
                          <MessageSquareText className="size-4" />
                          {t("session_archive.transcript_tab")}
                        </Button>
                        <Button type="button" variant={activePanel === "usage" ? "secondary" : "ghost"} size="sm" onClick={() => setActivePanel("usage")}>
                          <BarChart3 className="size-4" />
                          {t("session_archive.usage_tab")}
                        </Button>
                        {/* Analytics temporarily disabled for performance optimization */}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" variant="outline" size="icon-sm" aria-label={starredIds.includes(selectedSession.id) ? t("session_archive.unstar") : t("session_archive.star")} onClick={() => handleToggleStar(selectedSession.id)}>
                          <Star className={cn("size-4", starredIds.includes(selectedSession.id) && "fill-dls-accent text-dls-accent")} />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>
                            <Ellipsis className="size-4" />
                            {t("common.more")}
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onClick={() => startRename(selectedSession)}>
                              <Ellipsis className="size-4" />
                              {t("session_archive.rename")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleOpenDirectory(selectedSession.id)}>
                              <FolderOpen className="size-4" />
                              {t("session_archive.open_directory")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleResume(selectedSession.id)}>
                              <Terminal className="size-4" />
                              {t("session_archive.resume")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleExport(selectedSession.id, "html")}>
                              <Download className="size-4" />
                              {t("session_archive.export_html")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleExport(selectedSession.id, "md")}>
                              <Download className="size-4" />
                              {t("session_archive.export_md")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("session_archive.trash_action")} onClick={() => requestTrash(selectedSession)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
                {/* AnalyticsPanel temporarily disabled for performance optimization */}
                {activePanel === "usage" ? (
                  <div className="min-h-0 flex-1 overflow-auto pr-1">
                    <UsagePanel
                      loading={usageLoading}
                      summary={usageSummary}
                      comparison={usageComparison}
                      topSessions={topUsageSessions}
                      selectedSession={selectedSession}
                      sessionUsage={sessionUsage}
                    />
                  </div>
                ) : messagesLoading && !messages ? (
                  <ArchiveStateBlock title={t("session_archive.loading_messages")} />
                ) : messages?.messages.length ? (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-dls-border bg-dls-surface px-2 py-1.5">
                      {hasOlderMessages ? (
                        <Button type="button" variant="outline" size="sm" onClick={handleLoadOlderMessages} disabled={loadingOlderMessages}>
                          {loadingOlderMessages ? t("session_archive.loading_older_messages") : t("session_archive.load_older_messages")}
                        </Button>
                      ) : (
                        <span className="text-xs text-dls-muted">{t("session_archive.messages_loaded_all")}</span>
                      )}
                      <div className="flex min-w-64 flex-1 items-center gap-2">
                        <Search className="size-4 text-dls-secondary" />
                        <input
                          data-session-archive-find-input="true"
                          className="min-w-0 flex-1 bg-transparent text-sm text-dls-text outline-none placeholder:text-dls-muted"
                          value={sessionFindQuery}
                          onChange={(event) => setSessionFindQuery(event.target.value)}
                          placeholder={t("session_archive.find_placeholder")}
                          aria-label={t("session_archive.find_placeholder")}
                        />
                        <span className="min-w-16 text-right text-xs text-dls-secondary">
                          {sessionFindQuery.trim()
                            ? sessionFindMatches.length
                              ? t("session_archive.find_count", { current: sessionFindIndex + 1, total: sessionFindMatches.length })
                              : t("session_archive.find_no_results")
                            : ""}
                        </span>
                        <Button type="button" variant="ghost" size="icon-xs" disabled={!sessionFindMatches.length} onClick={() => moveSessionFind(-1)} aria-label={t("session_archive.find_previous")}>↑</Button>
                        <Button type="button" variant="ghost" size="icon-xs" disabled={!sessionFindMatches.length} onClick={() => moveSessionFind(1)} aria-label={t("session_archive.find_next")}>↓</Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button type="button" variant="outline" size="sm" onClick={() => setFollowLatestSignal((value) => value + 1)}>
                          {t("session_archive.follow_latest")}
                        </Button>
                        <Button type="button" variant={transcriptNewestFirst ? "secondary" : "outline"} size="sm" onClick={() => setTranscriptNewestFirst((value) => !value)}>
                          {t("session_archive.newest_first")}
                        </Button>
                        <Button type="button" variant={transcriptCompact ? "secondary" : "outline"} size="sm" onClick={() => setTranscriptCompact((value) => !value)}>
                          {t("session_archive.compact_transcript")}
                        </Button>
                        <Button type="button" variant={transcriptHideMeta ? "secondary" : "outline"} size="sm" onClick={() => setTranscriptHideMeta((value) => !value)}>
                          {t("session_archive.hide_message_meta")}
                        </Button>
                      </div>
                    </div>
                    <VirtualMessageList
                      messages={transcriptMessages}
                      pins={pins}
                      onTogglePin={handlePin}
                      findQuery={sessionFindQuery}
                      activeFindOrdinal={currentSessionFindMatch?.ordinal ?? null}
                      compact={transcriptCompact}
                      hideMeta={transcriptHideMeta}
                      followLatestSignal={followLatestSignal}
                    />
                  </div>
                ) : (
                  <ArchiveStateBlock title={t("session_archive.no_messages")} />
                )}
              </div>
            ) : (
              <ArchiveStateBlock title={t("session_archive.select_session")} />
            )}
          </section>
        </main>
      </div>
    </div>
    <Dialog open={Boolean(confirmAction)} onOpenChange={(open) => {
      if (!open) setConfirmAction(null);
    }}>
      <DialogContent className="rounded-xl bg-dls-surface text-dls-text" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{confirmTitle}</DialogTitle>
          <DialogDescription className="space-y-2 text-dls-secondary">
            <span className="block break-words">{confirmTarget}</span>
            <span className="block">{confirmDescription}</span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="rounded-b-xl">
          <Button type="button" variant="outline" onClick={() => setConfirmAction(null)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirmAction}>
            {confirmTitle}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <SessionArchiveCommandPalette
      open={commandPaletteOpen}
      items={commandPaletteItems}
      onClose={() => setCommandPaletteOpen(false)}
    />
    </>
  );
}
