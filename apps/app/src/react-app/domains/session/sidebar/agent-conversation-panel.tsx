/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import type { SidebarSessionItem, WorkspaceSessionGroup } from "../../../../app/types";
import { t } from "../../../../i18n";
import { useQueries, useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";
import {
  useAgentRegistryStore,
} from "../../agents";
import { useStatusToasts } from "../../shell-feedback";
import {
  addAssistantSession,
  isAssistantSession,
  readAssistantSessionCategory,
  writeAssistantSessionCategory,
} from "../../agents";
import { AssistantConversationSections } from "./assistant-conversation-sections";
import { groupAssistantAutomationItems } from "./assistant-automation-groups";
import { AgentConversationPanelHeader } from "./agent-conversation-panel-header";
import { AgentConversationList } from "./agent-conversation-list";
import {
  buildAgentConversationGroups,
  buildAgentStarterItems,
  buildAssistantConversationGroups,
  readAssistantPinnedSessionIds,
  snapshotConversationSummary,
  type AgentConversationGroup,
  type TaskStatusIndicator,
  writeAssistantPinnedSessionIds,
} from "./conversation-model";
import { readAssistantSessionWorkspaces } from "../sync/assistant-session-workspaces";
import {
  archiveAssistantTask,
  archivedSessionIdSet,
  assistantArchivedTasksChangedEvent,
  filterGroupsExcludingArchived,
  readAssistantArchivedTasks,
} from "./assistant-archived-tasks";
import { isDesktopRuntime } from "../../../../app/utils";
import { revealDesktopItemInDir } from "../../../../app/lib/desktop";
import {
  type AutomationSessionRecord,
  automationSessionsChangedEvent,
  readAutomationSessionRecords,
  syncAutomationSessionRecords,
} from "../../messaging";

function registerAutomationAssistantSessions(workspaceId: string) {
  for (const record of readAutomationSessionRecords(workspaceId)) {
    addAssistantSession(record.sessionId);
    writeAssistantSessionCategory(record.sessionId, record.category);
  }
}

function mergeAutomationSessions(
  sessions: WorkspaceSessionGroup["sessions"],
  records: AutomationSessionRecord[],
): WorkspaceSessionGroup["sessions"] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const merged = [...sessions];
  for (const record of records) {
    if (sessionsById.has(record.sessionId)) continue;
    const title = record.title.trim() || t("automation.run_history_title_fallback");
    const session: SidebarSessionItem = {
      id: record.sessionId,
      title,
      time: {
        created: record.createdAt,
        updated: record.createdAt,
      },
      directory: record.outputDirectory,
    };
    merged.push(session);
    sessionsById.set(session.id, session);
  }
  return merged.sort(
    (a, b) =>
      (b.time?.updated ?? b.time?.created ?? 0) -
      (a.time?.updated ?? a.time?.created ?? 0),
  );
}

export function AgentConversationPanel(props: {
  mode?: "agent" | "assistant";
  width: number;
  client: OnMyAgentServerClient | null;
  taskStatusVariant: TaskStatusIndicator["variant"];
  collapsed: boolean;
  groups: WorkspaceSessionGroup[];
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  selectedAgentId?: string | null;
  sessionStatusById: Record<string, string>;
  draftAgentGroup?: AgentConversationGroup | null;
  draftAgentGroups?: AgentConversationGroup[];
  query: string;
  onQueryChange: (value: string) => void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onOpenDraftAgent?: (sessionId: string) => void;
  onOpenAgentStarter?: (agentId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onToggleCollapsed: () => void;
  onOpenAgents: () => void;
  onCreateTask?: () => void;
  onOpenAssistant?: () => void;
  assistantCategoryId?: AssistantCategoryId;
  onAssistantCategoryChange?: (id: AssistantCategoryId) => void;
  automationActive?: boolean;
  onOpenAutomation?: () => void;
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onDeleteSession?: (sessionId: string) => void;
}) {
  const registry = useAgentRegistryStore((state) => state.registry);
  const { showToast } = useStatusToasts();
  const mode = props.mode ?? "agent";
  const [automationRevision, setAutomationRevision] = useState(0);
  const knownAutomationRunKeysRef = useRef<Set<string> | null>(null);
  const automationQuery = useQuery({
    queryKey: ["onmyagent-automations", props.selectedWorkspaceId],
    enabled: mode === "assistant" && Boolean(props.client),
    queryFn: async () => {
      const client = props.client;
      if (!client) throw new Error("OnMyAgent server unavailable");
      return client.listAutomations(props.selectedWorkspaceId);
    },
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => item.running) ? 2_000 : 15_000,
  });
  useEffect(() => {
    if (mode !== "assistant" || !automationQuery.data) return;
    syncAutomationSessionRecords(
      props.selectedWorkspaceId,
      automationQuery.data.items,
    );
  }, [
    automationQuery.data,
    mode,
    props.selectedWorkspaceId,
  ]);
  useEffect(() => {
    if (mode !== "assistant" || !automationQuery.data) return;
    const runKeys = new Set(
      automationQuery.data.items.flatMap((item) =>
        item.lastRun ? [`${item.id}:${item.lastRun.ranAt}`] : [],
      ),
    );
    const knownAutomationRunKeys = knownAutomationRunKeysRef.current;
    if (!knownAutomationRunKeys) {
      knownAutomationRunKeysRef.current = runKeys;
      return;
    }
    for (const item of automationQuery.data.items) {
      const run = item.lastRun;
      if (!run) continue;
      const key = `${item.id}:${run.ranAt}`;
      if (knownAutomationRunKeys.has(key)) continue;
      showToast({
        title: t("automation.run_finished_toast_title", { title: item.title }),
        description:
          run.status === "success"
            ? t("automation.run_finished_toast_success")
            : run.status === "skipped"
              ? t("automation.run_finished_toast_skipped")
              : t("automation.run_finished_toast_failed"),
        tone: run.status === "success" ? "success" : run.status === "skipped" ? "warning" : "error",
        durationMs: 3_000,
      });
    }
    knownAutomationRunKeysRef.current = runKeys;
  }, [
    automationQuery.data,
    mode,
    showToast,
  ]);
  useEffect(() => {
    registerAutomationAssistantSessions(props.selectedWorkspaceId);
    setAutomationRevision((current) => current + 1);
  }, [props.selectedWorkspaceId]);
  useEffect(() => {
    const handleChange = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        event.detail?.workspaceId !== props.selectedWorkspaceId
      ) return;
      registerAutomationAssistantSessions(props.selectedWorkspaceId);
      setAutomationRevision((current) => current + 1);
    };
    window.addEventListener(automationSessionsChangedEvent, handleChange);
    return () => window.removeEventListener(automationSessionsChangedEvent, handleChange);
  }, [props.selectedWorkspaceId]);
  const group = props.groups.find(
    (item) => item.workspace.id === props.selectedWorkspaceId,
  );
  const automationSessionRecords =
    useMemo(
      () =>
        mode === "assistant"
          ? readAutomationSessionRecords(props.selectedWorkspaceId)
          : [],
      [automationRevision, mode, props.selectedWorkspaceId],
    );
  const sessions: WorkspaceSessionGroup["sessions"] = useMemo(
    () =>
      mode === "assistant"
        ? mergeAutomationSessions(group?.sessions ?? [], automationSessionRecords)
        : group?.sessions ?? [],
    [automationSessionRecords, group?.sessions, mode],
  );
  const assistantSessions = useMemo(
    () =>
      mode === "assistant"
        ? sessions.filter((session) => isAssistantSession(session.id))
        : [],
    [mode, sessions],
  );
  const assistantWorkspaceRecords =
    mode === "assistant"
      ? readAssistantSessionWorkspaces(props.selectedWorkspaceId)
      : [];
  const assistantWorkspaceBySessionId = new Map(
    assistantWorkspaceRecords.map((item) => [item.sessionId, item]),
  );
  const assistantSnapshotQueries = useQueries({
    queries: assistantSessions.map((session) => ({
      queryKey: [
        "onmyagent-assistant-task-snapshot",
        props.selectedWorkspaceId,
        session.id,
      ],
      enabled: Boolean(props.client) && !session.id.startsWith("draft:"),
      queryFn: async () => {
        const client = props.client;
        if (!client) throw new Error("OnMyAgent server unavailable");
        return (
          await client.getSessionSnapshot(
            props.selectedWorkspaceId,
            session.id,
            {
              limit: 8,
              directory:
                assistantWorkspaceBySessionId.get(session.id)?.directory,
            },
          )
        ).item;
      },
      staleTime: 5_000,
    })),
  });
  const assistantTitleFallbacks = new Map<string, string>();
  const assistantPreviewBySessionId = new Map<string, string>();
  assistantSessions.forEach((session, index) => {
    const snapshot = assistantSnapshotQueries[index]?.data;
    if (!snapshot) return;
    const summary = snapshotConversationSummary(
      snapshot,
      session.time?.updated ?? session.time?.created,
    );
    assistantTitleFallbacks.set(session.id, summary.preview);
    if (summary.preview) {
      assistantPreviewBySessionId.set(session.id, summary.preview);
    }
  });
  const normalizedQuery = props.query.trim().toLowerCase();
  const agentGroups = useMemo(
    () =>
      mode === "assistant"
        ? buildAssistantConversationGroups(
            sessions,
            assistantTitleFallbacks,
            assistantPreviewBySessionId,
          )
        : buildAgentConversationGroups(sessions, registry),
    [assistantPreviewBySessionId, assistantTitleFallbacks, mode, registry, sessions],
  );
  const visibleAgentGroups = useMemo(() => {
    if (mode === "assistant") return agentGroups;
    const draftGroups = props.draftAgentGroups ?? (
      props.draftAgentGroup ? [props.draftAgentGroup] : []
    );
    const visibleDraftGroups = draftGroups.filter(
      (group) =>
        group.agentId &&
        !agentGroups.some((item) => item.agentId === group.agentId),
    );
    return visibleDraftGroups.length > 0
      ? [...visibleDraftGroups, ...agentGroups]
      : agentGroups;
  }, [agentGroups, mode, props.draftAgentGroup, props.draftAgentGroups]);
  const starterItems = useMemo(
    () =>
      mode === "assistant"
        ? []
        : buildAgentStarterItems(registry).filter((item) => {
            if (!normalizedQuery) return true;
            return `${item.name} ${item.description}`
              .toLowerCase()
              .includes(normalizedQuery);
          }),
    [mode, normalizedQuery, registry],
  );
  const filteredAgentGroups = normalizedQuery
    ? visibleAgentGroups.filter((item) =>
        `${item.name} ${item.description}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : visibleAgentGroups;
  const activeAssistantCategoryId = props.assistantCategoryId ?? "office";
  const automationSessionRecordById = new Map(
    automationSessionRecords.map((record) => [record.sessionId, record]),
  );
  const assistantCategoryGroups =
    mode === "assistant"
      ? filteredAgentGroups.filter(
          (item) =>
            readAssistantSessionCategory(item.latestSession.id) ===
            activeAssistantCategoryId,
        )
      : filteredAgentGroups;
  // Note: archivedIdSet is applied after this block via filtering each group’s items
  // once assistantArchivedIdSet is ready (see visible automation handling below).
  const automationGroupsRaw = groupAssistantAutomationItems(
    assistantCategoryGroups.flatMap((item) => {
      const record = automationSessionRecordById.get(item.latestSession.id);
      if (!record || record.category !== activeAssistantCategoryId) return [];
      return [{
        item,
        automationId: record.automationId,
        title: record.title,
        updatedAt:
          item.latestSession.time?.updated ??
          item.latestSession.time?.created ??
          record.createdAt,
      }];
    }),
  );
  const regularAssistantGroups = assistantCategoryGroups.filter(
    (item) => !automationSessionRecordById.has(item.latestSession.id),
  );
  const [assistantPinnedSessionIds, setAssistantPinnedSessionIds] = useState(() =>
    readAssistantPinnedSessionIds(props.selectedWorkspaceId),
  );
  const [archivedRevision, setArchivedRevision] = useState(0);
  const assistantArchivedTasks = useMemo(
    () => readAssistantArchivedTasks(props.selectedWorkspaceId),
    [props.selectedWorkspaceId, archivedRevision],
  );
  const assistantArchivedIdSet = useMemo(
    () => archivedSessionIdSet(assistantArchivedTasks),
    [assistantArchivedTasks],
  );
  const visibleRegularAssistantGroups = useMemo(
    () =>
      filterGroupsExcludingArchived(
        regularAssistantGroups,
        assistantArchivedIdSet,
      ),
    [regularAssistantGroups, assistantArchivedIdSet],
  );
  const automationGroups = useMemo(
    () =>
      automationGroupsRaw
        .map((group) => ({
          ...group,
          items: filterGroupsExcludingArchived(
            group.items,
            assistantArchivedIdSet,
          ),
        }))
        .filter((group) => group.items.length > 0),
    [automationGroupsRaw, assistantArchivedIdSet],
  );
  const assistantPinnedSessionIdSet = new Set(assistantPinnedSessionIds);
  const assistantPinnedGroups = visibleRegularAssistantGroups.filter((item) =>
    assistantPinnedSessionIdSet.has(item.latestSession.id),
  );
  const unpinnedAgentGroups = visibleRegularAssistantGroups.filter(
    (item) => !assistantPinnedSessionIdSet.has(item.latestSession.id),
  );
  const assistantTaskGroups = unpinnedAgentGroups.filter(
    (item) => !assistantWorkspaceBySessionId.has(item.latestSession.id),
  );
  const assistantSpaceGroups = Array.from(
    unpinnedAgentGroups.reduce((groups, item) => {
      const record = assistantWorkspaceBySessionId.get(item.latestSession.id);
      if (!record) return groups;
      const current = groups.get(record.directory) ?? [];
      current.push(item);
      groups.set(record.directory, current);
      return groups;
    }, new Map<string, AgentConversationGroup[]>()),
  ).sort(([, left], [, right]) => {
    const leftTime =
      left[0]?.latestSession.time?.updated ??
      left[0]?.latestSession.time?.created ??
      0;
    const rightTime =
      right[0]?.latestSession.time?.updated ??
      right[0]?.latestSession.time?.created ??
      0;
    return rightTime - leftTime;
  });
  const [expandedAssistantDirectories, setExpandedAssistantDirectories] =
    useState<string[]>([]);
  const [expandedAutomationDirectories, setExpandedAutomationDirectories] =
    useState<string[]>([]);
  const assistantSpaceDirectoryKey = assistantSpaceGroups
    .map(([directory]) => directory)
    .join("\n");
  const automationDirectoryKey = automationGroups
    .map((group) => group.id)
    .join("\n");

  useEffect(() => {
    setAssistantPinnedSessionIds(
      readAssistantPinnedSessionIds(props.selectedWorkspaceId),
    );
  }, [props.selectedWorkspaceId]);

  useEffect(() => {
    if (mode !== "assistant") return;
    const onArchivedChanged = () => setArchivedRevision((value) => value + 1);
    window.addEventListener(assistantArchivedTasksChangedEvent, onArchivedChanged);
    return () => {
      window.removeEventListener(
        assistantArchivedTasksChangedEvent,
        onArchivedChanged,
      );
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "assistant" || agentGroups.length === 0) return;
    const availableSessionIds = new Set(agentGroups.map((item) => item.latestSession.id));
    setAssistantPinnedSessionIds((current) => {
      const next = current.filter((sessionId) => availableSessionIds.has(sessionId));
      if (next.length === current.length) return current;
      writeAssistantPinnedSessionIds(props.selectedWorkspaceId, next);
      return next;
    });
  }, [agentGroups, mode, props.selectedWorkspaceId]);

  const toggleAssistantPinnedSession = useCallback(
    (sessionId: string) => {
      setAssistantPinnedSessionIds((current) => {
        const next = current.includes(sessionId)
          ? current.filter((item) => item !== sessionId)
          : [sessionId, ...current];
        writeAssistantPinnedSessionIds(props.selectedWorkspaceId, next);
        return next;
      });
    },
    [props.selectedWorkspaceId],
  );

  const folderPathBySessionId = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of assistantWorkspaceRecords) {
      if (record.directory?.trim()) {
        map.set(record.sessionId, record.directory.trim());
      }
    }
    return map;
  }, [assistantWorkspaceRecords]);

  const handleArchiveAssistantSession = useCallback(
    (sessionId: string, title: string) => {
      archiveAssistantTask(props.selectedWorkspaceId, {
        sessionId,
        title,
        directory: folderPathBySessionId.get(sessionId) ?? null,
        archivedAt: Date.now(),
        category: props.assistantCategoryId ?? null,
      });
      setArchivedRevision((value) => value + 1);
      // Drop pin membership when archiving so restore lands in the main list.
      setAssistantPinnedSessionIds((current) => {
        if (!current.includes(sessionId)) return current;
        const next = current.filter((item) => item !== sessionId);
        writeAssistantPinnedSessionIds(props.selectedWorkspaceId, next);
        return next;
      });
    },
    [
      folderPathBySessionId,
      props.assistantCategoryId,
      props.selectedWorkspaceId,
    ],
  );

  const handleOpenFolder = useCallback((path: string) => {
    if (!isDesktopRuntime()) {
      showToast({
        tone: "warning",
        title: t("session.open_folder_desktop_only"),
      });
      return;
    }
    void revealDesktopItemInDir(path).catch((error: unknown) => {
      showToast({
        tone: "error",
        title:
          error instanceof Error
            ? error.message
            : t("session.open_folder_failed"),
      });
    });
  }, [showToast]);



  useEffect(() => {
    setExpandedAssistantDirectories((current) => {
      const next = new Set(current);
      for (const [directory] of assistantSpaceGroups) next.add(directory);
      return next.size === current.length ? current : Array.from(next);
    });
  }, [assistantSpaceDirectoryKey]);

  useEffect(() => {
    setExpandedAutomationDirectories((current) => {
      const next = new Set(current);
      for (const group of automationGroups) next.add(group.id);
      return next.size === current.length ? current : Array.from(next);
    });
  }, [automationDirectoryKey]);

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col bg-dls-sidebar pb-5 mac:bg-dls-sidebar",
        mode === "agent" ? "overflow-visible" : "overflow-hidden",
        mode === "assistant" && "px-2.5",
      )}
      style={{ width: props.width }}
    >
      <AgentConversationPanelHeader
        mode={mode}
        query={props.query}
        selectedSessionId={props.selectedSessionId}
        assistantCategoryId={props.assistantCategoryId}
        automationActive={props.automationActive}
        onQueryChange={props.onQueryChange}
        onOpenAgents={props.onOpenAgents}
        onCreateTask={props.onCreateTask}
        onOpenAssistant={props.onOpenAssistant}
        showAgentSelectionTip={false}
        onAssistantCategoryChange={props.onAssistantCategoryChange}
        onOpenAutomation={props.onOpenAutomation}
      />

      <div className={cn("min-h-0 flex-1 overflow-y-auto", mode === "assistant" && "pr-0.5")}>
        {mode === "assistant" ? (
          <AssistantConversationSections
            categoryId={activeAssistantCategoryId}
            workspaceId={props.selectedWorkspaceId}
            selectedSessionId={props.selectedSessionId}
            automationGroups={automationGroups}
            pinnedGroups={assistantPinnedGroups}
            taskGroups={assistantTaskGroups}
            spaceGroups={assistantSpaceGroups}
            expandedDirectories={expandedAssistantDirectories}
            expandedAutomationDirectories={expandedAutomationDirectories}
            onExpandedDirectoriesChange={setExpandedAssistantDirectories}
            onExpandedAutomationDirectoriesChange={setExpandedAutomationDirectories}
            onOpenSession={props.onOpenSession}
            onPrefetchSession={props.onPrefetchSession}
            onTogglePinned={toggleAssistantPinnedSession}
            onRenameSession={props.onRenameSession}
            onArchiveSession={handleArchiveAssistantSession}
            onDeleteSession={props.onDeleteSession}
            onOpenFolder={handleOpenFolder}
            folderPathBySessionId={folderPathBySessionId}
          />
        ) : (
          <AgentConversationList
            groups={filteredAgentGroups}
            hasAnyConversation={visibleAgentGroups.length > 0}
            starterItems={starterItems}
            workspaceId={props.selectedWorkspaceId}
            selectedSessionId={props.selectedSessionId}
            selectedAgentId={props.selectedAgentId}
            sessionStatusById={props.sessionStatusById}
            taskStatusVariant={props.taskStatusVariant}
            onOpenSession={props.onOpenSession}
            onOpenDraftSession={props.onOpenDraftAgent}
            onOpenStarter={props.onOpenAgentStarter}
            onPrefetchSession={props.onPrefetchSession}
          />
        )}
      </div>
    </aside>
  );
}
