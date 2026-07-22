/** @jsxImportSource react */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Mail, MailOpen, MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react";

import { SessionRowButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { t } from "../../../../i18n";
import {
  formatConversationTime,
  type AgentConversationGroup,
  type TaskStatusIndicator,
} from "./conversation-model";
import { ExpertStatusDots } from "./expert-status-dots";
import { resolveTaskRowTrailingStatus } from "./task-row-trailing-status";
import {
  TASK_CONTEXT_MENU_CLASS,
  TASK_CONTEXT_MENU_ITEM_CLASS,
  TASK_CONTEXT_MENU_SEPARATOR_CLASS,
  TASK_CONTEXT_MENU_WIDTH,
  TASK_ROW_ACTION_CLASS,
  positionTaskContextMenu,
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
const EXPERT_MENU_HEIGHT = 200;

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
  /** Unread badge for this expert (hidden while selected). */
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
  // Trailing uses shared busy/time rules; unread is title weight for experts.
  const trailing = resolveTaskRowTrailingStatus({
    status: props.status,
    selected: props.selected,
    unread: false,
    timeLabel: summaryTime,
  });
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

  const openMenuAt = (clientX: number, clientY: number) => {
    // Synthetic anchor at cursor so flip/clamp still apply.
    setMenuPosition(
      positionTaskContextMenu(
        {
          top: clientY,
          bottom: clientY,
          left: clientX,
          right: clientX,
        },
        {
          width: TASK_CONTEXT_MENU_WIDTH,
          estimatedHeight: EXPERT_MENU_HEIGHT,
        },
      ),
    );
    setMenuOpen(true);
  };

  const openMenuFromButton = () => {
    const rect = moreRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPosition(
      positionTaskContextMenu(rect, {
        width: TASK_CONTEXT_MENU_WIDTH,
        estimatedHeight: EXPERT_MENU_HEIGHT,
      }),
    );
    setMenuOpen(true);
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
                "border-2 border-dls-sidebar bg-dls-accent text-2xs font-semibold leading-none text-white",
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
            {/* Busy: three-dot pulse (incl. selected active task). Idle: time. */}
            {trailing.kind === "busy" ? (
              <span
                className={cn(
                  "ms-auto inline-flex items-center text-dls-accent",
                  hasMenu && !menuOpen && "group-hover:hidden",
                  menuOpen && "hidden",
                )}
                title={trailing.activityLabel ?? undefined}
                aria-label={trailing.activityLabel ?? undefined}
              >
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
                {trailing.timeLabel}
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
