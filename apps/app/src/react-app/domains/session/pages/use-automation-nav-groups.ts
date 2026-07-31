/**
 * Build the left-rail automation task/run list (same source as home 定时 groups).
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
import type { AssistantCategoryId } from "../surface/personal-assistant-config";

export type AutomationNavSessionRow = {
  id: string;
  title: string;
  updatedAt: number | null;
};

export type AutomationNavGroupRow = {
  id: string;
  title: string;
  sessions: AutomationNavSessionRow[];
};

export function buildAutomationNavGroups(input: {
  records: ReturnType<typeof readAutomationSessionRecords>;
  sessions: readonly SidebarSessionItem[];
  categoryId: AssistantCategoryId;
  excludedSessionIds: ReadonlySet<string>;
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
        },
        automationId: record.automationId,
        title: record.title.trim() || record.automationId,
        updatedAt: typeof updatedAt === "number" ? updatedAt : 0,
      };
    });

  return groupAssistantAutomationItems(entries).map((group) => ({
    id: group.id,
    title: group.title,
    sessions: [...group.items].sort(
      (left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
    ),
  }));
}

export function useAutomationNavGroups(input: {
  workspaceId: string;
  categoryId: AssistantCategoryId;
  sessions: readonly SidebarSessionItem[];
  enabled: boolean;
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
    const excluded = new Set<string>([
      ...readDeletedAutomationSessionIds(input.workspaceId),
      ...archivedSessionIdSet(readAssistantArchivedTasks(input.workspaceId)),
    ]);
    return buildAutomationNavGroups({
      records: readAutomationSessionRecords(input.workspaceId),
      sessions: input.sessions,
      categoryId: input.categoryId,
      excludedSessionIds: excluded,
    });
  }, [
    input.categoryId,
    input.enabled,
    input.sessions,
    input.workspaceId,
    revision,
  ]);
}
