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
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
import { CountBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { SessionArchiveResumeRequest } from "./session-archive-helpers";
import {
  agentLabel,
  VISIBLE_AGENTS,
  groupSessionsByAgent,
  buildResumeRequest,
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
  VISIBLE_AGENTS,
  RESUMABLE_AGENTS,
  groupSessionsByAgent,
  buildResumeRequest,
} from "./session-archive-helpers";

const PAGE_LIMIT = 2000;
const MESSAGE_LIMIT = 500;

type Props = {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  onResume?: (request: SessionArchiveResumeRequest) => void;
};

export function SessionArchivePage(props: Props) {
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<OnMyAgentSessionArchiveSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<OnMyAgentSessionArchiveMessagesResponse["messages"]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listTick, setListTick] = useState(0);
  const [agentCounts, setAgentCounts] = useState<Array<{ agent: string; count: number }>>([]);
  const [agentFilter, setAgentFilter] = useState<string | null>(null); // null = 全部


  const trimmedQuery = query.trim();
  const refreshList = useCallback(() => setListTick((tick) => tick + 1), []);

  // Guard so SSE-driven refreshes never disturb the transcript pane the user
  // is currently reading. Transcript refetch only fires when the user changes
  // selection, not when the list ticks.
  const lastLoadedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim()) return;
    let cancelled = false;
    setLoadingList(true);
    setError(null);
    props.client
      .listSessionArchiveSessions(props.workspaceId, {
        limit: PAGE_LIMIT,
        search: trimmedQuery || undefined,
      })
      .then((page) => {
        if (cancelled) return;
        setSessions(page.sessions);
        setAgentCounts(page.agent_counts ?? []);
        setSelectedSessionId((current) => {
          if (current && page.sessions.some((s) => s.id === current)) return current;
          return page.sessions[0]?.id ?? null;
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.client, props.workspaceId, trimmedQuery, listTick]);

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
    const filteredSessions = sessions.filter((s) => VISIBLE_AGENTS.has(s.agent));
    const localGroups = groupSessionsByAgent(filteredSessions);
    if (agentCounts.length === 0) return localGroups;
    const bySessionAgent = new Map(localGroups.map((g) => [g.agent, g.sessions]));
    const merged = agentCounts
      .filter((entry) => entry.count > 0 && VISIBLE_AGENTS.has(entry.agent))
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
    return session.display_name || session.first_message || session.id;
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-dls-background">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-col gap-3 border-b border-dls-border px-4 py-3">
        <div className="flex items-center gap-3">
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
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                size="icon-xs"
                onClick={refreshList}
                disabled={loadingList}
                aria-label={t("session_archive.sync")}
                title={t("session_archive.sync")}
              >
                <RefreshCw className={cn("size-3.5", loadingList && "animate-spin")} />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
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
            {groups.map((g) => (
              <FilterChip
                key={g.agent}
                type="button"
                selected={g.agent === agentFilter}
                onClick={() => setAgentFilter(g.agent === agentFilter ? null : g.agent)}
                label={
                  <>
                    <AgentSkillIcon agent={g.agent as AgentManagementSkillAgent} />
                    {agentLabel(g.agent)}
                    <span className="tabular-nums opacity-70">
                      {(g as { totalCount?: number }).totalCount ?? g.sessions.length}
                    </span>
                  </>
                }
              />
            ))}
          </div>
        ) : null}

        {error ? <NoticeBox tone="error">{error}</NoticeBox> : null}
      </div>

      {/* Master–detail */}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r border-dls-border bg-dls-surface/40">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingList && flatSessions.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-8 text-xs text-dls-secondary">
                <LoadingSpinner size="sm" />
                {t("session_archive.loading")}
              </div>
            ) : null}
            {!loadingList && flatSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-20 text-center text-xs text-dls-secondary">
                <MessageSquare className="size-8 opacity-30" />
                <span>{t("session_archive.empty")}</span>
              </div>
            ) : null}
            <ul className="flex flex-col p-1.5">
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
                        "flex w-full min-w-0 flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors",
                        active
                          ? "bg-dls-list-selected text-dls-text"
                          : "text-dls-text hover:bg-dls-list-hover/60",
                      )}
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                          <AgentSkillIcon agent={session.agent as AgentManagementSkillAgent} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium leading-5">
                          {title}
                        </span>
                        {timeLabel ? (
                          <span className="mt-0.5 shrink-0 text-xs tabular-nums text-dls-secondary">
                            {timeLabel}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5 pl-6 text-xs text-dls-secondary">
                        <span className="shrink-0">{agentLabel(session.agent)}</span>
                        {project ? (
                          <>
                            <span className="opacity-40" aria-hidden="true">·</span>
                            <span className="min-w-0 truncate">{project}</span>
                          </>
                        ) : null}
                        <span className="opacity-40" aria-hidden="true">·</span>
                        <span className="shrink-0 tabular-nums">
                          {t("session_archive.message_count", { count: session.message_count })}
                        </span>
                      </div>
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
              <header className="flex shrink-0 items-center justify-between gap-4 border-b border-dls-border px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center">
                      <AgentSkillIcon agent={selectedSession.agent as AgentManagementSkillAgent} />
                    </span>
                    <h2 className="min-w-0 truncate text-sm font-semibold text-dls-text">
                      {sessionTitle(selectedSession)}
                    </h2>
                  </div>
                  <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-7 text-xs text-dls-secondary">
                    <span>{agentLabel(selectedSession.agent)}</span>
                    {shortProjectLabel(selectedSession.project) ? (
                      <>
                        <span className="opacity-40" aria-hidden="true">·</span>
                        <span className="min-w-0 truncate">
                          {shortProjectLabel(selectedSession.project)}
                        </span>
                      </>
                    ) : null}
                    <span className="opacity-40" aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {t("session_archive.message_count", {
                        count: selectedSession.message_count,
                      })}
                    </span>
                    {selectedSession.file_mtime ? (
                      <>
                        <span className="opacity-40" aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {formatRelativeTime(selectedSession.file_mtime)}
                        </span>
                      </>
                    ) : null}
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
                ) : messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-xs text-dls-secondary">
                    <MessageSquare className="size-8 opacity-30" />
                    <span>{t("session_archive.no_messages")}</span>
                  </div>
                ) : (
                  <ol className="mx-auto flex w-full max-w-3xl flex-col px-5 py-4">
                    {messages.map((message, index) => {
                      const isUser = message.role === "user";
                      return (
                        <li
                          key={message.id}
                          className={cn(
                            "flex flex-col gap-2 py-4",
                            index > 0 && "border-t border-dls-border/70",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium",
                                isUser
                                  ? "bg-dls-accent/10 text-dls-accent"
                                  : message.role === "tool"
                                    ? "bg-dls-surface-muted text-dls-secondary"
                                    : "bg-dls-surface-muted text-dls-text",
                              )}
                            >
                              {roleLabel(message.role)}
                            </span>
                          </div>
                          <div
                            className={cn(
                              "whitespace-pre-wrap break-words text-sm leading-relaxed text-dls-text",
                              isUser && "rounded-xl bg-dls-surface-muted/70 px-3.5 py-3",
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
              <span className="text-sm text-dls-text">{t("session_archive.select_session")}</span>
              <span>{t("session_archive.select_session_hint")}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function shortProjectLabel(project: string | null | undefined): string | null {
  if (!project) return null;
  const normalized = project.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return project;
  return parts[parts.length - 1] ?? project;
}
