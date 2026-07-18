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
  ChevronDown,
  Folder,
  ListFilter,
  MessageCircle,
  MoreHorizontal,
  Search,
  Timer,
  Trash2,
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import { LayoutStack } from "../settings-layout";
import {
  type AssistantArchivedTask,
  assistantArchivedTasksChangedEvent,
  permanentlyRemoveAssistantArchivedTask,
  readAssistantArchivedTasks,
  restoreAssistantArchivedTask,
} from "../../shared";
import {
  formatTaskArchiveMeta,
  groupArchivedRowsByProject,
  normalizeProjectKey,
  sortArchivedRows,
  type ArchivedKindFilter,
  type ArchivedProjectFilter,
  type ArchivedSortMode,
  type ArchivedSourceFilter,
} from "./archived-tasks-filters";

export type ArchivedTasksViewProps = {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
};

type SourceFilter = ArchivedSourceFilter;
type SortMode = ArchivedSortMode;

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

function projectKeyFromRow(
  project: string | null | undefined,
): string {
  return normalizeProjectKey(project);
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

/**
 * Radio row with optional leading icon; check sits on the trailing edge
 * (matches WorkBuddy / DESIGN DropdownMenuRadioItem layout).
 */
function FilterRadioItem(props: {
  value: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}) {
  const Icon = props.icon;
  return (
    <DropdownMenuRadioItem value={props.value} className="gap-2">
      {Icon ? (
        <Icon className="size-3.5 shrink-0 text-dls-secondary" aria-hidden />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </DropdownMenuRadioItem>
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
  /** Independent axes so project + kind compose (WorkBuddy-style menu, multi-dim filter). */
  const [projectFilter, setProjectFilter] =
    useState<ArchivedProjectFilter>("all");
  const [kindFilter, setKindFilter] = useState<ArchivedKindFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  /** Project key pending bulk permanent delete confirmation. */
  const [pendingDeleteGroupKey, setPendingDeleteGroupKey] = useState<
    string | null
  >(null);

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
    // Only real bound paths appear in the project menu. Soft-archives without a
    // space folder (and cloud trash rows with empty project) used to surface as
    // a synthetic “未知项目” option — confusing and not a real project.
    const keys = new Map<string, string>();
    for (const task of assistantTasks) {
      const raw = task.directory?.trim();
      if (!raw) continue;
      const key = projectKeyFromRow(raw);
      if (key === "__unknown__") continue;
      if (!keys.has(key)) keys.set(key, shortProjectLabel(raw));
    }
    for (const session of sessions) {
      const raw = session.project?.trim();
      if (!raw) continue;
      const key = projectKeyFromRow(raw);
      if (key === "__unknown__") continue;
      if (!keys.has(key)) keys.set(key, shortProjectLabel(raw));
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
        const projectKey = projectKeyFromRow(task.directory);
        // Local soft-archives are never "scheduled" automations.
        if (kindFilter === "scheduled") continue;
        if (projectFilter !== "all" && projectKey !== projectFilter) continue;
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
        const projectKey = projectKeyFromRow(session.project);
        const automated = session.is_automated === true;
        if (projectFilter !== "all" && projectKey !== projectFilter) continue;
        if (kindFilter === "tasks" && automated) continue;
        if (kindFilter === "scheduled" && !automated) continue;
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

    return sortArchivedRows(out, sortMode);
  }, [
    assistantTasks,
    sessions,
    query,
    sourceFilter,
    sortMode,
    projectFilter,
    kindFilter,
  ]);

  const sourceLabel = useMemo(() => {
    if (sourceFilter === "local") return t("settings.archived_tasks_type_local");
    if (sourceFilter === "cloud") return t("settings.archived_tasks_type_cloud");
    return t("settings.archived_tasks_type_all");
  }, [sourceFilter]);

  /** Chip label: kind wins when set, else project, else all projects. */
  const scopeLabel = useMemo(() => {
    if (kindFilter === "tasks") {
      return t("settings.archived_tasks_kind_tasks");
    }
    if (kindFilter === "scheduled") {
      return t("settings.archived_tasks_kind_scheduled");
    }
    if (projectFilter !== "all") {
      return (
        projectOptions.find((option) => option.value === projectFilter)?.label
        ?? shortProjectLabel(
          projectFilter === "__unknown__" ? null : projectFilter,
        )
      );
    }
    return t("settings.archived_tasks_all_projects");
  }, [kindFilter, projectFilter, projectOptions]);

  const scopeIcon = useMemo(() => {
    if (kindFilter === "tasks") return MessageCircle;
    if (kindFilter === "scheduled") return Timer;
    return Folder;
  }, [kindFilter]);

  /**
   * Project layout (Image #2): group under folder headers.
   * Task / scheduled layout (Image #3): flat list with date · project slug.
   */
  const useProjectGroups = kindFilter === "all";

  const projectGroups = useMemo(() => {
    if (!useProjectGroups) return [];
    return groupArchivedRowsByProject(rows, {
      unscopedLabel: t("settings.archived_tasks_unknown_project"),
    });
  }, [rows, useProjectGroups]);

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
      if (!props.client) {
        setError(t("settings.archived_tasks_no_workspace"));
        return;
      }
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

  const pendingDeleteGroup = useMemo(() => {
    if (!pendingDeleteGroupKey) return null;
    return (
      projectGroups.find((group) => group.key === pendingDeleteGroupKey)
      ?? null
    );
  }, [pendingDeleteGroupKey, projectGroups]);

  const handleDeleteGroup = useCallback(async () => {
    if (!pendingDeleteGroup) return;
    const items = pendingDeleteGroup.items;
    setPendingDeleteGroupKey(null);
    setError(null);
    setBusyId(`group:${pendingDeleteGroup.key}`);
    try {
      for (const row of items) {
        if (row.kind === "assistant") {
          permanentlyRemoveAssistantArchivedTask(props.workspaceId, row.id);
          if (props.client && props.workspaceId.trim()) {
            try {
              await props.client.deleteSession(props.workspaceId, row.id);
            } catch {
              // Soft-archive entry is already gone; session delete is best-effort.
            }
          }
        } else if (props.client) {
          await props.client.permanentlyDeleteSessionArchiveSession(
            props.workspaceId,
            row.id,
          );
        }
      }
      refreshAssistant();
      refreshTrash();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      refreshAssistant();
      refreshTrash();
    } finally {
      setBusyId(null);
    }
  }, [
    pendingDeleteGroup,
    props.client,
    props.workspaceId,
    refreshAssistant,
    refreshTrash,
  ]);

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

        {/* Type + sort (WorkBuddy: one chip, two radio groups, check on the right). */}
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
                <ListFilter className="size-3.5 text-dls-secondary" aria-hidden />
                <span className="max-w-40 truncate">{sourceLabel}</span>
                <ChevronDown className="size-3.5 text-dls-secondary" aria-hidden />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-52">
            {/*
              Base UI GroupLabel throws without a parent Group
              ("MenuGroupRootContext is missing") — that remounts the tab.
            */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-medium text-dls-secondary">
                {t("settings.archived_tasks_type_section")}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sourceFilter === "cloud" ? "all" : sourceFilter}
                onValueChange={(value) => {
                  // Cloud type is temporarily hidden from the menu; only all / local.
                  if (value === "all" || value === "local") {
                    setSourceFilter(value);
                  }
                }}
              >
                <FilterRadioItem
                  value="all"
                  label={t("settings.archived_tasks_type_all")}
                />
                <FilterRadioItem
                  value="local"
                  label={t("settings.archived_tasks_type_local")}
                />
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-medium text-dls-secondary">
                {t("settings.archived_tasks_sort_section")}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sortMode}
                onValueChange={(value) => {
                  if (
                    value === "updated" ||
                    value === "created" ||
                    value === "name"
                  ) {
                    setSortMode(value);
                  }
                }}
              >
                <FilterRadioItem
                  value="updated"
                  label={t("settings.archived_tasks_sort_updated")}
                />
                <FilterRadioItem
                  value="created"
                  label={t("settings.archived_tasks_sort_created")}
                />
                <FilterRadioItem
                  value="name"
                  label={t("settings.archived_tasks_sort_name")}
                />
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Project + kind (scope chip). */}
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
                {(() => {
                  const ScopeIcon = scopeIcon;
                  return (
                    <ScopeIcon
                      className="size-3.5 text-dls-secondary"
                      aria-hidden
                    />
                  );
                })()}
                <span className="max-w-40 truncate">{scopeLabel}</span>
                <ChevronDown
                  className="size-3.5 text-dls-secondary"
                  aria-hidden
                />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-56">
            {/*
              Project OR kind axes. Separator sits outside RadioGroups.
              When kind is inactive, kind RadioGroup stays controlled with a
              non-matching value so no row is checked.
            */}
            <DropdownMenuGroup>
              <DropdownMenuRadioGroup
                value={
                  kindFilter !== "all"
                    ? `kind:${kindFilter}`
                    : projectFilter === "all"
                      ? "all"
                      : `project:${projectFilter}`
                }
                onValueChange={(value) => {
                  if (value === "all") {
                    setProjectFilter("all");
                    setKindFilter("all");
                    return;
                  }
                  if (value.startsWith("project:")) {
                    const key = value.slice("project:".length) || "__unknown__";
                    setProjectFilter(key);
                    setKindFilter("all");
                  }
                }}
              >
                <FilterRadioItem
                  value="all"
                  label={t("settings.archived_tasks_all_projects")}
                  icon={Folder}
                />
                {projectOptions.map((option) => (
                  <FilterRadioItem
                    key={option.value}
                    value={`project:${option.value}`}
                    label={option.label}
                    icon={Folder}
                  />
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuRadioGroup
                value={
                  kindFilter !== "all" ? `kind:${kindFilter}` : "kind:none"
                }
                onValueChange={(value) => {
                  if (value === "kind:tasks") {
                    setKindFilter("tasks");
                    return;
                  }
                  if (value === "kind:scheduled") {
                    setKindFilter("scheduled");
                  }
                }}
              >
                <FilterRadioItem
                  value="kind:tasks"
                  label={t("settings.archived_tasks_kind_tasks")}
                  icon={MessageCircle}
                />
                <FilterRadioItem
                  value="kind:scheduled"
                  label={t("settings.archived_tasks_kind_scheduled")}
                  icon={Timer}
                />
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
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
        useProjectGroups ? (
          // WorkBuddy project archive: header outside card, rows in rounded card.
          <div className="flex flex-col gap-5" data-archived-task-list="true">
            {projectGroups.map((group) => {
              const groupBusy = busyId === `group:${group.key}`;
              return (
                <section key={group.key} className="min-w-0">
                  <header className="mb-2 flex min-h-8 items-center gap-2">
                    <Folder
                      className="size-3.5 shrink-0 text-dls-secondary"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium leading-none text-dls-text">
                      {group.label}
                    </span>
                    <span className="shrink-0 text-xs leading-none text-dls-secondary">
                      {t("settings.archived_tasks_count", {
                        count: group.items.length,
                      })}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="size-7 rounded-full text-dls-secondary hover:bg-dls-surface-muted hover:text-dls-text"
                            aria-label={t(
                              "settings.archived_tasks_project_menu",
                            )}
                            disabled={groupBusy}
                          >
                            <MoreHorizontal className="size-3.5" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent
                        align="end"
                        // Override default w-(--anchor-width) so the long
                        // destructive label stays on one line (ref Image #2).
                        className="w-auto min-w-max"
                      >
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={groupBusy || group.items.length === 0}
                          onClick={() => setPendingDeleteGroupKey(group.key)}
                          className="whitespace-nowrap text-dls-danger focus:text-dls-danger"
                        >
                          <Trash2 className="size-3.5 shrink-0 text-dls-danger" />
                          <span className="text-dls-danger">
                            {t("settings.archived_tasks_delete_project_all")}
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </header>
                  <ul className="overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
                    {group.items.map((row, index) => (
                      <ArchivedTaskRow
                        key={`${row.kind}:${row.id}`}
                        row={row}
                        bordered={index > 0}
                        busy={groupBusy || busyId === row.id}
                        /** Project view: date only (folder is the group header). */
                        meta={formatTime(row.updatedAt)}
                        onDelete={() => {
                          if (row.kind === "assistant") {
                            void handleDeleteAssistant(row.id);
                          } else {
                            void handleDeleteTrash(row.id);
                          }
                        }}
                        onRestore={() => {
                          if (row.kind === "assistant") {
                            handleRestoreAssistant(row.id);
                          } else {
                            void handleRestoreTrash(row.id);
                          }
                        }}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <ul
            className="overflow-hidden rounded-xl border border-dls-border bg-dls-surface"
            data-archived-task-list="true"
          >
            {rows.map((row, index) => (
              <ArchivedTaskRow
                key={`${row.kind}:${row.id}`}
                row={row}
                bordered={index > 0}
                busy={busyId === row.id}
                /** Task view: date · project slug (WorkBuddy task archive). */
                meta={formatTaskArchiveMeta({
                  timeLabel: formatTime(row.updatedAt),
                  projectKey: row.projectKey,
                  projectLabel: row.projectLabel,
                })}
                onDelete={() => {
                  if (row.kind === "assistant") {
                    void handleDeleteAssistant(row.id);
                  } else {
                    void handleDeleteTrash(row.id);
                  }
                }}
                onRestore={() => {
                  if (row.kind === "assistant") {
                    handleRestoreAssistant(row.id);
                  } else {
                    void handleRestoreTrash(row.id);
                  }
                }}
              />
            ))}
          </ul>
        )
      ) : null}

      <ConfirmModal
        open={pendingDeleteGroup != null}
        variant="danger"
        title={t("settings.archived_tasks_delete_project_all")}
        message={
          pendingDeleteGroup
            ? t("settings.archived_tasks_delete_project_all_confirm", {
                project: pendingDeleteGroup.label,
                count: pendingDeleteGroup.items.length,
              })
            : ""
        }
        confirmLabel={t("settings.archived_tasks_delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          void handleDeleteGroup();
        }}
        onCancel={() => setPendingDeleteGroupKey(null)}
      />
    </LayoutStack>
  );
}

/** Inset for task rows inside the rounded card (matches WorkBuddy archive). */
const ARCHIVE_ROW_INSET = "px-3.5";

function ArchivedTaskRow(props: {
  row: UnifiedRow;
  bordered: boolean;
  busy: boolean;
  meta: string;
  onDelete: () => void;
  onRestore: () => void;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-2 py-3",
        ARCHIVE_ROW_INSET,
        props.bordered && "border-t border-dls-border",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-5 text-dls-text">
          {props.row.title}
        </div>
        {props.meta ? (
          <div className="mt-0.5 truncate text-xs leading-4 text-dls-secondary">
            {props.meta}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={props.onDelete}
          disabled={props.busy}
          title={t("settings.archived_tasks_delete")}
          aria-label={t("settings.archived_tasks_delete")}
          className="size-7 text-dls-secondary hover:bg-dls-danger-soft hover:text-dls-danger"
        >
          {props.busy ? (
            <LoadingSpinner size="sm" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={props.onRestore}
          disabled={props.busy}
          className="h-7 rounded-full border-dls-border bg-dls-surface-muted/40 px-3 text-xs font-medium text-dls-text hover:bg-dls-surface-muted"
        >
          {t("settings.archived_tasks_unarchive")}
        </Button>
      </div>
    </li>
  );
}
