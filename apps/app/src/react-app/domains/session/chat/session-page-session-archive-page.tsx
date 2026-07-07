/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, PlayCircle, RefreshCw, Search, Trash2 } from "lucide-react";

import { t } from "../../../../i18n";
import type {
  OpenworkServerClient,
  OpenworkSessionArchiveMessagesResponse,
  OpenworkSessionArchiveSession,
} from "../../../../app/lib/onmyagent-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PAGE_LIMIT = 2000;
const MESSAGE_LIMIT = 500;

export type SessionArchiveResumeRequest = {
  agent: string;
  providerSessionId: string;
  project: string | null;
  sessionId: string;
  title: string;
};

type Props = {
  client: OpenworkServerClient | null;
  workspaceId: string;
  onResume?: (request: SessionArchiveResumeRequest) => void;
};

const AGENT_LABEL: Record<string, string> = {
  opencode: "OpenCode",
  codex: "Codex",
  claude: "Claude Code",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  gemini: "Gemini",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
  aider: "Aider",
  qwen: "Qwen Code",
  iflow: "iFlow",
  onmyagent: "OnMyAgent",
};

export function agentLabel(agent: string): string {
  return AGENT_LABEL[agent] ?? agent;
}

export const VISIBLE_AGENTS = new Set([
  "opencode",
  "codex",
  "claude",
  "openclaw",
  "hermes",
]);

export const RESUMABLE_AGENTS = new Set(["opencode", "codex", "claude", "openclaw", "hermes"]);


export function groupSessionsByAgent(
  sessions: ReadonlyArray<OpenworkSessionArchiveSession>,
): Array<{ agent: string; sessions: OpenworkSessionArchiveSession[] }> {
  const byAgent = new Map<string, OpenworkSessionArchiveSession[]>();
  for (const session of sessions) {
    const list = byAgent.get(session.agent) ?? [];
    list.push(session);
    byAgent.set(session.agent, list);
  }
  return Array.from(byAgent.entries())
    .map(([agent, items]) => ({ agent, sessions: items }))
    .sort((a, b) => b.sessions.length - a.sessions.length);
}

export function buildResumeRequest(
  session: OpenworkSessionArchiveSession | null,
): SessionArchiveResumeRequest | null {
  if (!session || !RESUMABLE_AGENTS.has(session.agent)) return null;
  const providerSessionId = session.id;
  if (!providerSessionId) return null;
  return {
    agent: session.agent,
    providerSessionId,
    project: session.project || null,
    sessionId: session.id,
    title: session.display_name || session.first_message || session.id,
  };
}

export function SessionArchivePage(props: Props) {
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<OpenworkSessionArchiveSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<OpenworkSessionArchiveMessagesResponse["messages"]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listTick, setListTick] = useState(0);
  const [collapsedAgents, setCollapsedAgents] = useState<Record<string, boolean>>({});
  const [agentCounts, setAgentCounts] = useState<Array<{ agent: string; count: number }>>([]);


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
    setCollapsedAgents((current) => ({ ...current, [agent]: !current[agent] }));
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("session_archive.search_placeholder")}
            className="pl-8"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={refreshList}
          disabled={loadingList}
          aria-label={t("session_archive.sync")}
        >
          <RefreshCw className={cn("size-4", loadingList && "animate-spin")} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={handleResume}
          disabled={!canResume}
          aria-label={t("session_archive.resume")}
          title={t("session_archive.resume")}
        >
          <PlayCircle className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={handleDelete}
          disabled={!selectedSession}
          aria-label={t("session_archive.delete")}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="flex w-72 min-w-56 flex-col overflow-hidden rounded-md border">
          <div className="border-b px-3 py-2 text-xs text-muted-foreground">
            {t("session_archive.agent_group_count", { count: totalKnown })}
          </div>
          <div className="flex-1 overflow-auto">
            {groups.length === 0 && !loadingList ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t("session_archive.empty")}
              </div>
            ) : null}
            {groups.map((group) => {
              const collapsed = collapsedAgents[group.agent] === true;
              return (
                <div key={group.agent} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggleAgent(group.agent)}
                    className="flex w-full items-center gap-2 bg-muted/40 px-3 py-1.5 text-left text-xs font-medium hover:bg-muted"
                  >
                    {collapsed ? (
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate">{agentLabel(group.agent)}</span>
                    <span className="text-muted-foreground">
                      {("totalCount" in group)
                        ? group.sessions.length === group.totalCount
                          ? group.totalCount
                          : `${group.sessions.length}/${group.totalCount}`
                        : group.sessions.length}
                    </span>
                  </button>
                  {collapsed ? null : (
                    <ul>
                      {group.sessions.map((session) => (
                        <li key={session.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedSessionId(session.id)}
                            className={cn(
                              "flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left text-xs hover:bg-muted",
                              session.id === selectedSessionId && "bg-muted",
                            )}
                          >
                            <div className="truncate text-sm font-medium">
                              {session.display_name || session.first_message || session.id}
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                              <span className="truncate">{session.project || agentLabel(session.agent)}</span>
                              <span>
                                {t("session_archive.message_count", { count: session.message_count })}
                              </span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
          {selectedSession ? (
            <>
              <header className="border-b px-3 py-2">
                <div className="truncate text-sm font-medium">
                  {selectedSession.display_name || selectedSession.first_message || selectedSession.id}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>{agentLabel(selectedSession.agent)}</span>
                  {selectedSession.project ? (
                    <span className="truncate">{selectedSession.project}</span>
                  ) : null}
                </div>
              </header>
              <div className="flex-1 overflow-auto p-3">
                {loadingMessages ? (
                  <div className="text-xs text-muted-foreground">
                    {t("session_archive.loading_messages")}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    {t("session_archive.no_messages")}
                  </div>
                ) : (
                  <ol className="flex flex-col gap-3">
                    {messages.map((message) => (
                      <li key={message.id} className="flex flex-col gap-1">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {message.role}
                        </div>
                        <div className="whitespace-pre-wrap break-words text-sm">
                          {message.content}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              {t("session_archive.select_session")}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
