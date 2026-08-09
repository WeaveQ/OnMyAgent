/** @jsxImportSource react */
/**
 * Option-B left column for the primary-rail Automation workspace.
 * Browse filters + create, plus scheduled-run groups with home-parity actions
 * (pin / archive / delete).
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  Archive,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  LayoutTemplate,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "../../../i18n";

import {
  positionTaskContextMenu,
  SIDEBAR_FOOTER_CTA_CLASS,
  TASK_CONTEXT_MENU_CLASS,
  TASK_CONTEXT_MENU_ITEM_CLASS,
  TASK_CONTEXT_MENU_SEPARATOR_CLASS,
  TASK_CONTEXT_MENU_WIDTH,
  TASK_ROW_ACTION_CLASS,
} from "@/components/ui/sidebar-chrome";

/** Match home task-row trailing time (today clock / N days ago). */
function relativeTimeLabel(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const ms = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDelta = Math.round(
    (today.getTime() - targetDay.getTime()) / 86_400_000,
  );
  if (dayDelta === 0) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  if (dayDelta > 0) return t("time.days_ago", { count: dayDelta });
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function IconHoverTip(props: {
  label: string;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipContent side="left" sideOffset={6}>
        {props.label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Left filters only — run history lives under All tasks / session groups (no duplicate nav). */
export type AutomationNavKey = "tasks" | "templates";

export type AutomationNavSessionRow = {
  id: string;
  title: string;
  updatedAt: number | null;
  directory?: string | null;
  /** Local pin inside the automation group (home parity). */
  pinned?: boolean;
};

export type AutomationNavGroupRow = {
  id: string;
  title: string;
  sessions: AutomationNavSessionRow[];
  pinned?: boolean;
};

export function AutomationNavSidebar(props: {
  width: number;
  active: AutomationNavKey;
  onChange: (key: AutomationNavKey) => void;
  onCreate: () => void;
  taskCount?: number;
  groups?: AutomationNavGroupRow[];
  selectedSessionId?: string | null;
  workspaceId?: string;
  onOpenSession?: (workspaceId: string, sessionId: string) => void;
  onToggleGroupPinned?: (groupId: string) => void;
  onArchiveGroup?: (groupId: string) => void;
  onDeleteGroup?: (target: {
    groupId: string;
    title: string;
    sessionIds: string[];
  }) => void;
  /** Session-level actions (same as former home schedule child rows). */
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onArchiveSession?: (sessionId: string, title: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onToggleSessionPinned?: (groupId: string, sessionId: string) => void;
}) {
  const groups = props.groups ?? [];
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return groups;
    return groups
      .map((group) => {
        const groupTitleHit = group.title.toLowerCase().includes(normalizedQuery);
        const sessions = group.sessions.filter((session) =>
          session.title.toLowerCase().includes(normalizedQuery),
        );
        // Keep whole group when title matches; otherwise only matching sessions.
        if (groupTitleHit) return group;
        if (sessions.length === 0) return null;
        return { ...group, sessions };
      })
      .filter((group): group is AutomationNavGroupRow => group != null);
  }, [groups, normalizedQuery]);

  useEffect(() => {
    if (groups.length === 0) return;
    setExpandedIds((current) => {
      if (current.length > 0) {
        const next = current.filter((id) =>
          groups.some((group) => group.id === id),
        );
        return next.length > 0
          ? next
          : groups.slice(0, 3).map((group) => group.id);
      }
      return groups.slice(0, 3).map((group) => group.id);
    });
  }, [groups]);

  // While searching, auto-expand groups that still have visible sessions.
  useEffect(() => {
    if (!normalizedQuery) return;
    setExpandedIds(filteredGroups.map((group) => group.id));
  }, [filteredGroups, normalizedQuery]);

  const items = useMemo(
    () =>
      [
        {
          key: "tasks" as const,
          label: t("automation.nav_all_tasks"),
          icon: CalendarClock,
          count: props.taskCount,
        },
        {
          key: "templates" as const,
          label: t("automation.nav_templates"),
          icon: LayoutTemplate,
        },
      ] satisfies Array<{
        key: AutomationNavKey;
        label: string;
        icon: typeof CalendarClock;
        count?: number;
      }>,
    [props.taskCount],
  );

  const visibleNavItems = useMemo(() => {
    if (!normalizedQuery) return items;
    return items.filter((item) =>
      item.label.toLowerCase().includes(normalizedQuery),
    );
  }, [items, normalizedQuery]);

  const toggleExpanded = (groupId: string) => {
    setExpandedIds((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
  };

  return (
    <TooltipProvider>
      <aside
        className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-dls-border bg-dls-sidebar px-2.5 pb-5 text-dls-text mac:bg-dls-sidebar mac:titlebar-no-drag"
        style={{ width: props.width }}
      >
        <div
          className="relative flex w-full shrink-0 flex-col pt-2"
          data-automation-search="true"
        >
          <InputGroup
            controlSize="lg"
            radius="lg"
            tone="surface"
            className="w-full"
          >
            <InputGroupAddon align="inline-start" inset="tight">
              <Search className="size-4" />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("session.search_tasks_placeholder")}
              aria-label={t("session.search_tasks_placeholder")}
              className="text-sm placeholder:text-dls-secondary/75"
            />
          </InputGroup>
        </div>

        {/*
          Stack under search: +2px vs expert list-lane (pt-1.5 → pt-2) so
          全部任务 has a bit more air under the search field.
        */}
        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 pt-2">
          {visibleNavItems.length > 0 ? (
            <nav className="flex flex-col gap-1" aria-label={t("nav.automation")}>
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = props.active === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => props.onChange(item.key)}
                    aria-pressed={active}
                    className={cn(
                      // Expert row uses px-2.5; keep single-line nav at list rhythm (h-10).
                      "flex h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-sm transition-colors",
                      active
                        ? "bg-dls-list-selected font-medium text-dls-text"
                        : "text-dls-text hover:bg-dls-hover",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {typeof item.count === "number" ? (
                      <span
                        className={cn(
                          "tabular-nums text-xs font-medium",
                          active ? "opacity-70" : "text-dls-text",
                        )}
                      >
                        {item.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          ) : null}

          {filteredGroups.length > 0 ? (
            <div className={cn(visibleNavItems.length > 0 ? "mt-4" : "mt-0")}>
              {/* Match home "最近" section label: text-sm medium, not 2xs caps. */}
              <div className="flex h-[34px] min-h-[34px] max-h-[34px] items-center px-2 text-sm font-medium leading-none tracking-wide text-dls-secondary">
                {t("automation.tab_tasks")}
              </div>
              <div className="flex flex-col gap-0.5">
                {filteredGroups.map((group) => {
                  const expanded =
                    Boolean(normalizedQuery) || expandedIds.includes(group.id);
                  const groupLabel = t("automation.session_group_title", {
                    title: group.title,
                  });
                  return (
                    <div
                      key={group.id}
                      className="flex min-w-0 flex-col gap-0.5"
                    >
                      <AutomationNavGroupHeader
                        title={groupLabel}
                        groupId={group.id}
                        expanded={expanded}
                        pinned={Boolean(group.pinned)}
                        sessionIds={group.sessions.map((session) => session.id)}
                        onToggle={() => toggleExpanded(group.id)}
                        onTogglePinned={props.onToggleGroupPinned}
                        onArchive={props.onArchiveGroup}
                        onDelete={
                          props.onDeleteGroup
                            ? () =>
                                props.onDeleteGroup?.({
                                  groupId: group.id,
                                  title: group.title,
                                  sessionIds: group.sessions.map(
                                    (session) => session.id,
                                  ),
                                })
                            : undefined
                        }
                      />
                      {expanded
                        ? group.sessions.map((session) => (
                            <AutomationNavSessionRowView
                              key={session.id}
                              session={session}
                              groupId={group.id}
                              selected={
                                props.selectedSessionId === session.id
                              }
                              workspaceId={props.workspaceId}
                              onOpenSession={props.onOpenSession}
                              onRenameSession={props.onRenameSession}
                              onArchiveSession={props.onArchiveSession}
                              onDeleteSession={props.onDeleteSession}
                              onToggleSessionPinned={
                                props.onToggleSessionPinned
                              }
                            />
                          ))
                        : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sidebar-cta"
            className={SIDEBAR_FOOTER_CTA_CLASS}
            onClick={props.onCreate}
            data-automation-create="true"
          >
            <Plus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
            {t("automation.add")}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}

function AutomationNavSessionRowView(props: {
  session: AutomationNavSessionRow;
  groupId: string;
  selected: boolean;
  workspaceId?: string;
  onOpenSession?: (workspaceId: string, sessionId: string) => void;
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onArchiveSession?: (sessionId: string, title: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onToggleSessionPinned?: (groupId: string, sessionId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const hasActions =
    Boolean(props.onRenameSession) ||
    Boolean(props.onArchiveSession) ||
    Boolean(props.onDeleteSession) ||
    Boolean(props.onToggleSessionPinned);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menuOpen]);

  useLayoutEffect(() => {
    if (!menuOpen || !anchorRef.current || !menuRef.current) return;
    const menu = menuRef.current;
    setMenuPosition(
      positionTaskContextMenu(anchorRef.current.getBoundingClientRect(), {
        width: menu.offsetWidth || TASK_CONTEXT_MENU_WIDTH,
        estimatedHeight: menu.offsetHeight || 180,
      }),
    );
  }, [menuOpen]);

  const openSession = () => {
    if (!props.workspaceId || !props.onOpenSession) return;
    props.onOpenSession(props.workspaceId, props.session.id);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={openSession}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openSession();
          }
        }}
        className={cn(
          // Match home task rows (LIST_ROW_H 34px) — avoid short py-1 rows
          // that look undersized under the group header.
          "group flex h-[34px] min-h-[34px] max-h-[34px] w-full shrink-0 cursor-pointer items-center gap-1 overflow-hidden rounded-lg py-0 pl-7 pr-1.5 text-left text-sm leading-none transition-colors",
          props.selected
            ? "bg-dls-list-selected font-medium text-dls-text"
            : "text-dls-text hover:bg-dls-hover",
          menuOpen && "bg-dls-list-hover text-dls-text",
        )}
      >
        <span className="min-w-0 flex-1 truncate leading-none">
          {props.session.title}
        </span>
        <span
          className={cn(
            "shrink-0 tabular-nums text-2xs leading-none text-dls-secondary group-hover:hidden",
            menuOpen && "hidden",
          )}
        >
          {relativeTimeLabel(props.session.updatedAt)}
        </span>
        {hasActions ? (
          <div
            className={cn(
              "hidden h-full shrink-0 items-center gap-0 group-hover:flex",
              menuOpen && "flex",
            )}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <IconHoverTip label={t("session.task_actions")}>
              <button
                ref={anchorRef}
                type="button"
                className={TASK_ROW_ACTION_CLASS}
                aria-label={t("session.task_actions")}
                onClick={(event) => {
                  event.stopPropagation();
                  if (anchorRef.current) {
                    setMenuPosition(
                      positionTaskContextMenu(
                        anchorRef.current.getBoundingClientRect(),
                        { estimatedHeight: 180 },
                      ),
                    );
                  }
                  setMenuOpen((value) => !value);
                }}
              >
                <MoreHorizontal strokeWidth={1.75} />
              </button>
            </IconHoverTip>
            {props.onToggleSessionPinned ? (
              <IconHoverTip
                label={
                  props.session.pinned ? t("session.unpin") : t("session.pin")
                }
              >
                <button
                  type="button"
                  className={cn(
                    TASK_ROW_ACTION_CLASS,
                    props.session.pinned
                      ? "text-dls-accent hover:text-dls-accent"
                      : "text-dls-secondary",
                  )}
                  aria-label={
                    props.session.pinned
                      ? t("session.unpin")
                      : t("session.pin")
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    props.onToggleSessionPinned?.(
                      props.groupId,
                      props.session.id,
                    );
                  }}
                >
                  {props.session.pinned ? (
                    <PinOff strokeWidth={1.75} />
                  ) : (
                    <Pin strokeWidth={1.75} />
                  )}
                </button>
              </IconHoverTip>
            ) : null}
            {props.onArchiveSession ? (
              <IconHoverTip label={t("session.archive_task")}>
                <button
                  type="button"
                  className={TASK_ROW_ACTION_CLASS}
                  aria-label={t("session.archive_task")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    props.onArchiveSession?.(
                      props.session.id,
                      props.session.title,
                    );
                  }}
                >
                  <Archive strokeWidth={1.75} />
                </button>
              </IconHoverTip>
            ) : null}
          </div>
        ) : null}
      </div>
      {menuOpen && menuPosition ? (
        <div
          ref={menuRef}
          className={TASK_CONTEXT_MENU_CLASS}
          data-task-context-menu="true"
          style={{ left: menuPosition.left, top: menuPosition.top }}
          onClick={(event) => event.stopPropagation()}
        >
          {props.onRenameSession ? (
            <button
              type="button"
              className={TASK_CONTEXT_MENU_ITEM_CLASS}
              onClick={() => {
                setMenuOpen(false);
                props.onRenameSession?.(
                  props.session.id,
                  props.session.title,
                );
              }}
            >
              <Pencil strokeWidth={1.75} />
              {t("session.rename_action")}
            </button>
          ) : null}
          {props.onToggleSessionPinned ? (
            <button
              type="button"
              className={TASK_CONTEXT_MENU_ITEM_CLASS}
              onClick={() => {
                setMenuOpen(false);
                props.onToggleSessionPinned?.(
                  props.groupId,
                  props.session.id,
                );
              }}
            >
              {props.session.pinned ? (
                <PinOff strokeWidth={1.75} />
              ) : (
                <Pin strokeWidth={1.75} />
              )}
              {props.session.pinned ? t("session.unpin") : t("session.pin")}
            </button>
          ) : null}
          {props.onArchiveSession ? (
            <button
              type="button"
              className={TASK_CONTEXT_MENU_ITEM_CLASS}
              onClick={() => {
                setMenuOpen(false);
                props.onArchiveSession?.(
                  props.session.id,
                  props.session.title,
                );
              }}
            >
              <Archive strokeWidth={1.75} />
              {t("session.archive_task")}
            </button>
          ) : null}
          {props.onDeleteSession ? (
            <>
              <div
                className={TASK_CONTEXT_MENU_SEPARATOR_CLASS}
                role="separator"
              />
              <button
                type="button"
                className={TASK_CONTEXT_MENU_ITEM_CLASS}
                onClick={() => {
                  setMenuOpen(false);
                  props.onDeleteSession?.(props.session.id);
                }}
              >
                <Trash2 strokeWidth={1.75} />
                {t("session.delete_task")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function AutomationNavGroupHeader(props: {
  title: string;
  groupId: string;
  expanded: boolean;
  pinned?: boolean;
  sessionIds: string[];
  onToggle: () => void;
  onTogglePinned?: (groupId: string) => void;
  onArchive?: (groupId: string) => void;
  onDelete?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const hasMenu =
    Boolean(props.onTogglePinned) ||
    Boolean(props.onArchive) ||
    Boolean(props.onDelete);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menuOpen]);

  useLayoutEffect(() => {
    if (!menuOpen || !anchorRef.current || !menuRef.current) return;
    const menu = menuRef.current;
    setMenuPosition(
      positionTaskContextMenu(anchorRef.current.getBoundingClientRect(), {
        width: menu.offsetWidth || TASK_CONTEXT_MENU_WIDTH,
        estimatedHeight: menu.offsetHeight || 180,
      }),
    );
  }, [menuOpen]);

  return (
    <>
      <div
        className={cn(
          "group flex h-[34px] min-h-[34px] max-h-[34px] w-full shrink-0 items-center gap-1 overflow-hidden rounded-lg px-1 py-0 text-sm leading-none text-dls-text transition-colors hover:bg-dls-hover",
          menuOpen && "bg-dls-list-hover",
        )}
      >
        <button
          type="button"
          onClick={props.onToggle}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 text-left"
          aria-expanded={props.expanded}
        >
          {props.expanded ? (
            <ChevronDown
              className="size-3.5 shrink-0 text-dls-secondary"
              strokeWidth={1.75}
              aria-hidden
            />
          ) : (
            <ChevronRight
              className="size-3.5 shrink-0 text-dls-secondary"
              strokeWidth={1.75}
              aria-hidden
            />
          )}
          <CalendarClock
            className="size-3.5 shrink-0 text-dls-secondary"
            strokeWidth={1.6}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate font-medium">
            {props.title}
          </span>
        </button>
        <div
          className={cn(
            "flex shrink-0 items-center gap-0 opacity-0 transition-opacity group-hover:opacity-100",
            menuOpen && "opacity-100",
          )}
        >
          {hasMenu ? (
            <IconHoverTip label={t("session.task_actions")}>
              <button
                ref={anchorRef}
                type="button"
                className={TASK_ROW_ACTION_CLASS}
                aria-label={t("session.task_actions")}
                onClick={(event) => {
                  event.stopPropagation();
                  if (anchorRef.current) {
                    setMenuPosition(
                      positionTaskContextMenu(
                        anchorRef.current.getBoundingClientRect(),
                        { estimatedHeight: 180 },
                      ),
                    );
                  }
                  setMenuOpen((value) => !value);
                }}
              >
                <MoreHorizontal strokeWidth={1.75} />
              </button>
            </IconHoverTip>
          ) : null}
          {props.onTogglePinned ? (
            <IconHoverTip
              label={props.pinned ? t("session.unpin") : t("session.pin")}
            >
              <button
                type="button"
                className={cn(
                  TASK_ROW_ACTION_CLASS,
                  props.pinned
                    ? "text-dls-accent hover:text-dls-accent"
                    : "text-dls-secondary",
                )}
                aria-label={
                  props.pinned ? t("session.unpin") : t("session.pin")
                }
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen(false);
                  props.onTogglePinned?.(props.groupId);
                }}
              >
                {props.pinned ? (
                  <PinOff strokeWidth={1.75} />
                ) : (
                  <Pin strokeWidth={1.75} />
                )}
              </button>
            </IconHoverTip>
          ) : null}
          {props.onArchive ? (
            <IconHoverTip label={t("session.archive_task")}>
              <button
                type="button"
                className={TASK_ROW_ACTION_CLASS}
                aria-label={t("session.archive_task")}
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen(false);
                  props.onArchive?.(props.groupId);
                }}
              >
                <Archive strokeWidth={1.75} />
              </button>
            </IconHoverTip>
          ) : null}
        </div>
      </div>
      {menuOpen && menuPosition ? (
        <div
          ref={menuRef}
          className={TASK_CONTEXT_MENU_CLASS}
          data-task-context-menu="true"
          style={{ left: menuPosition.left, top: menuPosition.top }}
          onClick={(event) => event.stopPropagation()}
        >
          {props.onTogglePinned ? (
            <button
              type="button"
              className={TASK_CONTEXT_MENU_ITEM_CLASS}
              onClick={() => {
                setMenuOpen(false);
                props.onTogglePinned?.(props.groupId);
              }}
            >
              {props.pinned ? (
                <PinOff strokeWidth={1.75} />
              ) : (
                <Pin strokeWidth={1.75} />
              )}
              {props.pinned ? t("session.unpin") : t("session.pin")}
            </button>
          ) : null}
          {props.onArchive ? (
            <button
              type="button"
              className={TASK_CONTEXT_MENU_ITEM_CLASS}
              onClick={() => {
                setMenuOpen(false);
                props.onArchive?.(props.groupId);
              }}
            >
              <Archive strokeWidth={1.75} />
              {t("session.archive_task")}
            </button>
          ) : null}
          {props.onDelete ? (
            <>
              {props.onArchive || props.onTogglePinned ? (
                <div
                  className={TASK_CONTEXT_MENU_SEPARATOR_CLASS}
                  role="separator"
                />
              ) : null}
              <button
                type="button"
                className={TASK_CONTEXT_MENU_ITEM_CLASS}
                onClick={() => {
                  setMenuOpen(false);
                  props.onDelete?.();
                }}
              >
                <Trash2 strokeWidth={1.75} />
                {t("session.delete_task")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
