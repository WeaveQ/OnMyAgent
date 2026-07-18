/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Folder, Search, Trash2, Undo2 } from "lucide-react";

import type {
  OnMyAgentServerClient,
  OnMyAgentSessionArchiveSession,
} from "../../../../app/lib/onmyagent-server";
import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyStateBox, NoticeBox } from "@/components/ui/notice-box";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { LayoutStack } from "../settings-layout";
import {
  type AssistantArchivedTask,
  assistantArchivedTasksChangedEvent,
  permanentlyRemoveAssistantArchivedTask,
  readAssistantArchivedTasks,
  restoreAssistantArchivedTask,
} from "../../shared";

export type ArchivedTasksViewProps = {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
};

type ProjectGroup = {
  projectKey: string;
  projectLabel: string;
  sessions: OnMyAgentSessionArchiveSession[];
};

function shortProjectLabel(project: string | null | undefined): string {
  if (!project?.trim()) return t("settings.archived_tasks_unknown_project");
  const normalized = project.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || project;
}

function sessionTitle(session: OnMyAgentSessionArchiveSession): string {
  return (
    session.display_name?.trim() ||
    session.session_name?.trim() ||
    session.first_message?.trim() ||
    session.id
  );
}

function sessionTimestamp(session: OnMyAgentSessionArchiveSession): number | null {
  const candidates = [
    session.deleted_at,
    session.local_modified_at,
    session.ended_at,
    session.started_at,
  ];
  for (const value of candidates) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  if (typeof session.file_mtime === "number" && session.file_mtime > 0) {
    return session.file_mtime < 1e12 ? session.file_mtime * 1000 : session.file_mtime;
  }
  return null;
}

function formatTime(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function formatArchivedTime(session: OnMyAgentSessionArchiveSession): string {
  return formatTime(sessionTimestamp(session));
}

export function ArchivedTasksView(props: ArchivedTasksViewProps) {
  const [assistantTasks, setAssistantTasks] = useState<AssistantArchivedTask[]>(
    () => readAssistantArchivedTasks(props.workspaceId),
  );
  const [sessions, setSessions] = useState<OnMyAgentSessionArchiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refreshAssistant = useCallback(() => {
    setAssistantTasks(readAssistantArchivedTasks(props.workspaceId));
  }, [props.workspaceId]);

  const refreshTrash = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    refreshAssistant();
  }, [refreshAssistant]);

  useEffect(() => {
    const onChanged = () => refreshAssistant();
    window.addEventListener(assistantArchivedTasksChangedEvent, onChanged);
    return () => {
      window.removeEventListener(assistantArchivedTasksChangedEvent, onChanged);
    };
  }, [refreshAssistant]);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim()) {
      setSessions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    props.client
      .listSessionArchiveTrash(props.workspaceId)
      .then((response) => {
        if (cancelled) return;
        setSessions(response.sessions ?? []);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Soft-fail trash load so assistant archives still show.
        setSessions([]);
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.client, props.workspaceId, tick]);

  const filteredAssistant = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assistantTasks
      .filter((task) => {
        const key = task.directory?.trim() || "__unknown__";
        if (projectFilter !== "all" && key !== projectFilter) return false;
        if (!q) return true;
        return [task.title, task.directory, task.sessionId]
          .filter(Boolean)
          .join("\n")
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => b.archivedAt - a.archivedAt);
  }, [assistantTasks, query, projectFilter]);

  const projectOptions = useMemo(() => {
    const keys = new Map<string, string>();
    for (const task of assistantTasks) {
      const key = task.directory?.trim() || "__unknown__";
      if (!keys.has(key)) keys.set(key, shortProjectLabel(task.directory));
    }
    for (const session of sessions) {
      const key = session.project?.trim() || "__unknown__";
      if (!keys.has(key)) keys.set(key, shortProjectLabel(session.project));
    }
    return Array.from(keys.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [assistantTasks, sessions]);

  const projectSelectItems = useMemo(
    () => [
      { value: "all", label: t("settings.archived_tasks_all_projects") },
      ...projectOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    ],
    [projectOptions],
  );

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions
      .filter((session) => {
        const key = session.project?.trim() || "__unknown__";
        if (projectFilter !== "all" && key !== projectFilter) return false;
        if (!q) return true;
        const haystack = [
          sessionTitle(session),
          session.project,
          session.agent,
          session.id,
        ]
          .filter(Boolean)
          .join("\n")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => (sessionTimestamp(b) ?? 0) - (sessionTimestamp(a) ?? 0));
  }, [sessions, query, projectFilter]);

  const groups = useMemo(() => {
    const byProject = new Map<string, ProjectGroup>();
    for (const session of filteredSessions) {
      const projectKey = session.project?.trim() || "__unknown__";
      const existing = byProject.get(projectKey);
      if (existing) {
        existing.sessions.push(session);
      } else {
        byProject.set(projectKey, {
          projectKey,
          projectLabel: shortProjectLabel(session.project),
          sessions: [session],
        });
      }
    }
    return Array.from(byProject.values()).sort((a, b) =>
      a.projectLabel.localeCompare(b.projectLabel),
    );
  }, [filteredSessions]);

  const handleRestoreAssistant = useCallback(
    (sessionId: string) => {
      restoreAssistantArchivedTask(props.workspaceId, sessionId);
      refreshAssistant();
    },
    [props.workspaceId, refreshAssistant],
  );

  const handleDeleteAssistant = useCallback(
    async (sessionId: string) => {
      setBusyId(sessionId);
      setError(null);
      try {
        permanentlyRemoveAssistantArchivedTask(props.workspaceId, sessionId);
        if (props.client && props.workspaceId.trim()) {
          await props.client.deleteSession(props.workspaceId, sessionId);
        }
        refreshAssistant();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        refreshAssistant();
      } finally {
        setBusyId(null);
      }
    },
    [props.client, props.workspaceId, refreshAssistant],
  );

  const handleRestoreTrash = useCallback(
    async (sessionId: string) => {
      if (!props.client) return;
      setBusyId(sessionId);
      setError(null);
      try {
        await props.client.restoreSessionArchiveSession(props.workspaceId, sessionId);
        refreshTrash();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusyId(null);
      }
    },
    [props.client, props.workspaceId, refreshTrash],
  );

  const handleDeleteTrash = useCallback(
    async (sessionId: string) => {
      if (!props.client) return;
      setBusyId(sessionId);
      setError(null);
      try {
        await props.client.permanentlyDeleteSessionArchiveSession(
          props.workspaceId,
          sessionId,
        );
        refreshTrash();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusyId(null);
      }
    },
    [props.client, props.workspaceId, refreshTrash],
  );

  if (!props.workspaceId.trim()) {
    return (
      <EmptyStateBox size="spacious" tone="surface" className="text-sm">
        {t("settings.archived_tasks_no_workspace")}
      </EmptyStateBox>
    );
  }

  const empty =
    !loading &&
    filteredAssistant.length === 0 &&
    filteredSessions.length === 0;

  return (
    <LayoutStack className="gap-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup
          controlSize="sm"
          radius="md"
          tone="surface"
          className="min-w-0 flex-1"
        >
          <InputGroupAddon align="inline-start">
            <Search className="size-3.5" aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.archived_tasks_search_placeholder")}
            aria-label={t("settings.archived_tasks_search_placeholder")}
          />
        </InputGroup>
        <Select
          value={projectFilter}
          items={projectSelectItems}
          onValueChange={(value) => {
            if (typeof value === "string" && value.trim()) {
              setProjectFilter(value);
            }
          }}
        >
          <SelectTrigger size="sm" className="w-44 shrink-0">
            <Folder className="size-3.5 text-dls-secondary" />
            <SelectValue
              placeholder={t("settings.archived_tasks_all_projects")}
            />
          </SelectTrigger>
          <SelectContent>
            {projectSelectItems.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? <NoticeBox tone="error">{error}</NoticeBox> : null}

      {loading && sessions.length === 0 && assistantTasks.length === 0 ? (
        <div className="flex items-center gap-2 py-10 text-sm text-dls-secondary">
          <LoadingSpinner size="sm" />
          {t("settings.archived_tasks_loading")}
        </div>
      ) : null}

      {empty ? (
        <EmptyStateBox size="spacious" tone="surface" className="text-sm">
          <div className="flex flex-col items-center gap-2 py-4">
            <Archive className="size-8 opacity-40" />
            <div className="font-medium text-dls-text">
              {assistantTasks.length === 0 && sessions.length === 0
                ? t("settings.archived_tasks_empty")
                : t("settings.archived_tasks_empty_filtered")}
            </div>
            <div className="max-w-sm text-center text-xs text-dls-secondary">
              {t("settings.archived_tasks_empty_hint")}
            </div>
          </div>
        </EmptyStateBox>
      ) : null}

      {filteredAssistant.length > 0 ? (
        <section className="flex flex-col gap-2" data-assistant-archived-list="true">
          <div className="flex items-center justify-between gap-3 px-0.5">
            <span className="text-sm font-medium text-dls-text">
              {t("settings.archived_tasks_assistant_section")}
            </span>
            <span className="text-xs tabular-nums text-dls-secondary">
              {t("settings.archived_tasks_count", {
                count: filteredAssistant.length,
              })}
            </span>
          </div>
          <ul className="overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
            {filteredAssistant.map((task, index) => {
              const rowBusy = busyId === task.sessionId;
              return (
                <li
                  key={task.sessionId}
                  className={cn(
                    "flex items-center gap-3 px-3.5 py-3",
                    index > 0 && "border-t border-dls-border",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-dls-text">
                      {task.title}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-dls-secondary">
                      {[
                        shortProjectLabel(task.directory),
                        formatTime(task.archivedAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void handleDeleteAssistant(task.sessionId)}
                      disabled={rowBusy}
                      title={t("settings.archived_tasks_delete")}
                      aria-label={t("settings.archived_tasks_delete")}
                      className="text-dls-secondary hover:bg-dls-danger-soft hover:text-dls-danger"
                    >
                      {rowBusy ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleRestoreAssistant(task.sessionId)}
                      disabled={rowBusy}
                    >
                      <Undo2 className="size-3.5" />
                      {t("settings.archived_tasks_unarchive")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.projectKey} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 px-0.5">
              <div className="flex min-w-0 items-center gap-2 text-sm text-dls-text">
                <Folder className="size-3.5 shrink-0 text-dls-secondary" />
                <span className="truncate font-medium">{group.projectLabel}</span>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-dls-secondary">
                {t("settings.archived_tasks_count", {
                  count: group.sessions.length,
                })}
              </span>
            </div>
            <ul className="overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
              {group.sessions.map((session, index) => {
                const rowBusy = busyId === session.id;
                return (
                  <li
                    key={session.id}
                    className={cn(
                      "flex items-center gap-3 px-3.5 py-3",
                      index > 0 && "border-t border-dls-border",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-dls-text">
                        {sessionTitle(session)}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-dls-secondary">
                        {formatArchivedTime(session)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void handleDeleteTrash(session.id)}
                        disabled={rowBusy}
                        title={t("settings.archived_tasks_delete")}
                        aria-label={t("settings.archived_tasks_delete")}
                        className="text-dls-secondary hover:bg-dls-danger-soft hover:text-dls-danger"
                      >
                        {rowBusy ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleRestoreTrash(session.id)}
                        disabled={rowBusy}
                      >
                        <Undo2 className="size-3.5" />
                        {t("settings.archived_tasks_unarchive")}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </LayoutStack>
  );
}
