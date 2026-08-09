/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, Store, UserPlus, Users } from "lucide-react";
import { useQueries, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import type { SidebarSessionItem, WorkspaceSessionGroup } from "../../../../app/types";
import { t } from "../../../../i18n";
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
import {
  AgentConversationPanelHeader,
  SIDEBAR_FOOTER_CTA_CLASS,
} from "./agent-conversation-panel-header";
import { AgentConversationList } from "./agent-conversation-list";
import {
  automationLocalPinScope,
  buildAgentConversationGroups,
  buildAssistantConversationGroups,
  readAssistantGlobalPins,
  writeAssistantGlobalPins,
  readAssistantSpaceLocalPins,
  writeAssistantSpaceLocalPins,
  readAssistantSpaceFolderOrder,
  writeAssistantSpaceFolderOrder,
  snapshotConversationSummary,
  type AgentConversationGroup,
  type AgentStarterItem,
  type AssistantGlobalPin,
  type TaskStatusIndicator,
} from "./conversation-model";
import {
  automationListRefetchIntervalMs,
  SIDEBAR_AUTOMATION_LIST_DEFER_MS,
  SIDEBAR_PREVIEW_SNAPSHOT_MESSAGE_LIMIT,
} from "../sync/session-poll-policy";
import {
  isSessionSnapshotNotFoundError,
  markSessionSnapshotNotFound,
  shouldRetrySessionSnapshotQuery,
  shouldSkipSnapshotForNotFoundCooldown,
} from "../sync/session-snapshot-fetch-policy";
import { useDeferredSidebarPreviews } from "./use-deferred-sidebar-previews";

import {
  buildAssistantSidebarModel,
  buildAutomationLocalPinsMap,
  globalPinKey,
  localPinMapsEqual,
  mergeVisibleReorderIntoFull,
  partitionCategoryGroupsForSidebar,
} from "./assistant-list-model";
import { queueAssistantNewTaskDirectory } from "../../../capabilities/session-identity/assistant-new-task-directory";
import {
  assistantSessionWorkspacesChangedEvent,
  dispatchAssistantSessionWorkspacesChanged,
  readAssistantSessionWorkspaceChangeOwner,
  readAssistantSessionWorkspaces,
  removeAssistantSessionWorkspacesByDirectory,
  writeAssistantSessionWorkspace,
} from "../sync/assistant-session-workspaces";
import {
  archiveAssistantTask,
  archivedSessionIdSet,
  assistantArchivedTasksChangedEvent,
  readAssistantArchivedTasks,
} from "../../shared";
import { isDesktopRuntime } from "../../../../app/utils";
import { pickDirectory, revealDesktopItemInDir } from "../../../../app/lib/desktop";
import {
  type AutomationSessionRecord,
  automationSessionsChangedEvent,
  readAutomationSessionRecords,
  readDeletedAutomationSessionIds,
  syncAutomationSessionRecords,
} from "../../messaging";

function registerAutomationAssistantSessions(workspaceId: string) {
  for (const record of readAutomationSessionRecords(workspaceId)) {
    addAssistantSession(record.sessionId);
    writeAssistantSessionCategory(record.sessionId, record.category);
  }
}

/** Module-level cooldown so remounts do not re-storm 404 snapshot ids. */
const snapshotNotFoundUntilBySessionId = new Map<string, number>();

/**
 * Merge engine sessions with local automation run records, dropping archived /
 * soft-deleted automation sessions so archive from the runs list stays in sync
 * with the 定时 sidebar.
 */
export function mergeAutomationSessions(
  sessions: WorkspaceSessionGroup["sessions"],
  records: AutomationSessionRecord[],
  excludedSessionIds?: ReadonlySet<string>,
): WorkspaceSessionGroup["sessions"] {
  const excluded = excludedSessionIds ?? new Set<string>();
  const base = sessions.filter((session) => !excluded.has(session.id));
  const sessionsById = new Map(base.map((session) => [session.id, session]));
  const merged = [...base];
  for (const record of records) {
    if (excluded.has(record.sessionId)) continue;
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
  onEditExpert?: (agentId: string) => void;
  editableExpertIds?: ReadonlySet<string>;
  /** When set, only these experts show hard-delete (system builtins excluded). */
  deletableExpertIds?: ReadonlySet<string>;
  onToggleCollapsed: () => void;
  onOpenAgents: () => void;
  onCreateExpert?: () => void;
  onCreateTask?: () => void;
  onOpenAssistant?: () => void;
  assistantCategoryId?: AssistantCategoryId;
  automationActive?: boolean;
  onOpenAutomation?: () => void;
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  /** Expert list: delete whole expert (all sessions under agent). */
  onDeleteExpert?: (target: {
    agentId: string;
    name: string;
    sessionIds: string[];
  }) => void;
  /** Confirm + permanently delete every run under a scheduled-task group. */
  onDeleteAutomationGroup?: (target: {
    groupId: string;
    title: string;
    sessionIds: string[];
  }) => void;
}) {
  const registry = useAgentRegistryStore((state) => state.registry);
  const { showToast } = useStatusToasts();
  const mode = props.mode ?? "agent";
  const [automationRevision, setAutomationRevision] = useState(0);
  const knownAutomationRunKeysRef = useRef<Set<string> | null>(null);
  // Defer automation list until after shell paint — not needed for first interaction.
  const [automationListReady, setAutomationListReady] = useState(false);
  useEffect(() => {
    if (mode !== "assistant" || !props.client) {
      setAutomationListReady(false);
      return;
    }
    const timer = window.setTimeout(
      () => setAutomationListReady(true),
      SIDEBAR_AUTOMATION_LIST_DEFER_MS,
    );
    return () => window.clearTimeout(timer);
  }, [mode, props.client, props.selectedWorkspaceId]);
  const automationQuery = useQuery({
    queryKey: ["onmyagent-automations", props.selectedWorkspaceId],
    enabled:
      mode === "assistant" && Boolean(props.client) && automationListReady,
    queryFn: async () => {
      const client = props.client;
      if (!client) throw new Error("OnMyAgent server unavailable");
      return client.listAutomations(props.selectedWorkspaceId);
    },
    refetchInterval: (query) =>
      automationListRefetchIntervalMs({
        anyRunning: Boolean(query.state.data?.items.some((item) => item.running)),
      }),
    // Pause interval while backgrounded without permanently disabling it.
    refetchIntervalInBackground: false,
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
  const [archivedRevision, setArchivedRevision] = useState(0);
  const assistantArchivedTasks = useMemo(
    () => readAssistantArchivedTasks(props.selectedWorkspaceId),
    [props.selectedWorkspaceId, archivedRevision],
  );
  const assistantArchivedIdSet = useMemo(
    () => archivedSessionIdSet(assistantArchivedTasks),
    [assistantArchivedTasks],
  );
  const automationSessionRecords =
    useMemo(
      () =>
        mode === "assistant"
          ? readAutomationSessionRecords(props.selectedWorkspaceId)
          : [],
      [automationRevision, mode, props.selectedWorkspaceId],
    );
  const excludedAutomationSessionIds = useMemo(() => {
    if (mode !== "assistant") return new Set<string>();
    const deleted = readDeletedAutomationSessionIds(props.selectedWorkspaceId);
    return new Set([...deleted, ...assistantArchivedIdSet]);
  }, [
    automationRevision,
    archivedRevision,
    assistantArchivedIdSet,
    mode,
    props.selectedWorkspaceId,
  ]);
  const sessions: WorkspaceSessionGroup["sessions"] = useMemo(
    () =>
      mode === "assistant"
        ? mergeAutomationSessions(
            group?.sessions ?? [],
            automationSessionRecords,
            excludedAutomationSessionIds,
          )
        : group?.sessions ?? [],
    [
      automationSessionRecords,
      excludedAutomationSessionIds,
      group?.sessions,
      mode,
    ],
  );
  const assistantSessions = useMemo(
    () =>
      mode === "assistant"
        ? sessions.filter((session) => isAssistantSession(session.id))
        : [],
    [mode, sessions],
  );
  const [workspaceBindRevision, setWorkspaceBindRevision] = useState(0);
  const assistantWorkspaceRecords = useMemo(
    () =>
      mode === "assistant"
        ? readAssistantSessionWorkspaces(props.selectedWorkspaceId)
        : [],
    [mode, props.selectedWorkspaceId, workspaceBindRevision],
  );
  const assistantWorkspaceBySessionId = useMemo(
    () => new Map(assistantWorkspaceRecords.map((item) => [item.sessionId, item])),
    [assistantWorkspaceRecords],
  );

  useEffect(() => {
    if (mode !== "assistant") return;
    const onChanged = (event: Event) => {
      const owner = readAssistantSessionWorkspaceChangeOwner(event);
      if (owner && owner !== props.selectedWorkspaceId) return;
      setWorkspaceBindRevision((value) => value + 1);
    };
    window.addEventListener(assistantSessionWorkspacesChangedEvent, onChanged);
    return () => {
      window.removeEventListener(
        assistantSessionWorkspacesChangedEvent,
        onChanged,
      );
    };
  }, [mode, props.selectedWorkspaceId]);
  // Non-selected preview snapshots are off (SIDEBAR_PREVIEW_SNAPSHOT_MAX=0).
  // Selected session transcript loads via SessionSurface only.
  const { previewSessionIds: assistantPreviewIds } = useDeferredSidebarPreviews({
    enabled: mode === "assistant" && Boolean(props.client),
    sessions: assistantSessions,
    selectedSessionId: props.selectedSessionId,
  });
  const assistantSnapshotQueries = useQueries({
    queries: assistantSessions.map((session) => ({
      queryKey: [
        "onmyagent-assistant-task-snapshot",
        props.selectedWorkspaceId,
        session.id,
      ],
      enabled:
        Boolean(props.client) &&
        !session.id.startsWith("draft:") &&
        assistantPreviewIds.has(session.id) &&
        !shouldSkipSnapshotForNotFoundCooldown({
          sessionId: session.id,
          notFoundUntilBySessionId: snapshotNotFoundUntilBySessionId,
          nowMs: Date.now(),
        }),
      queryFn: async () => {
        const client = props.client;
        if (!client) throw new Error("OnMyAgent server unavailable");
        if (
          shouldSkipSnapshotForNotFoundCooldown({
            sessionId: session.id,
            notFoundUntilBySessionId: snapshotNotFoundUntilBySessionId,
            nowMs: Date.now(),
          })
        ) {
          return null;
        }
        try {
          return (
            await client.getSessionSnapshot(
              props.selectedWorkspaceId,
              session.id,
              {
                limit: SIDEBAR_PREVIEW_SNAPSHOT_MESSAGE_LIMIT,
                directory:
                  assistantWorkspaceBySessionId.get(session.id)?.directory,
              },
            )
          ).item;
        } catch (error) {
          if (isSessionSnapshotNotFoundError(error)) {
            markSessionSnapshotNotFound({
              sessionId: session.id,
              notFoundUntilBySessionId: snapshotNotFoundUntilBySessionId,
              nowMs: Date.now(),
            });
            return null;
          }
          throw error;
        }
      },
      staleTime: 30_000,
      retry: (failureCount: number, error: unknown) =>
        shouldRetrySessionSnapshotQuery(failureCount, error),
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

  // Expert list: one snapshot per expert’s latest session → last-message subtitle.
  const expertLatestSessions = useMemo(() => {
    if (mode !== "agent") return [];
    const groups = buildAgentConversationGroups(sessions, registry);
    const seen = new Set<string>();
    const list: WorkspaceSessionGroup["sessions"] = [];
    for (const group of groups) {
      const session = group.latestSession;
      if (!session || session.id.startsWith("draft:") || seen.has(session.id)) {
        continue;
      }
      seen.add(session.id);
      list.push(session);
    }
    return list;
  }, [mode, registry, sessions]);

  const { previewSessionIds: expertPreviewIds } = useDeferredSidebarPreviews({
    enabled: mode === "agent" && Boolean(props.client),
    sessions: expertLatestSessions,
    selectedSessionId: props.selectedSessionId,
  });
  const expertSnapshotQueries = useQueries({
    queries: expertLatestSessions.map((session) => ({
      queryKey: [
        "onmyagent-expert-list-snapshot",
        props.selectedWorkspaceId,
        session.id,
      ],
      enabled:
        Boolean(props.client) &&
        mode === "agent" &&
        expertPreviewIds.has(session.id) &&
        !shouldSkipSnapshotForNotFoundCooldown({
          sessionId: session.id,
          notFoundUntilBySessionId: snapshotNotFoundUntilBySessionId,
          nowMs: Date.now(),
        }),
      queryFn: async () => {
        const client = props.client;
        if (!client) throw new Error("OnMyAgent server unavailable");
        if (
          shouldSkipSnapshotForNotFoundCooldown({
            sessionId: session.id,
            notFoundUntilBySessionId: snapshotNotFoundUntilBySessionId,
            nowMs: Date.now(),
          })
        ) {
          return null;
        }
        try {
          return (
            await client.getSessionSnapshot(
              props.selectedWorkspaceId,
              session.id,
              { limit: SIDEBAR_PREVIEW_SNAPSHOT_MESSAGE_LIMIT },
            )
          ).item;
        } catch (error) {
          if (isSessionSnapshotNotFoundError(error)) {
            markSessionSnapshotNotFound({
              sessionId: session.id,
              notFoundUntilBySessionId: snapshotNotFoundUntilBySessionId,
              nowMs: Date.now(),
            });
            return null;
          }
          throw error;
        }
      },
      staleTime: 30_000,
      retry: (failureCount: number, error: unknown) =>
        shouldRetrySessionSnapshotQuery(failureCount, error),
    })),
  });

  const expertPreviewBySessionId = useMemo(() => {
    const map = new Map<string, string>();
    expertLatestSessions.forEach((session, index) => {
      const snapshot = expertSnapshotQueries[index]?.data;
      if (!snapshot) return;
      const summary = snapshotConversationSummary(
        snapshot,
        session.time?.updated ?? session.time?.created,
        { preferAssistantReply: true },
      );
      const preview = summary.preview?.trim();
      if (
        preview &&
        preview !== t("session.default_title")
      ) {
        map.set(session.id, preview);
      }
    });
    return map;
  }, [expertLatestSessions, expertSnapshotQueries]);

  const normalizedQuery = props.query.trim().toLowerCase();
  const agentGroups = useMemo(
    () =>
      mode === "assistant"
        ? buildAssistantConversationGroups(
            sessions,
            assistantTitleFallbacks,
            assistantPreviewBySessionId,
          )
        : buildAgentConversationGroups(
            sessions,
            registry,
            expertPreviewBySessionId,
          ),
    [
      assistantPreviewBySessionId,
      assistantTitleFallbacks,
      expertPreviewBySessionId,
      mode,
      registry,
      sessions,
    ],
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
  const starterItems: AgentStarterItem[] = [];
  const filteredAgentGroups = useMemo(() => {
    // Soft-archived sessions disappear from expert list (same store as settings archive).
    const base =
      mode !== "assistant"
        ? visibleAgentGroups.flatMap((group) => {
            const sessions = group.sessions.filter(
              (session) => !assistantArchivedIdSet.has(session.id),
            );
            if (sessions.length === 0) return [];
            const latestSession =
              sessions.find((session) => session.id === group.latestSession.id) ??
              sessions[0]!;
            return [{ ...group, sessions, latestSession }];
          })
        : visibleAgentGroups;
    if (!normalizedQuery) return base;
    // Home: match task title (description / session title), not assistant product name.
    if (mode === "assistant") {
      return base.filter((item) => {
        const title = (
          item.description ||
          item.latestSession?.title ||
          ""
        ).toLowerCase();
        return title.includes(normalizedQuery);
      });
    }
    return base.filter((item) =>
      `${item.name} ${item.description} ${item.preview ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [
    assistantArchivedIdSet,
    mode,
    normalizedQuery,
    visibleAgentGroups,
  ]);
  const activeAssistantCategoryId = props.assistantCategoryId ?? "office";
  const assistantCategoryGroups = useMemo(
    () =>
      mode === "assistant"
        ? filteredAgentGroups.filter(
            (item) =>
              readAssistantSessionCategory(item.latestSession.id) ===
              activeAssistantCategoryId,
          )
        : filteredAgentGroups,
    [activeAssistantCategoryId, filteredAgentGroups, mode],
  );
  /** Raw partition only — full list model goes through buildAssistantSidebarModel. */
  const categoryPartition = useMemo(
    () =>
      mode === "assistant"
        ? partitionCategoryGroupsForSidebar({
            categoryGroups: assistantCategoryGroups,
            categoryId: activeAssistantCategoryId,
            automationRecords: automationSessionRecords,
          })
        : {
            regularGroups: assistantCategoryGroups,
            automationGroupsRaw: [] as ReturnType<
              typeof partitionCategoryGroupsForSidebar
            >["automationGroupsRaw"],
          },
    [
      activeAssistantCategoryId,
      assistantCategoryGroups,
      automationSessionRecords,
      mode,
    ],
  );
  const automationGroupsRaw = categoryPartition.automationGroupsRaw;

  const [assistantGlobalPins, setAssistantGlobalPins] = useState<
    AssistantGlobalPin[]
  >(() => readAssistantGlobalPins(props.selectedWorkspaceId));
  /** directory → local pin order (sessions pinned inside a space folder). */
  const [spaceLocalPinsByDirectory, setSpaceLocalPinsByDirectory] = useState<
    Record<string, string[]>
  >(() => {
    const map: Record<string, string[]> = {};
    for (const record of readAssistantSessionWorkspaces(
      props.selectedWorkspaceId,
    )) {
      const dir = record.directory?.trim();
      if (!dir || map[dir]) continue;
      map[dir] = readAssistantSpaceLocalPins(props.selectedWorkspaceId, dir);
    }
    return map;
  });
  /** automationId → local pin order (sessions pinned inside a scheduled group). */
  const [automationLocalPinsById, setAutomationLocalPinsById] = useState<
    Record<string, string[]>
  >({});

  // Hydrate local pins whenever automation groups appear / change.
  // Bail out when the map is deeply equal so we never setState every render.
  useEffect(() => {
    if (mode !== "assistant") return;
    const next = buildAutomationLocalPinsMap(
      automationGroupsRaw.map((group) => group.id),
      (scope) =>
        readAssistantSpaceLocalPins(props.selectedWorkspaceId, scope),
    );
    setAutomationLocalPinsById((current) =>
      localPinMapsEqual(current, next) ? current : next,
    );
  }, [automationGroupsRaw, mode, props.selectedWorkspaceId]);

  const [spaceFolderOrder, setSpaceFolderOrder] = useState<string[]>(() =>
    readAssistantSpaceFolderOrder(props.selectedWorkspaceId),
  );

  const assistantSidebarModel = useMemo(
    () =>
      buildAssistantSidebarModel({
        categoryGroups: assistantCategoryGroups,
        categoryId: activeAssistantCategoryId,
        globalPins: assistantGlobalPins,
        spaceLocalPinsByDirectory,
        spaceFolderOrder,
        workspaceBySessionId: assistantWorkspaceBySessionId,
        automationRecords: automationSessionRecords,
        archivedIdSet: assistantArchivedIdSet,
        automationLocalPinsById,
      }),
    [
      activeAssistantCategoryId,
      assistantArchivedIdSet,
      assistantCategoryGroups,
      assistantGlobalPins,
      assistantWorkspaceBySessionId,
      automationLocalPinsById,
      automationSessionRecords,
      spaceFolderOrder,
      spaceLocalPinsByDirectory,
    ],
  );
  const assistantListModel = assistantSidebarModel.listModel;
  const automationGroupsAll = assistantSidebarModel.automationGroupsAll;
  const automationGroups = assistantSidebarModel.automationGroups;

  const [expandedAssistantDirectories, setExpandedAssistantDirectories] =
    useState<string[]>([]);
  const [expandedAutomationDirectories, setExpandedAutomationDirectories] =
    useState<string[]>([]);
  const assistantSpaceDirectoryKey = Array.from(
    assistantListModel.spaceItemsByDirectory.keys(),
  ).join("\n");
  const automationDirectoryKey = automationGroupsAll
    .map((group) => group.id)
    .join("\n");

  useEffect(() => {
    setAssistantGlobalPins(readAssistantGlobalPins(props.selectedWorkspaceId));
    setSpaceFolderOrder(
      readAssistantSpaceFolderOrder(props.selectedWorkspaceId),
    );
    const map: Record<string, string[]> = {};
    for (const record of readAssistantSessionWorkspaces(
      props.selectedWorkspaceId,
    )) {
      const dir = record.directory?.trim();
      if (!dir || map[dir]) continue;
      map[dir] = readAssistantSpaceLocalPins(props.selectedWorkspaceId, dir);
    }
    setSpaceLocalPinsByDirectory(map);
  }, [props.selectedWorkspaceId, workspaceBindRevision]);

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
    const availableSessionIds = new Set(
      agentGroups.map((item) => item.latestSession.id),
    );
    const availableFolders = new Set(
      assistantWorkspaceRecords
        .map((item) => item.directory?.trim())
        .filter((item): item is string => Boolean(item)),
    );
    // All automations in the workspace — not category-scoped (else code view
    // would strip office automation pins from storage).
    const availableAutomations = new Set(
      automationSessionRecords.map((record) => record.automationId),
    );
    setAssistantGlobalPins((current) => {
      const next = current.filter((pin) => {
        if (pin.kind === "session") return availableSessionIds.has(pin.id);
        if (pin.kind === "folder") return availableFolders.has(pin.id);
        if (pin.kind === "automation") return availableAutomations.has(pin.id);
        return false;
      });
      if (next.length === current.length) return current;
      writeAssistantGlobalPins(props.selectedWorkspaceId, next);
      return next;
    });
  }, [
    agentGroups,
    assistantWorkspaceRecords,
    automationSessionRecords,
    mode,
    props.selectedWorkspaceId,
  ]);

  const folderPathBySessionId = assistantListModel.folderPathBySessionId;

  const automationIdBySessionId = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of automationSessionRecords) {
      if (record.sessionId) map.set(record.sessionId, record.automationId);
    }
    return map;
  }, [automationSessionRecords]);

  /**
   * Task sessions → global pin;
   * space sessions → pin inside that folder only;
   * automation runs → pin inside that scheduled group only.
   */
  const toggleAssistantPinnedSession = useCallback(
    (sessionId: string) => {
      const automationId = automationIdBySessionId.get(sessionId)?.trim() || null;
      if (automationId) {
        const scope = automationLocalPinScope(automationId);
        if (!scope) return;
        setAutomationLocalPinsById((current) => {
          const prev = current[automationId] ?? [];
          const nextIds = prev.includes(sessionId)
            ? prev.filter((id) => id !== sessionId)
            : [sessionId, ...prev];
          writeAssistantSpaceLocalPins(
            props.selectedWorkspaceId,
            scope,
            nextIds,
          );
          return { ...current, [automationId]: nextIds };
        });
        return;
      }
      const spaceDir = folderPathBySessionId.get(sessionId)?.trim() || null;
      if (spaceDir) {
        setSpaceLocalPinsByDirectory((current) => {
          const prev = current[spaceDir] ?? [];
          const nextIds = prev.includes(sessionId)
            ? prev.filter((id) => id !== sessionId)
            : [sessionId, ...prev];
          writeAssistantSpaceLocalPins(
            props.selectedWorkspaceId,
            spaceDir,
            nextIds,
          );
          return { ...current, [spaceDir]: nextIds };
        });
        return;
      }
      setAssistantGlobalPins((current) => {
        const exists = current.some(
          (pin) => pin.kind === "session" && pin.id === sessionId,
        );
        const next = exists
          ? current.filter(
              (pin) => !(pin.kind === "session" && pin.id === sessionId),
            )
          : [{ kind: "session" as const, id: sessionId }, ...current];
        writeAssistantGlobalPins(props.selectedWorkspaceId, next);
        return next;
      });
    },
    [
      automationIdBySessionId,
      folderPathBySessionId,
      props.selectedWorkspaceId,
    ],
  );

  const toggleAssistantPinnedFolder = useCallback(
    (directory: string) => {
      const dir = directory.trim();
      if (!dir) return;
      setAssistantGlobalPins((current) => {
        const exists = current.some(
          (pin) => pin.kind === "folder" && pin.id === dir,
        );
        const next = exists
          ? current.filter((pin) => !(pin.kind === "folder" && pin.id === dir))
          : [{ kind: "folder" as const, id: dir }, ...current];
        writeAssistantGlobalPins(props.selectedWorkspaceId, next);
        return next;
      });
    },
    [props.selectedWorkspaceId],
  );

  const toggleAssistantPinnedAutomationGroup = useCallback(
    (groupId: string) => {
      const id = groupId.trim();
      if (!id) return;
      setAssistantGlobalPins((current) => {
        const exists = current.some(
          (pin) => pin.kind === "automation" && pin.id === id,
        );
        const next = exists
          ? current.filter(
              (pin) => !(pin.kind === "automation" && pin.id === id),
            )
          : [{ kind: "automation" as const, id }, ...current];
        writeAssistantGlobalPins(props.selectedWorkspaceId, next);
        return next;
      });
      // Keep the group expanded under the pin strip after pin.
      setExpandedAutomationDirectories((current) =>
        current.includes(id) ? current : [...current, id],
      );
    },
    [props.selectedWorkspaceId],
  );

  const reorderAssistantGlobalPins = useCallback(
    (fromIndex: number, toIndex: number) => {
      // UI indices are into the *category-visible* pin list; merge back so
      // pins that belong only to the other category keep their storage order.
      const visible = assistantListModel.globalPins;
      setAssistantGlobalPins((current) => {
        const next = mergeVisibleReorderIntoFull({
          full: current,
          visible,
          fromIndex,
          toIndex,
          keyOf: globalPinKey,
        });
        if (
          next.length === current.length &&
          next.every((pin, i) => globalPinKey(pin) === globalPinKey(current[i]!))
        ) {
          return current;
        }
        writeAssistantGlobalPins(props.selectedWorkspaceId, next);
        return next;
      });
    },
    [assistantListModel.globalPins, props.selectedWorkspaceId],
  );

  const reorderAssistantSpaceFolders = useCallback(
    (orderedDirectories: string[]) => {
      const unique = Array.from(
        new Set(orderedDirectories.map((d) => d.trim()).filter(Boolean)),
      );
      setSpaceFolderOrder(unique);
      writeAssistantSpaceFolderOrder(props.selectedWorkspaceId, unique);
    },
    [props.selectedWorkspaceId],
  );

  const archiveAssistantSessionCore = useCallback(
    (sessionId: string, title: string, options?: { silent?: boolean }) => {
      archiveAssistantTask(props.selectedWorkspaceId, {
        sessionId,
        title,
        directory: folderPathBySessionId.get(sessionId) ?? null,
        archivedAt: Date.now(),
        category: props.assistantCategoryId ?? null,
      });
      setArchivedRevision((value) => value + 1);
      // Drop pin membership when archiving so restore lands in the main list.
      const automationId =
        automationIdBySessionId.get(sessionId)?.trim() || null;
      if (automationId) {
        const scope = automationLocalPinScope(automationId);
        setAutomationLocalPinsById((current) => {
          const prev = current[automationId] ?? [];
          if (!prev.includes(sessionId)) return current;
          const nextIds = prev.filter((id) => id !== sessionId);
          if (scope) {
            writeAssistantSpaceLocalPins(
              props.selectedWorkspaceId,
              scope,
              nextIds,
            );
          }
          return { ...current, [automationId]: nextIds };
        });
      } else {
        const spaceDir = folderPathBySessionId.get(sessionId)?.trim() || null;
        if (spaceDir) {
          setSpaceLocalPinsByDirectory((current) => {
            const prev = current[spaceDir] ?? [];
            if (!prev.includes(sessionId)) return current;
            const nextIds = prev.filter((id) => id !== sessionId);
            writeAssistantSpaceLocalPins(
              props.selectedWorkspaceId,
              spaceDir,
              nextIds,
            );
            return { ...current, [spaceDir]: nextIds };
          });
        } else {
          setAssistantGlobalPins((current) => {
            const next = current.filter(
              (pin) => !(pin.kind === "session" && pin.id === sessionId),
            );
            if (next.length === current.length) return current;
            writeAssistantGlobalPins(props.selectedWorkspaceId, next);
            return next;
          });
        }
      }
      if (!options?.silent) {
        showToast({
          tone: "success",
          title: t("session.archive_task_done"),
        });
      }
    },
    [
      automationIdBySessionId,
      folderPathBySessionId,
      props.assistantCategoryId,
      props.selectedWorkspaceId,
      showToast,
    ],
  );

  const handleArchiveAssistantSession = useCallback(
    (sessionId: string, title: string) => {
      archiveAssistantSessionCore(sessionId, title);
    },
    [archiveAssistantSessionCore],
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

  const handleSaveToSpace = useCallback(
    (sessionId: string) => {
      if (!isDesktopRuntime()) {
        showToast({
          tone: "warning",
          title: t("session.save_to_space_desktop_only"),
        });
        return;
      }
      void pickDirectory({ title: t("session.save_to_space_pick") })
        .then((directory) => {
          const path = typeof directory === "string" ? directory.trim() : "";
          if (!path) return;
          writeAssistantSessionWorkspace({
            sessionId,
            ownerWorkspaceId: props.selectedWorkspaceId,
            directory: path,
          });
          dispatchAssistantSessionWorkspacesChanged(props.selectedWorkspaceId);
          setWorkspaceBindRevision((value) => value + 1);
          // Keep the space directory expanded so the moved task is visible.
          setExpandedAssistantDirectories((current) =>
            current.includes(path) ? current : [...current, path],
          );
          showToast({
            tone: "success",
            title: t("session.save_to_space_done"),
          });
        })
        .catch((error: unknown) => {
          showToast({
            tone: "error",
            title:
              error instanceof Error
                ? error.message
                : t("session.save_to_space_failed"),
          });
        });
    },
    [props.selectedWorkspaceId, showToast],
  );

  const handleRemoveSpaceDirectory = useCallback(
    (directory: string) => {
      const removed = removeAssistantSessionWorkspacesByDirectory(
        props.selectedWorkspaceId,
        directory,
      );
      if (removed <= 0) return;
      // Drop folder pin + local session pins for this directory.
      setAssistantGlobalPins((current) => {
        const next = current.filter(
          (pin) => !(pin.kind === "folder" && pin.id === directory),
        );
        if (next.length === current.length) return current;
        writeAssistantGlobalPins(props.selectedWorkspaceId, next);
        return next;
      });
      setSpaceLocalPinsByDirectory((current) => {
        if (!current[directory]) return current;
        const next = { ...current };
        delete next[directory];
        writeAssistantSpaceLocalPins(props.selectedWorkspaceId, directory, []);
        return next;
      });
      dispatchAssistantSessionWorkspacesChanged(props.selectedWorkspaceId);
      setWorkspaceBindRevision((value) => value + 1);
      setExpandedAssistantDirectories((current) =>
        current.filter((item) => item !== directory),
      );
      showToast({
        tone: "success",
        title: t("session.remove_from_space_list_done"),
      });
    },
    [props.selectedWorkspaceId, showToast],
  );

  /** Soft-archive every run under a scheduled-task (automation) group. */
  const handleArchiveAutomationGroup = useCallback(
    (groupId: string) => {
      const group = automationGroupsAll.find((item) => item.id === groupId);
      if (!group || group.items.length === 0) return;
      for (const item of group.items) {
        archiveAssistantSessionCore(
          item.latestSession.id,
          item.description,
          { silent: true },
        );
      }
      // Drop group from global pins + clear local pin order.
      setAssistantGlobalPins((current) => {
        const next = current.filter(
          (pin) => !(pin.kind === "automation" && pin.id === groupId),
        );
        if (next.length === current.length) return current;
        writeAssistantGlobalPins(props.selectedWorkspaceId, next);
        return next;
      });
      const scope = automationLocalPinScope(groupId);
      if (scope) {
        writeAssistantSpaceLocalPins(props.selectedWorkspaceId, scope, []);
      }
      setAutomationLocalPinsById((current) => {
        if (!current[groupId]) return current;
        const next = { ...current };
        delete next[groupId];
        return next;
      });
      showToast({
        tone: "success",
        title: t("session.archive_space_done"),
      });
    },
    [
      archiveAssistantSessionCore,
      automationGroupsAll,
      props.selectedWorkspaceId,
      showToast,
    ],
  );

  /** Soft-archive every session under a space folder, then unbind the folder. */
  const handleArchiveSpaceDirectory = useCallback(
    (directory: string) => {
      const dir = directory.trim();
      if (!dir) return;
      const sessionsInSpace = assistantWorkspaceRecords.filter(
        (record) => record.directory?.trim() === dir,
      );
      const now = Date.now();
      const titleBySessionId = new Map(
        assistantSidebarModel.regularGroups.map((group) => [
          group.latestSession.id,
          group.description,
        ]),
      );
      for (const record of sessionsInSpace) {
        archiveAssistantTask(props.selectedWorkspaceId, {
          sessionId: record.sessionId,
          title:
            titleBySessionId.get(record.sessionId) ??
            record.sessionId,
          directory: dir,
          archivedAt: now,
          category: props.assistantCategoryId ?? null,
        });
      }
      removeAssistantSessionWorkspacesByDirectory(
        props.selectedWorkspaceId,
        dir,
      );
      setAssistantGlobalPins((current) => {
        const next = current.filter(
          (pin) => !(pin.kind === "folder" && pin.id === dir),
        );
        if (next.length === current.length) return current;
        writeAssistantGlobalPins(props.selectedWorkspaceId, next);
        return next;
      });
      setSpaceLocalPinsByDirectory((current) => {
        if (!current[dir]) return current;
        const next = { ...current };
        delete next[dir];
        writeAssistantSpaceLocalPins(props.selectedWorkspaceId, dir, []);
        return next;
      });
      setSpaceFolderOrder((current) => {
        const next = current.filter((item) => item !== dir);
        if (next.length === current.length) return current;
        writeAssistantSpaceFolderOrder(props.selectedWorkspaceId, next);
        return next;
      });
      dispatchAssistantSessionWorkspacesChanged(props.selectedWorkspaceId);
      setWorkspaceBindRevision((value) => value + 1);
      setArchivedRevision((value) => value + 1);
      setExpandedAssistantDirectories((current) =>
        current.filter((item) => item !== dir),
      );
      showToast({
        tone: "success",
        title: t("session.archive_space_done"),
      });
    },
    [
      assistantSidebarModel.regularGroups,
      assistantWorkspaceRecords,
      props.assistantCategoryId,
      props.selectedWorkspaceId,
      showToast,
    ],
  );

  const handleCreateTaskInDirectory = useCallback(
    (directory: string) => {
      const path = directory.trim();
      if (!path) return;
      queueAssistantNewTaskDirectory(path);
      props.onCreateTask?.();
    },
    [props.onCreateTask],
  );



  useEffect(() => {
    setExpandedAssistantDirectories((current) => {
      const next = new Set(current);
      for (const directory of assistantListModel.spaceItemsByDirectory.keys()) {
        next.add(directory);
      }
      return next.size === current.length ? current : Array.from(next);
    });
    // assistantSpaceDirectoryKey fingerprints the directory set.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is the stable signal
  }, [assistantSpaceDirectoryKey]);

  useEffect(() => {
    setExpandedAutomationDirectories((current) => {
      const next = new Set(current);
      for (const group of automationGroupsAll) next.add(group.id);
      return next.size === current.length ? current : Array.from(next);
    });
    // automationDirectoryKey fingerprints the automation group id set.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is the stable signal
  }, [automationDirectoryKey]);

  /**
   * Search → click flow:
   * 1) Clear filter first so the full expert list (and row menus) return.
   * 2) Then open session / starter / draft.
   * Must run even when the row is already selected (common after typing a
   * query while that expert is open) — otherwise the UI stays stuck filtered.
   */
  const clearSearchIfNeeded = useCallback(() => {
    if (props.query.trim()) props.onQueryChange("");
  }, [props.onQueryChange, props.query]);

  const handleOpenSessionClearingSearch = useCallback(
    (workspaceId: string, sessionId: string) => {
      clearSearchIfNeeded();
      props.onOpenSession(workspaceId, sessionId);
    },
    [clearSearchIfNeeded, props.onOpenSession],
  );

  const handleOpenStarterClearingSearch = useCallback(
    (agentId: string) => {
      clearSearchIfNeeded();
      props.onOpenAgentStarter?.(agentId);
    },
    [clearSearchIfNeeded, props.onOpenAgentStarter],
  );

  const handleOpenDraftClearingSearch = useCallback(
    (sessionId: string) => {
      clearSearchIfNeeded();
      props.onOpenDraftAgent?.(sessionId);
    },
    [clearSearchIfNeeded, props.onOpenDraftAgent],
  );

  return (
    <aside
      className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-dls-sidebar px-2.5 pb-5 mac:bg-dls-sidebar mac:titlebar-no-drag"
      style={{ width: props.width }}
    >
      <AgentConversationPanelHeader
        mode={mode}
        query={props.query}
        selectedSessionId={props.selectedSessionId}
        automationActive={props.automationActive}
        onQueryChange={props.onQueryChange}
        onOpenAgents={() => {
          clearSearchIfNeeded();
          props.onOpenAgents();
        }}
        onCreateTask={props.onCreateTask}
        onOpenAssistant={props.onOpenAssistant}
        onOpenAutomation={props.onOpenAutomation}
      />

      <div
        className={cn(
          // Only the conversation list scrolls; search top, create pinned bottom.
          "min-h-0 flex-1 overflow-y-auto pr-0.5",
          // Even gap under primary chrome (home CTA strip / expert search).
          "pt-1.5",
        )}
      >
        {mode === "assistant" ? (
          <AssistantConversationSections
            categoryId={activeAssistantCategoryId}
            workspaceId={props.selectedWorkspaceId}
            selectedSessionId={props.selectedSessionId}
            sessionStatusById={props.sessionStatusById}
            automationGroups={automationGroups}
            automationGroupsAll={automationGroupsAll}
            automationLocalPinsById={automationLocalPinsById}
            listModel={assistantListModel}
            expandedDirectories={expandedAssistantDirectories}
            expandedAutomationDirectories={expandedAutomationDirectories}
            onExpandedDirectoriesChange={setExpandedAssistantDirectories}
            onExpandedAutomationDirectoriesChange={setExpandedAutomationDirectories}
            onOpenSession={handleOpenSessionClearingSearch}
            onPrefetchSession={props.onPrefetchSession}
            onTogglePinned={toggleAssistantPinnedSession}
            onToggleFolderPinned={toggleAssistantPinnedFolder}
            onToggleAutomationGroupPinned={toggleAssistantPinnedAutomationGroup}
            onReorderGlobalPins={reorderAssistantGlobalPins}
            onReorderSpaceFolders={reorderAssistantSpaceFolders}
            onRenameSession={props.onRenameSession}
            onArchiveSession={handleArchiveAssistantSession}
            onDeleteSession={props.onDeleteSession}
            onOpenFolder={handleOpenFolder}
            onSaveToSpace={handleSaveToSpace}
            onRemoveSpaceDirectory={handleRemoveSpaceDirectory}
            onArchiveSpaceDirectory={handleArchiveSpaceDirectory}
            onCreateTaskInDirectory={handleCreateTaskInDirectory}
            onArchiveAutomationGroup={handleArchiveAutomationGroup}
            onDeleteAutomationGroup={props.onDeleteAutomationGroup}
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
            onOpenSession={handleOpenSessionClearingSearch}
            onOpenDraftSession={handleOpenDraftClearingSearch}
            onOpenStarter={handleOpenStarterClearingSearch}
            onPrefetchSession={props.onPrefetchSession}
            onEditExpert={props.onEditExpert}
            editableExpertIds={props.editableExpertIds}
            deletableExpertIds={props.deletableExpertIds}
            onDeleteExpert={props.onDeleteExpert}
          />
        )}
      </div>

      {/* Footer create CTA — same placement/style for home + experts. */}
      {mode === "assistant" && props.onCreateTask ? (
        <div className="shrink-0 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sidebar-cta"
            onClick={() => {
              clearSearchIfNeeded();
              props.onCreateTask?.();
            }}
            className={SIDEBAR_FOOTER_CTA_CLASS}
            data-assistant-create="true"
          >
            <Plus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
            {t("session.new_task")}
          </Button>
        </div>
      ) : null}
      {mode === "agent" && (props.onCreateExpert || props.onOpenAgents) ? (
        <div className="shrink-0 pt-2">
          {/*
            Summon experts — same pattern as store "Add skill" dropdown:
            market browse vs self-create (expert creation wizard).
          */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sidebar-cta"
                  className={SIDEBAR_FOOTER_CTA_CLASS}
                  data-expert-create="true"
                  onClick={() => clearSearchIfNeeded()}
                >
                  <Users className="size-4 shrink-0" strokeWidth={2} aria-hidden />
                  {t("session.summon_experts")}
                  <ChevronDown
                    className="size-3.5 shrink-0 opacity-70"
                    strokeWidth={2}
                    aria-hidden
                  />
                </Button>
              }
            />
            <DropdownMenuContent
              align="center"
              side="top"
              sideOffset={8}
              className="min-w-[12rem] border border-dls-border bg-dls-surface-solid p-1.5 text-dls-text"
            >
              {props.onOpenAgents ? (
                <DropdownMenuItem
                  className="cursor-pointer gap-2 text-dls-text focus:bg-dls-hover"
                  onClick={() => {
                    clearSearchIfNeeded();
                    props.onOpenAgents();
                  }}
                >
                  <Store className="size-4 shrink-0 text-dls-secondary" />
                  {t("session.add_expert_from_market")}
                </DropdownMenuItem>
              ) : null}
              {props.onCreateExpert ? (
                <DropdownMenuItem
                  className="cursor-pointer gap-2 text-dls-text focus:bg-dls-hover"
                  onClick={() => {
                    clearSearchIfNeeded();
                    props.onCreateExpert?.();
                  }}
                >
                  <UserPlus className="size-4 shrink-0 text-dls-secondary" />
                  {t("session.create_expert_yourself")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </aside>
  );
}
