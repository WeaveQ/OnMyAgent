/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { useQueries } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { MenuRowButton, SessionRowButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import type {
  OpenworkServerClient,
  OpenworkSessionSnapshot,
} from "../../../../../app/lib/onmyagent-server";
import {
  DEFAULT_SESSION_TITLE,
  isGeneratedSessionTitle,
} from "../../../../../app/lib/session-title";
import type { WorkspaceSessionGroup } from "../../../../../app/types";
import { t } from "../../../../../i18n";
import { sessionMessagePreview } from "./conversation-model";

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

function summarizeSessionSnapshotForTab(snapshot: OpenworkSessionSnapshot) {
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
  client: OpenworkServerClient | null;
  workspaceId: string;
  selectedSessionId: string | null;
  sessions: WorkspaceSessionGroup["sessions"];
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onOpenDraftSession?: (sessionId: string) => void;
  onCreateSession: () => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onDeleteSession: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
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
  const snapshotQueries = useQueries({
    queries: props.sessions.map((session) => ({
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

  if (props.sessions.length === 0) return null;

  return (
    <div
      className={cn(
        "relative shrink-0 bg-dls-surface-muted",
        expanded ? " px-4 pb-2 pt-2" : "h-0 overflow-visible",
      )}
    >
      <style>{`
        @keyframes onmyagent-tab-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(calc(-100% + 78px)); }
        }
      `}</style>
      {expanded ? (
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto pb-1">
          <Button
            type="button"
            variant="dashed"
            size="xs"
            onClick={props.onCreateSession}
            className="shrink-0"
            title={t("session.agent_tab_new_session_title")}
            aria-label={t("session.agent_tab_new_session_title")}
          >
            <Plus data-icon="inline-start" className="size-3.5" />
            {t("session.new_session")}
          </Button>
          {(() => {
            return props.sessions.map((session) => {
              const isDraft = session.id.startsWith("draft:");
              const active = session.id === activeSessionId;
              const originalIndex = props.sessions.findIndex(
                (s) => s.id === session.id,
              );
              const generatedFallback =
                originalIndex >= 0 && snapshotQueries[originalIndex]?.data
                  ? summarizeSessionSnapshotForTab(
                      snapshotQueries[originalIndex]?.data,
                    )
                  : undefined;
              const title = isDraft
                ? session.title
                : summarizeTabTitle(session, generatedFallback);
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
                      if (isDraft) props.onOpenDraftSession?.(session.id);
                      else props.onOpenSession(props.workspaceId, session.id);
                    }}
                    title={title}
                    aria-pressed={active}
                  >
                    <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                      <SessionTabMarqueeText title={title} />
                    </span>
                  </SessionRowButton>
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
            });
          })()}
        </div>
      ) : null}
      {menuState ? (
        <div
          ref={menuRef}
          className="fixed z-[100] w-24 overflow-hidden rounded-xl border border-dls-border bg-dls-surface py-1 text-xs"
          style={{ left: menuState.left, top: menuState.top }}
          onMouseLeave={() => setMenuState(null)}
          onPointerLeave={() => setMenuState(null)}
        >
          <MenuRowButton
            align="center"
            type="button"
            onClick={() => {
              props.onRenameSession(menuState.sessionId, menuState.title);
              setMenuState(null);
            }}
          >
            {t("session.agent_tab_rename")}
          </MenuRowButton>
          <MenuRowButton
            align="center"
            type="button"
            className="text-dls-status-danger-fg hover:bg-dls-status-danger-soft"
            onClick={() => {
              props.onDeleteSession(menuState.sessionId);
              setMenuState(null);
            }}
          >
            {t("session.agent_tab_delete")}
          </MenuRowButton>
        </div>
      ) : null}
      <Button
        type="button"
        onClick={() => {
          setExpanded((value) => !value);
          setMenuState(null);
        }}
        variant="outline"
        size="xs"
        className="absolute bottom-0 left-1/2 z-20 h-4 w-12 -translate-x-1/2 translate-y-1/2 rounded-full border-dls-border bg-dls-surface p-0 text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
        title={expanded ? t("session.agent_tab_collapse") : t("session.agent_tab_expand")}
        aria-label={expanded ? t("session.agent_tab_collapse") : t("session.agent_tab_expand")}
      >
        <ChevronRight
          className={cn(
            "size-3 rotate-90 transition-transform",
            !expanded && "-rotate-90",
          )}
        />
      </Button>
    </div>
  );
}
