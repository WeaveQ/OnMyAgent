/** @jsxImportSource react */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "../../../../i18n";
import type { AgentConversationGroup } from "./conversation-model";
import type { AssistantSpaceFolder } from "./assistant-list-model";
import {
  assistantTaskSelected,
  dropSlotToIndex,
  reorderSpaceFolderDirectories,
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
import { useExpertUnreadStore } from "../status/expert-unread-store";
import { pickAggregateSessionStatus } from "./utils";

/** Recent list preview before "show more". */
export const RECENT_PREVIEW_LIMIT = 10;
/** Per space/automation folder: show "show more" when children exceed this. */
export const FOLDER_TASK_PREVIEW_LIMIT = 5;

/**
 * Unified sidebar row rhythm (section / folder / task / show-more).
 * Strict fixed height so Chinese text, icons, and hover actions never drift.
 * 34px = prior h-8 (32) + 2px block height (not inter-row gap).
 */
const LIST_ROW_H = "h-[34px] min-h-[34px] max-h-[34px]";
/** Inter-row gap unchanged (2px). */
export const LIST_STACK_GAP = "gap-0.5";
export const LIST_ROW_CLASS = cn(
  "flex w-full shrink-0 items-center overflow-hidden rounded-md px-2",
  "text-sm font-normal leading-none",
  LIST_ROW_H,
);

/** Floating row/section icon → short hover tip (native title is too slow in Electron). */
export function IconHoverTip(props: {
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

/** Insertion slot from a drag-over event on a row (Codex-style half-row split). */
export function dropSlotFromEvent(event: DragEvent, rowIndex: number, count: number): number {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return resolveDropSlot(event.clientY, rect.top, rect.height, rowIndex, count);
}

/** Quiet one-line empty label — same chrome for tasks / spaces / schedules / recent. */
export function AssistantListEmptyState(props: { label: string }) {
  return (
    <div
      className={cn(LIST_ROW_CLASS, "px-2 text-xs text-dls-text-tertiary")}
      data-assistant-list-empty="true"
    >
      <span className="truncate leading-none">{props.label}</span>
    </div>
  );
}

export function AssistantTaskRows(props: {
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
  // Narrow subscribe: only re-render when this workspace's unread slices change.
  const workspaceSessionUnread = useExpertUnreadStore(
    (state) => state.sessionUnreadByWorkspace[props.workspaceId],
  );
  const workspaceAgentUnread = useExpertUnreadStore(
    (state) => state.byWorkspace[props.workspaceId],
  );
  const isSessionUnread = useExpertUnreadStore((state) => state.isSessionUnread);
  void workspaceSessionUnread;
  void workspaceAgentUnread;

  return (
    <>
      {props.groups.map((item) => {
        const unread = item.sessions.some((session) =>
          isSessionUnread(props.workspaceId, session.id),
        );
        const rowPinned =
          props.pinned === true || Boolean(props.pinnedSessionIds?.has(item.latestSession.id));
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
              props.folderPathBySessionId?.get(item.latestSession.id) ?? props.folderPath ?? null
            }
            onOpenSession={props.onOpenSession}
            onPrefetchSession={props.onPrefetchSession}
            onTogglePinned={props.onTogglePinned}
            onRenameSession={props.onRenameSession}
            onArchiveSession={props.onArchiveSession}
            onDeleteSession={props.onDeleteSession}
            onOpenFolder={props.onOpenFolder}
            // Already in a space folder — no "save to space" again.
            onSaveToSpace={props.folderPath?.trim() ? undefined : props.onSaveToSpace}
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
export function PinDropIndicator() {
  return (
    <div className="pointer-events-none relative z-10 my-0.5 h-0 w-full" aria-hidden>
      <div className="absolute inset-x-1 top-0 flex -translate-y-1/2 items-center">
        <span className="size-2 shrink-0 rounded-full border-2 border-dls-accent bg-dls-background" />
        <span className="h-0.5 min-w-0 flex-1 rounded-full bg-dls-accent" />
      </div>
    </div>
  );
}

/** Codex-style drag reorder for space folders (same indicator as global pins). */
export function SpaceFolderDragList(props: {
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
    // Shared pure path with global pins: visible subset + full storage merge
    // (globally pinned folders keep relative slots in allSpaceDirectories).
    const next = reorderSpaceFolderDirectories({
      fullDirectories: props.allSpaceDirectories,
      visibleDirectories: props.folders.map((folder) => folder.directory),
      fromIndex: from,
      toIndex: to,
    });
    props.onReorderSpaceFolders(next);
  };

  return (
    <div
      className={cn("flex flex-col", LIST_STACK_GAP)}
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
            {/*
 Drop target wraps the whole block; only the folder header is
 draggable. Nested task rows must stay outside `draggable` so
 Electron does not swallow open-session clicks.
 */}
            <div
              className={cn("relative flex flex-col", LIST_STACK_GAP, isDragging && "opacity-40")}
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
                const slot = dropSlot ?? dropSlotFromEvent(event, index, count);
                clearDrag();
                if (from === null) return;
                commitReorder(from, slot);
              }}
            >
              <div
                className={cn(canDrag && "cursor-grab active:cursor-grabbing")}
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
              </div>
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
                        <div data-no-drag>
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
                        </div>
                        <FolderTaskShowMore
                          total={items.length}
                          showAll={showAll}
                          onToggle={() => props.onToggleShowAllFolder(directory)}
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

export function SectionHeader(props: {
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
      className={cn(LIST_ROW_CLASS, "group/section gap-0.5 text-dls-secondary")}
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
            <span className="tabular-nums font-normal opacity-80"> ({props.count})</span>
          ) : null}
        </span>
        {props.expanded ? (
          <ChevronDown className="size-3 shrink-0 text-dls-secondary" strokeWidth={2} aria-hidden />
        ) : (
          <ChevronRight
            className="size-3 shrink-0 text-dls-secondary"
            strokeWidth={2}
            aria-hidden
          />
        )}
      </button>
      {props.trailing ? (
        <div className="ml-auto flex h-full max-h-8 shrink-0 items-center">{props.trailing}</div>
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
              className="size-3 shrink-0 text-dls-secondary"
              strokeWidth={2}
              aria-hidden
            />
          ) : (
            <ChevronRight
              className="size-3 shrink-0 text-dls-secondary"
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
export function SpaceDirectoryRow(props: {
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
    typeof props.sessionCount === "number" && props.sessionCount > 0 ? `${props.name}` : props.name;

  return (
    <>
      <FolderRowShell
        title={titleWithCount}
        tooltip={props.directory}
        expanded={props.expanded}
        onToggle={props.onToggle}
        data-assistant-space-directory="true"
        className={cn(menuOpen && "bg-dls-list-hover text-dls-text")}
        icon={<Folder className="size-3.5 shrink-0 text-dls-secondary" strokeWidth={1.6} />}
        trailing={
          <div
            data-no-drag
            className={cn(
              "flex h-full items-center gap-0 opacity-0 transition-opacity group-hover:opacity-100",
              menuOpen && "opacity-100",
            )}
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
                      positionTaskContextMenu(anchorRef.current.getBoundingClientRect(), {
                        estimatedHeight: 200,
                      }),
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
                  className={TASK_ROW_ACTION_CLASS}
                  aria-label={t("session.new_task_in_space")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    props.onCreateTask?.(props.directory);
                  }}
                >
                  <Plus strokeWidth={1.75} />
                </button>
              </IconHoverTip>
            ) : null}
            {props.onArchiveDirectory ? (
              <IconHoverTip label={t("session.archive_space")}>
                <button
                  type="button"
                  className={TASK_ROW_ARCHIVE_CHIP_CLASS}
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
              {props.pinned ? <PinOff strokeWidth={1.75} /> : <Pin strokeWidth={1.75} />}
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
              <div className={TASK_CONTEXT_MENU_SEPARATOR_CLASS} role="separator" />
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

export function SectionShowMore(props: {
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
function FolderTaskShowMore(props: { total: number; showAll: boolean; onToggle: () => void }) {
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
export function FolderChildren(props: { children: ReactNode }) {
  return <div className={cn("ml-5 flex flex-col", LIST_STACK_GAP)}>{props.children}</div>;
}
