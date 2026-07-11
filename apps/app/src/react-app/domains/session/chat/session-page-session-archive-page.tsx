/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, MessageSquare, PlayCircle, RefreshCw, Search, Trash2 } from "lucide-react";

import { t } from "../../../../i18n";
import type {
  OnMyAgentServerClient,
  OnMyAgentSessionArchiveMessagesResponse,
  OnMyAgentSessionArchiveSession,
} from "../../../../app/lib/onmyagent-server";
import { formatRelativeTime } from "../../../../app/utils";
import { AgentSkillIcon } from "../components/shared-pages/agent-skill-icon";
import type { AgentManagementSkillAgent } from "../../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [collapsedAgents, setCollapsedAgents] = useState<Record<string, boolean>>({});
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

  const toggleAgent = (agent: string) => {
    setCollapsedAgents((current) => ({ ...current, [agent]: current[agent] === true ? false : true }));
  };

  const filteredGroups = useMemo(() => {
    if (!agentFilter) return groups;
    return groups.filter((g) => g.agent === agentFilter);
  }, [groups, agentFilter]);

  // 当选择某个 agent 筛选时自动展开对应分组
  useEffect(() => {
    if (agentFilter) {
      setCollapsedAgents((current) => ({ ...current, [agentFilter]: false }));
    }
  }, [agentFilter]);

  // 默认全部折叠：首次有数据时把所有 agent 标记为折叠
  const didInitCollapse = useRef(false);
  useEffect(() => {
    if (!didInitCollapse.current && groups.length > 0) {
      didInitCollapse.current = true;
      setCollapsedAgents((current) => {
        const next = { ...current };
        let changed = false;
        for (const g of groups) {
          if (next[g.agent] === undefined) {
            next[g.agent] = true;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }
  }, [groups]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-dls-secondary" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("session_archive.search_placeholder")}
            className="border-dls-border bg-dls-surface pl-9 text-sm"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={refreshList}
          disabled={loadingList}
          aria-label={t("session_archive.sync")}
          title={t("session_archive.sync")}
        >
          <RefreshCw className={cn("size-4", loadingList && "animate-spin")} />
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {/* Agent 筛选栏 */}
      {groups.length > 0 ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAgentFilter(null)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              !agentFilter
                ? "bg-dls-accent text-white"
                : "bg-dls-surface-muted text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
            )}
          >
            {t("session_archive.agent_filter_all")}
          </button>
          {groups.map((g) => (
            <button
              key={g.agent}
              type="button"
              onClick={() => setAgentFilter(g.agent === agentFilter ? null : g.agent)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                g.agent === agentFilter
                  ? "bg-dls-accent text-white"
                  : "bg-dls-surface-muted text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
              )}
            >
              <AgentSkillIcon agent={g.agent as AgentManagementSkillAgent} />
              {agentLabel(g.agent)}
              <span className="ml-0.5 opacity-70 tabular-nums">
                {(g as { totalCount?: number }).totalCount ?? g.sessions.length}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="flex w-80 min-w-60 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
          <div className="flex items-center justify-between border-b border-dls-border px-3 py-2">
            <span className="text-xs font-medium text-dls-secondary">
              {t("session_archive.agent_group_count", { count: totalKnown })}
            </span>
            {loadingList ? (
              <RefreshCw className="size-3.5 animate-spin text-dls-secondary" />
            ) : null}
          </div>
          <div className="flex-1 overflow-auto">
            {filteredGroups.length === 0 && !loadingList ? (
              <div className="px-3 py-8 text-center text-xs text-dls-secondary">
                {t("session_archive.empty")}
              </div>
            ) : null}
            {filteredGroups.map((group) => {
              const collapsed = collapsedAgents[group.agent] === true;
              const countLabel =
                "totalCount" in group
                  ? group.sessions.length === group.totalCount
                    ? String(group.totalCount)
                    : `${group.sessions.length}/${group.totalCount}`
                  : String(group.sessions.length);
              return (
                <div key={group.agent} className="border-b border-dls-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggleAgent(group.agent)}
                    className="flex w-full items-center gap-2 bg-dls-surface-muted px-3 py-2 text-left text-xs font-medium text-dls-text transition-colors hover:bg-dls-hover"
                  >
                    <span className="flex size-4 items-center justify-center">
                      <AgentSkillIcon agent={group.agent as AgentManagementSkillAgent} />
                    </span>
                    {collapsed ? (
                      <ChevronRight className="size-3.5 text-dls-secondary" />
                    ) : (
                      <ChevronDown className="size-3.5 text-dls-secondary" />
                    )}
                    <span className="flex-1 truncate">{agentLabel(group.agent)}</span>
                    <span className="rounded-full bg-dls-hover px-1.5 py-0.5 text-2xs font-medium text-dls-secondary tabular-nums">
                      {countLabel}
                    </span>
                  </button>
                  {collapsed ? null : (
                    <ul className="divide-y divide-dls-border/60">
                      {group.sessions.map((session) => {
                        const active = session.id === selectedSessionId;
                        return (
                          <li key={session.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedSessionId(session.id)}
                              className={cn(
                                "flex w-full flex-col gap-1.5 px-3 py-2.5 text-left transition-colors",
                                active
                                  ? "bg-dls-hover ring-1 ring-inset ring-dls-accent/20"
                                  : "hover:bg-dls-hover/60",
                              )}
                            >
                              <div className="flex items-start gap-2">
                                <MessageSquare
                                  className={cn(
                                    "mt-0.5 size-3.5 shrink-0",
                                    active ? "text-dls-accent" : "text-dls-secondary/50",
                                  )}
                                />
                                <span className="flex-1 truncate text-sm font-medium text-dls-text">
                                  {session.display_name || session.first_message || session.id}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2 pl-5.5 text-xs text-dls-secondary">
                                <span className="truncate">
                                  {session.project || agentLabel(session.agent)}
                                </span>
                                <span className="shrink-0 tabular-nums">
                                  {session.file_mtime
                                    ? formatRelativeTime(session.file_mtime)
                                    : t("session_archive.message_count", { count: session.message_count })}
                                </span>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
          {selectedSession ? (
            <>
              <header className="flex items-start justify-between gap-3 border-b border-dls-border px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex size-4.5 items-center justify-center">
                      <AgentSkillIcon agent={selectedSession.agent as AgentManagementSkillAgent} />
                    </span>
                    <h2 className="truncate text-sm font-semibold text-dls-text">
                      {selectedSession.display_name || selectedSession.first_message || selectedSession.id}
                    </h2>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dls-secondary">
                    <span>{agentLabel(selectedSession.agent)}</span>
                    {selectedSession.project ? (
                      <span className="truncate">{selectedSession.project}</span>
                    ) : null}
                    <span>
                      {t("session_archive.message_count", { count: selectedSession.message_count })}
                    </span>
                    {selectedSession.file_mtime ? (
                      <span>{formatRelativeTime(selectedSession.file_mtime)}</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleResume}
                    disabled={!canResume}
                  >
                    <PlayCircle className="size-4" />
                    {t("session_archive.resume")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDelete}
                    disabled={!selectedSession}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    {t("session_archive.delete")}
                  </Button>
                </div>
              </header>
              <div className="flex-1 overflow-auto p-4">
                {loadingMessages ? (
                  <div className="flex items-center gap-2 text-xs text-dls-secondary">
                    <RefreshCw className="size-3 animate-spin" />
                    {t("session_archive.loading_messages")}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-xs text-dls-secondary">
                    <MessageSquare className="size-8 opacity-30" />
                    <span>{t("session_archive.no_messages")}</span>
                  </div>
                ) : (
                  <ol className="flex flex-col gap-4">
                    {messages.map((message) => (
                      <li key={message.id} className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-2xs font-semibold uppercase tracking-wider",
                            message.role === "user" ? "text-dls-accent" : "text-dls-secondary",
                          )}>
                            {message.role}
                          </span>
                          <span className="h-px flex-1 bg-dls-border/60" />
                        </div>
                        <div className="whitespace-pre-wrap break-words rounded-lg bg-dls-surface-muted px-3 py-2 text-sm leading-relaxed text-dls-text">
                          {message.content}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-xs text-dls-secondary">
              <MessageSquare className="size-8 opacity-30" />
              <span>{t("session_archive.select_session")}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
