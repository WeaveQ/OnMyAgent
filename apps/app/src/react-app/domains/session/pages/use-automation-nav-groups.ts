/**
 * Build the left-rail automation task/run list.
 * Same data source + grouping as the former home 「定时任务」 section
 * (automation session records + mergeAutomationSessions + group by task id).
 */
import { useEffect, useMemo, useState } from "react";

import type { SidebarSessionItem } from "../../../../app/types";
import {
  automationSessionsChangedEvent,
  readAutomationSessionRecords,
  readDeletedAutomationSessionIds,
} from "../../messaging";
import {
  archivedSessionIdSet,
  assistantArchivedTasksChangedEvent,
  readAssistantArchivedTasks,
} from "../../shared";
import { groupAssistantAutomationItems } from "../sidebar/assistant-automation-groups";
import { mergeAutomationSessions } from "../sidebar/agent-conversation-panel";
import {
  automationLocalPinScope,
  readAssistantGlobalPins,
  readAssistantSpaceLocalPins,
} from "../sidebar/conversation-model";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";
import type {
  AutomationNavGroupRow,
  AutomationNavSessionRow,
} from "../../messaging";

export type { AutomationNavGroupRow, AutomationNavSessionRow };

export function buildAutomationNavGroups(input: {
  workspaceId: string;
  records: ReturnType<typeof readAutomationSessionRecords>;
  sessions: readonly SidebarSessionItem[];
  categoryId: AssistantCategoryId;
  excludedSessionIds: ReadonlySet<string>;
  pinnedGroupIds?: ReadonlySet<string>;
}): AutomationNavGroupRow[] {
  const sessionById = new Map(
    input.sessions.map((session) => [session.id, session] as const),
  );
  const entries = input.records
    .filter(
      (record) =>
        record.category === input.categoryId &&
        !input.excludedSessionIds.has(record.sessionId),
    )
    .map((record) => {
      const session = sessionById.get(record.sessionId);
      const updatedAt =
        session?.time?.updated ?? session?.time?.created ?? record.createdAt;
      const title =
        session?.title?.trim() ||
        record.title.trim() ||
        record.sessionId;
      return {
        item: {
          id: record.sessionId,
          title,
          updatedAt: typeof updatedAt === "number" ? updatedAt : null,
          directory:
            session?.directory?.trim() ||
            record.outputDirectory?.trim() ||
            null,
          pinned: false,
        },
        automationId: record.automationId,
        title: record.title.trim() || record.automationId,
        updatedAt: typeof updatedAt === "number" ? updatedAt : 0,
      };
    });

  const pinned = input.pinnedGroupIds ?? new Set<string>();
  return groupAssistantAutomationItems(entries).map((group) => {
    const scope = automationLocalPinScope(group.id);
    const localPins = new Set(
      scope && input.workspaceId.trim()
        ? readAssistantSpaceLocalPins(input.workspaceId, scope)
        : [],
    );
    const sessions = [...group.items]
      .map((item) => ({
        ...item,
        pinned: localPins.has(item.id),
      }))
      .sort((left, right) => {
        // Local pins first (home parity), then recency.
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
        return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
      });
    return {
      id: group.id,
      title: group.title,
      pinned: pinned.has(group.id),
      sessions,
    };
  });
}

export function useAutomationNavGroups(input: {
  workspaceId: string;
  categoryId: AssistantCategoryId;
  sessions: readonly SidebarSessionItem[];
  enabled: boolean;
  /** Bump when global pin set changes so pin icons refresh. */
  pinRevision?: number;
}): AutomationNavGroupRow[] {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!input.enabled) return;
    const bump = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        event.detail?.workspaceId &&
        event.detail.workspaceId !== input.workspaceId
      ) {
        return;
      }
      setRevision((value) => value + 1);
    };
    window.addEventListener(automationSessionsChangedEvent, bump);
    window.addEventListener(assistantArchivedTasksChangedEvent, bump);
    return () => {
      window.removeEventListener(automationSessionsChangedEvent, bump);
      window.removeEventListener(assistantArchivedTasksChangedEvent, bump);
    };
  }, [input.enabled, input.workspaceId]);

  return useMemo(() => {
    if (!input.enabled || !input.workspaceId.trim()) return [];
    void revision;
    const records = readAutomationSessionRecords(input.workspaceId);
    const excluded = new Set<string>([
      ...readDeletedAutomationSessionIds(input.workspaceId),
      ...archivedSessionIdSet(readAssistantArchivedTasks(input.workspaceId)),
    ]);
    // Same merge as home AgentConversationPanel: record-only runs still appear.
    const sessions = mergeAutomationSessions(
      [...input.sessions],
      records,
      excluded,
    );
    const pinnedGroupIds = new Set(
      readAssistantGlobalPins(input.workspaceId)
        .filter((pin) => pin.kind === "automation")
        .map((pin) => pin.id),
    );
    return buildAutomationNavGroups({
      workspaceId: input.workspaceId,
      records,
      sessions,
      categoryId: input.categoryId,
      excludedSessionIds: excluded,
      pinnedGroupIds,
    });
  }, [
    input.categoryId,
    input.enabled,
    input.pinRevision,
    input.sessions,
    input.workspaceId,
    revision,
  ]);
}
