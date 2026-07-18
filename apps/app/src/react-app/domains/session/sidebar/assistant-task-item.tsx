/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MenuRowButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { t } from "../../../../i18n";
import {
  formatConversationTime,
  type AgentConversationGroup,
} from "./conversation-model";
import { resolveOpenFolderPath } from "./assistant-archived-tasks";

/** Shared chrome for assistant task + expert strip context menus. */
export const TASK_CONTEXT_MENU_CLASS =
  "fixed z-[100] w-44 overflow-hidden rounded-xl border border-dls-border bg-dls-surface py-1 text-sm";

export const TASK_CONTEXT_MENU_SEPARATOR_CLASS =
  "my-1 h-px bg-dls-border/80";

type AssistantTaskItemProps = {
  group: AgentConversationGroup;
  workspaceId: string;
  selected: boolean;
  pinned?: boolean;
  pinnable?: boolean;
  /** Bound workspace/folder path for “open folder”; hide action when empty. */
  folderPath?: string | null;
  typeIcon?: React.ReactNode;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onTogglePinned?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onArchiveSession?: (sessionId: string, title: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onOpenFolder?: (path: string) => void;
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

  return (
    <div
      className={cn(
        "group flex w-full items-start gap-2 rounded-md px-2 py-1.5 transition-colors",
        props.selected
          ? "bg-dls-list-selected text-dls-text"
          : "text-dls-text hover:bg-dls-list-hover",
      )}
      onPointerEnter={() =>
        props.onPrefetchSession?.(props.workspaceId, latestSession.id)
      }
    >
      {props.typeIcon ? (
        <span className="shrink-0 text-dls-secondary">{props.typeIcon}</span>
      ) : null}
      <Button
        type="button"
        onClick={() => props.onOpenSession(props.workspaceId, latestSession.id)}
        variant="ghost"
        size="xs"
        className={cn(
          "h-auto min-w-0 flex-1 flex-col items-start justify-center gap-0.5 truncate px-0 text-left hover:bg-transparent",
          props.selected ? "font-medium" : "font-normal",
        )}
      >
        <span className="w-full truncate text-sm leading-5 text-dls-text">
          {props.group.description}
        </span>
        {props.group.preview ? (
          <span className="w-full truncate text-xs font-normal leading-4 text-dls-secondary">
            {props.group.preview}
          </span>
        ) : null}
      </Button>
      <div className="shrink-0 self-start pt-0.5 text-xs leading-5 text-dls-text/30 group-hover:hidden">
        {summaryTime}
      </div>
      <Button
        ref={anchorRef}
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={(event) => {
          event.stopPropagation();
          if (anchorRef.current) {
            const rect = anchorRef.current.getBoundingClientRect();
            setMenuPosition({ left: rect.right - 176, top: rect.bottom + 4 });
          }
          setMenuOpen((value) => !value);
        }}
        className="hidden shrink-0 text-dls-secondary group-hover:flex"
        title={t("session.task_actions")}
        aria-label={t("session.task_actions")}
      >
        <MoreHorizontal className="size-4" />
      </Button>

      {menuOpen && menuPosition ? (
        <div
          className={TASK_CONTEXT_MENU_CLASS}
          data-task-context-menu="true"
          style={{ left: menuPosition.left, top: menuPosition.top }}
          onClick={(event) => event.stopPropagation()}
        >
          {pinnable ? (
            <MenuRowButton
              align="start"
              density="compact"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                props.onTogglePinned?.(latestSession.id);
              }}
            >
              {props.pinned ? (
                <PinOff className="size-3.5" />
              ) : (
                <Pin className="size-3.5" />
              )}
              {props.pinned ? t("session.unpin") : t("session.pin")}
            </MenuRowButton>
          ) : null}
          {openFolderPath && props.onOpenFolder ? (
            <MenuRowButton
              align="start"
              density="compact"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                props.onOpenFolder?.(openFolderPath);
              }}
            >
              <FolderOpen className="size-3.5" />
              {t("session.open_folder")}
            </MenuRowButton>
          ) : null}
          <MenuRowButton
            align="start"
            density="compact"
            type="button"
            onClick={() => {
              setMenuOpen(false);
              props.onRenameSession?.(
                latestSession.id,
                props.group.description,
              );
            }}
          >
            <Pencil className="size-3.5" />
            {t("session.rename_action")}
          </MenuRowButton>
          {props.onArchiveSession ? (
            <>
              <div className={TASK_CONTEXT_MENU_SEPARATOR_CLASS} role="separator" />
              <MenuRowButton
                align="start"
                density="compact"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  props.onArchiveSession?.(
                    latestSession.id,
                    props.group.description,
                  );
                }}
              >
                <Archive className="size-3.5" />
                {t("session.archive_task")}
              </MenuRowButton>
            </>
          ) : null}
          {props.onDeleteSession ? (
            <>
              <div className={TASK_CONTEXT_MENU_SEPARATOR_CLASS} role="separator" />
              <MenuRowButton
                align="start"
                density="compact"
                type="button"
                className="text-dls-status-danger-fg hover:bg-dls-status-danger-soft"
                onClick={() => {
                  setMenuOpen(false);
                  props.onDeleteSession?.(latestSession.id);
                }}
              >
                <Trash2 className="size-3.5" />
                {t("session.delete_task")}
              </MenuRowButton>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
