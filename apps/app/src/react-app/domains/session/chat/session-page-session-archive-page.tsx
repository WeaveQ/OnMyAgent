/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, PlayCircle, RefreshCw, Search, Trash2 } from "lucide-react";

import { t } from "../../../../i18n";
import type {
  OnMyAgentServerClient,
  OnMyAgentSessionArchiveMessagesResponse,
  OnMyAgentSessionArchiveSession,
} from "../../../../app/lib/onmyagent-server";
import { formatRelativeTime } from "../../../../app/utils";
import { AgentSkillIcon } from "../../../design-system/agent-skill-icon";
import type { AgentManagementSkillAgent } from "../../../../app/lib/desktop";
import { FilterChip } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
import { CountBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { SessionArchiveResumeRequest } from "./session-archive-helpers";
import {
  agentLabel,
  archiveAgentIconId,
  isVisibleArchiveAgent,
  groupSessionsByAgent,
  buildResumeRequest,
  humanizeArchiveTitle,
} from "./session-archive-helpers";

// Pure helpers + the `SessionArchiveResumeRequest` type live in
// `session-archive-helpers.ts` to keep this page focused on rendering.
// They are re-exported here so existing import sites
// (expert.tsx / assistant.tsx / personal-local-agent-page.tsx /
// session-archive-page.test.ts) keep working unchanged.
export type {
  SessionArchiveResumeRequest,
} from "./session-archive-helpers";
export {
  agentLabel,
  archiveAgentIconId,
  isVisibleArchiveAgent,
  VISIBLE_AGENTS,
  RESUMABLE_AGENTS,
  groupSessionsByAgent,
  buildResumeRequest,
  humanizeArchiveTitle,
} from "./session-archive-helpers";

const PAGE_LIMIT = 2000;
const MESSAGE_LIMIT = 500;

type Props = {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  onResume?: (request: SessionArchiveResumeRequest) => void;
};

type ArchiveSyncSummary = {
  discovered: number;
  synced: number;
  skipped: number;
  failed: number;
  warnings: string[];
};

export function SessionArchivePage(props: Props) {
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<OnMyAgentSessionArchiveSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<OnMyAgentSessionArchiveMessagesResponse["messages"]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listTick, setListTick] = useState(0);
  const [agentCounts, setAgentCounts] = useState<Array<{ agent: string; count: number }>>([]);
  const [agentFilter, setAgentFilter] = useState<string | null>(null); // null = 全部
  const [lastSyncSummary, setLastSyncSummary] = useState<ArchiveSyncSummary | null>(null);

  const trimmedQuery = query.trim();
  const refreshList = useCallback(() => setListTick((tick) => tick + 1), []);

  // Guard so SSE-driven refreshes never disturb the transcript pane the user
  // is currently reading. Transcript refetch only fires when the user changes
  // selection, not when the list ticks.
  const lastLoadedSessionRef = useRef<string | null>(null);
  const initialSyncDoneRef = useRef(false);

  const loadSessionList = useCallback(async () => {
    if (!props.client || !props.workspaceId.trim()) return;
    setLoadingList(true);
    setError(null);
    try {
      const page = await props.client.listSessionArchiveSessions(props.workspaceId, {
        limit: PAGE_LIMIT,
        search: trimmedQuery || undefined,
      });
      setSessions(page.sessions);
      setAgentCounts(page.agent_counts ?? []);
      setSelectedSessionId((current) => {
        if (current && page.sessions.some((s) => s.id === current)) return current;
        return page.sessions[0]?.id ?? null;
      });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingList(false);
    }
  }, [props.client, props.workspaceId, trimmedQuery]);

  const runArchiveSync = useCallback(
    async (mode: "incremental" | "resync" = "resync") => {
      if (!props.client || !props.workspaceId.trim()) return;
      setSyncing(true);
      setError(null);
      try {
        await props.client.syncSessionArchive(props.workspaceId, { mode });
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          const status = await props.client.getSessionArchiveSyncStatus(props.workspaceId);
          if (status.status === "completed" || status.status === "failed") {
            const stats = status.stats;
            setLastSyncSummary({
              discovered: stats?.discovered_sessions ?? stats?.total_sessions ?? 0,
              synced: stats?.synced ?? 0,
              skipped: stats?.skipped ?? 0,
              failed: stats?.failed ?? 0,
              warnings: stats?.warnings ?? (status.error ? [status.error] : []),
            });
            if (status.status === "failed" && status.error) {
              setError(status.error);
            }
            break;
          }
          await new Promise((resolve) => {
            window.setTimeout(resolve, 400);
          });
        }
        await loadSessionList();
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSyncing(false);
      }
    },
    [props.client, props.workspaceId, loadSessionList],
  );

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    void loadSessionList();
  }, [props.client, props.workspaceId, trimmedQuery, listTick, loadSessionList]);

  // First visit: run a real archive sync so Windows cold starts actually index
  // local agent histories instead of only re-reading an empty SQLite cache.
  useEffect(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    if (initialSyncDoneRef.current) return;
    initialSyncDoneRef.current = true;
    void runArchiveSync("incremental");
  }, [props.client, props.workspaceId, runArchiveSync]);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim() || !selectedSessionId) {
      setMessages([]);
      lastLoadedSessionRef.current = null;
      return;
    }
    if (lastLoadedSessionRef.current === selectedSessionId) return;
    lastLoadedSessionRef.current = selectedSessionId;
    let cancelled = false;
    setLoadingMessages(true);
    props.client
      .getSessionArchiveMessages(props.workspaceId, selectedSessionId, {
        limit: MESSAGE_LIMIT,
        direction: "asc",
      })
      .then((response) => {
        if (cancelled) return;
        setMessages(response.messages);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.client, props.workspaceId, selectedSessionId]);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    const controller = new AbortController();
    props.client
      .openSessionArchiveEventsStream(props.workspaceId, { pollMs: 5000, signal: controller.signal })
      .then(async (response) => {
        const body = response.body;
        if (!body) return;
        const reader = body.getReader();
        try {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
            refreshList();
          }
        } finally {
          reader.releaseLock();
        }
      })
      .catch(() => {});
    return () => {
      controller.abort();
    };
  }, [props.client, props.workspaceId, refreshList]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const groups = useMemo(() => {
    // Option A: surface every backend-scanned agent that has sessions —
    // no tight five-agent whitelist (mimocode / kiro / … stay discoverable).
    const filteredSessions = sessions.filter((s) => isVisibleArchiveAgent(s.agent));
    const localGroups = groupSessionsByAgent(filteredSessions);
    if (agentCounts.length === 0) return localGroups;
    const bySessionAgent = new Map(localGroups.map((g) => [g.agent, g.sessions]));
    const merged = agentCounts
      .filter((entry) => entry.count > 0 && isVisibleArchiveAgent(entry.agent))
      .map((entry) => ({
        agent: entry.agent,
        totalCount: entry.count,
        sessions: bySessionAgent.get(entry.agent) ?? [],
      }))
      .sort((a, b) => b.totalCount - a.totalCount);
    return merged;
  }, [sessions, agentCounts]);

  const handleDelete = useCallback(async () => {
    if (!props.client || !selectedSessionId) return;
    try {
      await props.client.trashSessionArchiveSession(props.workspaceId, selectedSessionId);
      setSelectedSessionId(null);
      lastLoadedSessionRef.current = null;
      refreshList();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [props.client, props.workspaceId, selectedSessionId, refreshList]);

  const resumeRequest = useMemo(() => buildResumeRequest(selectedSession), [selectedSession]);
  const totalKnown = useMemo(() => {
    return groups.reduce((sum, g) => {
      const total = (g as { totalCount?: number }).totalCount;
      return sum + (typeof total === "number" ? total : g.sessions.length);
    }, 0);
  }, [groups]);
  const handleResume = useCallback(() => {
    if (!resumeRequest || !props.onResume) return;
    props.onResume(resumeRequest);
  }, [props, resumeRequest]);
  const canResume = Boolean(resumeRequest && props.onResume);

  const flatSessions = useMemo(() => {
    const source = agentFilter
      ? groups.filter((g) => g.agent === agentFilter)
      : groups;
    const rows = source.flatMap((g) => g.sessions);
    return rows.sort((a, b) => {
      const at = a.file_mtime ?? 0;
      const bt = b.file_mtime ?? 0;
      return bt - at;
    });
  }, [groups, agentFilter]);

  const roleLabel = useCallback((role: string) => {
    if (role === "user") return t("session_archive.role_user");
    if (role === "assistant") return t("session_archive.role_assistant");
    if (role === "system") return t("session_archive.role_system");
    if (role === "tool") return t("session_archive.role_tool");
    return role;
  }, []);

  const sessionTitle = useCallback((session: OnMyAgentSessionArchiveSession) => {
    return humanizeArchiveTitle(session);
  }, []);

  const displayMessages = useMemo(() => {
    return messages
      .map((message) => ({
        ...message,
        content: cleanArchiveMessageContent(message.content),
      }))
      .filter((message) => !isNoisyArchiveMessage(message));
  }, [messages]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-dls-background">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-dls-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <InputGroup controlSize="sm" radius="md" tone="surface" className="min-w-0 flex-1">
            <InputGroupAddon align="inline-start">
              <Search aria-hidden="true" className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("session_archive.search_placeholder")}
              aria-label={t("session_archive.search_placeholder")}
              className="text-sm text-dls-text placeholder:text-dls-secondary/70"
            />
          </InputGroup>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => {
              void runArchiveSync("resync");
            }}
            disabled={loadingList || syncing}
            aria-label={t("session_archive.sync")}
            title={t("session_archive.sync")}
            className="shrink-0"
          >
            <RefreshCw className={cn("size-3.5", (loadingList || syncing) && "animate-spin")} />
          </Button>
          <CountBadge size="dot" className="shrink-0 tabular-nums">
            {t("session_archive.agent_group_count", { count: totalKnown })}
          </CountBadge>
        </div>

        {groups.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip
              type="button"
              selected={!agentFilter}
              onClick={() => setAgentFilter(null)}
              label={t("session_archive.agent_filter_all")}
            />
            {groups.map((g) => {
              const count =
                (g as { totalCount?: number }).totalCount ?? g.sessions.length;
              return (
                <FilterChip
                  key={g.agent}
                  type="button"
                  selected={g.agent === agentFilter}
                  onClick={() =>
                    setAgentFilter(g.agent === agentFilter ? null : g.agent)
                  }
                  label={
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <AgentSkillIcon
                        agent={archiveAgentIconId(g.agent) as AgentManagementSkillAgent}
                      />
                      <span className="truncate">{agentLabel(g.agent)}</span>
                      <span className="tabular-nums text-dls-secondary">
                        {formatCompactCount(count)}
                      </span>
                    </span>
                  }
                />
              );
            })}
          </div>
        ) : null}

        {error ? <NoticeBox tone="error">{error}</NoticeBox> : null}
      </div>

      {/* Master–detail */}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r border-dls-border/60 bg-dls-surface/40">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingList && flatSessions.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-8 text-xs text-dls-secondary">
                <LoadingSpinner size="sm" />
                {t("session_archive.loading")}
              </div>
            ) : null}
            {!loadingList && !syncing && flatSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center text-xs text-dls-secondary">
                <MessageSquare className="size-8 opacity-30" />
                <span>{t("session_archive.empty")}</span>
                <span className="max-w-[16rem] text-[11px] leading-relaxed text-dls-secondary/80">
                  {t("session_archive.empty_hint")}
                </span>
                {lastSyncSummary ? (
                  <span className="max-w-[16rem] text-[11px] leading-relaxed text-dls-secondary/70">
                    {t("session_archive.empty_sync_stats", {
                      discovered: lastSyncSummary.discovered,
                      synced: lastSyncSummary.synced,
                      skipped: lastSyncSummary.skipped,
                      failed: lastSyncSummary.failed,
                    })}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  disabled={syncing}
                  onClick={() => {
                    void runArchiveSync("resync");
                  }}
                >
                  <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
                  {t("session_archive.sync")}
                </Button>
              </div>
            ) : null}
            {syncing && flatSessions.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-8 text-xs text-dls-secondary">
                <LoadingSpinner size="sm" />
                {t("session_archive.syncing")}
              </div>
            ) : null}
            <ul className="flex flex-col gap-0.5 p-2">
              {flatSessions.map((session) => {
                const active = session.id === selectedSessionId;
                const title = sessionTitle(session);
                const project = shortProjectLabel(session.project);
                const timeLabel = session.file_mtime
                  ? formatRelativeTime(session.file_mtime)
                  : null;
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedSessionId(session.id)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex min-h-14 w-full min-w-0 items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                        active
                          ? "bg-dls-list-selected text-dls-text shadow-none"
                          : "text-dls-text hover:bg-dls-list-hover/50",
                      )}
                    >
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dls-surface ring-1 ring-dls-border/50">
                        <AgentSkillIcon
                          agent={archiveAgentIconId(session.agent) as AgentManagementSkillAgent}
                        />
                      </span>
                      <span className="flex min-h-0 min-w-0 flex-1 flex-col justify-center gap-0.5">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium leading-5">
                            {title}
                          </span>
                          {timeLabel ? (
                            <span className="shrink-0 text-2xs tabular-nums text-dls-secondary">
                              {timeLabel}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 text-2xs leading-4 text-dls-secondary">
                          <span className="shrink-0">
                            {agentLabel(session.agent)}
                          </span>
                          {project ? (
                            <>
                              <span className="opacity-40" aria-hidden="true">
                                ·
                              </span>
                              <span className="min-w-0 truncate">{project}</span>
                            </>
                          ) : null}
                          <span className="opacity-40" aria-hidden="true">
                            ·
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {t("session_archive.message_count", {
                              count: session.message_count,
                            })}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-dls-background">
          {selectedSession ? (
            <>
              <header className="flex shrink-0 items-center justify-between gap-4 border-b border-dls-border/60 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-dls-surface ring-1 ring-dls-border/50">
                      <AgentSkillIcon
                        agent={archiveAgentIconId(selectedSession.agent) as AgentManagementSkillAgent}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="min-w-0 truncate text-sm font-semibold leading-5 text-dls-text">
                        {sessionTitle(selectedSession)}
                      </h2>
                      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-dls-secondary">
                        <span>{agentLabel(selectedSession.agent)}</span>
                        {shortProjectLabel(selectedSession.project) ? (
                          <>
                            <span className="opacity-40" aria-hidden="true">
                              ·
                            </span>
                            <span className="min-w-0 truncate">
                              {shortProjectLabel(selectedSession.project)}
                            </span>
                          </>
                        ) : null}
                        <span className="opacity-40" aria-hidden="true">
                          ·
                        </span>
                        <span className="tabular-nums">
                          {t("session_archive.message_count", {
                            count: selectedSession.message_count,
                          })}
                        </span>
                        {selectedSession.file_mtime ? (
                          <>
                            <span className="opacity-40" aria-hidden="true">
                              ·
                            </span>
                            <span className="tabular-nums">
                              {formatRelativeTime(selectedSession.file_mtime)}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={handleResume}
                    disabled={!canResume}
                  >
                    <PlayCircle className="size-4" />
                    {t("session_archive.resume")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleDelete}
                    disabled={!selectedSession}
                    className="text-dls-danger hover:bg-dls-danger-soft hover:text-dls-danger"
                  >
                    <Trash2 className="size-4" />
                    {t("session_archive.delete")}
                  </Button>
                </div>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {loadingMessages ? (
                  <div className="flex items-center gap-2 px-5 py-8 text-xs text-dls-secondary">
                    <LoadingSpinner size="sm" />
                    {t("session_archive.loading_messages")}
                  </div>
                ) : displayMessages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-xs text-dls-secondary">
                    <MessageSquare className="size-8 opacity-30" />
                    <span>{t("session_archive.no_messages")}</span>
                  </div>
                ) : (
                  <ol className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-6">
                    {displayMessages.map((message) => {
                      const isUser = message.role === "user";
                      const isTool = message.role === "tool";
                      const isSystem = message.role === "system";
                      return (
                        <li
                          key={message.id}
                          className={cn(
                            "flex flex-col gap-1.5",
                            isUser ? "items-end" : "items-start",
                          )}
                        >
                          <div
                            className={cn(
                              "inline-flex h-5 items-center rounded-md px-1.5 text-2xs font-medium",
                              isUser
                                ? "bg-dls-accent/10 text-dls-accent"
                                : isTool || isSystem
                                  ? "bg-dls-surface-muted text-dls-secondary"
                                  : "bg-dls-surface-muted text-dls-secondary",
                            )}
                          >
                            {roleLabel(message.role)}
                          </div>
                          <div
                            className={cn(
                              "max-w-[min(100%,42rem)] whitespace-pre-wrap break-words text-sm leading-relaxed",
                              isUser &&
                                "rounded-2xl bg-dls-chat-user-bg px-3.5 py-2.5 text-dls-text",
                              isTool &&
                                "rounded-xl border border-dls-border/50 bg-dls-surface-muted/60 px-3 py-2 font-mono text-xs leading-5 text-dls-secondary",
                              isSystem &&
                                "rounded-xl border border-dashed border-dls-border/50 bg-dls-surface/40 px-3.5 py-2.5 text-xs leading-5 text-dls-secondary",
                              !isUser &&
                                !isTool &&
                                !isSystem &&
                                "rounded-2xl border border-dls-border/40 bg-dls-surface px-3.5 py-2.5 text-dls-text",
                            )}
                          >
                            {message.content}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-xs text-dls-secondary">
              <MessageSquare className="size-9 opacity-30" />
              <span className="text-sm text-dls-text">
                {t("session_archive.select_session")}
              </span>
              <span>{t("session_archive.select_session_hint")}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Prefer human payload inside harness wrappers; strip protocol tags so the
 * transcript does not look like a raw XML dump.
 */
function cleanArchiveMessageContent(content: string): string {
  const raw = String(content ?? "").trim();
  if (!raw) return "";
  const userRequest = raw.match(/<user-request>\s*([\s\S]*?)\s*<\/user-request>/i);
  if (userRequest?.[1]?.trim()) return userRequest[1].trim();
  const stripped = raw
    .replace(/<\/?(?:auto-slash-command|command-instruction|user-request|INSTRUCTIONS)[^>]*>/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripped || raw;
}

/** Drop empty / pure tool-noise lines so the transcript stays readable. */
function isNoisyArchiveMessage(message: {
  role: string;
  content: string;
}): boolean {
  const text = String(message.content ?? "").trim();
  if (!text) return true;
  if (message.role === "tool") {
    // Keep short tool summaries; drop giant dumps.
    if (text.length > 600) return true;
  }
  // JSON-RPC / protocol blobs
  if (text.startsWith("{") && (text.includes("jsonrpc") || text.includes('"method"'))) {
    return true;
  }
  // Bare harness shells: mostly tags/punctuation after cleanArchiveMessageContent.
  if (message.role === "system" && text.length > 400) {
    const letters = text.replace(/[^A-Za-z0-9]/g, "");
    if (letters.length < 12) return true;
  }
  return false;
}

function formatCompactCount(count: number): string {
  if (!Number.isFinite(count) || count < 1000) return String(count);
  if (count < 10_000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(count / 1000)}k`;
}

function shortProjectLabel(project: string | null | undefined): string | null {
  if (!project) return null;
  const normalized = project.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return project;
  return parts[parts.length - 1] ?? project;
}
