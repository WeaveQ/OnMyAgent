/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MenuRowButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { t } from "../../../../../i18n";
import {
  formatConversationTime,
  type AgentConversationGroup,
} from "./conversation-model";

type AssistantTaskItemProps = {
  group: AgentConversationGroup;
  workspaceId: string;
  selected: boolean;
  pinned?: boolean;
  pinnable?: boolean;
  typeIcon?: React.ReactNode;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onTogglePinned?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onDeleteSession?: (sessionId: string) => void;
};

export function AssistantTaskItem(props: AssistantTaskItemProps) {
  const latestSession = props.group.latestSession;
  const pinnable = props.pinnable ?? true;
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
        "group flex w-full items-center gap-2 rounded-md px-2 py-1 transition-colors",
        props.selected ? "bg-dls-list-selected text-dls-text" : "text-dls-text hover:bg-dls-list-selected",
      )}
      onPointerEnter={() =>
        props.onPrefetchSession?.(props.workspaceId, latestSession.id)
      }
    >
      {props.typeIcon ? (
        <span className="shrink-0 text-dls-secondary">
          {props.typeIcon}
        </span>
      ) : null}
      <Button
        type="button"
        onClick={() => props.onOpenSession(props.workspaceId, latestSession.id)}
        variant="ghost"
        size="xs"
        className="h-auto min-w-0 flex-1 justify-start truncate px-0 text-left text-xs leading-5 hover:bg-transparent"
      >
        {props.group.description}
      </Button>
      <div className="shrink-0 text-xs leading-none text-dls-secondary/75 group-hover:hidden">
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
            setMenuPosition({ left: rect.right - 116, top: rect.bottom + 4 });
          }
          setMenuOpen((value) => !value);
        }}
        className="hidden shrink-0 text-dls-secondary group-hover:flex"
        title="任务操作"
        aria-label="任务操作"
      >
        <MoreHorizontal className="size-4" />
      </Button>

      {menuOpen && menuPosition ? (
        <div
          className="fixed z-[100] w-28 overflow-hidden rounded-xl border border-dls-border bg-dls-surface py-1 text-xs"
          style={{ left: menuPosition.left, top: menuPosition.top }}
          onClick={(event) => event.stopPropagation()}
        >
          {pinnable ? (
            <MenuRowButton
              align="center"
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
          <MenuRowButton
            align="center"
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
          <MenuRowButton
            align="center"
            type="button"
            className="text-dls-status-danger-fg hover:bg-dls-status-danger-soft"
            onClick={() => {
              setMenuOpen(false);
              props.onDeleteSession?.(latestSession.id);
            }}
          >
            <Trash2 className="size-3.5" />
            {t("common.delete")}
          </MenuRowButton>
        </div>
      ) : null}
    </div>
  );
}
