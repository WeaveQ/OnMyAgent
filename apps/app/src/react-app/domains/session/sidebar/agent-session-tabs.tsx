/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Mail,
  MailOpen,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from "lucide-react";
import { useQueries } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SessionRowButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import {
  TASK_CONTEXT_MENU_CLASS,
  TASK_CONTEXT_MENU_ITEM_CLASS,
  TASK_CONTEXT_MENU_SEPARATOR_CLASS,
} from "./assistant-task-item";
import type {
  OnMyAgentServerClient,
  OnMyAgentSessionSnapshot,
} from "../../../../app/lib/onmyagent-server";
import {
  DEFAULT_SESSION_TITLE,
  isGeneratedSessionTitle,
} from "../../../../app/lib/session-title";
import type { WorkspaceSessionGroup } from "../../../../app/types";
import { t } from "../../../../i18n";
import {
  readAgentSessionTabPinnedIds,
  sessionMessagePreview,
  writeAgentSessionTabPinnedIds,
} from "./conversation-model";
import {
  expertActivityLabel,
  isStreamingSessionStatus,
} from "./utils";
import {
  resolveAgentIdForSession,
  useExpertUnreadStore,
} from "../status/expert-unread-store";

function summarizeTabTitle(
  session: WorkspaceSessionGroup["sessions"][number],
  generatedFallback?: string,
) {
  const rawTitle = session.title?.trim() ?? "";
  const defaultTitle = t("session.default_title");
  if (
    rawTitle &&
    rawTitle !== DEFAULT_SESSION_TITLE &&
    rawTitle !== defaultTitle &&
    !isGeneratedSessionTitle(rawTitle)
  ) {
    return rawTitle;
  }
  return compactTabTitle(generatedFallback ?? t("session.agent_tab_summarizing"));
}

function compactTabTitle(input: string) {
  const cleaned = input
    .replace(/\u7528\u6237\u53d1\u9001\u4e86|The user|I should|This is/gi, "")
    .replace(/["""''.。？?！!,，:：；;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const source = cleaned || input.trim() || t("session.agent_tab_new_session");
  return source.length > 10 ? source.slice(0, 10) : source;
}

const TAB_SCROLL_SPEED = 25;
const TAB_VISIBLE_WIDTH = 78;

function SessionTabMarqueeText({ title }: { title: string }) {
  const measureRef = useRef<HTMLSpanElement>(null);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!measureRef.current) return;
    const w = measureRef.current.offsetWidth;
    if (w > TAB_VISIBLE_WIDTH) {
      setDuration(Math.max(3, (w - TAB_VISIBLE_WIDTH) / TAB_SCROLL_SPEED));
    }
  }, [title]);

  return (
    <>
      <span
        ref={measureRef}
        className="pointer-events-none absolute invisible whitespace-nowrap text-xs"
      >
        {title}
      </span>
      {duration <= 0 ? (
        <span className="inline-block">{title}</span>
      ) : (
        <span
          className="inline-block animate-[onmyagent-tab-marquee_linear_infinite]"
          style={{ animationDuration: `${duration}s` }}
        >
          {title}
        </span>
      )}
    </>
  );
}

function summarizeSessionSnapshotForTab(snapshot: OnMyAgentSessionSnapshot) {
  const previews = snapshot.messages
    .map(sessionMessagePreview)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
  if (!previews) return undefined;
  return previews
    .replace(/\u7528\u6237\u53d1\u9001\u4e86|The user|I should|This is/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function AgentSessionTabs(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  selectedSessionId: string | null;
  sessions: WorkspaceSessionGroup["sessions"];
  /** Active expert — used when session→agent binding is missing. */
  agentId?: string | null;
  /** Per-session run status — chip shows busy state when user switches away. */
  sessionStatusById?: Record<string, string>;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onOpenDraftSession?: (sessionId: string) => void;
  onCreateSession: () => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onDeleteSession: (sessionId: string) => void;
  /** Notify parent so title-bar border can hide when the strip is expanded. */
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

  // Parent uses this to drop the title-bar border while the strip is open
  // (one rule only). No sessions ⇒ treat as collapsed so the header keeps a line.
  useEffect(() => {
    if (props.sessions.length === 0) {
      props.onExpandedChange?.(false);
      return;
    }
    props.onExpandedChange?.(expanded);
  }, [expanded, props.onExpandedChange, props.sessions.length]);
  const [menuState, setMenuState] = useState<{
    sessionId: string;
    left: number;
    top: number;
    triggerLeft: number;
    triggerRight: number;
    triggerTop: number;
    triggerBottom: number;
    title: string;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const activeSessionId = pendingSessionId ?? props.selectedSessionId;

  const [pinnedSessionIds, setPinnedSessionIds] = useState(() =>
    readAgentSessionTabPinnedIds(props.workspaceId),
  );
  const byWorkspace = useExpertUnreadStore((state) => state.byWorkspace);
  const sessionUnreadByWorkspace = useExpertUnreadStore(
    (state) => state.sessionUnreadByWorkspace,
  );
  const markUnread = useExpertUnreadStore((state) => state.markUnread);
  const markRead = useExpertUnreadStore((state) => state.markRead);
  const markSessionRead = useExpertUnreadStore((state) => state.markSessionRead);
  const hasUnreadRecord = useExpertUnreadStore((state) => state.hasUnreadRecord);
  const isSessionUnread = useExpertUnreadStore((state) => state.isSessionUnread);

  const resolveTabAgentId = useCallback(
    (sessionId: string) =>
      resolveAgentIdForSession(sessionId) ??
      props.agentId?.trim() ??
      null,
    [props.agentId],
  );

  useEffect(() => {
    setPinnedSessionIds(readAgentSessionTabPinnedIds(props.workspaceId));
  }, [props.workspaceId]);

  const pinnedSet = useMemo(
    () => new Set(pinnedSessionIds),
    [pinnedSessionIds],
  );

  const orderedSessions = useMemo(() => {
    const list = [...props.sessions];
    list.sort((left, right) => {
      const leftPinned = pinnedSet.has(left.id) ? 1 : 0;
      const rightPinned = pinnedSet.has(right.id) ? 1 : 0;
      if (leftPinned !== rightPinned) return rightPinned - leftPinned;
      // Keep relative order among same pin tier (stable-ish via original index).
      const leftIndex = props.sessions.findIndex((s) => s.id === left.id);
      const rightIndex = props.sessions.findIndex((s) => s.id === right.id);
      return leftIndex - rightIndex;
    });
    return list;
  }, [pinnedSet, props.sessions]);

  const snapshotQueries = useQueries({
    queries: orderedSessions.map((session) => ({
      queryKey: [
        "onmyagent-agent-session-tab-snapshot",
        props.workspaceId,
        session.id,
      ],
      enabled: Boolean(props.client) && !session.id.startsWith("draft:"),
      queryFn: async () => {
        const client = props.client;
        if (!client) throw new Error("OnMyAgent server unavailable");
        return (
          await client.getSessionSnapshot(props.workspaceId, session.id, {
            limit: 8,
          })
        ).item;
      },
      staleTime: 5_000,
    })),
  });

  const togglePinSession = useCallback(
    (sessionId: string) => {
      const id = sessionId.trim();
      if (!id || id.startsWith("draft:")) return;
      setPinnedSessionIds((current) => {
        const next = current.includes(id)
          ? current.filter((item) => item !== id)
          : [id, ...current.filter((item) => item !== id)];
        writeAgentSessionTabPinnedIds(props.workspaceId, next);
        return next;
      });
    },
    [props.workspaceId],
  );

  useEffect(() => {
    if (!pendingSessionId) return;
    const fallbackTimer = window.setTimeout(() => {
      setPendingSessionId((current) =>
        current === pendingSessionId ? null : current,
      );
    }, 4_000);
    if (props.selectedSessionId === pendingSessionId) {
      setPendingSessionId(null);
      return () => window.clearTimeout(fallbackTimer);
    }
    if (!props.sessions.some((session) => session.id === pendingSessionId)) {
      setPendingSessionId(null);
    }
    return () => window.clearTimeout(fallbackTimer);
  }, [pendingSessionId, props.selectedSessionId, props.sessions]);

  useEffect(() => {
    if (!activeSessionId || !expanded) return;
    tabRefs.current[activeSessionId]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeSessionId, expanded]);

  useEffect(() => {
    if (!menuState) return undefined;
    const handlePointerMove = (event: PointerEvent) => {
      const rect = menuRef.current?.getBoundingClientRect();
      if (!rect) return;
      const padding = 8;
      const safeLeft = Math.min(rect.left, menuState.triggerLeft) - padding;
      const safeRight = Math.max(rect.right, menuState.triggerRight) + padding;
      const safeTop = Math.min(rect.top, menuState.triggerTop) - padding;
      const safeBottom = Math.max(rect.bottom, menuState.triggerBottom) + padding;
      if (
        event.clientX >= safeLeft &&
        event.clientX <= safeRight &&
        event.clientY >= safeTop &&
        event.clientY <= safeBottom
      ) {
        return;
      }
      setMenuState(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [menuState]);

  // Re-render chips / menu when unread changes.
  void byWorkspace;
  void sessionUnreadByWorkspace;

  const menuAgentId = menuState
    ? resolveTabAgentId(menuState.sessionId)
    : null;
  const menuUnread = menuAgentId
    ? hasUnreadRecord(props.workspaceId, menuAgentId)
    : false;
  const menuSessionUnread = menuState
    ? isSessionUnread(props.workspaceId, menuState.sessionId)
    : false;
  const menuPinned = menuState ? pinnedSet.has(menuState.sessionId) : false;

  if (props.sessions.length === 0) return null;

  return (
    <div
      className={cn(
        "relative shrink-0 bg-dls-background",
        expanded
          ? // Expanded: sole divider under the strip (header border is off).
            "h-11 border-b border-dls-mist px-3"
          : // Collapsed: hang-tab host only; header keeps the single rule.
            "h-0 overflow-visible shadow-none",
      )}
    >
      <style>{`
        @keyframes onmyagent-tab-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(calc(-100% + 78px)); }
        }
      `}</style>
      {expanded ? (
        <div className="flex h-full min-w-0 items-center gap-1.5 overflow-x-auto">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={props.onCreateSession}
            className="h-7 shrink-0 rounded-md border-dls-border bg-transparent px-2.5 text-xs font-medium text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
            title={t("session.agent_tab_new_session_title")}
            aria-label={t("session.agent_tab_new_session_title")}
          >
            <Plus data-icon="inline-start" className="size-3.5" />
            {t("session.new_session")}
          </Button>
          {orderedSessions.map((session, index) => {
            const isDraft = session.id.startsWith("draft:");
            const active = session.id === activeSessionId;
            const generatedFallback = snapshotQueries[index]?.data
              ? summarizeSessionSnapshotForTab(snapshotQueries[index]?.data)
              : undefined;
            const title = isDraft
              ? session.title
              : summarizeTabTitle(session, generatedFallback);
            const sessionStatus = props.sessionStatusById?.[session.id];
            const busy = isStreamingSessionStatus(sessionStatus);
            const activityLabel = expertActivityLabel(sessionStatus);
            const pinned = pinnedSet.has(session.id);
            const sessionUnread = isSessionUnread(
              props.workspaceId,
              session.id,
            );
            const chipTitle = [
              title,
              activityLabel,
              sessionUnread ? t("session.expert_unread") : null,
              pinned ? t("session.pin") : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div
                key={session.id}
                ref={(node) => {
                  tabRefs.current[session.id] = node;
                }}
                className="relative shrink-0"
              >
                <SessionRowButton
                  type="button"
                  size="tab"
                  active={active}
                  muted={isDraft}
                  onClick={() => {
                    setPendingSessionId(session.id);
                    setMenuState(null);
                    // Opening a different session clears that tab’s red dot
                    // (stay if already active — preserves just-marked unread).
                    if (
                      !isDraft &&
                      session.id !== props.selectedSessionId &&
                      sessionUnread
                    ) {
                      markSessionRead(props.workspaceId, session.id);
                    }
                    if (isDraft) props.onOpenDraftSession?.(session.id);
                    else props.onOpenSession(props.workspaceId, session.id);
                  }}
                  title={chipTitle}
                  aria-pressed={active}
                  aria-label={chipTitle}
                  className={cn(
                    // Non-active busy chips stay visible after the user switches sessions.
                    busy &&
                      !active &&
                      "bg-dls-accent/8 text-dls-text ring-1 ring-inset ring-dls-accent/25",
                    pinned &&
                      !busy &&
                      !active &&
                      "ring-1 ring-inset ring-dls-border/80",
                  )}
                >
                  {busy ? (
                    <LoadingSpinner
                      size="sm"
                      className="size-3 shrink-0 border-dls-accent/20 border-t-dls-accent"
                      aria-hidden
                    />
                  ) : pinned ? (
                    <Pin
                      className="size-3 shrink-0 text-dls-accent"
                      strokeWidth={2}
                      aria-hidden
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                    <SessionTabMarqueeText title={title} />
                  </span>
                </SessionRowButton>
                {/* Session chip unread — top-left so it never collides with ··· */}
                {sessionUnread ? (
                  <span
                    className="pointer-events-none absolute -left-0.5 -top-0.5 z-10 size-2 rounded-full bg-dls-status-danger ring-2 ring-dls-background"
                    aria-hidden
                    title={t("session.expert_unread")}
                  />
                ) : null}
                {!isDraft && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={(event) => {
                      event.stopPropagation();
                      const rect =
                        event.currentTarget.getBoundingClientRect();
                      setMenuState((current) =>
                        current?.sessionId === session.id
                          ? null
                          : {
                              sessionId: session.id,
                              left: rect.left - 72,
                              top: rect.bottom + 6,
                              triggerLeft: rect.left,
                              triggerRight: rect.right,
                              triggerTop: rect.top,
                              triggerBottom: rect.bottom,
                              title,
                            },
                      );
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-dls-secondary"
                    title={t("session.agent_tab_actions_title")}
                    aria-label={t("session.agent_tab_actions_title")}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      {menuState ? (
        <div
          ref={menuRef}
          className={TASK_CONTEXT_MENU_CLASS}
          data-task-context-menu="true"
          style={{ left: menuState.left, top: menuState.top }}
          onMouseLeave={() => setMenuState(null)}
          onPointerLeave={() => setMenuState(null)}
        >
          <button
            type="button"
            className={TASK_CONTEXT_MENU_ITEM_CLASS}
            onClick={() => {
              togglePinSession(menuState.sessionId);
              setMenuState(null);
            }}
          >
            {menuPinned ? (
              <PinOff strokeWidth={1.75} />
            ) : (
              <Pin strokeWidth={1.75} />
            )}
            {menuPinned ? t("session.unpin") : t("session.pin")}
          </button>
          {menuAgentId ? (
            menuUnread || menuSessionUnread ? (
              <button
                type="button"
                className={TASK_CONTEXT_MENU_ITEM_CLASS}
                onClick={() => {
                  markRead(props.workspaceId, menuAgentId);
                  setMenuState(null);
                }}
              >
                <MailOpen strokeWidth={1.75} />
                {t("session.expert_mark_read")}
              </button>
            ) : (
              <button
                type="button"
                className={TASK_CONTEXT_MENU_ITEM_CLASS}
                onClick={() => {
                  markUnread(props.workspaceId, menuAgentId, {
                    sessionId: menuState.sessionId,
                  });
                  setMenuState(null);
                }}
              >
                <Mail strokeWidth={1.75} />
                {t("session.expert_mark_unread")}
              </button>
            )
          ) : null}
          <button
            type="button"
            className={TASK_CONTEXT_MENU_ITEM_CLASS}
            onClick={() => {
              props.onRenameSession(menuState.sessionId, menuState.title);
              setMenuState(null);
            }}
          >
            <Pencil strokeWidth={1.75} />
            {t("session.agent_tab_rename")}
          </button>
          <div className={TASK_CONTEXT_MENU_SEPARATOR_CLASS} role="separator" />
          <button
            type="button"
            className={cn(
              TASK_CONTEXT_MENU_ITEM_CLASS,
              "text-dls-status-danger hover:bg-dls-status-danger/10 [&_svg]:text-dls-status-danger",
            )}
            onClick={() => {
              props.onDeleteSession(menuState.sessionId);
              setMenuState(null);
            }}
          >
            <Trash2 strokeWidth={1.75} />
            {t("session.agent_tab_delete")}
          </button>
        </div>
      ) : null}
      <Button
        type="button"
        onClick={() => {
          setExpanded((value) => !value);
          setMenuState(null);
        }}
        variant="ghost"
        size="icon-xs"
        className={cn(
          "absolute bottom-0 left-1/2 z-20 h-2.5 w-14 -translate-x-1/2 translate-y-full overflow-visible rounded-t-none rounded-b-md border-x border-b border-t-0 border-dls-mist bg-dls-background px-0 text-dls-secondary shadow-none transition-[height,color] duration-150 hover:h-4 hover:bg-dls-background hover:text-dls-text mac:titlebar-no-drag",
          // Only “cut” the rule under the hang-tab when the strip is expanded;
          // collapsed needs a continuous line aligned with the side panel header.
          expanded &&
            "before:absolute before:-top-px before:inset-x-0 before:h-px before:bg-dls-background",
        )}
        title={expanded ? t("session.agent_tab_collapse") : t("session.agent_tab_expand")}
        aria-label={expanded ? t("session.agent_tab_collapse") : t("session.agent_tab_expand")}
      >
        <ChevronRight
          className={cn(
            "size-3 transition-transform",
            expanded ? "-rotate-90" : "rotate-90",
          )}
        />
      </Button>
    </div>
  );
}
