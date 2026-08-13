import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  TaskOrchestratorAlignmentMessageInput,
  TaskOrchestratorArtifactContentGetInput,
  TaskOrchestratorArtifactContentResult,
  TaskOrchestratorDesktopEvent,
  TaskOrchestratorEvent,
  TaskOrchestratorFinalizeContractInput,
  TaskOrchestratorRecoveryInput,
  TaskOrchestratorArtifactGetInput,
  TaskOrchestratorResolveGateInput,
  TaskOrchestratorRetryInput,
  TaskOrchestratorSnapshot,
  TaskOrchestratorTurnHistoryItem,
  TaskOrchestratorTurnHistoryListResult,
  TaskOrchestratorTaskCreateInput,
  TaskOrchestratorTaskArchiveInput,
  TaskOrchestratorTaskListResult,
  TaskOrchestratorTaskRestoreInput,
  TaskOrchestratorTaskUpdateInput,
  TaskOrchestratorHandoffArtifact,
} from "@onmyagent/types";

import { personalLocalAgentsList } from "@/app/lib/desktop-local-agents";
import {
  taskOrchestratorAlignmentMessage,
  taskOrchestratorAlignmentCancel,
  taskOrchestratorArtifactContentGet,
  taskOrchestratorArtifactGet,
  taskOrchestratorArtifactsList,
  taskOrchestratorContractFinalize,
  taskOrchestratorGateResolve,
  taskOrchestratorPrimaryRetry,
  taskOrchestratorRecoveryContinue,
  taskOrchestratorTaskCreate,
  taskOrchestratorTaskArchive,
  taskOrchestratorTaskGet,
  taskOrchestratorTaskPause,
  taskOrchestratorTaskRestore,
  taskOrchestratorTaskResume,
  taskOrchestratorTaskStart,
  taskOrchestratorTaskStop,
  taskOrchestratorTaskUpdate,
  taskOrchestratorTasksList,
  taskOrchestratorEventsList,
  taskOrchestratorRunsList,
  taskOrchestratorTurnHistoryList,
  taskOrchestratorOperationsDiagnosticsGet,
  subscribeTaskOrchestratorEvents,
} from "@/app/lib/desktop-task-orchestrator";
import type { PersonalLocalAgent } from "@/app/lib/desktop-types";
import {
  taskCenterListPollInterval,
  taskCenterSnapshotPollInterval,
  usableTaskCenterAgents,
  type TaskCenterCatalog,
} from "./task-center-model";

export const taskCenterListQueryKey = (workspaceRoot: string) =>
  ["task-center", "tasks", workspaceRoot] as const;

export const taskCenterSnapshotQueryKey = (taskId: string | null, taskRunId: string | null = null) =>
  ["task-center", "snapshot", taskId ?? "none", taskRunId ?? "latest"] as const;

export const taskCenterRunsQueryKey = (taskId: string | null) =>
  ["task-center", "runs", taskId ?? "none"] as const;

export const taskCenterTurnHistoryQueryKey = (taskId: string | null, taskRunId: string | null) =>
  ["task-center", "turn-history", taskId ?? "none", taskRunId ?? "none"] as const;

export const taskCenterOperationsDiagnosticsQueryKey = (taskId: string | null, taskRunId: string | null) =>
  ["task-center", "operations-diagnostics", taskId ?? "none", taskRunId ?? "none"] as const;

export const taskCenterEventsQueryKey = (taskId: string | null, taskRunId: string | null = null) =>
  ["task-center", "events", taskId ?? "none", taskRunId ?? "all"] as const;

export const taskCenterArtifactsQueryKey = (taskId: string | null, taskRunId: string | null) =>
  ["task-center", "artifacts", taskId ?? "none", taskRunId ?? "none"] as const;

export const taskCenterCatalogQueryKey = (workspaceRoot: string) =>
  ["task-center", "personal-catalog", workspaceRoot] as const;

export function flattenTaskCenterTurnHistoryPages(
  pages: readonly Pick<TaskOrchestratorTurnHistoryListResult, "items">[],
): TaskOrchestratorTurnHistoryItem[] {
  return pages.flatMap((page) => page.items);
}

export function taskCenterTurnHistoryNextCursor(
  page: Pick<TaskOrchestratorTurnHistoryListResult, "hasMore" | "nextCursor">,
): string | undefined {
  return page.hasMore ? page.nextCursor ?? undefined : undefined;
}

const TASK_CENTER_OPERATIONS_ACTIVE_STATUSES = new Set([
  "queued",
  "running",
  "checkpointing",
  "pausing",
  "backoff",
  "waiting-approval",
]);

export function taskCenterOperationsDiagnosticsPollInterval(status: string | null | undefined): number | false {
  return status && TASK_CENTER_OPERATIONS_ACTIVE_STATUSES.has(status) ? 5_000 : false;
}

export type TaskCenterActionName = "create" | "alignment" | "alignmentCancel" | "finalize" | "update" | "start" | "stop" | "pause" | "resume" | "retry" | "recovery" | "gate" | "archive" | "restore";
export type TaskCenterActionErrorMap = Partial<Record<TaskCenterActionName, unknown>>;
export type TaskCenterActionPendingMap = Record<TaskCenterActionName, boolean>;

const TASK_CENTER_ARTIFACT_CHUNK_CHARS = 64_000;
const TASK_CENTER_ARTIFACT_MAX_CHARS = 500_000;
const TASK_CENTER_ARTIFACT_MAX_CHUNKS = Math.ceil(TASK_CENTER_ARTIFACT_MAX_CHARS / TASK_CENTER_ARTIFACT_CHUNK_CHARS) + 1;
const TASK_CENTER_ARTIFACT_EVIDENCE_PAGE_SIZE = 2;
const TASK_CENTER_ARTIFACT_MAX_EVIDENCE = 100;
const TASK_CENTER_ARTIFACT_MAX_REQUESTS = TASK_CENTER_ARTIFACT_MAX_CHUNKS + Math.ceil(TASK_CENTER_ARTIFACT_MAX_EVIDENCE / TASK_CENTER_ARTIFACT_EVIDENCE_PAGE_SIZE) + 1;

type ArtifactContentRequest = TaskOrchestratorArtifactContentGetInput & {
  evidenceOffset?: number;
  evidenceLimit?: number;
};
type ArtifactChunkLoader = (input: ArtifactContentRequest) => Promise<TaskOrchestratorArtifactContentResult>;
type ArtifactFullLoader = (input: TaskOrchestratorArtifactGetInput) => Promise<TaskOrchestratorHandoffArtifact>;
type CompatibleArtifactContentResult = Omit<
  TaskOrchestratorArtifactContentResult,
  "evidenceOffset" | "evidence" | "nextEvidenceOffset" | "evidenceComplete" | "totalEvidence"
> & {
  evidenceOffset?: number;
  evidence?: TaskOrchestratorHandoffArtifact["evidence"];
  nextEvidenceOffset?: number | null;
  evidenceComplete?: boolean;
  totalEvidence?: number;
};

function artifactMetadataMatches(
  expected: TaskOrchestratorArtifactContentResult["artifact"],
  actual: TaskOrchestratorArtifactContentResult["artifact"],
): boolean {
  return (
    expected.schemaVersion === actual.schemaVersion &&
    expected.id === actual.id &&
    expected.taskId === actual.taskId &&
    expected.taskRunId === actual.taskRunId &&
    expected.taskRevision === actual.taskRevision &&
    expected.attemptId === actual.attemptId &&
    expected.turnId === actual.turnId &&
    expected.kind === actual.kind &&
    expected.summary === actual.summary &&
    expected.evidenceCount === actual.evidenceCount &&
    expected.contentBytes === actual.contentBytes &&
    expected.contentSha256 === actual.contentSha256 &&
    expected.createdAt === actual.createdAt
  );
}

/**
 * Read immutable artifact content and evidence in bounded pages. The response
 * metadata is the source of truth for the reconstructed immutable artifact;
 * ArtifactGet is only retained as a compatibility fallback for small artifacts
 * served by an older desktop runtime that has no evidence cursor fields.
 */
export async function loadTaskCenterArtifactContent(input: {
  taskId: string;
  taskRunId: string;
  artifactId: string;
  snapshotArtifact?: TaskOrchestratorHandoffArtifact;
  loadChunk?: ArtifactChunkLoader;
  loadFull?: ArtifactFullLoader;
}): Promise<TaskOrchestratorHandoffArtifact> {
  const loadChunk = input.loadChunk ?? taskOrchestratorArtifactContentGet;
  const loadFull = input.loadFull ?? taskOrchestratorArtifactGet;
  const chunks: string[] = [];
  let contentOffset = 0;
  let totalChars: number | null = null;
  let metadata: TaskOrchestratorArtifactContentResult["artifact"] | null = null;
  let contentComplete = false;
  let evidenceOffset = 0;
  let evidenceComplete = false;
  let evidencePaginationAvailable = false;
  let requestEvidenceCursors = false;
  let totalEvidence: number | null = null;
  const evidence: TaskOrchestratorHandoffArtifact["evidence"] = [];

  for (let requestIndex = 0; requestIndex < TASK_CENTER_ARTIFACT_MAX_REQUESTS; requestIndex += 1) {
    const requestOffset = contentComplete ? totalChars : contentOffset;
    if (requestOffset === null) throw new Error("Artifact content cursor was not initialized");
    const request: ArtifactContentRequest = {
      taskId: input.taskId,
      taskRunId: input.taskRunId,
      artifactId: input.artifactId,
      offset: requestOffset,
      // Keep the content loop bounded while allowing evidence-only requests
      // after the final content page has been consumed.
      limitChars: contentComplete ? 1 : TASK_CENTER_ARTIFACT_CHUNK_CHARS,
    };
    if (requestEvidenceCursors) {
      request.evidenceOffset = evidenceOffset;
      request.evidenceLimit = TASK_CENTER_ARTIFACT_EVIDENCE_PAGE_SIZE;
    }
    const page = (await loadChunk(request)) as CompatibleArtifactContentResult;

    if (page.offset !== requestOffset) throw new Error("Artifact content offset changed during loading");
    if (!metadata) metadata = page.artifact;
    if (!artifactMetadataMatches(metadata, page.artifact)) throw new Error("Artifact metadata changed during loading");
    if (page.totalChars > TASK_CENTER_ARTIFACT_MAX_CHARS) throw new Error("Artifact content exceeds the renderer safety limit");
    if (totalChars === null) totalChars = page.totalChars;
    if (page.totalChars !== totalChars) throw new Error("Artifact content length changed during loading");

    if (!contentComplete) {
      chunks.push(page.contentChunk);
      const consumed = contentOffset + page.contentChunk.length;
      if (consumed > page.totalChars) throw new Error("Artifact content chunk exceeded the declared length");
      if (page.complete) {
        if (page.nextOffset !== null || consumed !== page.totalChars) throw new Error("Artifact content terminated with an invalid cursor");
        contentComplete = true;
      } else {
        if (page.nextOffset === null || page.nextOffset !== consumed || page.nextOffset <= contentOffset) {
          throw new Error("Artifact content cursor did not advance");
        }
        contentOffset = page.nextOffset;
      }
    } else if (!page.complete || page.nextOffset !== null || page.contentChunk.length !== 0) {
      throw new Error("Artifact evidence page changed completed content");
    }

    const hasEvidencePage =
      typeof page.evidenceOffset === "number" &&
      Array.isArray(page.evidence) &&
      typeof page.totalEvidence === "number" &&
      typeof page.evidenceComplete === "boolean" &&
      (page.nextEvidenceOffset === null || typeof page.nextEvidenceOffset === "number");
    if (hasEvidencePage) {
      evidencePaginationAvailable = true;
      requestEvidenceCursors = true;
      if (page.evidenceOffset !== evidenceOffset) throw new Error("Artifact evidence offset changed during loading");
      if (totalEvidence === null) totalEvidence = page.totalEvidence ?? null;
      if (page.totalEvidence !== totalEvidence || page.totalEvidence > TASK_CENTER_ARTIFACT_MAX_EVIDENCE) {
        throw new Error("Artifact evidence length changed during loading");
      }
      evidence.push(...(page.evidence ?? []));
      const consumedEvidence = evidenceOffset + (page.evidence?.length ?? 0);
      if (consumedEvidence > page.totalEvidence) throw new Error("Artifact evidence page exceeded the declared length");
      if (page.evidenceComplete) {
        if (page.nextEvidenceOffset !== null || consumedEvidence !== page.totalEvidence) {
          throw new Error("Artifact evidence terminated with an invalid cursor");
        }
        evidenceOffset = consumedEvidence;
        evidenceComplete = true;
      } else {
        if (page.nextEvidenceOffset === null || page.nextEvidenceOffset !== consumedEvidence || page.nextEvidenceOffset <= evidenceOffset) {
          throw new Error("Artifact evidence cursor did not advance");
        }
        evidenceOffset = page.nextEvidenceOffset;
      }
    }

    if (contentComplete && (evidenceComplete || !evidencePaginationAvailable)) break;
  }
  if (!contentComplete || !metadata || totalChars === null) throw new Error("Artifact content exceeded the bounded chunk loop");

  let resolvedEvidence: TaskOrchestratorHandoffArtifact["evidence"];
  if (evidencePaginationAvailable) {
    if (!evidenceComplete || totalEvidence === null) throw new Error("Artifact evidence exceeded the bounded page loop");
    resolvedEvidence = evidence;
  } else {
    // Older desktop runtimes exposed evidence only in snapshots/full artifacts.
    // Do not call ArtifactGet for large content: it is explicitly rejected by
    // the desktop store and would turn a usable content load into a false error.
    const snapshotEvidence = input.snapshotArtifact?.evidence ?? [];
    resolvedEvidence = snapshotEvidence.slice(0, metadata.evidenceCount);
    if (resolvedEvidence.length < metadata.evidenceCount && totalChars <= TASK_CENTER_ARTIFACT_CHUNK_CHARS) {
      try {
        const full = await loadFull({
          taskId: input.taskId,
          taskRunId: input.taskRunId,
          artifactId: input.artifactId,
        });
        resolvedEvidence = full.evidence.slice(0, metadata.evidenceCount);
      } catch {
        // Keep content usable and let the evidence panel report this contract gap.
      }
    }
  }
  return {
    schemaVersion: metadata.schemaVersion,
    id: metadata.id,
    taskId: metadata.taskId,
    taskRunId: metadata.taskRunId,
    taskRevision: metadata.taskRevision,
    attemptId: metadata.attemptId,
    turnId: metadata.turnId,
    kind: metadata.kind,
    summary: metadata.summary,
    content: chunks.join(""),
    evidence: resolvedEvidence,
    createdAt: metadata.createdAt,
  };
}

export function taskCenterEventTouchesList(
  event: Pick<TaskOrchestratorEvent, "taskId" | "taskRunId">,
  result: TaskOrchestratorTaskListResult | undefined,
  selectedTaskId: string | null,
): boolean {
  if (!event.taskId.trim()) return false;
  if (selectedTaskId === event.taskId) return true;
  return Boolean(
    result?.tasks.some(
      (task) => task.id === event.taskId || task.latestRunId === event.taskRunId,
    ),
  );
}

export function taskCenterDesktopEventScope(event: TaskOrchestratorDesktopEvent): {
  resync: boolean;
  taskId: string | null;
} {
  if (event.type === "task-supervisor-resync") return { resync: true, taskId: null };
  const taskId = event.taskId.trim();
  return { resync: false, taskId: taskId || null };
}

export type TaskCenterQueryInvalidation = {
  queryKey: readonly unknown[];
  exact?: true;
};

export const TASK_CENTER_EVENT_INVALIDATION_DEBOUNCE_MS = 50;

export function coalesceTaskCenterQueryInvalidations(
  invalidations: readonly TaskCenterQueryInvalidation[],
): TaskCenterQueryInvalidation[] {
  const fullResync = invalidations.find(({ queryKey }) => (
    queryKey.length === 1 && queryKey[0] === "task-center"
  ));
  if (fullResync) return [fullResync];
  const unique = new Map<string, TaskCenterQueryInvalidation>();
  for (const invalidation of invalidations) {
    const identity = JSON.stringify([invalidation.queryKey, invalidation.exact === true]);
    unique.set(identity, invalidation);
  }
  return [...unique.values()];
}

export function taskCenterDesktopEventInvalidations(input: {
  event: TaskOrchestratorDesktopEvent;
  workspaceRoot: string;
  list: TaskOrchestratorTaskListResult | undefined;
  selectedTaskId: string | null;
}): TaskCenterQueryInvalidation[] {
  const scope = taskCenterDesktopEventScope(input.event);
  if (scope.resync) return [{ queryKey: ["task-center"] }];
  if (!scope.taskId || input.event.type === "task-supervisor-resync") return [];

  const taskId = scope.taskId;
  const invalidations: TaskCenterQueryInvalidation[] = [
    { queryKey: ["task-center", "snapshot", taskId] },
    { queryKey: taskCenterRunsQueryKey(taskId) },
    { queryKey: ["task-center", "events", taskId] },
    // Artifacts are committed before their durable lifecycle event is emitted.
    // Invalidate the task prefix so every cached run page sees the new record.
    { queryKey: ["task-center", "artifacts", taskId] },
    { queryKey: ["task-center", "turn-history", taskId] },
    { queryKey: ["task-center", "operations-diagnostics", taskId] },
  ];
  if (taskCenterEventTouchesList(input.event, input.list, input.selectedTaskId)) {
    invalidations.push({
      queryKey: taskCenterListQueryKey(input.workspaceRoot),
      exact: true,
    });
  }
  return invalidations;
}

export function taskCenterCanLoadSnapshot(
  taskId: string | null,
  result: TaskOrchestratorTaskListResult | undefined,
): boolean {
  return Boolean(taskId && result?.tasks.some((task) => task.id === taskId));
}

export function isTaskCenterRevisionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /revision\s+conflict|expected\s+revision|expected\s+\d+\s*,\s*found\s+\d+/i.test(message);
}

function taskIdFromActionInput(input: unknown): string | null {
  if (typeof input !== "object" || input === null || !("taskId" in input)) return null;
  const taskId = input.taskId;
  return typeof taskId === "string" && taskId.trim() ? taskId : null;
}

function catalogRevision(result: { catalogRevision?: unknown; revision?: unknown }): string | null {
  const value = result.catalogRevision ?? result.revision;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCatalog(result: {
  agents?: PersonalLocalAgent[];
  catalogRevision?: unknown;
  revision?: unknown;
}): TaskCenterCatalog {
  return {
    agents: usableTaskCenterAgents(Array.isArray(result.agents) ? result.agents : []),
    catalogRevision: catalogRevision(result),
  };
}

function isLegacyTaskListPaginationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /unrecognized_keys/i.test(message)
    && /(?:\"|\\\")cursor(?:\"|\\\")/i.test(message)
    && /(?:\"|\\\")limit(?:\"|\\\")/i.test(message);
}

/**
 * A detached Task Supervisor intentionally survives renderer reloads. During
 * development that means a freshly HMR-updated renderer can briefly meet the
 * pre-pagination list contract owned by the already-running Supervisor. Keep
 * the paged path primary, but retry the first request without the new fields
 * when that exact rolling-upgrade mismatch is reported.
 */
export async function loadTaskCenterTaskList(input: {
  workspaceRoot: string;
  loadPage?: typeof taskOrchestratorTasksList;
}): Promise<TaskOrchestratorTaskListResult> {
  const loadPage = input.loadPage ?? taskOrchestratorTasksList;
  const tasks: TaskOrchestratorTaskListResult["tasks"] = [];
  const issues: string[] = [];
  let cursor: string | null = null;
  do {
    let page: TaskOrchestratorTaskListResult;
    try {
      page = await loadPage({
        workspaceRoot: input.workspaceRoot,
        cursor,
        limit: 200,
      });
    } catch (error) {
      if (cursor !== null || tasks.length > 0 || !isLegacyTaskListPaginationError(error)) throw error;
      const legacyPage = await loadPage({ workspaceRoot: input.workspaceRoot });
      return { tasks: legacyPage.tasks, issues: legacyPage.issues, nextCursor: null, hasMore: false };
    }
    tasks.push(...page.tasks);
    issues.push(...page.issues);
    cursor = page.hasMore ? page.nextCursor ?? null : null;
  } while (cursor !== null);
  return { tasks, issues, nextCursor: null, hasMore: false };
}

export function useTaskCenterQueries(input: {
  workspaceRoot: string;
  selectedTaskId: string | null;
  selectedTaskRunId?: string | null;
}) {
  const normalizedWorkspaceRoot = input.workspaceRoot.trim();
  const queryClient = useQueryClient();
  const pendingEventInvalidations = useRef<TaskCenterQueryInvalidation[]>([]);
  const eventInvalidationTimer = useRef<number | null>(null);
  const listQuery = useQuery({
    queryKey: taskCenterListQueryKey(normalizedWorkspaceRoot),
    queryFn: () => loadTaskCenterTaskList({ workspaceRoot: normalizedWorkspaceRoot }),
    enabled: Boolean(normalizedWorkspaceRoot),
    refetchInterval: (query) => taskCenterListPollInterval(query.state.data),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const snapshotQuery = useQuery({
    queryKey: taskCenterSnapshotQueryKey(input.selectedTaskId, input.selectedTaskRunId ?? null),
    queryFn: () => taskOrchestratorTaskGet({ taskId: input.selectedTaskId ?? "", ...(input.selectedTaskRunId ? { taskRunId: input.selectedTaskRunId } : {}) }),
    enabled: taskCenterCanLoadSnapshot(input.selectedTaskId, listQuery.data),
    refetchInterval: (query) => taskCenterSnapshotPollInterval(query.state.data),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  // Historical run views still need the latest authoritative task/run for
  // archive gates and revision-guarded mutations.
  const latestSnapshotQuery = useQuery({
    queryKey: taskCenterSnapshotQueryKey(input.selectedTaskId),
    queryFn: () => taskOrchestratorTaskGet({ taskId: input.selectedTaskId ?? "" }),
    enabled: Boolean(input.selectedTaskRunId) && taskCenterCanLoadSnapshot(input.selectedTaskId, listQuery.data),
    refetchInterval: (query) => taskCenterSnapshotPollInterval(query.state.data),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const runsQuery = useInfiniteQuery({
    queryKey: taskCenterRunsQueryKey(input.selectedTaskId),
    queryFn: ({ pageParam }) => taskOrchestratorRunsList({ taskId: input.selectedTaskId ?? "", cursor: pageParam, limit: 50 }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
    enabled: taskCenterCanLoadSnapshot(input.selectedTaskId, listQuery.data),
    refetchOnWindowFocus: true,
  });

  const activeRunId = input.selectedTaskRunId ?? snapshotQuery.data?.run?.id ?? null;
  const eventsQuery = useInfiniteQuery({
    queryKey: taskCenterEventsQueryKey(input.selectedTaskId, activeRunId),
    queryFn: ({ pageParam }) => taskOrchestratorEventsList({ taskId: input.selectedTaskId ?? "", taskRunId: activeRunId, cursor: pageParam, limit: 50 }),
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
    enabled: taskCenterCanLoadSnapshot(input.selectedTaskId, listQuery.data),
    refetchOnWindowFocus: true,
  });

  const artifactsQuery = useInfiniteQuery({
    queryKey: taskCenterArtifactsQueryKey(input.selectedTaskId, activeRunId),
    queryFn: ({ pageParam }) => taskOrchestratorArtifactsList({ taskId: input.selectedTaskId ?? "", taskRunId: activeRunId ?? "", cursor: pageParam, limit: 50 }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
    enabled: Boolean(input.selectedTaskId && activeRunId),
    refetchOnWindowFocus: true,
  });

  const turnHistoryQuery = useInfiniteQuery({
    queryKey: taskCenterTurnHistoryQueryKey(input.selectedTaskId, activeRunId),
    queryFn: ({ pageParam }) => taskOrchestratorTurnHistoryList({
      taskId: input.selectedTaskId ?? "",
      taskRunId: activeRunId ?? "",
      cursor: pageParam,
      limit: 50,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: taskCenterTurnHistoryNextCursor,
    enabled: Boolean(activeRunId && taskCenterCanLoadSnapshot(input.selectedTaskId, listQuery.data)),
    refetchOnWindowFocus: true,
  });

  const operationsDiagnosticsQuery = useQuery({
    queryKey: taskCenterOperationsDiagnosticsQueryKey(input.selectedTaskId, activeRunId),
    queryFn: () => taskOrchestratorOperationsDiagnosticsGet({
      taskId: input.selectedTaskId ?? "",
      taskRunId: activeRunId ?? "",
    }),
    enabled: Boolean(activeRunId && taskCenterCanLoadSnapshot(input.selectedTaskId, listQuery.data)),
    refetchInterval: () => taskCenterOperationsDiagnosticsPollInterval(snapshotQuery.data?.run?.status),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const [artifactContent, setArtifactContent] = useState<Record<string, TaskOrchestratorHandoffArtifact>>({});
  useEffect(() => {
    setArtifactContent({});
  }, [input.selectedTaskId, activeRunId]);
  const loadArtifact = async (artifactId: string) => {
    if (!input.selectedTaskId || !activeRunId) throw new Error("A task run is required to load an artifact");
    const snapshotArtifact = snapshotQuery.data?.artifacts.find((artifact) => artifact.id === artifactId);
    const artifact = await loadTaskCenterArtifactContent({
      taskId: input.selectedTaskId,
      taskRunId: activeRunId,
      artifactId,
      snapshotArtifact,
    });
    setArtifactContent((current) => ({ ...current, [artifactId]: artifact }));
    return artifact;
  };

  const catalogQuery = useQuery({
    queryKey: taskCenterCatalogQueryKey(normalizedWorkspaceRoot),
    queryFn: async () =>
      normalizeCatalog(
        await personalLocalAgentsList({
          workspaceRoot: normalizedWorkspaceRoot,
          includeModels: true,
        }),
      ),
    enabled: Boolean(normalizedWorkspaceRoot),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!normalizedWorkspaceRoot) return;
    const flushInvalidations = () => {
      if (eventInvalidationTimer.current !== null) {
        window.clearTimeout(eventInvalidationTimer.current);
        eventInvalidationTimer.current = null;
      }
      const pending = pendingEventInvalidations.current;
      pendingEventInvalidations.current = [];
      for (const invalidation of pending) {
        void queryClient.invalidateQueries(invalidation);
      }
    };
    const unsubscribe = subscribeTaskOrchestratorEvents((event) => {
      const listKey = taskCenterListQueryKey(normalizedWorkspaceRoot);
      const list = queryClient.getQueryData<TaskOrchestratorTaskListResult>(listKey);
      // Supervisor resync invalidates the whole Task Center projection. A
      // durable task event only invalidates keys scoped to that task, so an
      // unrelated selected task is never refetched by another task's event.
      pendingEventInvalidations.current = coalesceTaskCenterQueryInvalidations([
        ...pendingEventInvalidations.current,
        ...taskCenterDesktopEventInvalidations({
        event,
        workspaceRoot: normalizedWorkspaceRoot,
        list,
        selectedTaskId: input.selectedTaskId,
        }),
      ]);
      if (eventInvalidationTimer.current === null) {
        eventInvalidationTimer.current = window.setTimeout(
          flushInvalidations,
          TASK_CENTER_EVENT_INVALIDATION_DEBOUNCE_MS,
        );
      }
    });
    return () => {
      unsubscribe();
      // Preserve the last durable event when task selection changes during the
      // coalescing window. Component unmounts are harmless: invalidating an
      // inactive query only marks it stale for the next mount.
      flushInvalidations();
    };
  }, [input.selectedTaskId, normalizedWorkspaceRoot, queryClient]);

  return {
    listQuery,
    snapshotQuery,
    latestSnapshotQuery: input.selectedTaskRunId ? latestSnapshotQuery : snapshotQuery,
    catalogQuery,
    runsQuery,
    eventsQuery,
    artifactsQuery,
    turnHistoryQuery,
    operationsDiagnosticsQuery,
    operationsDiagnostics: operationsDiagnosticsQuery.data,
    runs: runsQuery.data?.pages.flatMap((page) => page.runs) ?? [],
    events: eventsQuery.data?.pages.flatMap((page) => page.events) ?? [],
    artifactMetadata: artifactsQuery.data?.pages.flatMap((page) => page.artifacts) ?? [],
    turnHistory: flattenTaskCenterTurnHistoryPages(turnHistoryQuery.data?.pages ?? []),
    artifactContent,
    loadArtifact,
  };
}

export function useTaskCenterActions(workspaceRoot: string) {
  const queryClient = useQueryClient();
  const normalizedWorkspaceRoot = workspaceRoot.trim();
  const lastInputs = useRef<Partial<Record<TaskCenterActionName, unknown>>>({});

  const acceptSnapshot = (snapshot: TaskOrchestratorSnapshot) => {
    queryClient.setQueryData(taskCenterSnapshotQueryKey(snapshot.task.id), snapshot);
    void queryClient.invalidateQueries({
      queryKey: ["task-center", "snapshot", snapshot.task.id],
    });
    // The action itself is complete once its authoritative snapshot is in the
    // cache. List refresh is a projection update and must not keep every Task
    // Center control disabled (notably stop -> retry) when a refetch is slow.
    void queryClient.invalidateQueries({
      queryKey: taskCenterListQueryKey(normalizedWorkspaceRoot),
    });
    return snapshot;
  };

  const createMutation = useMutation({
    mutationFn: (input: TaskOrchestratorTaskCreateInput) => taskOrchestratorTaskCreate(input),
    onSuccess: acceptSnapshot,
  });
  const alignmentMutation = useMutation({
    mutationFn: (input: TaskOrchestratorAlignmentMessageInput) => taskOrchestratorAlignmentMessage(input),
    onSuccess: acceptSnapshot,
  });
  const alignmentCancelMutation = useMutation({
    mutationFn: (taskId: string) => taskOrchestratorAlignmentCancel({ taskId }),
    onSuccess: acceptSnapshot,
  });
  const finalizeMutation = useMutation({
    mutationFn: (input: TaskOrchestratorFinalizeContractInput) => taskOrchestratorContractFinalize(input),
    onSuccess: acceptSnapshot,
  });
  const updateMutation = useMutation({
    mutationFn: (input: TaskOrchestratorTaskUpdateInput) => taskOrchestratorTaskUpdate(input),
    onSuccess: acceptSnapshot,
  });
  const startMutation = useMutation({
    mutationFn: (taskId: string) => taskOrchestratorTaskStart({ taskId }),
    onSuccess: acceptSnapshot,
  });
  const stopMutation = useMutation({
    mutationFn: (taskRunId: string) => taskOrchestratorTaskStop({ taskRunId }),
    onSuccess: acceptSnapshot,
  });
  const pauseMutation = useMutation({
    mutationFn: (taskRunId: string) => taskOrchestratorTaskPause({ taskRunId }),
    onSuccess: acceptSnapshot,
  });
  const resumeMutation = useMutation({
    mutationFn: (taskRunId: string) => taskOrchestratorTaskResume({ taskRunId }),
    onSuccess: acceptSnapshot,
  });
  const retryMutation = useMutation({
    mutationFn: (input: TaskOrchestratorRetryInput) => taskOrchestratorPrimaryRetry(input),
    onSuccess: acceptSnapshot,
  });
  const recoveryMutation = useMutation({
    mutationFn: (input: TaskOrchestratorRecoveryInput) => taskOrchestratorRecoveryContinue(input),
    onSuccess: acceptSnapshot,
  });
  const gateMutation = useMutation({
    mutationFn: (input: TaskOrchestratorResolveGateInput) => taskOrchestratorGateResolve(input),
    onSuccess: acceptSnapshot,
  });
  const archiveMutation = useMutation({
    mutationFn: (input: TaskOrchestratorTaskArchiveInput) => taskOrchestratorTaskArchive(input),
    onSuccess: acceptSnapshot,
  });
  const restoreMutation = useMutation({
    mutationFn: (input: TaskOrchestratorTaskRestoreInput) => taskOrchestratorTaskRestore(input),
    onSuccess: acceptSnapshot,
  });

  const create = (input: TaskOrchestratorTaskCreateInput) => {
    lastInputs.current.create = input;
    return createMutation.mutateAsync(input);
  };
  const sendAlignment = (input: TaskOrchestratorAlignmentMessageInput) => {
    lastInputs.current.alignment = input;
    return alignmentMutation.mutateAsync(input);
  };
  const cancelAlignment = (taskId: string) => {
    lastInputs.current.alignmentCancel = taskId;
    return alignmentCancelMutation.mutateAsync(taskId);
  };
  const finalize = (input: TaskOrchestratorFinalizeContractInput) => {
    lastInputs.current.finalize = input;
    return finalizeMutation.mutateAsync(input);
  };
  const update = (input: TaskOrchestratorTaskUpdateInput) => {
    lastInputs.current.update = input;
    return updateMutation.mutateAsync(input);
  };
  const start = (taskId: string) => {
    lastInputs.current.start = taskId;
    return startMutation.mutateAsync(taskId);
  };
  const stop = (taskRunId: string) => {
    lastInputs.current.stop = taskRunId;
    return stopMutation.mutateAsync(taskRunId);
  };
  const pause = (taskRunId: string) => {
    lastInputs.current.pause = taskRunId;
    return pauseMutation.mutateAsync(taskRunId);
  };
  const resume = (taskRunId: string) => {
    lastInputs.current.resume = taskRunId;
    return resumeMutation.mutateAsync(taskRunId);
  };
  const retry = (input: TaskOrchestratorRetryInput) => {
    lastInputs.current.retry = input;
    return retryMutation.mutateAsync(input);
  };
  const continueRecovery = (input: TaskOrchestratorRecoveryInput) => {
    lastInputs.current.recovery = input;
    return recoveryMutation.mutateAsync(input);
  };
  const resolveGate = (input: TaskOrchestratorResolveGateInput) => {
    lastInputs.current.gate = input;
    return gateMutation.mutateAsync(input);
  };
  const archive = (input: TaskOrchestratorTaskArchiveInput) => {
    lastInputs.current.archive = input;
    return archiveMutation.mutateAsync(input);
  };
  const restore = (input: TaskOrchestratorTaskRestoreInput) => {
    lastInputs.current.restore = input;
    return restoreMutation.mutateAsync(input);
  };

  const retryAction = (name: TaskCenterActionName): void => {
    const input = lastInputs.current[name];
    if (input === undefined) return;
    const revisionError = name === "archive" ? archiveMutation.error : name === "restore" ? restoreMutation.error : null;
    if ((name === "archive" || name === "restore") && isTaskCenterRevisionConflict(revisionError)) {
      const taskId = taskIdFromActionInput(input);
      if (taskId) {
        void queryClient.invalidateQueries({ queryKey: ["task-center", "snapshot", taskId] });
        void queryClient.invalidateQueries({ queryKey: taskCenterListQueryKey(normalizedWorkspaceRoot) });
      }
      // The old expectedRevision is intentionally not replayed. Once the
      // authoritative snapshot refreshes, the user must confirm the action
      // against its new revision.
      return;
    }
    switch (name) {
      case "create": createMutation.mutate(input as TaskOrchestratorTaskCreateInput); break;
      case "alignment": alignmentMutation.mutate(input as TaskOrchestratorAlignmentMessageInput); break;
      case "alignmentCancel": alignmentCancelMutation.mutate(input as string); break;
      case "finalize": finalizeMutation.mutate(input as TaskOrchestratorFinalizeContractInput); break;
      case "update": updateMutation.mutate(input as TaskOrchestratorTaskUpdateInput); break;
      case "start": startMutation.mutate(input as string); break;
      case "stop": stopMutation.mutate(input as string); break;
      case "pause": pauseMutation.mutate(input as string); break;
      case "resume": resumeMutation.mutate(input as string); break;
      case "retry": retryMutation.mutate(input as TaskOrchestratorRetryInput); break;
      case "recovery": recoveryMutation.mutate(input as TaskOrchestratorRecoveryInput); break;
      case "gate": gateMutation.mutate(input as TaskOrchestratorResolveGateInput); break;
      case "archive": archiveMutation.mutate(input as TaskOrchestratorTaskArchiveInput); break;
      case "restore": restoreMutation.mutate(input as TaskOrchestratorTaskRestoreInput); break;
    }
  };

  const actionErrors: TaskCenterActionErrorMap = {
    create: createMutation.error,
    alignment: alignmentMutation.error,
    alignmentCancel: alignmentCancelMutation.error,
    finalize: finalizeMutation.error,
    update: updateMutation.error,
    start: startMutation.error,
    stop: stopMutation.error,
    pause: pauseMutation.error,
    resume: resumeMutation.error,
    retry: retryMutation.error,
    recovery: recoveryMutation.error,
    gate: gateMutation.error,
    archive: archiveMutation.error,
    restore: restoreMutation.error,
  };
  const actionPending: TaskCenterActionPendingMap = {
    create: createMutation.isPending,
    alignment: alignmentMutation.isPending,
    alignmentCancel: alignmentCancelMutation.isPending,
    finalize: finalizeMutation.isPending,
    update: updateMutation.isPending,
    start: startMutation.isPending,
    stop: stopMutation.isPending,
    pause: pauseMutation.isPending,
    resume: resumeMutation.isPending,
    retry: retryMutation.isPending,
    recovery: recoveryMutation.isPending,
    gate: gateMutation.isPending,
    archive: archiveMutation.isPending,
    restore: restoreMutation.isPending,
  };

  return {
    create,
    sendAlignment,
    cancelAlignment,
    finalize,
    update,
    start,
    stop,
    pause,
    resume,
    retry,
    continueRecovery,
    resolveGate,
    archive,
    restore,
    retryAction,
    actionErrors,
    actionPending,
    isPending:
      createMutation.isPending ||
      alignmentMutation.isPending ||
      alignmentCancelMutation.isPending ||
      finalizeMutation.isPending ||
      updateMutation.isPending ||
      startMutation.isPending ||
      stopMutation.isPending ||
      pauseMutation.isPending ||
      resumeMutation.isPending ||
      retryMutation.isPending ||
      recoveryMutation.isPending ||
      gateMutation.isPending ||
      archiveMutation.isPending ||
      restoreMutation.isPending,
    error:
      createMutation.error ??
      alignmentMutation.error ??
      alignmentCancelMutation.error ??
      finalizeMutation.error ??
      updateMutation.error ??
      startMutation.error ??
      stopMutation.error ??
      pauseMutation.error ??
      resumeMutation.error ??
      retryMutation.error ??
      recoveryMutation.error ??
      gateMutation.error ??
      archiveMutation.error ??
      restoreMutation.error,
    resetErrors: () => {
      createMutation.reset();
      alignmentMutation.reset();
      alignmentCancelMutation.reset();
      finalizeMutation.reset();
      updateMutation.reset();
      startMutation.reset();
      stopMutation.reset();
      pauseMutation.reset();
      resumeMutation.reset();
      retryMutation.reset();
      recoveryMutation.reset();
      gateMutation.reset();
      archiveMutation.reset();
      restoreMutation.reset();
    },
    dismissActionError: (name: TaskCenterActionName) => {
      switch (name) {
        case "create": createMutation.reset(); break;
        case "alignment": alignmentMutation.reset(); break;
        case "alignmentCancel": alignmentCancelMutation.reset(); break;
        case "finalize": finalizeMutation.reset(); break;
        case "update": updateMutation.reset(); break;
        case "start": startMutation.reset(); break;
        case "stop": stopMutation.reset(); break;
        case "pause": pauseMutation.reset(); break;
        case "resume": resumeMutation.reset(); break;
        case "retry": retryMutation.reset(); break;
        case "recovery": recoveryMutation.reset(); break;
        case "gate": gateMutation.reset(); break;
        case "archive": archiveMutation.reset(); break;
        case "restore": restoreMutation.reset(); break;
      }
    },
  };
}
