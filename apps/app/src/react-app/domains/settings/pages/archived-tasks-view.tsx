/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import {
  Archive,
  Check,
  ChevronDown,
  Folder,
  ListFilter,
  MessageCircle,
  Search,
  Timer,
  Trash2,
  Undo2,
} from "lucide-react";

import type {
  OnMyAgentServerClient,
  OnMyAgentSessionArchiveSession,
} from "../../../../app/lib/onmyagent-server";
import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyStateBox, NoticeBox } from "@/components/ui/notice-box";
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

/** Local soft-archive vs server trash. */
type SourceFilter = "all" | "local" | "cloud";
type SortMode = "updated" | "created" | "name";
/** Project path or synthetic kind filter. */
type ScopeFilter =
  | "all"
  | `project:${string}`
  | "kind:tasks"
  | "kind:scheduled";

type UnifiedRow =
  | {
      kind: "assistant";
      id: string;
      title: string;
      projectKey: string;
      projectLabel: string;
      updatedAt: number;
      createdAt: number;
      automated: false;
      source: "local";
      task: AssistantArchivedTask;
    }
  | {
      kind: "session";
      id: string;
      title: string;
      projectKey: string;
      projectLabel: string;
      updatedAt: number;
      createdAt: number;
      automated: boolean;
      source: "cloud";
      session: OnMyAgentSessionArchiveSession;
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

function parseTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function sessionUpdatedAt(session: OnMyAgentSessionArchiveSession): number {
  const candidates = [
    session.deleted_at,
    session.local_modified_at,
    session.ended_at,
    session.started_at,
    session.created_at,
  ];
  for (const value of candidates) {
    const ms = parseTimeMs(value);
    if (ms != null) return ms;
  }
  if (typeof session.file_mtime === "number" && session.file_mtime > 0) {
    return session.file_mtime < 1e12 ? session.file_mtime * 1000 : session.file_mtime;
  }
  return 0;
}

function sessionCreatedAt(session: OnMyAgentSessionArchiveSession): number {
  return (
    parseTimeMs(session.started_at)
    ?? parseTimeMs(session.created_at)
    ?? sessionUpdatedAt(session)
  );
}

function formatTime(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "";
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

function MenuCheckItem(props: {
  selected: boolean;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onSelect: () => void;
}) {
  const Icon = props.icon;
  return (
    <DropdownMenuItem
      className="gap-2"
      onClick={(event) => {
        event.preventDefault();
        props.onSelect();
      }}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {props.selected ? <Check className="size-3.5" /> : null}
      </span>
      {Icon ? <Icon className="size-3.5 text-dls-secondary" /> : null}
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </DropdownMenuItem>
  );
}

const filterTriggerClass =
  "h-9 shrink-0 gap-1.5 rounded-full border-dls-border bg-dls-surface px-3 font-normal text-dls-text";

export function ArchivedTasksView(props: ArchivedTasksViewProps) {
  const [assistantTasks, setAssistantTasks] = useState<AssistantArchivedTask[]>(
    () => readAssistantArchivedTasks(props.workspaceId),
  );
  const [sessions, setSessions] = useState<OnMyAgentSessionArchiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
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

  const rows = useMemo((): UnifiedRow[] => {
    const q = query.trim().toLowerCase();
    const out: UnifiedRow[] = [];

    if (sourceFilter !== "cloud") {
      for (const task of assistantTasks) {
        const projectKey = task.directory?.trim() || "__unknown__";
        if (scopeFilter.startsWith("project:")) {
          const wanted = scopeFilter.slice("project:".length);
          if (projectKey !== wanted) continue;
        }
        if (scopeFilter === "kind:scheduled") continue;
        if (q) {
          const hay = [task.title, task.directory, task.sessionId]
            .filter(Boolean)
            .join("\n")
            .toLowerCase();
          if (!hay.includes(q)) continue;
        }
        out.push({
          kind: "assistant",
          id: task.sessionId,
          title: task.title,
          projectKey,
          projectLabel: shortProjectLabel(task.directory),
          updatedAt: task.archivedAt,
          createdAt: task.archivedAt,
          automated: false,
          source: "local",
          task,
        });
      }
    }

    if (sourceFilter !== "local") {
      for (const session of sessions) {
        const projectKey = session.project?.trim() || "__unknown__";
        const automated = session.is_automated === true;
        if (scopeFilter.startsWith("project:")) {
          const wanted = scopeFilter.slice("project:".length);
          if (projectKey !== wanted) continue;
        }
        if (scopeFilter === "kind:tasks" && automated) continue;
        if (scopeFilter === "kind:scheduled" && !automated) continue;
        if (q) {
          const hay = [
            sessionTitle(session),
            session.project,
            session.agent,
            session.id,
          ]
            .filter(Boolean)
            .join("\n")
            .toLowerCase();
          if (!hay.includes(q)) continue;
        }
        out.push({
          kind: "session",
          id: session.id,
          title: sessionTitle(session),
          projectKey,
          projectLabel: shortProjectLabel(session.project),
          updatedAt: sessionUpdatedAt(session),
          createdAt: sessionCreatedAt(session),
          automated,
          source: "cloud",
          session,
        });
      }
    }

    out.sort((left, right) => {
      if (sortMode === "name") {
        return left.title.localeCompare(right.title, undefined, {
          sensitivity: "base",
        });
      }
      if (sortMode === "created") {
        return right.createdAt - left.createdAt;
      }
      return right.updatedAt - left.updatedAt;
    });
    return out;
  }, [
    assistantTasks,
    sessions,
    query,
    sourceFilter,
    sortMode,
    scopeFilter,
  ]);

  const sourceLabel = useMemo(() => {
    if (sourceFilter === "local") return t("settings.archived_tasks_type_local");
    if (sourceFilter === "cloud") return t("settings.archived_tasks_type_cloud");
    return t("settings.archived_tasks_type_all");
  }, [sourceFilter]);

  const scopeLabel = useMemo(() => {
    if (scopeFilter === "kind:tasks") {
      return t("settings.archived_tasks_kind_tasks");
    }
    if (scopeFilter === "kind:scheduled") {
      return t("settings.archived_tasks_kind_scheduled");
    }
    if (scopeFilter.startsWith("project:")) {
      const key = scopeFilter.slice("project:".length);
      return projectOptions.find((option) => option.value === key)?.label
        ?? shortProjectLabel(key);
    }
    return t("settings.archived_tasks_all_projects");
  }, [scopeFilter, projectOptions]);

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
        await props.client.restoreSessionArchiveSession(
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
    !loading && rows.length === 0;
  const hasAny =
    assistantTasks.length > 0 || sessions.length > 0;

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

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={filterTriggerClass}
                aria-label={t("settings.archived_tasks_type_section")}
              >
                <ListFilter className="size-3.5 text-dls-secondary" />
                <span className="max-w-40 truncate">{sourceLabel}</span>
                <ChevronDown className="size-3.5 text-dls-secondary" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuLabel className="text-xs font-medium text-dls-secondary">
              {t("settings.archived_tasks_type_section")}
            </DropdownMenuLabel>
            <MenuCheckItem
              selected={sourceFilter === "all"}
              label={t("settings.archived_tasks_type_all")}
              onSelect={() => setSourceFilter("all")}
            />
            <MenuCheckItem
              selected={sourceFilter === "local"}
              label={t("settings.archived_tasks_type_local")}
              onSelect={() => setSourceFilter("local")}
            />
            <MenuCheckItem
              selected={sourceFilter === "cloud"}
              label={t("settings.archived_tasks_type_cloud")}
              onSelect={() => setSourceFilter("cloud")}
            />
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-medium text-dls-secondary">
              {t("settings.archived_tasks_sort_section")}
            </DropdownMenuLabel>
            <MenuCheckItem
              selected={sortMode === "updated"}
              label={t("settings.archived_tasks_sort_updated")}
              onSelect={() => setSortMode("updated")}
            />
            <MenuCheckItem
              selected={sortMode === "created"}
              label={t("settings.archived_tasks_sort_created")}
              onSelect={() => setSortMode("created")}
            />
            <MenuCheckItem
              selected={sortMode === "name"}
              label={t("settings.archived_tasks_sort_name")}
              onSelect={() => setSortMode("name")}
            />
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={filterTriggerClass}
                aria-label={t("settings.archived_tasks_all_projects")}
              >
                <Folder className="size-3.5 text-dls-secondary" />
                <span className="max-w-40 truncate">{scopeLabel}</span>
                <ChevronDown className="size-3.5 text-dls-secondary" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-56">
            <MenuCheckItem
              selected={scopeFilter === "all"}
              label={t("settings.archived_tasks_all_projects")}
              icon={Folder}
              onSelect={() => setScopeFilter("all")}
            />
            {projectOptions.map((option) => (
              <MenuCheckItem
                key={option.value}
                selected={scopeFilter === `project:${option.value}`}
                label={option.label}
                icon={Folder}
                onSelect={() => setScopeFilter(`project:${option.value}`)}
              />
            ))}
            <DropdownMenuSeparator />
            <MenuCheckItem
              selected={scopeFilter === "kind:tasks"}
              label={t("settings.archived_tasks_kind_tasks")}
              icon={MessageCircle}
              onSelect={() => setScopeFilter("kind:tasks")}
            />
            <MenuCheckItem
              selected={scopeFilter === "kind:scheduled"}
              label={t("settings.archived_tasks_kind_scheduled")}
              icon={Timer}
              onSelect={() => setScopeFilter("kind:scheduled")}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error ? <NoticeBox tone="error">{error}</NoticeBox> : null}

      {loading && !hasAny ? (
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
              {!hasAny
                ? t("settings.archived_tasks_empty")
                : t("settings.archived_tasks_empty_filtered")}
            </div>
            <div className="max-w-sm text-center text-xs text-dls-secondary">
              {t("settings.archived_tasks_empty_hint")}
            </div>
          </div>
        </EmptyStateBox>
      ) : null}

      {rows.length > 0 ? (
        <ul
          className="overflow-hidden rounded-xl border border-dls-border bg-dls-surface"
          data-archived-task-list="true"
        >
          {rows.map((row, index) => {
            const rowBusy = busyId === row.id;
            const meta = [row.projectLabel, formatTime(row.updatedAt)]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={`${row.kind}:${row.id}`}
                className={cn(
                  "flex items-center gap-3 px-3.5 py-3",
                  index > 0 && "border-t border-dls-border",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-dls-text">
                    {row.title}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-dls-secondary">
                    {meta}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      if (row.kind === "assistant") {
                        void handleDeleteAssistant(row.id);
                      } else {
                        void handleDeleteTrash(row.id);
                      }
                    }}
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
                    onClick={() => {
                      if (row.kind === "assistant") {
                        handleRestoreAssistant(row.id);
                      } else {
                        void handleRestoreTrash(row.id);
                      }
                    }}
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
      ) : null}
    </LayoutStack>
  );
}
