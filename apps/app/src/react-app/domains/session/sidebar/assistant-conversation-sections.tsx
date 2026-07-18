/** @jsxImportSource react */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Folder,
  FolderOpen,
  Maximize2,
  MessageCirclePlus,
  Minimize2,
  MoreHorizontal,
  Trash2,
} from "lucide-react";

import { IconTile } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "../../../../i18n";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";
import type { AgentConversationGroup } from "./conversation-model";
import type { AssistantAutomationGroup } from "./assistant-automation-groups";
import {
  AssistantTaskItem,
  TASK_CONTEXT_MENU_CLASS,
  TASK_CONTEXT_MENU_ITEM_CLASS,
  TASK_ROW_ACTION_CLASS,
} from "./assistant-task-item";

type SectionId = "pinned" | "tasks" | "spaces" | "automations";
const ASSISTANT_TASK_PREVIEW_LIMIT = 20;
/** Per space/automation folder: show “查看更多” when children exceed this. */
const FOLDER_TASK_PREVIEW_LIMIT = 5;

/**
 * Unified sidebar row rhythm (section / folder / task / show-more).
 * Strict fixed height so Chinese text, icons, and hover actions never drift.
 */
const LIST_ROW_H = "h-8 min-h-8 max-h-8";
const LIST_ROW_CLASS = cn(
  "flex w-full shrink-0 items-center overflow-hidden rounded-md px-2",
  "text-sm font-normal leading-none",
  LIST_ROW_H,
);

type AssistantConversationSectionsProps = {
  categoryId: AssistantCategoryId;
  workspaceId: string;
  selectedSessionId: string | null;
  automationGroups: AssistantAutomationGroup<AgentConversationGroup>[];
  pinnedGroups: AgentConversationGroup[];
  taskGroups: AgentConversationGroup[];
  spaceGroups: [string, AgentConversationGroup[]][];
  expandedDirectories: string[];
  expandedAutomationDirectories: string[];
  onExpandedDirectoriesChange: (updater: (current: string[]) => string[]) => void;
  onExpandedAutomationDirectoriesChange: (updater: (current: string[]) => string[]) => void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onTogglePinned: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onArchiveSession?: (sessionId: string, title: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onOpenFolder?: (path: string) => void;
  onSaveToSpace?: (sessionId: string) => void;
  /** Unbind all tasks under this project folder from the space list. */
  onRemoveSpaceDirectory?: (directory: string) => void;
  /** Start a new assistant task bound to this project folder. */
  onCreateTaskInDirectory?: (directory: string) => void;
  /** sessionId → bound folder path (for open-folder menu item). */
  folderPathBySessionId?: ReadonlyMap<string, string>;
};

function assistantDirectoryName(directory: string) {
  return (
    directory
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean)
      .pop() ?? directory
  );
}

function assistantTaskSelected(
  group: AgentConversationGroup,
  selectedSessionId: string | null,
) {
  return group.sessions.some((session) => session.id === selectedSessionId);
}

function groupIncludesSession(
  groups: AgentConversationGroup[],
  selectedSessionId: string | null,
) {
  if (!selectedSessionId) return false;
  return groups.some((group) => assistantTaskSelected(group, selectedSessionId));
}

function groupedEntriesIncludeSession(
  groups: [string, AgentConversationGroup[]][],
  selectedSessionId: string | null,
) {
  if (!selectedSessionId) return false;
  return groups.some(([, items]) => groupIncludesSession(items, selectedSessionId));
}

function takeVisibleGroups(
  groups: AgentConversationGroup[],
  remaining: { value: number },
) {
  if (remaining.value <= 0) return [];
  const visible = groups.slice(0, remaining.value);
  remaining.value -= visible.length;
  return visible;
}

function AssistantListEmptyState(props: {
  kind: SectionId;
  title: string;
  description: string;
}) {
  const icon = (() => {
    if (props.kind === "spaces") return <FolderOpen className="size-5" />;
    if (props.kind === "automations") return <CalendarClock className="size-5" />;
    return <ClipboardList className="size-5" />;
  })();

  return (
    <div className="mx-1 mt-1 flex flex-col items-center gap-2 rounded-xl border border-dls-border/60 bg-dls-surface/40 px-3 py-5 text-center">
      <IconTile size="md" shape="lg" tone="neutral" className="bg-dls-surface text-dls-secondary">
        {icon}
      </IconTile>
      <div className="space-y-1">
        <div className="text-sm font-medium text-dls-text">{props.title}</div>
        <p className="mx-auto max-w-48 text-xs leading-5 text-dls-secondary">
          {props.description}
        </p>
      </div>
    </div>
  );
}

function AssistantTaskRows(props: {
  groups: AgentConversationGroup[];
  workspaceId: string;
  selectedSessionId: string | null;
  pinned?: boolean;
  pinnable?: boolean;
  typeIcon?: React.ReactNode;
  singleLine?: boolean;
  folderPathBySessionId?: ReadonlyMap<string, string>;
  /** Fallback folder for all rows in this block (e.g. space directory). */
  folderPath?: string | null;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onTogglePinned: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onArchiveSession?: (sessionId: string, title: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onOpenFolder?: (path: string) => void;
  onSaveToSpace?: (sessionId: string) => void;
}) {
  return (
    <>
      {props.groups.map((item) => (
        <AssistantTaskItem
          key={item.key}
          group={item}
          workspaceId={props.workspaceId}
          selected={assistantTaskSelected(item, props.selectedSessionId)}
          pinned={props.pinned}
          pinnable={props.pinnable}
          typeIcon={props.typeIcon}
          singleLine={props.singleLine}
          folderPath={
            props.folderPathBySessionId?.get(item.latestSession.id) ??
            props.folderPath ??
            null
          }
          onOpenSession={props.onOpenSession}
          onPrefetchSession={props.onPrefetchSession}
          onTogglePinned={props.onTogglePinned}
          onRenameSession={props.onRenameSession}
          onArchiveSession={props.onArchiveSession}
          onDeleteSession={props.onDeleteSession}
          onOpenFolder={props.onOpenFolder}
          onSaveToSpace={props.onSaveToSpace}
        />
      ))}
    </>
  );
}

function SectionHeader(props: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  /** Optional trailing control (e.g. expand-all for 空间). */
  trailing?: ReactNode;
}) {
  // WorkBuddy：`空间 (10) ∨` — 箭头紧贴标题；可选 trailing 贴行尾。
  return (
    <div
      className={cn(LIST_ROW_CLASS, "group/section gap-0.5 text-dls-secondary")}
      data-assistant-section-header="true"
    >
      <button
        type="button"
        onClick={props.onToggle}
        className="flex h-full min-w-0 flex-1 items-center justify-start gap-1 overflow-hidden rounded-md text-left leading-none transition-colors hover:bg-dls-list-hover hover:text-dls-text"
        aria-expanded={props.expanded}
      >
        <span className="min-w-0 max-w-full truncate tracking-tight leading-none">
          {props.label}
          <span className="tabular-nums"> ({props.count})</span>
        </span>
        {props.expanded ? (
          <ChevronDown
            className="size-3 shrink-0 opacity-50"
            strokeWidth={2}
            aria-hidden
          />
        ) : (
          <ChevronRight
            className="size-3 shrink-0 opacity-50"
            strokeWidth={2}
            aria-hidden
          />
        )}
      </button>
      {props.trailing ? (
        <div className="ml-auto flex h-full max-h-8 shrink-0 items-center">
          {props.trailing}
        </div>
      ) : null}
    </div>
  );
}

/** Shared folder row chrome — space project + automation group (same height). */
function FolderRowShell(props: {
  title: string;
  /** Full path / longer label for native tooltip; defaults to title. */
  tooltip?: string;
  expanded: boolean;
  onToggle: () => void;
  icon: ReactNode;
  trailing?: ReactNode;
  "data-assistant-space-directory"?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        LIST_ROW_CLASS,
        // WorkBuddy: neutral charcoal outline folders (not blue secondary).
        "group gap-0.5 text-dls-text/80 transition-colors hover:bg-dls-list-hover hover:text-dls-text",
        props.className,
      )}
      data-assistant-space-directory={props["data-assistant-space-directory"]}
    >
      {/*
        WorkBuddy: `📁 name >` — chevron sits immediately after the name
        (not row-trailing). Trailing actions stay on the far right via ml-auto.
      */}
      <button
        type="button"
        onClick={props.onToggle}
        title={props.tooltip ?? props.title}
        aria-expanded={props.expanded}
        className="flex h-full min-w-0 flex-1 items-center overflow-hidden rounded-md text-left leading-none outline-none"
      >
        <span className="flex min-w-0 max-w-full items-center gap-1.5">
          {props.icon}
          <span className="min-w-0 truncate leading-none">{props.title}</span>
          {props.expanded ? (
            <ChevronDown
              className="size-3 shrink-0 text-dls-text/40"
              strokeWidth={2}
              aria-hidden
            />
          ) : (
            <ChevronRight
              className="size-3 shrink-0 text-dls-text/40"
              strokeWidth={2}
              aria-hidden
            />
          )}
        </span>
      </button>
      {props.trailing ? (
        <div className="ml-auto flex h-full max-h-8 shrink-0 items-center gap-0">
          {props.trailing}
        </div>
      ) : null}
    </div>
  );
}

/** Space project row — folder + name + chevron + ⋯ menu (open / remove). */
function SpaceDirectoryRow(props: {
  name: string;
  directory: string;
  expanded: boolean;
  onToggle: () => void;
  onOpenFolder?: (path: string) => void;
  onRemoveFromList?: (directory: string) => void;
  onCreateTask?: (directory: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

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

  return (
    <>
      <FolderRowShell
        title={props.name}
        tooltip={props.directory}
        expanded={props.expanded}
        onToggle={props.onToggle}
        data-assistant-space-directory="true"
        className={menuOpen ? "bg-dls-list-hover text-dls-text" : undefined}
        icon={
          <Folder
            className="size-3.5 shrink-0 text-dls-text/55"
            strokeWidth={1.6}
          />
        }
        trailing={
          <div
            className={cn(
              "flex h-full items-center gap-0 opacity-0 transition-opacity group-hover:opacity-100",
              menuOpen && "opacity-100",
            )}
          >
            <button
              ref={anchorRef}
              type="button"
              className={cn(TASK_ROW_ACTION_CLASS, "text-dls-text/50")}
              title={t("session.task_actions")}
              aria-label={t("session.task_actions")}
              onClick={(event) => {
                event.stopPropagation();
                if (anchorRef.current) {
                  const rect = anchorRef.current.getBoundingClientRect();
                  setMenuPosition({
                    left: rect.right - 176,
                    top: rect.bottom + 4,
                  });
                }
                setMenuOpen((value) => !value);
              }}
            >
              <MoreHorizontal strokeWidth={1.75} />
            </button>
            {props.onCreateTask ? (
              <button
                type="button"
                className={cn(TASK_ROW_ACTION_CLASS, "text-dls-text/50")}
                title={t("session.new_task_in_space")}
                aria-label={t("session.new_task_in_space")}
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen(false);
                  props.onCreateTask?.(props.directory);
                }}
              >
                <MessageCirclePlus strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
        }
      />
      {menuOpen && menuPosition ? (
        <div
          className={TASK_CONTEXT_MENU_CLASS}
          data-task-context-menu="true"
          style={{ left: menuPosition.left, top: menuPosition.top }}
          onClick={(event) => event.stopPropagation()}
        >
          {props.onOpenFolder ? (
            <button
              type="button"
              className={TASK_CONTEXT_MENU_ITEM_CLASS}
              onClick={() => {
                setMenuOpen(false);
                props.onOpenFolder?.(props.directory);
              }}
            >
              <FolderOpen strokeWidth={1.75} />
              {t("session.open_folder")}
            </button>
          ) : null}
          {props.onRemoveFromList ? (
            <button
              type="button"
              className={TASK_CONTEXT_MENU_ITEM_CLASS}
              onClick={() => {
                setMenuOpen(false);
                props.onRemoveFromList?.(props.directory);
              }}
            >
              <Trash2 strokeWidth={1.75} />
              {t("session.remove_from_space_list")}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function SectionShowMore(props: {
  overflow: boolean;
  showAll: boolean;
  hiddenCount: number;
  onToggle: () => void;
}) {
  if (!props.overflow) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        LIST_ROW_CLASS,
        "justify-center bg-dls-sidebar text-xs font-normal text-dls-secondary hover:bg-dls-list-hover hover:text-dls-text",
      )}
      data-assistant-task-list-disclosure="true"
      onClick={props.onToggle}
    >
      {props.showAll ? (
        <ChevronUp className="size-3.5 shrink-0" />
      ) : (
        <ChevronDown className="size-3.5 shrink-0" />
      )}
      {props.showAll
        ? t("session.task_list_show_less")
        : t("session.task_list_show_more", { count: props.hiddenCount })}
    </Button>
  );
}

/** WorkBuddy folder disclosure: soft pill “查看更多(n)” / “收起” — same h-8 as tasks. */
function FolderTaskShowMore(props: {
  total: number;
  showAll: boolean;
  onToggle: () => void;
}) {
  if (props.total <= FOLDER_TASK_PREVIEW_LIMIT) return null;
  const hidden = props.total - FOLDER_TASK_PREVIEW_LIMIT;
  return (
    <button
      type="button"
      data-assistant-folder-task-disclosure="true"
      onClick={props.onToggle}
      className={cn(
        LIST_ROW_CLASS,
        "text-left text-dls-text/80 transition-colors hover:bg-dls-list-hover hover:text-dls-text",
        props.showAll && "bg-dls-list-hover text-dls-text",
      )}
    >
      <span className="truncate leading-none">
        {props.showAll
          ? t("session.collapse_folder_tasks")
          : t("session.view_more_folder_tasks", { count: hidden })}
      </span>
    </button>
  );
}

/** Nested task list under a folder — no extra py so row heights stay even. */
function FolderChildren(props: { children: ReactNode }) {
  return <div className="ml-5 flex flex-col gap-0.5">{props.children}</div>;
}

export function AssistantConversationSections(props: AssistantConversationSectionsProps) {
  // Default collapsed (WorkBuddy); open the section that owns the selection.
  const [expandedSections, setExpandedSections] = useState<Record<SectionId, boolean>>({
    pinned: true,
    tasks: false,
    spaces: false,
    automations: false,
  });
  const [showAllBySection, setShowAllBySection] = useState<Record<SectionId, boolean>>({
    pinned: false,
    tasks: false,
    spaces: false,
    automations: false,
  });
  /** Per space-folder / automation-group: expand beyond FOLDER_TASK_PREVIEW_LIMIT. */
  const [showAllByFolder, setShowAllByFolder] = useState<Record<string, boolean>>({});

  const pinnedCount = props.pinnedGroups.length;
  const taskCount = props.taskGroups.length;
  const spacesCount = props.spaceGroups.reduce(
    (count, [, items]) => count + items.length,
    0,
  );
  const spaceDirectoryCount = props.spaceGroups.length;
  const allSpaceDirectoriesExpanded =
    spaceDirectoryCount > 0 &&
    props.spaceGroups.every(([directory]) =>
      props.expandedDirectories.includes(directory),
    );
  const automationsCount = props.automationGroups.reduce(
    (count, group) => count + group.items.length,
    0,
  );

  // Keep the section that owns the selected session expanded.
  useEffect(() => {
    if (groupIncludesSession(props.pinnedGroups, props.selectedSessionId)) {
      setExpandedSections((current) =>
        current.pinned ? current : { ...current, pinned: true },
      );
      return;
    }
    if (groupIncludesSession(props.taskGroups, props.selectedSessionId)) {
      setExpandedSections((current) =>
        current.tasks ? current : { ...current, tasks: true },
      );
      return;
    }
    if (groupedEntriesIncludeSession(props.spaceGroups, props.selectedSessionId)) {
      setExpandedSections((current) =>
        current.spaces ? current : { ...current, spaces: true },
      );
      return;
    }
    if (
      groupIncludesSession(
        props.automationGroups.flatMap((group) => group.items),
        props.selectedSessionId,
      )
    ) {
      setExpandedSections((current) =>
        current.automations ? current : { ...current, automations: true },
      );
    }
  }, [
    props.automationGroups,
    props.pinnedGroups,
    props.selectedSessionId,
    props.spaceGroups,
    props.taskGroups,
  ]);

  const toggleSection = (id: SectionId) => {
    setExpandedSections((current) => ({ ...current, [id]: !current[id] }));
  };

  const toggleShowAll = (id: SectionId) => {
    setShowAllBySection((current) => ({ ...current, [id]: !current[id] }));
  };

  const toggleShowAllFolder = (folderKey: string) => {
    setShowAllByFolder((current) => ({
      ...current,
      [folderKey]: !current[folderKey],
    }));
  };

  const pinnedRemaining = {
    value: showAllBySection.pinned
      ? Number.POSITIVE_INFINITY
      : ASSISTANT_TASK_PREVIEW_LIMIT,
  };
  const visiblePinnedGroups = expandedSections.pinned
    ? takeVisibleGroups(props.pinnedGroups, pinnedRemaining)
    : [];
  const pinnedOverflow = pinnedCount > ASSISTANT_TASK_PREVIEW_LIMIT;

  const taskRemaining = {
    value: showAllBySection.tasks
      ? Number.POSITIVE_INFINITY
      : ASSISTANT_TASK_PREVIEW_LIMIT,
  };
  const visibleTaskGroups = expandedSections.tasks
    ? takeVisibleGroups(props.taskGroups, taskRemaining)
    : [];
  const tasksOverflow = taskCount > ASSISTANT_TASK_PREVIEW_LIMIT;

  return (
    <div className="mt-1 flex flex-col gap-0.5 pt-1" data-assistant-task-list="true">
      {/* 置顶任务 — WorkBuddy: 置顶任务 (n) ∨ as its own section */}
      {pinnedCount > 0 ? (
        <div data-assistant-section="pinned" className="flex flex-col gap-0.5">
          <SectionHeader
            label={t("session.pinned_tasks_section")}
            count={pinnedCount}
            expanded={expandedSections.pinned}
            onToggle={() => toggleSection("pinned")}
          />
          {expandedSections.pinned ? (
            <div className="flex flex-col gap-0.5 pb-1">
              <AssistantTaskRows
                groups={visiblePinnedGroups}
                workspaceId={props.workspaceId}
                selectedSessionId={props.selectedSessionId}
                pinned
                singleLine
                folderPathBySessionId={props.folderPathBySessionId}
                onOpenSession={props.onOpenSession}
                onPrefetchSession={props.onPrefetchSession}
                onTogglePinned={props.onTogglePinned}
                onRenameSession={props.onRenameSession}
                onArchiveSession={props.onArchiveSession}
                onDeleteSession={props.onDeleteSession}
                onOpenFolder={props.onOpenFolder}
                onSaveToSpace={props.onSaveToSpace}
              />
              <SectionShowMore
                overflow={pinnedOverflow}
                showAll={showAllBySection.pinned}
                hiddenCount={pinnedCount - ASSISTANT_TASK_PREVIEW_LIMIT}
                onToggle={() => toggleShowAll("pinned")}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 任务 */}
      <div data-assistant-section="tasks" className="flex flex-col gap-0.5">
        <SectionHeader
          label={t("session.task_filter_tasks")}
          count={taskCount}
          expanded={expandedSections.tasks}
          onToggle={() => toggleSection("tasks")}
        />
        {expandedSections.tasks ? (
          <div className="flex flex-col gap-0.5 pb-1">
            {taskCount === 0 ? (
              <AssistantListEmptyState
                kind="tasks"
                title={
                  props.categoryId === "code"
                    ? t("session.no_code_tasks")
                    : t("session.no_tasks")
                }
                description={
                  props.categoryId === "code"
                    ? t("session.no_code_tasks_desc")
                    : t("session.no_tasks_desc")
                }
              />
            ) : (
              <>
                <AssistantTaskRows
                  groups={visibleTaskGroups}
                  workspaceId={props.workspaceId}
                  selectedSessionId={props.selectedSessionId}
                  singleLine
                  folderPathBySessionId={props.folderPathBySessionId}
                  onOpenSession={props.onOpenSession}
                  onPrefetchSession={props.onPrefetchSession}
                  onTogglePinned={props.onTogglePinned}
                  onRenameSession={props.onRenameSession}
                  onArchiveSession={props.onArchiveSession}
                  onDeleteSession={props.onDeleteSession}
                  onOpenFolder={props.onOpenFolder}
                  onSaveToSpace={props.onSaveToSpace}
                />
                <SectionShowMore
                  overflow={tasksOverflow}
                  showAll={showAllBySection.tasks}
                  hiddenCount={taskCount - ASSISTANT_TASK_PREVIEW_LIMIT}
                  onToggle={() => toggleShowAll("tasks")}
                />
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* 空间 — WorkBuddy: 空间(n) ∨ / 📁 name > + expand-all */}
      <div data-assistant-section="spaces" className="flex flex-col gap-0.5">
        <SectionHeader
          label={t("session.task_filter_space_tasks")}
          count={spacesCount}
          expanded={expandedSections.spaces}
          onToggle={() => toggleSection("spaces")}
          trailing={
            spacesCount > 0 ? (
              <button
                type="button"
                className={cn(
                  TASK_ROW_ACTION_CLASS,
                  "opacity-0 transition-opacity group-hover/section:opacity-100",
                  expandedSections.spaces && "opacity-100",
                )}
                title={
                  allSpaceDirectoriesExpanded
                    ? t("session.collapse_all_spaces")
                    : t("session.expand_all_spaces")
                }
                aria-label={
                  allSpaceDirectoriesExpanded
                    ? t("session.collapse_all_spaces")
                    : t("session.expand_all_spaces")
                }
                onClick={(event) => {
                  event.stopPropagation();
                  // Ensure the 空间 section itself is open.
                  if (!expandedSections.spaces) {
                    setExpandedSections((current) => ({
                      ...current,
                      spaces: true,
                    }));
                  }
                  if (allSpaceDirectoriesExpanded) {
                    props.onExpandedDirectoriesChange(() => []);
                    return;
                  }
                  const allDirs = props.spaceGroups.map(([directory]) => directory);
                  props.onExpandedDirectoriesChange(() => allDirs);
                }}
              >
                {allSpaceDirectoriesExpanded ? (
                  <Minimize2 strokeWidth={1.75} />
                ) : (
                  <Maximize2 strokeWidth={1.75} />
                )}
              </button>
            ) : null
          }
        />
        {expandedSections.spaces ? (
          <div className="flex flex-col gap-0.5 pb-1">
            {spacesCount === 0 ? (
              <AssistantListEmptyState
                kind="spaces"
                title={t("session.no_space_tasks")}
                description={t("session.no_space_tasks_desc")}
              />
            ) : (
              <>
                {/* Full folder list; per-folder cap is FOLDER_TASK_PREVIEW_LIMIT. */}
                {props.spaceGroups.map(([directory, items]) => {
                  const expandedDir = props.expandedDirectories.includes(directory);
                  const name = assistantDirectoryName(directory);
                  return (
                    <div key={directory} className="flex flex-col gap-0.5">
                      <SpaceDirectoryRow
                        name={name}
                        directory={directory}
                        expanded={expandedDir}
                        onToggle={() =>
                          props.onExpandedDirectoriesChange((current) =>
                            current.includes(directory)
                              ? current.filter((item) => item !== directory)
                              : [...current, directory],
                          )
                        }
                        onOpenFolder={props.onOpenFolder}
                        onRemoveFromList={props.onRemoveSpaceDirectory}
                        onCreateTask={props.onCreateTaskInDirectory}
                      />
                      {expandedDir ? (
                        <FolderChildren>
                          {(() => {
                            const showAll = showAllByFolder[directory] === true;
                            const visibleItems =
                              showAll || items.length <= FOLDER_TASK_PREVIEW_LIMIT
                                ? items
                                : items.slice(0, FOLDER_TASK_PREVIEW_LIMIT);
                            return (
                              <>
                                <AssistantTaskRows
                                  groups={visibleItems}
                                  workspaceId={props.workspaceId}
                                  selectedSessionId={props.selectedSessionId}
                                  singleLine
                                  folderPath={directory}
                                  folderPathBySessionId={props.folderPathBySessionId}
                                  onOpenSession={props.onOpenSession}
                                  onPrefetchSession={props.onPrefetchSession}
                                  onTogglePinned={props.onTogglePinned}
                                  onRenameSession={props.onRenameSession}
                                  onArchiveSession={props.onArchiveSession}
                                  onDeleteSession={props.onDeleteSession}
                                  onOpenFolder={props.onOpenFolder}
                                  onSaveToSpace={props.onSaveToSpace}
                                />
                                <FolderTaskShowMore
                                  total={items.length}
                                  showAll={showAll}
                                  onToggle={() => toggleShowAllFolder(directory)}
                                />
                              </>
                            );
                          })()}
                        </FolderChildren>
                      ) : null}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* 定时 */}
      <div data-assistant-section="automations" className="flex flex-col gap-0.5">
        <SectionHeader
          label={t("session.task_filter_automation_tasks")}
          count={automationsCount}
          expanded={expandedSections.automations}
          onToggle={() => toggleSection("automations")}
        />
        {expandedSections.automations ? (
          <div className="flex flex-col gap-0.5 pb-1">
            {automationsCount === 0 ? (
              <AssistantListEmptyState
                kind="automations"
                title={t("session.no_automation_tasks")}
                description={t("session.no_automation_tasks_desc")}
              />
            ) : (
              <>
                {props.automationGroups.map((group) => {
                  const expandedAuto = props.expandedAutomationDirectories.includes(
                    group.id,
                  );
                  const groupLabel = t("automation.session_group_title", {
                    title: group.title,
                  });
                  return (
                    <div key={group.id} className="flex flex-col gap-0.5">
                      <FolderRowShell
                        title={groupLabel}
                        expanded={expandedAuto}
                        onToggle={() =>
                          props.onExpandedAutomationDirectoriesChange((current) =>
                            current.includes(group.id)
                              ? current.filter((item) => item !== group.id)
                              : [...current, group.id],
                          )
                        }
                        icon={
                          <CalendarClock
                            className="size-3.5 shrink-0 text-dls-text/55"
                            strokeWidth={1.6}
                          />
                        }
                      />
                      {expandedAuto ? (
                        <FolderChildren>
                          {(() => {
                            const folderKey = `auto:${group.id}`;
                            const showAll = showAllByFolder[folderKey] === true;
                            const items = group.items;
                            const visibleItems =
                              showAll || items.length <= FOLDER_TASK_PREVIEW_LIMIT
                                ? items
                                : items.slice(0, FOLDER_TASK_PREVIEW_LIMIT);
                            return (
                              <>
                                <AssistantTaskRows
                                  groups={visibleItems}
                                  workspaceId={props.workspaceId}
                                  selectedSessionId={props.selectedSessionId}
                                  singleLine
                                  pinnable={false}
                                  folderPathBySessionId={props.folderPathBySessionId}
                                  onOpenSession={props.onOpenSession}
                                  onPrefetchSession={props.onPrefetchSession}
                                  onTogglePinned={props.onTogglePinned}
                                  onRenameSession={props.onRenameSession}
                                  onArchiveSession={props.onArchiveSession}
                                  onDeleteSession={props.onDeleteSession}
                                  onOpenFolder={props.onOpenFolder}
                                  onSaveToSpace={props.onSaveToSpace}
                                />
                                <FolderTaskShowMore
                                  total={items.length}
                                  showAll={showAll}
                                  onToggle={() => toggleShowAllFolder(folderKey)}
                                />
                              </>
                            );
                          })()}
                        </FolderChildren>
                      ) : null}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
