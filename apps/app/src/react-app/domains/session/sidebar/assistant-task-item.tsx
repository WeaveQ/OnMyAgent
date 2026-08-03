/** @jsxImportSource react */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Archive,
  Box,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";

import {
  positionTaskContextMenu,
  TASK_CONTEXT_MENU_CLASS,
  TASK_CONTEXT_MENU_ITEM_CLASS,
  TASK_CONTEXT_MENU_SEPARATOR_CLASS,
  TASK_CONTEXT_MENU_WIDTH,
  TASK_ROW_ACTION_CLASS,
} from "@/components/ui/sidebar-chrome";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "../../../../i18n";
import {
  formatConversationTime,
  type AgentConversationGroup,
} from "./conversation-model";
import { ExpertStatusDots } from "./expert-status-dots";
import { resolveTaskRowTrailingStatus } from "./task-row-trailing-status";
import { resolveOpenFolderPath } from "../../shared";

// Re-export shared chrome for session sidebar consumers (stable import path).
export {
  positionTaskContextMenu,
  TASK_CONTEXT_MENU_CLASS,
  TASK_CONTEXT_MENU_ITEM_CLASS,
  TASK_CONTEXT_MENU_SEPARATOR_CLASS,
  TASK_CONTEXT_MENU_WIDTH,
  TASK_ROW_ACTION_CLASS,
};

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

/** Archive control: icon-only (same footprint as pin); label via tooltip / aria. */
export const TASK_ROW_ARCHIVE_CHIP_CLASS = TASK_ROW_ACTION_CLASS;

function TaskMenuItem(props: {
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(TASK_CONTEXT_MENU_ITEM_CLASS, props.className)}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

type AssistantTaskItemProps = {
  group: AgentConversationGroup;
  workspaceId: string;
  selected: boolean;
  pinned?: boolean;
  pinnable?: boolean;
  /** Live run status for latest (or any) session under this task. */
  status?: string;
  /**
   * Unread blue dot after a reply finishes while this task is not focused.
   * Hidden while selected / busy (busy shows status dots).
   */
  unread?: boolean;
  /** Bound workspace/folder path for “open folder”; hide action when empty. */
  folderPath?: string | null;
  typeIcon?: React.ReactNode;
  /** Single-line title only (no leading icon chrome, no preview). */
  singleLine?: boolean;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onTogglePinned?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onArchiveSession?: (sessionId: string, title: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onOpenFolder?: (path: string) => void;
  /** Bind this task to a project folder (appears under spaces). */
  onSaveToSpace?: (sessionId: string) => void;
};

export function AssistantTaskItem(props: AssistantTaskItemProps) {
  const latestSession = props.group.latestSession;
  const pinnable = props.pinnable ?? true;
  const openFolderPath = resolveOpenFolderPath(props.folderPath);
  const summaryTime = formatConversationTime(
    latestSession.time?.updated ?? latestSession.time?.created,
  );
  const trailing = resolveTaskRowTrailingStatus({
    status: props.status,
    unread: props.unread,
    selected: props.selected,
    timeLabel: summaryTime,
  });
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

  // After paint, re-place using real menu size so near-bottom rows flip up.
  useLayoutEffect(() => {
    if (!menuOpen || !anchorRef.current || !menuRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    setMenuPosition(
      positionTaskContextMenu(anchor, {
        width: menu.offsetWidth || TASK_CONTEXT_MENU_WIDTH,
        estimatedHeight: menu.offsetHeight || 220,
      }),
    );
  }, [menuOpen]);

  const singleLine = props.singleLine === true;
  const openSession = () => {
    props.onOpenSession(props.workspaceId, latestSession.id);
  };

  return (
    <div
      data-assistant-task-row="true"
      role="button"
      tabIndex={0}
      // Whole-row open: nested Button inside HTML5-draggable ancestors was
      // unreliable in Electron (clicks swallowed). Actions stopPropagation.
      // No data-no-drag on the open surface — pin reorder drags from this row.
      onClick={openSession}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openSession();
        }
      }}
      className={cn(
        // WorkBuddy task card: soft pill selection, single-line dense row.
        "group relative flex w-full cursor-pointer gap-1 rounded-lg px-2 transition-colors mac:titlebar-no-drag",
        singleLine
          ? // Match LIST_ROW_H in assistant-conversation-sections (strict 34px).
            "h-[34px] min-h-[34px] max-h-[34px] shrink-0 items-center overflow-hidden py-0"
          : "items-start py-1.5",
        props.selected
          ? "bg-dls-list-selected/75 text-dls-text"
          : "text-dls-text hover:bg-dls-list-hover/80",
      )}
      onPointerEnter={() =>
        props.onPrefetchSession?.(props.workspaceId, latestSession.id)
      }
    >
      {!singleLine && props.typeIcon ? (
        <span className="shrink-0 text-dls-secondary">{props.typeIcon}</span>
      ) : null}
      <div
        className={cn(
          "min-w-0 flex-1 truncate text-left",
          singleLine
            ? "flex h-8 min-h-0 max-h-8 flex-row items-center gap-0 py-0 leading-none"
            : "flex h-auto flex-col items-start justify-center gap-0.5",
          props.selected ? "font-medium" : "font-normal",
        )}
      >
        <span
          className={cn(
            "block w-full truncate text-sm text-dls-text",
            singleLine ? "leading-none" : "leading-5",
          )}
        >
          {props.group.description}
        </span>
        {/* Two-line preview only when not WorkBuddy single-line mode. */}
        {!singleLine && props.group.preview ? (
          <span className="w-full truncate text-xs font-normal leading-4 text-dls-secondary">
            {props.group.preview}
          </span>
        ) : null}
      </div>
      {/*
        WorkBuddy idle: relative time only (pin lives under 置顶任务 section).
        Hover: ⋯ / pin / archive icon — label via tooltip only.
      */}
      <div
        className={cn(
          "pointer-events-none shrink-0 group-hover:hidden",
          singleLine
            ? "flex h-8 min-w-[2.75rem] items-center justify-end self-center"
            : "self-start pt-0.5",
          menuOpen && "hidden",
        )}
      >
        {trailing.kind === "busy" ? (
          <span
            className="inline-flex items-center text-dls-accent"
            title={trailing.activityLabel ?? undefined}
            aria-label={trailing.activityLabel ?? undefined}
          >
            <ExpertStatusDots />
          </span>
        ) : trailing.kind === "unread" ? (
          <span
            className="size-2 shrink-0 rounded-full bg-dls-accent"
            title={t("session.expert_unread")}
            aria-label={t("session.expert_unread")}
          />
        ) : (
          <span
            className={cn(
              "tabular-nums text-xs font-normal leading-none text-dls-text-tertiary",
              !singleLine && "leading-5",
            )}
          >
            {trailing.timeLabel}
          </span>
        )}
      </div>
      <TooltipProvider delay={200}>
      <div
        data-no-drag
        className={cn(
          "hidden shrink-0 items-center justify-end gap-0.5 group-hover:flex",
          singleLine ? "h-8 self-center" : "self-start",
          menuOpen && "flex",
        )}
        // Keep ⋯ / pin / archive from also opening the session row / starting drag.
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <IconHoverTip label={t("session.task_actions")}>
          <button
            ref={anchorRef}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (anchorRef.current) {
                setMenuPosition(
                  positionTaskContextMenu(
                    anchorRef.current.getBoundingClientRect(),
                  ),
                );
              }
              setMenuOpen((value) => !value);
            }}
            className={TASK_ROW_ACTION_CLASS}
            aria-label={t("session.task_actions")}
          >
            <MoreHorizontal strokeWidth={1.75} />
          </button>
        </IconHoverTip>
        {pinnable && props.onTogglePinned ? (
          <IconHoverTip
            label={props.pinned ? t("session.unpin") : t("session.pin")}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen(false);
                props.onTogglePinned?.(latestSession.id);
              }}
              className={cn(
                TASK_ROW_ACTION_CLASS,
                // Pinned → accent “unpin”; unpinned → quiet secondary “pin”.
                props.pinned
                  ? "text-dls-accent hover:text-dls-accent"
                  : "text-dls-secondary",
              )}
              aria-label={props.pinned ? t("session.unpin") : t("session.pin")}
            >
              {props.pinned ? (
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
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen(false);
                props.onArchiveSession?.(
                  latestSession.id,
                  props.group.description,
                );
              }}
              className={TASK_ROW_ARCHIVE_CHIP_CLASS}
              aria-label={t("session.archive_task")}
            >
              <Archive strokeWidth={1.75} />
            </button>
          </IconHoverTip>
        ) : null}
      </div>
      </TooltipProvider>

      {menuOpen && menuPosition ? (
        <div
          ref={menuRef}
          className={TASK_CONTEXT_MENU_CLASS}
          data-task-context-menu="true"
          style={{ left: menuPosition.left, top: menuPosition.top }}
          onClick={(event) => event.stopPropagation()}
        >
          {openFolderPath && props.onOpenFolder ? (
            <TaskMenuItem
              onClick={() => {
                setMenuOpen(false);
                props.onOpenFolder?.(openFolderPath);
              }}
            >
              <FolderOpen strokeWidth={1.75} />
              {t("session.open_folder")}
            </TaskMenuItem>
          ) : null}
          <TaskMenuItem
            onClick={() => {
              setMenuOpen(false);
              props.onRenameSession?.(
                latestSession.id,
                props.group.description,
              );
            }}
          >
            <Pencil strokeWidth={1.75} />
            {t("session.rename_action")}
          </TaskMenuItem>
          {pinnable && props.onTogglePinned ? (
            <TaskMenuItem
              onClick={() => {
                setMenuOpen(false);
                props.onTogglePinned?.(latestSession.id);
              }}
            >
              {props.pinned ? (
                <PinOff strokeWidth={1.75} />
              ) : (
                <Pin strokeWidth={1.75} />
              )}
              {props.pinned ? t("session.unpin") : t("session.pin")}
            </TaskMenuItem>
          ) : null}
          {props.onArchiveSession ? (
            <TaskMenuItem
              onClick={() => {
                setMenuOpen(false);
                props.onArchiveSession?.(
                  latestSession.id,
                  props.group.description,
                );
              }}
            >
              <Archive strokeWidth={1.75} />
              {t("session.archive_task")}
            </TaskMenuItem>
          ) : null}
          {/* WorkBuddy order: save-to-space sits below archive */}
          {props.onSaveToSpace ? (
            <TaskMenuItem
              onClick={() => {
                setMenuOpen(false);
                props.onSaveToSpace?.(latestSession.id);
              }}
            >
              <Box strokeWidth={1.75} />
              {t("session.save_to_space")}
            </TaskMenuItem>
          ) : null}
          {props.onDeleteSession ? (
            <>
              <div className={TASK_CONTEXT_MENU_SEPARATOR_CLASS} role="separator" />
              <TaskMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  props.onDeleteSession?.(latestSession.id);
                }}
              >
                <Trash2 strokeWidth={1.75} />
                {t("session.delete_task")}
              </TaskMenuItem>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
