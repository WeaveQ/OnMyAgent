/** @jsxImportSource react */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Mail, MailOpen, MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react";

import { SessionRowButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { t } from "../../../../i18n";
import { expertActivityLabel } from "./utils";
import {
  formatConversationTime,
  type AgentConversationGroup,
  type TaskStatusIndicator,
} from "./conversation-model";
import { ExpertStatusDots } from "./expert-status-dots";
import {
  TASK_CONTEXT_MENU_CLASS,
  TASK_CONTEXT_MENU_ITEM_CLASS,
  TASK_CONTEXT_MENU_SEPARATOR_CLASS,
  TASK_ROW_ACTION_CLASS,
} from "./assistant-task-item";

/** Match local-agent list row typography (`localAgentTextClass` / list subtitle). */
const agentConversationTextClass = {
  itemTitle: "min-w-0 flex-1 truncate text-sm font-medium leading-5 text-dls-text",
  // Tabular time hugs the trailing edge — avoid a dead column beside it.
  itemMeta:
    "shrink-0 tabular-nums text-xs leading-none text-dls-secondary/70",
  itemDescription: "min-w-0 flex-1 truncate text-xs leading-5 text-dls-secondary",
  activity:
    "inline-flex shrink-0 items-center gap-1 text-xs font-medium leading-none text-dls-accent",
};

/** Keep fixed menus fully on-screen (4 rows + separator ≈ 200px). */
const EXPERT_MENU_WIDTH = 184;
const EXPERT_MENU_HEIGHT = 200;

function clampMenuPosition(left: number, top: number) {
  if (typeof window === "undefined") return { left, top };
  const maxLeft = Math.max(8, window.innerWidth - EXPERT_MENU_WIDTH - 8);
  const maxTop = Math.max(8, window.innerHeight - EXPERT_MENU_HEIGHT - 8);
  return {
    left: Math.min(Math.max(8, left), maxLeft),
    top: Math.min(Math.max(8, top), maxTop),
  };
}

function ExpertMenuItem(props: {
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

export function AgentConversationItem(props: {
  group: AgentConversationGroup;
  workspaceId: string;
  selected: boolean;
  status?: string;
  taskStatusVariant: TaskStatusIndicator["variant"];
  /** WeChat-style unread for this expert (hidden while selected). */
  unread?: boolean;
  /** Raw unread for menu mark-read / mark-unread (ignores selected focus). */
  unreadRecord?: boolean;
  unreadCount?: number;
  pinned?: boolean;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onOpenDraftSession?: (sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onTogglePinned?: (agentId: string) => void;
  onMarkUnread?: (agentId: string) => void;
  onMarkRead?: (agentId: string) => void;
  /**
   * Delete this expert row: all non-draft sessions under the agent
   * (confirm + batch delete upstream).
   */
  onDeleteExpert?: (target: {
    agentId: string;
    name: string;
    sessionIds: string[];
  }) => void;
}) {
  const latestSession = props.group.latestSession;
  const isDraftSession = latestSession.id.startsWith("draft:");
  const agentId = props.group.agentId?.trim() ?? "";
  const summaryTime = formatConversationTime(
    latestSession.time?.updated ?? latestSession.time?.created,
  );
  const activityLabel = expertActivityLabel(props.status);
  // Manual 标为未读 keeps the badge while the expert is still open.
  const unread = Boolean(props.unread);
  const unreadRecord = Boolean(props.unreadRecord);
  const unreadCount = Math.max(0, props.unreadCount ?? 0);
  const pinned = Boolean(props.pinned);
  /** Prefer last-message preview (WeChat-style); fall back to expert capability. */
  const subtitle =
    props.group.preview?.trim() || props.group.description;
  const canDeleteExpert = Boolean(props.onDeleteExpert) && Boolean(agentId) && !isDraftSession;
  const hasMenu =
    Boolean(agentId) &&
    !isDraftSession &&
    Boolean(
      props.onTogglePinned ||
        props.onMarkUnread ||
        props.onMarkRead ||
        canDeleteExpert,
    );

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) || moreRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onBlur = () => setMenuOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const openMenuAt = (left: number, top: number) => {
    setMenuPosition(clampMenuPosition(left, top));
    setMenuOpen(true);
  };

  const openMenuFromButton = () => {
    const rect = moreRef.current?.getBoundingClientRect();
    if (!rect) return;
    openMenuAt(rect.right - EXPERT_MENU_WIDTH, rect.bottom + 4);
  };

  const handleDeleteExpert = () => {
    if (!agentId || !props.onDeleteExpert) return;
    setMenuOpen(false);
    const sessionIds = props.group.sessions
      .map((session) => session.id)
      .filter((id) => id.trim() && !id.startsWith("draft:"));
    // Always include latest if list somehow empty but row is real.
    if (sessionIds.length === 0 && !isDraftSession) {
      sessionIds.push(latestSession.id);
    }
    props.onDeleteExpert({
      agentId,
      name: props.group.name,
      sessionIds,
    });
  };

  const openConversation = () => {
    if (isDraftSession) {
      props.onOpenDraftSession?.(latestSession.id);
      return;
    }
    props.onOpenSession(props.workspaceId, latestSession.id);
  };

  const menu =
    menuOpen && menuPosition && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className={cn(TASK_CONTEXT_MENU_CLASS, "z-[200]")}
            data-task-context-menu="true"
            data-expert-row-menu="true"
            style={{ left: menuPosition.left, top: menuPosition.top }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            {props.onTogglePinned && agentId ? (
              <ExpertMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  props.onTogglePinned?.(agentId);
                }}
              >
                {pinned ? (
                  <PinOff strokeWidth={1.75} />
                ) : (
                  <Pin strokeWidth={1.75} />
                )}
                {pinned ? t("session.unpin") : t("session.pin")}
              </ExpertMenuItem>
            ) : null}
            {unreadRecord && props.onMarkRead && agentId ? (
              <ExpertMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  props.onMarkRead?.(agentId);
                }}
              >
                <MailOpen strokeWidth={1.75} />
                {t("session.expert_mark_read")}
              </ExpertMenuItem>
            ) : null}
            {!unreadRecord && props.onMarkUnread && agentId ? (
              <ExpertMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  props.onMarkUnread?.(agentId);
                }}
              >
                <Mail strokeWidth={1.75} />
                {t("session.expert_mark_unread")}
              </ExpertMenuItem>
            ) : null}
            {/* Delete is always last when available — portaled so scroll clip cannot hide it. */}
            {canDeleteExpert ? (
              <>
                <div
                  className={TASK_CONTEXT_MENU_SEPARATOR_CLASS}
                  role="separator"
                />
                <ExpertMenuItem
                  className="text-dls-status-danger hover:bg-dls-status-danger/10 [&_svg]:text-dls-status-danger"
                  onClick={handleDeleteExpert}
                >
                  <Trash2 strokeWidth={1.75} />
                  {t("session.expert_delete_conversation")}
                </ExpertMenuItem>
              </>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      className="group relative"
      onContextMenu={(event) => {
        if (!hasMenu) return;
        event.preventDefault();
        event.stopPropagation();
        openMenuAt(event.clientX, event.clientY);
      }}
    >
      <SessionRowButton
        type="button"
        onClick={openConversation}
        onPointerEnter={() =>
          isDraftSession
            ? undefined
            : props.onPrefetchSession?.(props.workspaceId, latestSession.id)
        }
        onFocus={() =>
          isDraftSession
            ? undefined
            : props.onPrefetchSession?.(props.workspaceId, latestSession.id)
        }
        active={props.selected}
        // Same footprint as local-agent list: h-68 / gap-3 / px-4 (SessionRow default).
      >
        <div className="relative shrink-0">
          {/* size-10 + rounded-md matches AgentBrandIcon size="md". */}
          <div
            className={cn(
              "flex size-10 items-center justify-center overflow-hidden rounded-md text-sm font-medium",
              "bg-dls-surface-muted text-dls-secondary ring-1 ring-dls-border/60",
              "dark:bg-white dark:text-neutral-700 dark:ring-black/10",
            )}
            style={
              props.group.avatarUrl
                ? undefined
                : { backgroundColor: props.group.avatarBackground }
            }
          >
            {props.group.avatarUrl ? (
              <img
                src={props.group.avatarUrl}
                alt=""
                className="size-full object-cover"
                draggable={false}
              />
            ) : (
              props.group.name.charAt(0).toUpperCase() || t("session.agent_initial")
            )}
          </div>
          {unread ? (
            <span
              className={cn(
                "absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1",
                "border-2 border-dls-sidebar bg-dls-status-danger text-2xs font-semibold leading-none text-white",
                props.selected && "border-dls-list-selected",
              )}
              aria-label={t("session.expert_unread_count", {
                count: Math.max(1, unreadCount),
              })}
            >
              {unreadCount > 99 ? "99+" : Math.max(1, unreadCount)}
            </span>
          ) : pinned ? (
            <span
              className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-dls-surface text-dls-accent"
              title={t("session.pin")}
              aria-label={t("session.pin")}
            >
              <Pin className="size-2.5" strokeWidth={2.25} />
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            "min-w-0 flex-1",
            // Only reserve trailing room for ··· while hovering / menu open.
            hasMenu && "group-hover:pe-5",
            menuOpen && "pe-5",
          )}
        >
          <div className="flex min-w-0 items-baseline gap-2">
            <div
              className={cn(
                agentConversationTextClass.itemTitle,
                unread && "font-semibold",
              )}
            >
              {props.group.name}
            </div>
            {/* Busy / time — sits flush right; swaps for ··· on hover. */}
            {activityLabel ? (
              <span
                className={cn(
                  agentConversationTextClass.activity,
                  "ms-auto",
                  hasMenu && !menuOpen && "group-hover:hidden",
                  menuOpen && "hidden",
                )}
                aria-live="polite"
              >
                <span>{activityLabel}</span>
                <ExpertStatusDots />
              </span>
            ) : (
              <div
                className={cn(
                  agentConversationTextClass.itemMeta,
                  "ms-auto",
                  hasMenu && !menuOpen && "group-hover:hidden",
                  menuOpen && "hidden",
                )}
              >
                {summaryTime}
              </div>
            )}
          </div>
          <div className="mt-1 min-w-0 truncate text-xs leading-5 text-dls-secondary">
            <span title={subtitle}>{subtitle}</span>
          </div>
        </div>
      </SessionRowButton>

      {hasMenu ? (
        <button
          ref={moreRef}
          type="button"
          className={cn(
            TASK_ROW_ACTION_CLASS,
            "absolute right-2 top-1/2 z-10 hidden -translate-y-1/2",
            "group-hover:inline-flex",
            menuOpen && "inline-flex",
          )}
          onClick={(event) => {
            event.stopPropagation();
            if (menuOpen) {
              setMenuOpen(false);
              return;
            }
            openMenuFromButton();
          }}
          aria-label={t("session.expert_actions")}
          title={t("session.expert_actions")}
        >
          <MoreHorizontal strokeWidth={1.75} />
        </button>
      ) : null}

      {menu}
    </div>
  );
}
