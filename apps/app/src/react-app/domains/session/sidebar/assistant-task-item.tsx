/** @jsxImportSource react */
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { cn } from "@/lib/utils";
import { t } from "../../../../i18n";
import {
  formatConversationTime,
  type AgentConversationGroup,
} from "./conversation-model";
import { resolveOpenFolderPath } from "../../shared";

/**
 * WorkBuddy-style task context menu chrome.
 * surface-solid: opaque on macOS Electron glass (bg-dls-surface is translucent).
 */
export const TASK_CONTEXT_MENU_CLASS =
  "fixed z-[100] min-w-[11.5rem] overflow-hidden rounded-2xl border border-dls-border/70 bg-dls-surface-solid p-1.5 text-sm text-dls-text shadow-[0_10px_30px_rgba(15,23,42,0.12)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.45)]";

export const TASK_CONTEXT_MENU_SEPARATOR_CLASS =
  "my-1 h-px bg-dls-border/80";

/** Quiet outline row — icon + label, soft hover wash (matches reference). */
export const TASK_CONTEXT_MENU_ITEM_CLASS =
  "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-normal text-dls-text outline-none transition-colors hover:bg-dls-surface-muted focus-visible:bg-dls-surface-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-dls-secondary";

/**
 * Row hover actions — plain button (not Button primitive) so icon chrome
 * (size/padding/baseline) never fights the fixed 24×24 flex center box.
 */
export const TASK_ROW_ACTION_CLASS =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 leading-none text-dls-secondary outline-none transition-colors hover:text-dls-text focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:pointer-events-none [&_svg]:block [&_svg]:size-3.5 [&_svg]:shrink-0";

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
  /** Bind this task to a project folder (appears under 空间). */
  onSaveToSpace?: (sessionId: string) => void;
};

export function AssistantTaskItem(props: AssistantTaskItemProps) {
  const latestSession = props.group.latestSession;
  const pinnable = props.pinnable ?? true;
  const openFolderPath = resolveOpenFolderPath(props.folderPath);
  const summaryTime = formatConversationTime(
    latestSession.time?.updated ?? latestSession.time?.created,
  );
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

  const singleLine = props.singleLine === true;

  return (
    <div
      className={cn(
        "group flex w-full gap-1 rounded-md px-2 transition-colors",
        singleLine
          ? // Match LIST_ROW_H in assistant-conversation-sections (strict 32px).
            "h-8 min-h-8 max-h-8 shrink-0 items-center overflow-hidden py-0"
          : "items-start py-1.5",
        props.selected
          ? "bg-dls-list-selected text-dls-text"
          : "text-dls-text hover:bg-dls-list-hover",
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
        {!singleLine && props.group.preview ? (
          <span className="w-full truncate text-xs font-normal leading-4 text-dls-secondary">
            {props.group.preview}
          </span>
        ) : null}
      </Button>
      {/*
        WorkBuddy idle: always show relative time (pin state is the 置顶任务 section).
        Hover: ⋯ / archive / pin — pin stays accent when already pinned (unpin).
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
        <span
          className={cn(
            "tabular-nums text-xs font-normal leading-none text-dls-secondary/55",
            !singleLine && "leading-5",
          )}
        >
          {summaryTime}
        </span>
      </div>
      <div
        className={cn(
          "hidden shrink-0 items-center justify-end gap-0 group-hover:flex",
          singleLine ? "h-8 self-center" : "self-start",
          menuOpen && "flex",
        )}
      >
        <button
          ref={anchorRef}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (anchorRef.current) {
              const rect = anchorRef.current.getBoundingClientRect();
              setMenuPosition({ left: rect.right - 176, top: rect.bottom + 4 });
            }
            setMenuOpen((value) => !value);
          }}
          className={TASK_ROW_ACTION_CLASS}
          title={t("session.task_actions")}
          aria-label={t("session.task_actions")}
        >
          <MoreHorizontal strokeWidth={1.75} />
        </button>
        {props.onArchiveSession ? (
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
            className={TASK_ROW_ACTION_CLASS}
            title={t("session.archive_task")}
            aria-label={t("session.archive_task")}
          >
            <Archive strokeWidth={1.75} />
          </button>
        ) : null}
        {pinnable && props.onTogglePinned ? (
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
            title={props.pinned ? t("session.unpin") : t("session.pin")}
            aria-label={props.pinned ? t("session.unpin") : t("session.pin")}
          >
            {props.pinned ? (
              <PinOff strokeWidth={1.75} />
            ) : (
              <Pin strokeWidth={1.75} />
            )}
          </button>
        ) : null}
      </div>

      {menuOpen && menuPosition ? (
        <div
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
