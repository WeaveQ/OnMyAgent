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

import { Button } from "@/components/ui/button";
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
import { expertActivityLabel } from "./utils";
import { resolveOpenFolderPath } from "../../shared";

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

/**
 * WorkBuddy-style task context menu chrome.
 * surface-solid: opaque on macOS Electron glass (bg-dls-surface is translucent).
 */
export const TASK_CONTEXT_MENU_CLASS =
  "fixed z-[100] min-w-[11.5rem] overflow-hidden rounded-2xl border border-dls-border/70 bg-dls-surface-solid p-1.5 text-sm text-dls-text shadow-[0_10px_30px_rgba(15,23,42,0.12)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.45)]";

export const TASK_CONTEXT_MENU_SEPARATOR_CLASS =
  "my-1 h-px bg-dls-border/80";

/** Matches `min-w-[11.5rem]` on TASK_CONTEXT_MENU_CLASS. */
export const TASK_CONTEXT_MENU_WIDTH = 184;

/**
 * Place a fixed context menu relative to an anchor.
 * Prefer below; flip above when the remaining viewport space under the
 * anchor is shorter than the menu (and shorter than space above).
 */
export function positionTaskContextMenu(
  anchor: Pick<DOMRect, "top" | "bottom" | "left" | "right">,
  options?: {
    width?: number;
    /** Approximate menu height before measure; default covers ~5 rows. */
    estimatedHeight?: number;
    gap?: number;
    margin?: number;
  },
): { left: number; top: number } {
  const width = options?.width ?? TASK_CONTEXT_MENU_WIDTH;
  const height = options?.estimatedHeight ?? 220;
  const gap = options?.gap ?? 4;
  const margin = options?.margin ?? 8;
  const viewportWidth =
    typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportHeight =
    typeof window !== "undefined" ? window.innerHeight : 800;

  let left = anchor.right - width;
  left = Math.min(
    Math.max(margin, left),
    Math.max(margin, viewportWidth - width - margin),
  );

  const spaceBelow = viewportHeight - anchor.bottom - margin;
  const spaceAbove = anchor.top - margin;
  // Flip up when below cannot fit and above has more room (or enough room).
  const openBelow =
    spaceBelow >= height || (spaceBelow >= spaceAbove && spaceBelow >= 96);

  let top = openBelow
    ? anchor.bottom + gap
    : anchor.top - gap - height;

  top = Math.min(
    Math.max(margin, top),
    Math.max(margin, viewportHeight - height - margin),
  );

  return { left, top };
}

/** Quiet outline row — icon + label, soft hover wash (matches reference). */
export const TASK_CONTEXT_MENU_ITEM_CLASS =
  "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-normal text-dls-text outline-none transition-colors hover:bg-dls-surface-muted focus-visible:bg-dls-surface-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-dls-secondary";

/**
 * Row hover actions — plain button (not Button primitive) so icon chrome
 * (size/padding/baseline) never fights the fixed 24×24 flex center box.
 */
export const TASK_ROW_ACTION_CLASS =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 leading-none text-dls-secondary outline-none transition-colors hover:text-dls-text focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:pointer-events-none [&_svg]:block [&_svg]:size-3.5 [&_svg]:shrink-0";

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
  const activityLabel = expertActivityLabel(props.status);
  const unread = Boolean(props.unread) && !props.selected;
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

  return (
    <div
      className={cn(
        // WorkBuddy task card: soft pill selection, single-line dense row.
        "group relative flex w-full gap-1 rounded-lg px-2 transition-colors",
        singleLine
          ? // Match LIST_ROW_H in assistant-conversation-sections (strict 32px).
            "h-8 min-h-8 max-h-8 shrink-0 items-center overflow-hidden py-0"
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
      <Button
        type="button"
        onClick={() => props.onOpenSession(props.workspaceId, latestSession.id)}
        variant="ghost"
        size={singleLine ? "sm" : "xs"}
        className={cn(
          "min-w-0 flex-1 truncate px-0 text-left hover:bg-transparent",
          singleLine
            ? "h-8 min-h-0 max-h-8 flex-row items-center gap-0 py-0 leading-none"
            : "h-auto flex-col items-start justify-center gap-0.5",
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
      </Button>
      {/*
        WorkBuddy idle: relative time only (pin lives under 置顶任务 section).
        Hover: ⋯ / pin / archive icon — label via tooltip only.
      */}
      <div
        className={cn(
          "shrink-0 group-hover:hidden",
          singleLine
            ? "flex h-8 min-w-[2.75rem] items-center justify-end self-center"
            : "self-start pt-0.5",
          menuOpen && "hidden",
        )}
      >
        {activityLabel && !props.selected ? (
          <span
            className="inline-flex items-center text-dls-accent"
            title={activityLabel}
            aria-label={activityLabel}
          >
            <ExpertStatusDots />
          </span>
        ) : unread ? (
          <span
            className="size-2 shrink-0 rounded-full bg-dls-accent"
            title={t("session.expert_unread")}
            aria-label={t("session.expert_unread")}
          />
        ) : (
          <span
            className={cn(
              "tabular-nums text-xs font-normal leading-none text-dls-secondary/55",
              !singleLine && "leading-5",
            )}
          >
            {summaryTime}
          </span>
        )}
      </div>
      <TooltipProvider delay={200}>
      <div
        className={cn(
          "hidden shrink-0 items-center justify-end gap-0.5 group-hover:flex",
          singleLine ? "h-8 self-center" : "self-start",
          menuOpen && "flex",
        )}
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
