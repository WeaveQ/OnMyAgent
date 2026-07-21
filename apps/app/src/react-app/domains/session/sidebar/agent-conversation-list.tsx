/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import { SessionRowButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { t } from "../../../../i18n";
import type {
  AgentConversationGroup,
  AgentStarterItem,
  TaskStatusIndicator,
} from "./conversation-model";
import {
  readExpertPinnedAgentIds,
  writeExpertPinnedAgentIds,
} from "./conversation-model";
import { AgentConversationItem } from "./agent-conversation-item";
import { pickAggregateSessionStatus } from "./utils";
import { useExpertUnreadStore } from "../status/expert-unread-store";

type AgentConversationListProps = {
  groups: AgentConversationGroup[];
  hasAnyConversation: boolean;
  starterItems?: AgentStarterItem[];
  workspaceId: string;
  selectedSessionId: string | null;
  selectedAgentId?: string | null;
  sessionStatusById: Record<string, string>;
  taskStatusVariant: TaskStatusIndicator["variant"];
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onOpenDraftSession?: (sessionId: string) => void;
  onOpenStarter?: (agentId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onDeleteExpert?: (target: {
    agentId: string;
    name: string;
    sessionIds: string[];
  }) => void;
};

const starterTextClass = {
  itemTitle: "min-w-0 flex-1 truncate text-sm font-medium leading-5 text-dls-text",
};

function AgentStarterRow(props: {
  item: AgentStarterItem;
  onOpenStarter?: (agentId: string) => void;
}) {
  return (
    <SessionRowButton
      type="button"
      onClick={() => props.onOpenStarter?.(props.item.agentId)}
    >
      <div className="relative shrink-0">
        {/* Match local AgentBrandIcon size="md" / expert list tiles. */}
        <div
          className={cn(
            "flex size-10 items-center justify-center overflow-hidden rounded-md text-sm font-medium",
            "bg-dls-surface-muted text-dls-secondary ring-1 ring-dls-border/60",
            "dark:bg-white dark:text-neutral-700 dark:ring-black/10",
          )}
          style={
            props.item.avatarUrl
              ? undefined
              : { backgroundColor: props.item.avatarBackground }
          }
        >
          {props.item.avatarUrl ? (
            <img
              src={props.item.avatarUrl}
              alt=""
              className="size-full object-cover"
              draggable={false}
            />
          ) : (
            props.item.name.charAt(0).toUpperCase() || t("session.agent_initial")
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className={starterTextClass.itemTitle}>
          {props.item.name}
        </div>
        <div className="mt-1 min-w-0 truncate text-xs leading-5 text-dls-secondary">
          {props.item.description}
        </div>
      </div>
    </SessionRowButton>
  );
}

export function AgentConversationList(props: AgentConversationListProps) {
  const byWorkspace = useExpertUnreadStore((state) => state.byWorkspace);
  const sessionUnreadByWorkspace = useExpertUnreadStore(
    (state) => state.sessionUnreadByWorkspace,
  );
  const focused = useExpertUnreadStore((state) => state.focused);
  const setFocusedAgent = useExpertUnreadStore((state) => state.setFocusedAgent);
  const isUnread = useExpertUnreadStore((state) => state.isUnread);
  const hasUnreadRecord = useExpertUnreadStore((state) => state.hasUnreadRecord);
  const getUnreadCount = useExpertUnreadStore((state) => state.getUnreadCount);
  const markUnread = useExpertUnreadStore((state) => state.markUnread);
  const markRead = useExpertUnreadStore((state) => state.markRead);

  const [pinnedAgentIds, setPinnedAgentIds] = useState(() =>
    readExpertPinnedAgentIds(props.workspaceId),
  );

  useEffect(() => {
    setPinnedAgentIds(readExpertPinnedAgentIds(props.workspaceId));
  }, [props.workspaceId]);

  // Keep read cursor in sync with the open expert.
  useEffect(() => {
    const selectedGroup = props.groups.find(
      (group) =>
        group.agentId === props.selectedAgentId ||
        group.sessions.some((session) => session.id === props.selectedSessionId),
    );
    const agentId = selectedGroup?.agentId ?? props.selectedAgentId ?? null;
    setFocusedAgent(props.workspaceId, agentId);
  }, [
    props.groups,
    props.selectedAgentId,
    props.selectedSessionId,
    props.workspaceId,
    setFocusedAgent,
  ]);

  const togglePinned = useCallback(
    (agentId: string) => {
      const id = agentId.trim();
      if (!id) return;
      setPinnedAgentIds((current) => {
        const next = current.includes(id)
          ? current.filter((item) => item !== id)
          : [id, ...current.filter((item) => item !== id)];
        writeExpertPinnedAgentIds(props.workspaceId, next);
        return next;
      });
    },
    [props.workspaceId],
  );

  const handleMarkUnread = useCallback(
    (agentId: string) => {
      const group = props.groups.find((item) => item.agentId === agentId);
      const latestId = group?.latestSession.id;
      markUnread(props.workspaceId, agentId, {
        sessionId:
          latestId && !latestId.startsWith("draft:") ? latestId : undefined,
      });
    },
    [markUnread, props.groups, props.workspaceId],
  );

  const handleMarkRead = useCallback(
    (agentId: string) => {
      markRead(props.workspaceId, agentId);
    },
    [markRead, props.workspaceId],
  );

  const pinnedSet = useMemo(() => new Set(pinnedAgentIds), [pinnedAgentIds]);

  const orderedGroups = useMemo(() => {
    // Depend on store snapshots so list re-renders when unread / pin changes.
    void byWorkspace;
    void sessionUnreadByWorkspace;
    void focused;
    const withFlags = props.groups.map((group) => {
      const agentId = group.agentId ?? "";
      const unread =
        Boolean(agentId) && isUnread(props.workspaceId, agentId);
      // Menu uses raw record so “标为已读” still works on the open expert.
      const unreadRecord =
        Boolean(agentId) && hasUnreadRecord(props.workspaceId, agentId);
      const unreadCount = agentId
        ? getUnreadCount(props.workspaceId, agentId)
        : 0;
      const pinned = Boolean(agentId) && pinnedSet.has(agentId);
      // Recency: newest activity among all sessions under this expert.
      const updated = group.sessions.reduce((max, session) => {
        const ts =
          session.time?.updated ?? session.time?.created ?? 0;
        return ts > max ? ts : max;
      }, 0);
      return { group, unread, unreadRecord, unreadCount, pinned, updated };
    });
    // Order: pinned block first, then pure recency. Unread is badge-only — never reorders.
    withFlags.sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      if (left.updated !== right.updated) return right.updated - left.updated;
      // Stable tie-break by name so equal timestamps don’t jump.
      return left.group.name.localeCompare(right.group.name, "zh");
    });
    return withFlags;
  }, [
    byWorkspace,
    focused,
    getUnreadCount,
    hasUnreadRecord,
    isUnread,
    pinnedSet,
    props.groups,
    props.workspaceId,
    sessionUnreadByWorkspace,
  ]);

  if (props.groups.length === 0) {
    if (props.hasAnyConversation && props.starterItems?.length) {
      return (
        <div>
          {props.starterItems.map((item) => (
            <AgentStarterRow
              key={item.key}
              item={item}
              onOpenStarter={props.onOpenStarter}
            />
          ))}
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm leading-5 text-dls-secondary">
        {props.hasAnyConversation
          ? t("session.no_matching_expert_conversations")
          : t("session.no_expert_conversations")}
      </div>
    );
  }

  return (
    <div>
      {orderedGroups.map(({ group, unread, unreadRecord, unreadCount, pinned }) => (
        <AgentConversationItem
          key={group.key}
          group={group}
          workspaceId={props.workspaceId}
          selected={
            group.sessions.some(
              (session) => session.id === props.selectedSessionId,
            ) || group.agentId === props.selectedAgentId
          }
          status={pickAggregateSessionStatus(
            group.sessions.map((session) => session.id),
            props.sessionStatusById,
          )}
          taskStatusVariant={props.taskStatusVariant}
          unread={unread}
          unreadRecord={unreadRecord}
          unreadCount={unreadCount}
          pinned={pinned}
          onOpenSession={props.onOpenSession}
          onOpenDraftSession={props.onOpenDraftSession}
          onPrefetchSession={props.onPrefetchSession}
          onTogglePinned={togglePinned}
          onMarkUnread={handleMarkUnread}
          onMarkRead={handleMarkRead}
          onDeleteExpert={props.onDeleteExpert}
        />
      ))}
    </div>
  );
}
