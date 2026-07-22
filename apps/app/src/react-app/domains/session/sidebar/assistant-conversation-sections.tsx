/** @jsxImportSource react */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Archive,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
  FolderOpen,
  Maximize2,
  MessageCirclePlus,
  Minimize2,
  MoreHorizontal,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "../../../../i18n";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";
import type {
  AgentConversationGroup,
  AssistantGlobalPin,
} from "./conversation-model";
import type { AssistantAutomationGroup } from "./assistant-automation-groups";
import type {
  AssistantListModel,
  AssistantSpaceFolder,
} from "./assistant-list-model";
import {
  dropSlotToIndex,
  resolveDropSlot,
} from "./assistant-list-model";
import {
  AssistantTaskItem,
  TASK_CONTEXT_MENU_CLASS,
  TASK_CONTEXT_MENU_ITEM_CLASS,
  TASK_CONTEXT_MENU_SEPARATOR_CLASS,
  TASK_CONTEXT_MENU_WIDTH,
  TASK_ROW_ACTION_CLASS,
  TASK_ROW_ARCHIVE_CHIP_CLASS,
  positionTaskContextMenu,
} from "./assistant-task-item";
import {
  resolveUnreadAgentIdForSession,
  useExpertUnreadStore,
} from "../status/expert-unread-store";
import { pickAggregateSessionStatus } from "./utils";

/** Floating row/section icon → short hover tip (native title is too slow in Electron). */
function IconHoverTip(props: {
  label: string;
  children: ReactElement;
  side?: "left" | "top" | "right" | "bottom";
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipContent side={props.side ?? "left"} sideOffset={6}>
        {props.label}
      </TooltipContent>
    </Tooltip>
  );
}

type SectionId = "pinned" | "recent" | "spaces" | "automations";
/** Recent list preview before "show more". */
const RECENT_PREVIEW_LIMIT = 12;
/** Per space/automation folder: show "show more" when children exceed this. */
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
  sessionStatusById?: Record<string, string>;
  /** Unpinned scheduled groups for the Schedules section. */
  automationGroups: AssistantAutomationGroup<AgentConversationGroup>[];
  /**
   * All scheduled groups (incl. globally pinned) — used by the pin strip and
   * local-pin lookup. Defaults to automationGroups when omitted.
   */
  automationGroupsAll?: AssistantAutomationGroup<AgentConversationGroup>[];
  /** automationId → local pin order inside that scheduled group. */
  automationLocalPinsById?: Record<string, string[]>;
  /** Built once in the panel — pin / space / recent rules. */
  listModel: AssistantListModel;
  expandedDirectories: string[];
  expandedAutomationDirectories: string[];
  onExpandedDirectoriesChange: (updater: (current: string[]) => string[]) => void;
  onExpandedAutomationDirectoriesChange: (updater: (current: string[]) => string[]) => void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onTogglePinned: (sessionId: string) => void;
  onToggleFolderPinned?: (directory: string) => void;
  onToggleAutomationGroupPinned?: (groupId: string) => void;
  onReorderGlobalPins?: (fromIndex: number, toIndex: number) => void;
  onReorderSpaceFolders?: (orderedDirectories: string[]) => void;
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onArchiveSession?: (sessionId: string, title: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onOpenFolder?: (path: string) => void;
  onSaveToSpace?: (sessionId: string) => void;
  onRemoveSpaceDirectory?: (directory: string) => void;
  onArchiveSpaceDirectory?: (directory: string) => void;
  onCreateTaskInDirectory?: (directory: string) => void;
  /** Soft-archive every run under a scheduled-task group. */
  onArchiveAutomationGroup?: (groupId: string) => void;
  /** Confirm + permanently delete every run under a scheduled-task group. */
  onDeleteAutomationGroup?: (target: {
    groupId: string;
    title: string;
    sessionIds: string[];
  }) => void;
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

/** Insertion slot from a drag-over event on a row (Codex-style half-row split). */
function dropSlotFromEvent(
  event: DragEvent,
  rowIndex: number,
  count: number,
): number {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return resolveDropSlot(event.clientY, rect.top, rect.height, rowIndex, count);
}

/** Quiet one-line empty label — same chrome for tasks / spaces / schedules / recent. */
function AssistantListEmptyState(props: { label: string }) {
  return (
    <div
      className={cn(
        LIST_ROW_CLASS,
        "px-2 text-xs text-dls-secondary/70",
      )}
      data-assistant-list-empty="true"
    >
      <span className="truncate leading-none">{props.label}</span>
    </div>
  );
}

function AssistantTaskRows(props: {
  groups: AgentConversationGroup[];
  workspaceId: string;
  selectedSessionId: string | null;
  sessionStatusById?: Record<string, string>;
  /** Force all rows pinned=true (global pin strip). */
  pinned?: boolean;
  /** Per-session pin flags (space-local pins). */
  pinnedSessionIds?: ReadonlySet<string>;
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
  // Subscribe so task unread dots update when stream activity / focus changes.
  const sessionUnreadByWorkspace = useExpertUnreadStore(
    (state) => state.sessionUnreadByWorkspace,
  );
  const byWorkspace = useExpertUnreadStore((state) => state.byWorkspace);
  const focused = useExpertUnreadStore((state) => state.focused);
  const isSessionUnread = useExpertUnreadStore((state) => state.isSessionUnread);
  void sessionUnreadByWorkspace;
  void byWorkspace;
  void focused;

  return (
    <>
      {props.groups.map((item) => {
        const unread = item.sessions.some((session) =>
          isSessionUnread(props.workspaceId, session.id),
        );
        const rowPinned =
          props.pinned === true ||
          Boolean(props.pinnedSessionIds?.has(item.latestSession.id));
        return (
          <AssistantTaskItem
            key={item.key}
            group={item}
            workspaceId={props.workspaceId}
            selected={assistantTaskSelected(item, props.selectedSessionId)}
            status={pickAggregateSessionStatus(
              item.sessions.map((session) => session.id),
              props.sessionStatusById,
            )}
            unread={unread}
            pinned={rowPinned}
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
            // Already in a space folder — no "save to space" again.
            onSaveToSpace={
              props.folderPath?.trim() ? undefined : props.onSaveToSpace
            }
          />
        );
      })}
    </>
  );
}

/**
 * Codex-style drop indicator: blue circle + horizontal line between rows.
 * `slot` is the insertion index (0 = before first, n = after last).
 */
function PinDropIndicator() {
  return (
    <div
      className="pointer-events-none relative z-10 my-0.5 h-0 w-full"
      aria-hidden
    >
      <div className="absolute inset-x-1 top-0 flex -translate-y-1/2 items-center">
        <span className="size-2 shrink-0 rounded-full border-2 border-dls-accent bg-dls-background" />
        <span className="h-0.5 min-w-0 flex-1 rounded-full bg-dls-accent" />
      </div>
    </div>
  );
}

/** Codex-style drag reorder for space folders (same indicator as global pins). */
function SpaceFolderDragList(props: {
  folders: AssistantSpaceFolder[];
  workspaceId: string;
  selectedSessionId: string | null;
  sessionStatusById?: Record<string, string>;
  expandedDirectories: string[];
  folderPathBySessionId?: ReadonlyMap<string, string>;
  showAllByFolder: Record<string, boolean>;
  /** Full space directory list (incl. globally pinned) for order persistence. */
  allSpaceDirectories: string[];
  onExpandedDirectoriesChange: (updater: (current: string[]) => string[]) => void;
  onToggleFolderPinned?: (directory: string) => void;
  onReorderSpaceFolders?: (orderedDirectories: string[]) => void;
  onOpenFolder?: (path: string) => void;
  onArchiveDirectory?: (directory: string) => void;
  onRemoveFromList?: (directory: string) => void;
  onCreateTask?: (directory: string) => void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onTogglePinned: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onArchiveSession?: (sessionId: string, title: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onSaveToSpace?: (sessionId: string) => void;
  onToggleShowAllFolder: (folderKey: string) => void;
}) {
  const dragFromRef = useRef<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const count = props.folders.length;
  const canDrag = Boolean(props.onReorderSpaceFolders) && count > 1;

  const clearDrag = () => {
    dragFromRef.current = null;
    setDragFrom(null);
    setDropSlot(null);
  };

  const commitReorder = (from: number, slot: number) => {
    if (!props.onReorderSpaceFolders) return;
    const to = dropSlotToIndex(from, slot);
    if (to === from) return;
    const visible = props.folders.map((folder) => folder.directory);
    const nextVisible = [...visible];
    const [moved] = nextVisible.splice(from, 1);
    if (!moved) return;
    nextVisible.splice(to, 0, moved);
    // Keep globally-pinned (hidden) folders in the saved order after visible ones.
    const full = [...nextVisible];
    for (const dir of props.allSpaceDirectories) {
      if (!full.includes(dir)) full.push(dir);
    }
    props.onReorderSpaceFolders(full);
  };

  return (
    <div
      className="flex flex-col gap-0.5"
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDropSlot(null);
      }}
    >
      {props.folders.map((folder, index) => {
        const { directory, name, items, localPinnedSessionIds } = folder;
        const expandedDir = props.expandedDirectories.includes(directory);
        const localPins = new Set(localPinnedSessionIds);
        const isDragging = dragFrom === index;
        return (
          <div key={directory}>
            {dragFrom !== null && dropSlot === index ? <PinDropIndicator /> : null}
            <div
              className={cn(
                "relative flex flex-col gap-0.5",
                canDrag && "cursor-grab active:cursor-grabbing",
                isDragging && "opacity-40",
              )}
              draggable={canDrag}
              onDragStart={(event) => {
                if (!canDrag) return;
                const target = event.target;
                if (
                  target instanceof Element &&
                  target.closest("button, a, input, textarea, [data-no-drag]")
                ) {
                  event.preventDefault();
                  return;
                }
                dragFromRef.current = index;
                setDragFrom(index);
                try {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", directory);
                } catch {
                  // ignore
                }
              }}
              onDragOver={(event) => {
                if (dragFromRef.current === null || !canDrag) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const slot = dropSlotFromEvent(event, index, count);
                setDropSlot((current) => (current === slot ? current : slot));
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = dragFromRef.current;
                const slot =
                  dropSlot ?? dropSlotFromEvent(event, index, count);
                clearDrag();
                if (from === null) return;
                commitReorder(from, slot);
              }}
              onDragEnd={() => clearDrag()}
            >
              <SpaceDirectoryRow
                name={name}
                directory={directory}
                expanded={expandedDir}
                sessionCount={items.length}
                onToggle={() =>
                  props.onExpandedDirectoriesChange((current) =>
                    current.includes(directory)
                      ? current.filter((item) => item !== directory)
                      : [...current, directory],
                  )
                }
                onTogglePinned={props.onToggleFolderPinned}
                onOpenFolder={props.onOpenFolder}
                onArchiveDirectory={props.onArchiveDirectory}
                onRemoveFromList={props.onRemoveFromList}
                onCreateTask={props.onCreateTask}
              />
              {expandedDir ? (
                <FolderChildren>
                  {(() => {
                    const showAll = props.showAllByFolder[directory] === true;
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
                          sessionStatusById={props.sessionStatusById}
                          singleLine
                          pinnedSessionIds={localPins}
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
                          onToggle={() =>
                            props.onToggleShowAllFolder(directory)
                          }
                        />
                      </>
                    );
                  })()}
                </FolderChildren>
              ) : null}
            </div>
          </div>
        );
      })}
      {dragFrom !== null && dropSlot === count ? <PinDropIndicator /> : null}
    </div>
  );
}

function SectionHeader(props: {
  label: string;
  count?: number;
  expanded: boolean;
  onToggle: () => void;
  /** Optional trailing control (e.g. expand-all for spaces). */
  trailing?: ReactNode;
  /** Quieter label (no count) — WorkBuddy section chrome. */
  quiet?: boolean;
}) {
  // WorkBuddy: quiet section labels; optional (n); chevron after title.
  return (
    <div
      className={cn(
        LIST_ROW_CLASS,
        "group/section gap-0.5 text-dls-secondary/80",
      )}
      data-assistant-section-header="true"
    >
      <button
        type="button"
        onClick={props.onToggle}
        className="flex h-full min-w-0 flex-1 items-center justify-start gap-1 overflow-hidden rounded-md text-left text-sm font-medium leading-none tracking-wide transition-colors hover:bg-dls-list-hover/70 hover:text-dls-secondary"
        aria-expanded={props.expanded}
      >
        <span className="min-w-0 max-w-full truncate leading-none">
          {props.label}
          {typeof props.count === "number" && !props.quiet ? (
            <span className="tabular-nums font-normal opacity-80">
              {" "}
              ({props.count})
            </span>
          ) : null}
        </span>
        {props.expanded ? (
          <ChevronDown
            className="size-3 shrink-0 opacity-40"
            strokeWidth={2}
            aria-hidden
          />
        ) : (
          <ChevronRight
            className="size-3 shrink-0 opacity-40"
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

/** Space project row — folder + name + chevron + ⋯ menu. */
function SpaceDirectoryRow(props: {
  name: string;
  directory: string;
  expanded: boolean;
  pinned?: boolean;
  sessionCount?: number;
  onToggle: () => void;
  onTogglePinned?: (directory: string) => void;
  onOpenFolder?: (path: string) => void;
  onArchiveDirectory?: (directory: string) => void;
  onRemoveFromList?: (directory: string) => void;
  onCreateTask?: (directory: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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

  useLayoutEffect(() => {
    if (!menuOpen || !anchorRef.current || !menuRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    setMenuPosition(
      positionTaskContextMenu(anchor, {
        width: menu.offsetWidth || TASK_CONTEXT_MENU_WIDTH,
        estimatedHeight: menu.offsetHeight || 200,
      }),
    );
  }, [menuOpen]);

  const titleWithCount =
    typeof props.sessionCount === "number" && props.sessionCount > 0
      ? `${props.name}`
      : props.name;

  return (
    <>
      <FolderRowShell
        title={titleWithCount}
        tooltip={props.directory}
        expanded={props.expanded}
        onToggle={props.onToggle}
        data-assistant-space-directory="true"
        className={cn(menuOpen && "bg-dls-list-hover text-dls-text")}
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
            <IconHoverTip label={t("session.task_actions")}>
              <button
                ref={anchorRef}
                type="button"
                className={cn(TASK_ROW_ACTION_CLASS, "text-dls-text/50")}
                aria-label={t("session.task_actions")}
                onClick={(event) => {
                  event.stopPropagation();
                  if (anchorRef.current) {
                    setMenuPosition(
                      positionTaskContextMenu(
                        anchorRef.current.getBoundingClientRect(),
                        { estimatedHeight: 200 },
                      ),
                    );
                  }
                  setMenuOpen((value) => !value);
                }}
              >
                <MoreHorizontal strokeWidth={1.75} />
              </button>
            </IconHoverTip>
            {props.onCreateTask ? (
              <IconHoverTip label={t("session.new_task_in_space")}>
                <button
                  type="button"
                  className={cn(TASK_ROW_ACTION_CLASS, "text-dls-text/50")}
                  aria-label={t("session.new_task_in_space")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    props.onCreateTask?.(props.directory);
                  }}
                >
                  <MessageCirclePlus strokeWidth={1.75} />
                </button>
              </IconHoverTip>
            ) : null}
            {props.onArchiveDirectory ? (
              <IconHoverTip label={t("session.archive_space")}>
                <button
                  type="button"
                  className={cn(TASK_ROW_ARCHIVE_CHIP_CLASS, "text-dls-text/50")}
                  aria-label={t("session.archive_space")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    props.onArchiveDirectory?.(props.directory);
                  }}
                >
                  <Archive strokeWidth={1.75} />
                </button>
              </IconHoverTip>
            ) : null}
          </div>
        }
      />
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
                props.onTogglePinned?.(props.directory);
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
          {props.onArchiveDirectory ? (
            <button
              type="button"
              className={TASK_CONTEXT_MENU_ITEM_CLASS}
              onClick={() => {
                setMenuOpen(false);
                props.onArchiveDirectory?.(props.directory);
              }}
            >
              <Archive strokeWidth={1.75} />
              {t("session.archive_space")}
            </button>
          ) : null}
          {props.onRemoveFromList ? (
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
                  props.onRemoveFromList?.(props.directory);
                }}
              >
                <Trash2 strokeWidth={1.75} />
                {t("session.remove_from_space_list")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** Scheduled-task group row — clock icon + ⋯ / pin / archive actions. */
function AutomationGroupRow(props: {
  title: string;
  groupId: string;
  expanded: boolean;
  pinned?: boolean;
  onToggle: () => void;
  onTogglePinned?: (groupId: string) => void;
  onArchive?: (groupId: string) => void;
  onDelete?: (groupId: string) => void;
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
    const anchor = anchorRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    setMenuPosition(
      positionTaskContextMenu(anchor, {
        width: menu.offsetWidth || TASK_CONTEXT_MENU_WIDTH,
        estimatedHeight: menu.offsetHeight || 180,
      }),
    );
  }, [menuOpen]);

  return (
    <>
      <FolderRowShell
        title={props.title}
        expanded={props.expanded}
        onToggle={props.onToggle}
        className={cn(menuOpen && "bg-dls-list-hover text-dls-text")}
        icon={
          <CalendarClock
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
            {hasMenu ? (
              <IconHoverTip label={t("session.task_actions")}>
                <button
                  ref={anchorRef}
                  type="button"
                  className={cn(TASK_ROW_ACTION_CLASS, "text-dls-text/50")}
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
                      : "text-dls-text/50",
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
                  className={cn(TASK_ROW_ARCHIVE_CHIP_CLASS, "text-dls-text/50")}
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
        }
      />
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
                  props.onDelete?.(props.groupId);
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

/** WorkBuddy folder disclosure: soft pill "show more (n)" / "collapse" — same h-8 as tasks. */
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

function pinOwnsSession(
  pin: AssistantGlobalPin,
  selectedSessionId: string | null,
  groupsBySessionId: Map<string, AgentConversationGroup>,
  spaceItemsByDirectory: Map<string, AgentConversationGroup[]>,
  automationItemsById: Map<string, AgentConversationGroup[]>,
): boolean {
  if (!selectedSessionId) return false;
  if (pin.kind === "session") {
    const group = groupsBySessionId.get(pin.id);
    return group ? assistantTaskSelected(group, selectedSessionId) : false;
  }
  if (pin.kind === "automation") {
    return groupIncludesSession(
      automationItemsById.get(pin.id) ?? [],
      selectedSessionId,
    );
  }
  return groupIncludesSession(
    spaceItemsByDirectory.get(pin.id) ?? [],
    selectedSessionId,
  );
}

export function AssistantConversationSections(
  props: AssistantConversationSectionsProps,
) {
  // Recent open by default; spaces open; automations collapsed.
  // Selection still forces its owning section open.
  const [expandedSections, setExpandedSections] = useState<
    Record<SectionId, boolean>
  >({
    pinned: true,
    recent: true,
    spaces: true,
    automations: false,
  });
  const [showAllBySection, setShowAllBySection] = useState<
    Record<SectionId, boolean>
  >({
    pinned: false,
    recent: false,
    spaces: false,
    automations: false,
  });
  /** Per space-folder / automation-group: expand beyond FOLDER_TASK_PREVIEW_LIMIT. */
  const [showAllByFolder, setShowAllByFolder] = useState<Record<string, boolean>>(
    {},
  );

  const setFocusedAgent = useExpertUnreadStore((state) => state.setFocusedAgent);

  // Keep unread cursor in sync with the open assistant task (clears blue dot).
  useEffect(() => {
    const sessionId = props.selectedSessionId?.trim() || null;
    const scopeId = sessionId
      ? resolveUnreadAgentIdForSession(sessionId)
      : null;
    setFocusedAgent(props.workspaceId, scopeId);
  }, [props.selectedSessionId, props.workspaceId, setFocusedAgent]);

  const {
    globalPins,
    groupsBySessionId,
    spaceItemsByDirectory,
    spaceFolders,
    recentGroups,
    folderPathBySessionId,
    spaceLocalPinsByDirectory,
  } = props.listModel;

  const automationGroupsAll =
    props.automationGroupsAll ?? props.automationGroups;
  const automationLocalPinsById = props.automationLocalPinsById ?? {};
  const automationItemsById = useMemo(() => {
    const map = new Map<string, AgentConversationGroup[]>();
    for (const group of automationGroupsAll) {
      map.set(group.id, group.items);
    }
    return map;
  }, [automationGroupsAll]);
  const automationGroupById = useMemo(() => {
    const map = new Map<
      string,
      AssistantAutomationGroup<AgentConversationGroup>
    >();
    for (const group of automationGroupsAll) {
      map.set(group.id, group);
    }
    return map;
  }, [automationGroupsAll]);

  const pinnedCount = globalPins.length;
  const recentCount = recentGroups.length;
  const spacesCount = spaceFolders.reduce(
    (count, folder) => count + folder.items.length,
    0,
  );
  const spaceDirectoryCount = spaceFolders.length;
  const allSpaceDirectoriesExpanded =
    spaceDirectoryCount > 0 &&
    spaceFolders.every((folder) =>
      props.expandedDirectories.includes(folder.directory),
    );
  const allSpaceDirectories = Array.from(spaceItemsByDirectory.keys());
  const automationsCount = props.automationGroups.reduce(
    (count, group) => count + group.items.length,
    0,
  );
  const automationGroupCount = props.automationGroups.length;
  const allAutomationGroupsExpanded =
    automationGroupCount > 0 &&
    props.automationGroups.every((group) =>
      props.expandedAutomationDirectories.includes(group.id),
    );

  // Keep the section that owns the selected session expanded.
  useEffect(() => {
    const selected = props.selectedSessionId;
    if (!selected) return;

    if (
      globalPins.some((pin) =>
        pinOwnsSession(
          pin,
          selected,
          groupsBySessionId,
          spaceItemsByDirectory,
          automationItemsById,
        ),
      )
    ) {
      setExpandedSections((current) =>
        current.pinned ? current : { ...current, pinned: true },
      );
      return;
    }
    if (groupIncludesSession(recentGroups, selected)) {
      setExpandedSections((current) =>
        current.recent ? current : { ...current, recent: true },
      );
      return;
    }
    if (
      spaceFolders.some((folder) =>
        groupIncludesSession(folder.items, selected),
      )
    ) {
      setExpandedSections((current) =>
        current.spaces ? current : { ...current, spaces: true },
      );
      return;
    }
    if (
      groupIncludesSession(
        automationGroupsAll.flatMap((group) => group.items),
        selected,
      )
    ) {
      setExpandedSections((current) =>
        current.automations ? current : { ...current, automations: true },
      );
    }
  }, [
    automationGroupsAll,
    automationItemsById,
    globalPins,
    groupsBySessionId,
    props.selectedSessionId,
    recentGroups,
    spaceFolders,
    spaceItemsByDirectory,
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

  const showAllRecent = showAllBySection.recent;
  const visibleRecentGroups =
    showAllRecent || recentGroups.length <= RECENT_PREVIEW_LIMIT
      ? recentGroups
      : recentGroups.slice(0, RECENT_PREVIEW_LIMIT);
  const recentOverflow = recentGroups.length > RECENT_PREVIEW_LIMIT;

  // Codex-style pin reorder: whole-row drag + blue insertion line.
  const dragPinFromRef = useRef<number | null>(null);
  const [pinDragFrom, setPinDragFrom] = useState<number | null>(null);
  const [pinDropSlot, setPinDropSlot] = useState<number | null>(null);

  const clearPinDrag = () => {
    dragPinFromRef.current = null;
    setPinDragFrom(null);
    setPinDropSlot(null);
  };

  const handlePinDragStart = (pinIndex: number, event: DragEvent) => {
    if (!props.onReorderGlobalPins) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("button, a, input, textarea, [data-no-drag]")
    ) {
      event.preventDefault();
      return;
    }
    dragPinFromRef.current = pinIndex;
    setPinDragFrom(pinIndex);
    try {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(pinIndex));
    } catch {
      // ignore
    }
  };

  const handlePinDragOver = (pinIndex: number, event: DragEvent) => {
    if (dragPinFromRef.current === null || !props.onReorderGlobalPins) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const slot = dropSlotFromEvent(event, pinIndex, globalPins.length);
    setPinDropSlot((current) => (current === slot ? current : slot));
  };

  const handlePinDrop = (pinIndex: number, event: DragEvent) => {
    event.preventDefault();
    const from = dragPinFromRef.current;
    const slot =
      pinDropSlot ?? dropSlotFromEvent(event, pinIndex, globalPins.length);
    clearPinDrag();
    if (from === null || !props.onReorderGlobalPins) return;
    const to = dropSlotToIndex(from, slot);
    if (to === from) return;
    props.onReorderGlobalPins(from, to);
  };

  const renderPinRow = (pin: AssistantGlobalPin, pinIndex: number) => {
    const isDragging = pinDragFrom === pinIndex;
    const dragProps = props.onReorderGlobalPins
      ? {
          draggable: true as const,
          onDragStart: (event: DragEvent) =>
            handlePinDragStart(pinIndex, event),
          onDragOver: (event: DragEvent) => handlePinDragOver(pinIndex, event),
          onDrop: (event: DragEvent) => handlePinDrop(pinIndex, event),
          onDragEnd: () => clearPinDrag(),
        }
      : {};

    if (pin.kind === "session") {
      const group = groupsBySessionId.get(pin.id);
      if (!group) return null;
      return (
        <div
          key={`pin-session:${pin.id}`}
          className={cn(
            "relative",
            props.onReorderGlobalPins && "cursor-grab active:cursor-grabbing",
            isDragging && "opacity-40",
          )}
          {...dragProps}
        >
          <AssistantTaskRows
            groups={[group]}
            workspaceId={props.workspaceId}
            selectedSessionId={props.selectedSessionId}
            sessionStatusById={props.sessionStatusById}
            pinned
            singleLine
            folderPathBySessionId={folderPathBySessionId}
            onOpenSession={props.onOpenSession}
            onPrefetchSession={props.onPrefetchSession}
            onTogglePinned={props.onTogglePinned}
            onRenameSession={props.onRenameSession}
            onArchiveSession={props.onArchiveSession}
            onDeleteSession={props.onDeleteSession}
            onOpenFolder={props.onOpenFolder}
            onSaveToSpace={props.onSaveToSpace}
          />
        </div>
      );
    }

    if (pin.kind === "automation") {
      const autoGroup = automationGroupById.get(pin.id);
      if (!autoGroup) return null;
      const groupLabel = t("automation.session_group_title", {
        title: autoGroup.title,
      });
      const expandedAuto =
        props.expandedAutomationDirectories.includes(pin.id);
      return (
        <div
          key={`pin-automation:${pin.id}`}
          className={cn(
            "relative flex flex-col gap-0.5",
            props.onReorderGlobalPins && "cursor-grab active:cursor-grabbing",
            isDragging && "opacity-40",
          )}
          {...dragProps}
        >
          <AutomationGroupRow
            title={groupLabel}
            groupId={pin.id}
            expanded={expandedAuto}
            pinned
            onToggle={() =>
              props.onExpandedAutomationDirectoriesChange((current) =>
                current.includes(pin.id)
                  ? current.filter((item) => item !== pin.id)
                  : [...current, pin.id],
              )
            }
            onTogglePinned={props.onToggleAutomationGroupPinned}
            onArchive={props.onArchiveAutomationGroup}
            onDelete={
              props.onDeleteAutomationGroup
                ? () =>
                    props.onDeleteAutomationGroup?.({
                      groupId: pin.id,
                      title: autoGroup.title,
                      sessionIds: autoGroup.items.map(
                        (item) => item.latestSession.id,
                      ),
                    })
                : undefined
            }
          />
          {expandedAuto ? (
            <FolderChildren>
              <AssistantTaskRows
                groups={autoGroup.items}
                workspaceId={props.workspaceId}
                selectedSessionId={props.selectedSessionId}
                sessionStatusById={props.sessionStatusById}
                singleLine
                pinnable
                pinnedSessionIds={
                  new Set(automationLocalPinsById[pin.id] ?? [])
                }
                folderPathBySessionId={folderPathBySessionId}
                onOpenSession={props.onOpenSession}
                onPrefetchSession={props.onPrefetchSession}
                onTogglePinned={props.onTogglePinned}
                onRenameSession={props.onRenameSession}
                onArchiveSession={props.onArchiveSession}
                onDeleteSession={props.onDeleteSession}
                onOpenFolder={props.onOpenFolder}
              />
            </FolderChildren>
          ) : null}
        </div>
      );
    }

    const items = spaceItemsByDirectory.get(pin.id) ?? [];
    const name = assistantDirectoryName(pin.id);
    return (
      <div
        key={`pin-folder:${pin.id}`}
        className={cn(
          "relative flex flex-col gap-0.5",
          props.onReorderGlobalPins && "cursor-grab active:cursor-grabbing",
          isDragging && "opacity-40",
        )}
        {...dragProps}
      >
        <SpaceDirectoryRow
          name={name}
          directory={pin.id}
          expanded={props.expandedDirectories.includes(pin.id)}
          pinned
          sessionCount={items.length}
          onToggle={() =>
            props.onExpandedDirectoriesChange((current) =>
              current.includes(pin.id)
                ? current.filter((item) => item !== pin.id)
                : [...current, pin.id],
            )
          }
          onTogglePinned={props.onToggleFolderPinned}
          onOpenFolder={props.onOpenFolder}
          onArchiveDirectory={props.onArchiveSpaceDirectory}
          onRemoveFromList={props.onRemoveSpaceDirectory}
          onCreateTask={props.onCreateTaskInDirectory}
        />
        {props.expandedDirectories.includes(pin.id) ? (
          <FolderChildren>
            <AssistantTaskRows
              groups={items}
              workspaceId={props.workspaceId}
              selectedSessionId={props.selectedSessionId}
              sessionStatusById={props.sessionStatusById}
              singleLine
              pinnedSessionIds={
                new Set(spaceLocalPinsByDirectory[pin.id] ?? [])
              }
              folderPath={pin.id}
              folderPathBySessionId={folderPathBySessionId}
              onOpenSession={props.onOpenSession}
              onPrefetchSession={props.onPrefetchSession}
              onTogglePinned={props.onTogglePinned}
              onRenameSession={props.onRenameSession}
              onArchiveSession={props.onArchiveSession}
              onDeleteSession={props.onDeleteSession}
              onOpenFolder={props.onOpenFolder}
              onSaveToSpace={props.onSaveToSpace}
            />
          </FolderChildren>
        ) : null}
      </div>
    );
  };

  const emptyTasksLabel =
    props.categoryId === "code"
      ? t("session.no_code_tasks")
      : t("session.no_tasks");

  return (
    <TooltipProvider delay={200}>
      <div
        className="mt-1 flex flex-col gap-0.5 pt-1"
        data-assistant-task-list="true"
      >
        {/* Global pins — sessions + folders; Codex-style drag insert line */}
        {pinnedCount > 0 ? (
          <div
            data-assistant-section="pinned"
            className="flex flex-col gap-0.5"
          >
            <SectionHeader
              label={t("session.pinned_section")}
              expanded={expandedSections.pinned}
              onToggle={() => toggleSection("pinned")}
              quiet
            />
            {expandedSections.pinned ? (
              <div
                className="flex flex-col gap-0.5 pb-1"
                onDragLeave={(event) => {
                  if (
                    event.currentTarget.contains(event.relatedTarget as Node)
                  ) {
                    return;
                  }
                  setPinDropSlot(null);
                }}
              >
                {globalPins.map((pin, pinIndex) => (
                  <div key={`${pin.kind}:${pin.id}`}>
                    {pinDragFrom !== null && pinDropSlot === pinIndex ? (
                      <PinDropIndicator />
                    ) : null}
                    {renderPinRow(pin, pinIndex)}
                  </div>
                ))}
                {pinDragFrom !== null && pinDropSlot === globalPins.length ? (
                  <PinDropIndicator />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Recent — unpinned non-space sessions (single list; no separate tasks) */}
        <div data-assistant-section="recent" className="flex flex-col gap-0.5">
          <SectionHeader
            label={t("session.recent_section")}
            expanded={expandedSections.recent}
            onToggle={() => toggleSection("recent")}
            quiet
          />
          {expandedSections.recent ? (
            <div className="flex flex-col gap-0.5 pb-1">
              {recentCount === 0 ? (
                <AssistantListEmptyState label={emptyTasksLabel} />
              ) : (
                <>
                  <AssistantTaskRows
                    groups={visibleRecentGroups}
                    workspaceId={props.workspaceId}
                    selectedSessionId={props.selectedSessionId}
                    sessionStatusById={props.sessionStatusById}
                    singleLine
                    folderPathBySessionId={folderPathBySessionId}
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
                    overflow={recentOverflow}
                    showAll={showAllRecent}
                    hiddenCount={recentCount - RECENT_PREVIEW_LIMIT}
                    onToggle={() => toggleShowAll("recent")}
                  />
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* Spaces — folders not in global pins */}
        <div data-assistant-section="spaces" className="flex flex-col gap-0.5">
          <SectionHeader
            label={t("session.task_filter_space_tasks")}
            expanded={expandedSections.spaces}
            onToggle={() => toggleSection("spaces")}
            quiet
            trailing={
              spacesCount > 0 || spaceDirectoryCount > 0 ? (
                <IconHoverTip
                  label={
                    allSpaceDirectoriesExpanded
                      ? t("session.collapse_all_spaces")
                      : t("session.expand_all_spaces")
                  }
                >
                  <button
                    type="button"
                    className={cn(
                      TASK_ROW_ACTION_CLASS,
                      "opacity-0 transition-opacity group-hover/section:opacity-100",
                      expandedSections.spaces && "opacity-100",
                    )}
                    aria-label={
                      allSpaceDirectoriesExpanded
                        ? t("session.collapse_all_spaces")
                        : t("session.expand_all_spaces")
                    }
                    onClick={(event) => {
                      event.stopPropagation();
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
                      props.onExpandedDirectoriesChange(() =>
                        spaceFolders.map((folder) => folder.directory),
                      );
                    }}
                  >
                    {allSpaceDirectoriesExpanded ? (
                      <Minimize2 strokeWidth={1.75} />
                    ) : (
                      <Maximize2 strokeWidth={1.75} />
                    )}
                  </button>
                </IconHoverTip>
              ) : null
            }
          />
          {expandedSections.spaces ? (
            <div className="flex flex-col gap-0.5 pb-1">
              {spaceDirectoryCount === 0 ? (
                <AssistantListEmptyState label={t("session.no_space_tasks")} />
              ) : (
                <SpaceFolderDragList
                  folders={spaceFolders}
                  workspaceId={props.workspaceId}
                  selectedSessionId={props.selectedSessionId}
                  sessionStatusById={props.sessionStatusById}
                  expandedDirectories={props.expandedDirectories}
                  folderPathBySessionId={folderPathBySessionId}
                  showAllByFolder={showAllByFolder}
                  allSpaceDirectories={allSpaceDirectories}
                  onExpandedDirectoriesChange={
                    props.onExpandedDirectoriesChange
                  }
                  onToggleFolderPinned={props.onToggleFolderPinned}
                  onReorderSpaceFolders={props.onReorderSpaceFolders}
                  onOpenFolder={props.onOpenFolder}
                  onArchiveDirectory={props.onArchiveSpaceDirectory}
                  onRemoveFromList={props.onRemoveSpaceDirectory}
                  onCreateTask={props.onCreateTaskInDirectory}
                  onOpenSession={props.onOpenSession}
                  onPrefetchSession={props.onPrefetchSession}
                  onTogglePinned={props.onTogglePinned}
                  onRenameSession={props.onRenameSession}
                  onArchiveSession={props.onArchiveSession}
                  onDeleteSession={props.onDeleteSession}
                  onSaveToSpace={props.onSaveToSpace}
                  onToggleShowAllFolder={toggleShowAllFolder}
                />
              )}
            </div>
          ) : null}
        </div>

        {/* Schedules */}
        <div
          data-assistant-section="automations"
          className="flex flex-col gap-0.5"
        >
          <SectionHeader
            label={t("session.task_filter_automation_tasks")}
            expanded={expandedSections.automations}
            onToggle={() => toggleSection("automations")}
            quiet
            trailing={
              automationsCount > 0 ? (
                <IconHoverTip
                  label={
                    allAutomationGroupsExpanded
                      ? t("session.collapse_all_automations")
                      : t("session.expand_all_automations")
                  }
                >
                  <button
                    type="button"
                    className={cn(
                      TASK_ROW_ACTION_CLASS,
                      "opacity-0 transition-opacity group-hover/section:opacity-100",
                      expandedSections.automations && "opacity-100",
                    )}
                    aria-label={
                      allAutomationGroupsExpanded
                        ? t("session.collapse_all_automations")
                        : t("session.expand_all_automations")
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!expandedSections.automations) {
                        setExpandedSections((current) => ({
                          ...current,
                          automations: true,
                        }));
                      }
                      if (allAutomationGroupsExpanded) {
                        props.onExpandedAutomationDirectoriesChange(() => []);
                        return;
                      }
                      const allIds = props.automationGroups.map(
                        (group) => group.id,
                      );
                      props.onExpandedAutomationDirectoriesChange(
                        () => allIds,
                      );
                    }}
                  >
                    {allAutomationGroupsExpanded ? (
                      <Minimize2 strokeWidth={1.75} />
                    ) : (
                      <Maximize2 strokeWidth={1.75} />
                    )}
                  </button>
                </IconHoverTip>
              ) : null
            }
          />
          {expandedSections.automations ? (
            <div className="flex flex-col gap-0.5 pb-1">
              {automationsCount === 0 ? (
                <AssistantListEmptyState
                  label={t("session.no_automation_tasks")}
                />
              ) : (
                props.automationGroups.map((group) => {
                  const expandedAuto =
                    props.expandedAutomationDirectories.includes(group.id);
                  const groupLabel = t("automation.session_group_title", {
                    title: group.title,
                  });
                  return (
                    <div key={group.id} className="flex flex-col gap-0.5">
                      <AutomationGroupRow
                        title={groupLabel}
                        groupId={group.id}
                        expanded={expandedAuto}
                        onToggle={() =>
                          props.onExpandedAutomationDirectoriesChange(
                            (current) =>
                              current.includes(group.id)
                                ? current.filter((item) => item !== group.id)
                                : [...current, group.id],
                          )
                        }
                        onTogglePinned={props.onToggleAutomationGroupPinned}
                        onArchive={props.onArchiveAutomationGroup}
                        onDelete={
                          props.onDeleteAutomationGroup
                            ? () =>
                                props.onDeleteAutomationGroup?.({
                                  groupId: group.id,
                                  title: group.title,
                                  sessionIds: group.items.map(
                                    (item) => item.latestSession.id,
                                  ),
                                })
                            : undefined
                        }
                      />
                      {expandedAuto ? (
                        <FolderChildren>
                          {(() => {
                            const folderKey = `auto:${group.id}`;
                            const showAll =
                              showAllByFolder[folderKey] === true;
                            const items = group.items;
                            const visibleItems =
                              showAll ||
                              items.length <= FOLDER_TASK_PREVIEW_LIMIT
                                ? items
                                : items.slice(0, FOLDER_TASK_PREVIEW_LIMIT);
                            return (
                              <>
                                <AssistantTaskRows
                                  groups={visibleItems}
                                  workspaceId={props.workspaceId}
                                  selectedSessionId={props.selectedSessionId}
                                  sessionStatusById={props.sessionStatusById}
                                  singleLine
                                  pinnable
                                  pinnedSessionIds={
                                    new Set(
                                      automationLocalPinsById[group.id] ?? [],
                                    )
                                  }
                                  folderPathBySessionId={folderPathBySessionId}
                                  onOpenSession={props.onOpenSession}
                                  onPrefetchSession={props.onPrefetchSession}
                                  onTogglePinned={props.onTogglePinned}
                                  onRenameSession={props.onRenameSession}
                                  onArchiveSession={props.onArchiveSession}
                                  onDeleteSession={props.onDeleteSession}
                                  onOpenFolder={props.onOpenFolder}
                                  // Scheduled runs stay in automation history —
                                  // do not offer "save to space" from this list.
                                />
                                <FolderTaskShowMore
                                  total={items.length}
                                  showAll={showAll}
                                  onToggle={() =>
                                    toggleShowAllFolder(folderKey)
                                  }
                                />
                              </>
                            );
                          })()}
                        </FolderChildren>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}
