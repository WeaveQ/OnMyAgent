/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { ListTodo, Plus, RefreshCw } from "lucide-react";
import type { TaskOrchestratorTaskCreateInput, TaskOrchestratorTaskSummary } from "@onmyagent/types";

import { NavListButton } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyStateBox, NoticeBox } from "@/components/ui/notice-box";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  LIST_LANE_HEADER_CLASS,
  SIDEBAR_PRIMARY_CTA_CLASS,
  SIDEBAR_PRIMARY_HEADER_CLASS,
} from "@/components/ui/sidebar-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { TaskCenterCreateForm } from "./task-center-create-form";
import { TaskCenterActionErrors } from "./task-center-action-errors";
import { TaskCenterDetail } from "./task-center-detail";
import {
  persistTaskCenterSelection,
  readTaskCenterSelection,
  taskCenterActorLabelKey,
  taskCenterFilterTasks,
  taskCenterQueryWithTaskSelection,
  taskCenterRunIdFromQuery,
  taskCenterRunSelectionNeedsMore,
  taskCenterStatusDotTone,
  taskCenterStatusLabelKey,
  taskCenterStatusTone,
  taskCenterTaskIdFromQuery,
  TASK_CENTER_DEFAULT_LIST_FILTERS,
  type TaskCenterListFilters,
} from "./task-center-model";
import { useTaskCenterActions, useTaskCenterQueries, type TaskCenterActionName } from "./task-center-query";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return t("task_center.unknown_error");
}

function actorLabel(actor: TaskOrchestratorTaskSummary["currentActor"]): string | null {
  if (!actor) return null;
  return t(taskCenterActorLabelKey(actor));
}

function TaskListRow(props: {
  task: TaskOrchestratorTaskSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = props.task.latestRunStatus ?? props.task.definitionStatus;
  return (
    <NavListButton
      type="button"
      size="sidebar"
      active={props.selected}
      className="h-auto min-h-14 items-start py-2.5"
      onClick={props.onSelect}
    >
      <StatusDot className="mt-1.5" size="md" tone={taskCenterStatusDotTone(status)} pulse={status === "running"} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{props.task.idea}</span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5">
          <StatusBadge size="tiny" shape="soft" tone={taskCenterStatusTone(status)}>
            {t(taskCenterStatusLabelKey(status))}
          </StatusBadge>
          {actorLabel(props.task.currentActor) ? (
            <span className="truncate text-xs text-dls-secondary">{actorLabel(props.task.currentActor)}</span>
          ) : null}
        </span>
      </span>
    </NavListButton>
  );
}

export function TaskCenterPage(props: {
  workspaceRoot: string;
  initialTaskId?: string | null;
  className?: string;
}) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => {
    const queryTaskId = typeof window === "undefined" ? null : taskCenterTaskIdFromQuery(window.location.search);
    return props.initialTaskId ?? queryTaskId ?? readTaskCenterSelection(props.workspaceRoot);
  });
  const [selectedTaskRunId, setSelectedTaskRunId] = useState<string | null>(() => typeof window === "undefined" ? null : taskCenterRunIdFromQuery(window.location.search));
  const [filters, setFilters] = useState<TaskCenterListFilters>(TASK_CENTER_DEFAULT_LIST_FILTERS);
  const [creating, setCreating] = useState(false);
  const { listQuery, snapshotQuery, latestSnapshotQuery, catalogQuery, runs, events, artifactMetadata, artifactContent, loadArtifact, runsQuery, eventsQuery, artifactsQuery, turnHistory, turnHistoryQuery, operationsDiagnostics, operationsDiagnosticsQuery } = useTaskCenterQueries({
    workspaceRoot: props.workspaceRoot,
    selectedTaskId,
    selectedTaskRunId,
  });
  const actions = useTaskCenterActions(props.workspaceRoot);
  const tasks = listQuery.data?.tasks ?? [];
  const visibleTasks = taskCenterFilterTasks(tasks, filters);
  const selectedTaskIsListed = Boolean(selectedTaskId && tasks.some((task) => task.id === selectedTaskId));

  useEffect(() => {
    const queryTaskId = typeof window === "undefined" ? null : taskCenterTaskIdFromQuery(window.location.search);
    const queryRunId = typeof window === "undefined" ? null : taskCenterRunIdFromQuery(window.location.search);
    setSelectedTaskId(props.initialTaskId ?? queryTaskId ?? readTaskCenterSelection(props.workspaceRoot));
    setSelectedTaskRunId(queryRunId);
    setCreating(false);
  }, [props.initialTaskId, props.workspaceRoot]);

  useEffect(() => {
    persistTaskCenterSelection(props.workspaceRoot, selectedTaskId);
    if (typeof window !== "undefined") {
      const nextSearch = taskCenterQueryWithTaskSelection(window.location.search, selectedTaskId, selectedTaskRunId);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${nextSearch}${window.location.hash}`);
    }
  }, [props.workspaceRoot, selectedTaskId, selectedTaskRunId]);

  useEffect(() => {
    if (!selectedTaskRunId || !runsQuery.isSuccess || runs.some((run) => run.id === selectedTaskRunId)) return;
    if (taskCenterRunSelectionNeedsMore({
      selectedRunId: selectedTaskRunId,
      runs,
      hasNextPage: Boolean(runsQuery.hasNextPage),
      isFetchingNextPage: runsQuery.isFetchingNextPage,
    })) {
      void runsQuery.fetchNextPage();
      return;
    }
    if (runsQuery.hasNextPage || runsQuery.isFetchingNextPage) return;
    setSelectedTaskRunId(null);
  }, [runs, runsQuery.fetchNextPage, runsQuery.hasNextPage, runsQuery.isFetchingNextPage, runsQuery.isSuccess, selectedTaskRunId]);

  useEffect(() => {
    if (!listQuery.isSuccess || creating || !selectedTaskId || !selectedTaskRunId) return;
    if (!tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskRunId(null);
    }
  }, [creating, listQuery.isSuccess, selectedTaskId, selectedTaskRunId, tasks]);

  useEffect(() => {
    if (creating || !listQuery.isSuccess) return;
    if (!selectedTaskId || !tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(tasks[0]?.id ?? null);
    }
  }, [creating, listQuery.isSuccess, selectedTaskId, tasks]);

  const createTask = async (input: TaskOrchestratorTaskCreateInput) => {
    const snapshot = await actions.create(input);
    setSelectedTaskId(snapshot.task.id);
    setSelectedTaskRunId(snapshot.run?.id ?? null);
    setCreating(false);
  };

  const snapshot = selectedTaskIsListed ? snapshotQuery.data : undefined;
  const authoritativeSnapshot = selectedTaskRunId ? latestSnapshotQuery.data : snapshot;
  const taskReadOnly = Boolean((authoritativeSnapshot ?? snapshot)?.task.definitionStatus === "archived");
  const combinedError = listQuery.error ?? (selectedTaskIsListed ? snapshotQuery.error : null) ?? null;
  const runAction = (promise: Promise<unknown>) => {
    void promise.then(undefined, () => undefined);
  };
  const finalizeAndStart = async (proposalId: string, proposalRevision: number) => {
    if (!snapshot) return;
    await actions.finalize({
      taskId: snapshot.task.id,
      expectedRevision: snapshot.task.revision,
      proposalId,
      proposalRevision,
    });
    await actions.start(snapshot.task.id);
  };

  return (
    <div className={cn("flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-dls-background text-dls-text md:flex-row", props.className)}>
      <aside className="flex max-h-64 w-full shrink-0 flex-col border-b border-dls-border bg-dls-sidebar md:max-h-none md:w-72 md:border-b-0 md:border-r">
        <div className={cn(LIST_LANE_HEADER_CLASS, "justify-between gap-2 px-3")}>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{t("task_center.title")}</div>
            <div className="truncate text-xs text-dls-secondary" title={props.workspaceRoot}>
              {props.workspaceRoot || t("task_center.no_workspace")}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("task_center.refresh")}
            disabled={!props.workspaceRoot || listQuery.isFetching}
            onClick={() => void listQuery.refetch()}
          >
            {listQuery.isFetching ? <LoadingSpinner size="sm" /> : <RefreshCw className="size-4" aria-hidden />}
          </Button>
        </div>
        <div className={cn(SIDEBAR_PRIMARY_HEADER_CLASS, "px-3")}>
          <Button
            type="button"
            size="sidebar-cta"
            className={SIDEBAR_PRIMARY_CTA_CLASS}
            data-task-center-new-task
            disabled={!props.workspaceRoot}
            onClick={() => {
              actions.resetErrors();
              setCreating(true);
            }}
          >
            <Plus className="size-4" aria-hidden />
            {t("task_center.new_task")}
          </Button>
        </div>
        <div className="space-y-2 border-b border-dls-border px-3 pb-3">
          <Input
            value={filters.search}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.currentTarget.value }))}
            placeholder={t("task_center.task_search_placeholder")}
            aria-label={t("task_center.task_search")}
            variant="dls"
            density="comfortable"
          />
          <div className="grid grid-cols-2 gap-2">
            <Select value={filters.status} onValueChange={(value) => setFilters((current) => ({ ...current, status: value ?? "all" }))}>
              <SelectTrigger size="sm" className="w-full" aria-label={t("task_center.task_status_filter")}>
                <SelectValue>{(value) => value === "all" ? t("task_center.filter_all_statuses") : t(taskCenterStatusLabelKey(String(value ?? "all")))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("task_center.filter_all_statuses")}</SelectItem>
                {["alignment", "awaiting-confirmation", "ready", "archived", "legacy-readonly", "queued", "running", "checkpointing", "pausing", "backoff", "waiting-approval", "paused", "succeeded", "failed", "blocked", "cancelled"].map((status) => (
                  <SelectItem key={status} value={status}>{t(taskCenterStatusLabelKey(status))}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.permissionMode} onValueChange={(value) => setFilters((current) => ({ ...current, permissionMode: (value ?? "all") as TaskCenterListFilters["permissionMode"] }))}>
              <SelectTrigger size="sm" className="w-full" aria-label={t("task_center.task_permission_filter")}>
                <SelectValue>{(value) => value === "restricted" ? t("task_center.permission_restricted") : value === "full-allow" ? t("task_center.permission_full_allow") : t("task_center.filter_all_permissions")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("task_center.filter_all_permissions")}</SelectItem>
                <SelectItem value="restricted">{t("task_center.permission_restricted")}</SelectItem>
                <SelectItem value="full-allow">{t("task_center.permission_full_allow")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {listQuery.isPending ? (
            <div className="flex h-24 items-center justify-center"><LoadingSpinner /></div>
          ) : listQuery.isError ? (
            <NoticeBox tone="error" className="mx-1">{errorMessage(listQuery.error)}</NoticeBox>
          ) : tasks.length ? (
            <div className="space-y-1">
              {visibleTasks.map((task) => (
                <TaskListRow
                  key={task.id}
                  task={task}
                  selected={!creating && selectedTaskId === task.id}
                  onSelect={() => {
                    actions.resetErrors();
                    setCreating(false);
                    setSelectedTaskId(task.id);
                    setSelectedTaskRunId(null);
                  }}
                />
              ))}
              {!visibleTasks.length ? <EmptyStateBox size="comfortable" className="mx-1 mt-2">{t("task_center.no_matching_tasks")}</EmptyStateBox> : null}
            </div>
          ) : (
            <EmptyStateBox size="comfortable" className="mx-1 mt-2">{t("task_center.no_tasks")}</EmptyStateBox>
          )}
        </div>
        {listQuery.data?.issues.length ? <NoticeBox tone="warning" className="m-3 mt-0">{listQuery.data.issues.join(" · ")}</NoticeBox> : null}
      </aside>
      <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
        <TaskCenterActionErrors
          errors={actions.actionErrors}
          pending={actions.actionPending}
          readOnly={taskReadOnly}
          onRetry={(name: TaskCenterActionName) => actions.retryAction(name)}
          onDismiss={actions.dismissActionError}
        />
        {combinedError && !listQuery.isError ? <NoticeBox role="alert" tone="error" className="sticky top-3 z-20 mx-6 mt-3">{errorMessage(combinedError)}</NoticeBox> : null}
        {!props.workspaceRoot ? (
          <div className="flex h-full items-center justify-center p-6"><EmptyStateBox size="spacious" className="max-w-lg">{t("task_center.workspace_required")}</EmptyStateBox></div>
        ) : creating ? (
          <TaskCenterCreateForm
            workspaceRoot={props.workspaceRoot}
            catalog={catalogQuery.data ?? null}
            catalogLoading={catalogQuery.isPending || catalogQuery.isFetching}
            catalogError={catalogQuery.error}
            busy={actions.actionPending.create}
            onRefreshCatalog={() => void catalogQuery.refetch()}
            onCancel={() => setCreating(false)}
            onCreate={createTask}
          />
        ) : snapshotQuery.isPending && selectedTaskIsListed ? (
          <div className="flex h-full items-center justify-center"><LoadingSpinner /></div>
        ) : snapshot ? (
          <TaskCenterDetail
            snapshot={snapshot}
            busy={actions.isPending}
            actionPending={actions.actionPending}
            onAlignmentMessage={(text) => runAction(actions.sendAlignment({ taskId: snapshot.task.id, text }))}
            onAlignmentCancel={() => runAction(actions.cancelAlignment(snapshot.task.id))}
            onFinalize={(proposalId, proposalRevision) => runAction(finalizeAndStart(proposalId, proposalRevision))}
            onStart={() => runAction(actions.start(snapshot.task.id))}
            onPause={() => { if (snapshot.run) runAction(actions.pause(snapshot.run.id)); }}
            onResume={() => { if (snapshot.run) runAction(actions.resume(snapshot.run.id)); }}
            onUpdateEndConditions={(endConditions) => runAction(actions.update({ taskId: snapshot.task.id, expectedRevision: snapshot.task.revision, endConditions }))}
            onStop={() => { if (snapshot.run) runAction(actions.stop(snapshot.run.id)); }}
            onRetry={(attemptId) => { if (snapshot.run) runAction(actions.retry({ taskRunId: snapshot.run.id, attemptId })); }}
            onRecovery={(attemptId) => { if (snapshot.run) runAction(actions.continueRecovery({ taskRunId: snapshot.run.id, attemptId })); }}
            onResolveGate={(gateId, decision) => { if (snapshot.run) runAction(actions.resolveGate({ taskRunId: snapshot.run.id, gateId, decision })); }}
            onArchive={() => { if (authoritativeSnapshot) runAction(actions.archive({ taskId: authoritativeSnapshot.task.id, expectedRevision: authoritativeSnapshot.task.revision })); }}
            onRestore={() => { if (authoritativeSnapshot) runAction(actions.restore({ taskId: authoritativeSnapshot.task.id, expectedRevision: authoritativeSnapshot.task.revision })); }}
            latestSnapshot={authoritativeSnapshot}
            latestSnapshotLoading={Boolean(selectedTaskRunId && (latestSnapshotQuery.isPending || latestSnapshotQuery.isFetching))}
            runHistory={runs}
            selectedTaskRunId={selectedTaskRunId}
            onSelectRun={(runId) => setSelectedTaskRunId(runId)}
            runsHasMore={Boolean(runsQuery.hasNextPage)}
            runsLoading={runsQuery.isFetchingNextPage}
            onLoadMoreRuns={() => { void runsQuery.fetchNextPage(); }}
            events={events}
            eventsHasMore={Boolean(eventsQuery.hasNextPage)}
            eventsLoading={eventsQuery.isFetchingNextPage}
            onLoadMoreEvents={() => { void eventsQuery.fetchNextPage(); }}
            turnHistory={turnHistory}
            turnHistoryHasMore={Boolean(turnHistoryQuery.hasNextPage)}
            turnHistoryLoading={turnHistoryQuery.isPending || turnHistoryQuery.isFetchingNextPage}
            turnHistoryError={turnHistoryQuery.error}
            onRetryTurnHistory={() => { void turnHistoryQuery.refetch(); }}
            onLoadMoreTurnHistory={() => { void turnHistoryQuery.fetchNextPage(); }}
            operationsDiagnostics={operationsDiagnostics}
            operationsDiagnosticsLoading={operationsDiagnosticsQuery.isPending || operationsDiagnosticsQuery.isFetching}
            operationsDiagnosticsError={operationsDiagnosticsQuery.error}
            onRetryOperationsDiagnostics={() => { void operationsDiagnosticsQuery.refetch(); }}
            artifactMetadata={artifactMetadata}
            artifactContent={artifactContent}
            artifactsHasMore={Boolean(artifactsQuery.hasNextPage)}
            artifactsLoading={artifactsQuery.isFetchingNextPage}
            artifactsError={artifactsQuery.error}
            onRetryArtifacts={() => { void artifactsQuery.refetch(); }}
            onLoadMoreArtifacts={() => { void artifactsQuery.fetchNextPage(); }}
            onLoadArtifact={loadArtifact}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6"><EmptyStateBox size="spacious" className="max-w-lg"><ListTodo className="mx-auto mb-3 size-6" aria-hidden />{t("task_center.select_or_create")}</EmptyStateBox></div>
        )}
      </main>
    </div>
  );
}
