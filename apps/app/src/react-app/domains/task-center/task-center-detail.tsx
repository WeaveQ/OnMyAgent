/** @jsxImportSource react */
import { useState } from "react";
import { Archive, ArchiveRestore, Bot, Pause, Play, RotateCcw, Square } from "lucide-react";
import type {
  TaskOrchestratorArtifactMetadata,
  TaskOrchestratorEvent,
  TaskOrchestratorHandoffArtifact,
  TaskOrchestratorOperationsDiagnostics,
  TaskOrchestratorRunSummary,
  TaskOrchestratorSnapshot,
  TaskOrchestratorTurnHistoryItem,
} from "@onmyagent/types";

import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { t } from "@/i18n";
import { TaskCenterArtifactsPanel, TaskCenterEvidencePanel } from "./task-center-detail-artifacts";
import { TaskCenterPendingGates } from "./task-center-detail-gates";
import { TaskCenterAlignmentPanel, TaskCenterExecutionPanel } from "./task-center-detail-overview-flow";
import { formatTaskCenterTimestamp } from "./task-center-detail-shared";
import { EndConditionCard } from "./task-center-create-form";
import {
  createTaskCenterDraft,
  isTaskCenterRunActive,
  taskCenterIsDesktopInterruption,
  taskCenterRecoveryCandidate,
  latestPrimaryRetryCandidate,
  profileForAttempt,
  taskCenterStatusDotTone,
  taskCenterStatusLabelKey,
  taskCenterStatusTone,
  taskCenterPauseReasonLabelKey,
  taskCenterTabLabelKey,
  taskCenterTabs,
  taskCenterEndConditionPresetFor,
  type TaskCenterTab,
} from "./task-center-model";
import type { TaskCenterActionPendingMap } from "./task-center-query";

function DetailTabPanel(props: {
  tab: TaskCenterTab;
  snapshot: TaskOrchestratorSnapshot;
  busy: boolean;
  actionPending?: Partial<TaskCenterActionPendingMap>;
  readOnly?: boolean;
  onAlignmentMessage: (text: string) => void;
  onAlignmentCancel: () => void;
  onFinalize: (proposalId: string, proposalRevision: number) => void;
  runHistory?: TaskOrchestratorRunSummary[];
  selectedTaskRunId?: string | null;
  onSelectRun?: (runId: string | null) => void;
  runsHasMore?: boolean;
  runsLoading?: boolean;
  onLoadMoreRuns?: () => void;
  events?: TaskOrchestratorEvent[];
  eventsHasMore?: boolean;
  eventsLoading?: boolean;
  onLoadMoreEvents?: () => void;
  turnHistory?: TaskOrchestratorTurnHistoryItem[];
  turnHistoryHasMore?: boolean;
  turnHistoryLoading?: boolean;
  turnHistoryError?: unknown;
  onRetryTurnHistory?: () => void;
  onLoadMoreTurnHistory?: () => void;
  operationsDiagnostics?: TaskOrchestratorOperationsDiagnostics;
  operationsDiagnosticsLoading?: boolean;
  operationsDiagnosticsError?: unknown;
  onRetryOperationsDiagnostics?: () => void;
  artifactMetadata?: TaskOrchestratorArtifactMetadata[];
  artifactsHasMore?: boolean;
  artifactsLoading?: boolean;
  onLoadMoreArtifacts?: () => void;
  artifactContent?: Record<string, TaskOrchestratorHandoffArtifact>;
  artifactsError?: unknown;
  onRetryArtifacts?: () => void;
  onLoadArtifact?: (artifactId: string) => Promise<TaskOrchestratorHandoffArtifact>;
}) {
  if (props.tab === "alignment") {
    return <TaskCenterAlignmentPanel snapshot={props.snapshot} busy={props.actionPending?.alignment ?? props.busy} finalizeBusy={props.actionPending?.finalize ?? props.busy} cancelBusy={props.actionPending?.alignmentCancel} readOnly={props.readOnly} onSend={props.onAlignmentMessage} onCancel={props.onAlignmentCancel} onFinalize={props.onFinalize} />;
  }
  if (props.tab === "execution") return <TaskCenterExecutionPanel snapshot={props.snapshot} events={props.events} eventsHasMore={props.eventsHasMore} eventsLoading={props.eventsLoading} onLoadMoreEvents={props.onLoadMoreEvents} turnHistory={props.turnHistory} turnHistoryHasMore={props.turnHistoryHasMore} turnHistoryLoading={props.turnHistoryLoading} turnHistoryError={props.turnHistoryError} onRetryTurnHistory={props.onRetryTurnHistory} onLoadMoreTurnHistory={props.onLoadMoreTurnHistory} operationsDiagnostics={props.operationsDiagnostics} operationsDiagnosticsLoading={props.operationsDiagnosticsLoading} operationsDiagnosticsError={props.operationsDiagnosticsError} onRetryOperationsDiagnostics={props.onRetryOperationsDiagnostics} />;
  if (props.tab === "artifacts") return <TaskCenterArtifactsPanel snapshot={props.snapshot} artifactMetadata={props.artifactMetadata} artifactContent={props.artifactContent} artifactsHasMore={props.artifactsHasMore} artifactsLoading={props.artifactsLoading} artifactsError={props.artifactsError} onRetryArtifacts={props.onRetryArtifacts} onLoadMoreArtifacts={props.onLoadMoreArtifacts} onLoadArtifact={props.onLoadArtifact} />;
  return <TaskCenterEvidencePanel snapshot={props.snapshot} artifactMetadata={props.artifactMetadata} artifactContent={props.artifactContent} artifactsHasMore={props.artifactsHasMore} artifactsLoading={props.artifactsLoading} artifactsError={props.artifactsError} onRetryArtifacts={props.onRetryArtifacts} onLoadMoreArtifacts={props.onLoadMoreArtifacts} onLoadArtifact={props.onLoadArtifact} />;
}

export function TaskCenterDetail(props: {
  snapshot: TaskOrchestratorSnapshot;
  busy: boolean;
  onAlignmentMessage: (text: string) => void;
  onAlignmentCancel: () => void;
  onFinalize: (proposalId: string, proposalRevision: number) => void;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onUpdateEndConditions: (endConditions: NonNullable<TaskOrchestratorSnapshot["task"]["endConditions"]>) => void;
  onRetry: (attemptId: string) => void;
  onRecovery: (attemptId: string) => void;
  onResolveGate: (gateId: string, decision: "approve" | "reject") => void;
  onArchive: () => void;
  onRestore: () => void;
  latestSnapshot?: TaskOrchestratorSnapshot;
  latestSnapshotLoading?: boolean;
  actionPending?: Partial<TaskCenterActionPendingMap>;
  runHistory?: TaskOrchestratorRunSummary[];
  selectedTaskRunId?: string | null;
  onSelectRun?: (runId: string | null) => void;
  runsHasMore?: boolean;
  runsLoading?: boolean;
  onLoadMoreRuns?: () => void;
  events?: TaskOrchestratorEvent[];
  eventsHasMore?: boolean;
  eventsLoading?: boolean;
  onLoadMoreEvents?: () => void;
  turnHistory?: TaskOrchestratorTurnHistoryItem[];
  turnHistoryHasMore?: boolean;
  turnHistoryLoading?: boolean;
  turnHistoryError?: unknown;
  onRetryTurnHistory?: () => void;
  onLoadMoreTurnHistory?: () => void;
  operationsDiagnostics?: TaskOrchestratorOperationsDiagnostics;
  operationsDiagnosticsLoading?: boolean;
  operationsDiagnosticsError?: unknown;
  onRetryOperationsDiagnostics?: () => void;
  artifactMetadata?: TaskOrchestratorArtifactMetadata[];
  artifactsHasMore?: boolean;
  artifactsLoading?: boolean;
  onLoadMoreArtifacts?: () => void;
  artifactContent?: Record<string, TaskOrchestratorHandoffArtifact>;
  artifactsError?: unknown;
  onRetryArtifacts?: () => void;
  onLoadArtifact?: (artifactId: string) => Promise<TaskOrchestratorHandoffArtifact>;
}) {
  const [tab, setTab] = useState<TaskCenterTab>("alignment");
  const [editingEndConditions, setEditingEndConditions] = useState(false);
  const [endConditionDraft, setEndConditionDraft] = useState(() => {
    const draft = createTaskCenterDraft(null);
    return {
      ...draft,
      endConditionPreset: taskCenterEndConditionPresetFor(props.snapshot.task.endConditions ?? draft.endConditions),
      endConditions: props.snapshot.task.endConditions ?? draft.endConditions,
    };
  });
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const run = props.snapshot.run;
  const authoritative = props.latestSnapshot ?? (props.selectedTaskRunId ? null : props.snapshot);
  const archived = authoritative
    ? authoritative.task.definitionStatus === "archived"
    : props.snapshot.task.definitionStatus === "archived";
  const active = isTaskCenterRunActive(run?.status);
  const authoritativeActive = isTaskCenterRunActive(authoritative?.run?.status);
  const unresolvedGate = authoritative?.gates.some((gate) => gate.status === "pending" || gate.status === "resolving") ?? false;
  const retryablePrimary = archived ? null : latestPrimaryRetryCandidate(run);
  const recoveryCandidate = archived ? null : taskCenterRecoveryCandidate(run);
  const desktopInterruption = taskCenterIsDesktopInterruption(run);
  const currentAttempt = run?.currentAttemptId ? [...(run.primaryAttempts ?? []), ...(run.workerAttempts ?? [])].find((attempt) => attempt.id === run.currentAttemptId) : null;
  const currentProfile = currentAttempt && run ? profileForAttempt(run, currentAttempt) : null;
  const displayStatus = run?.status ?? props.snapshot.task.definitionStatus;
  const canStart = !archived && !active && !authoritativeActive && props.snapshot.task.definitionStatus === "ready" && !run;
  const canPause = !archived && Boolean(run && ["queued", "running", "checkpointing", "backoff", "waiting-approval"].includes(run.status));
  const canResume = !archived && Boolean(run?.status === "paused" && run.pause?.resumeEligible);
  const canEditEndConditions = !archived && !active && !run;
  const canArchive = Boolean(authoritative && !props.latestSnapshotLoading)
    && !archived
    && authoritative?.task.definitionStatus !== "legacy-readonly"
    && authoritative?.task.alignment.status !== "running"
    && !authoritativeActive
    && !unresolvedGate;
  const historyRuns = props.runHistory ?? [];
  const beginEndConditionEdit = () => {
    const fallback = createTaskCenterDraft(null);
    setEndConditionDraft({
      ...fallback,
      endConditionPreset: taskCenterEndConditionPresetFor(props.snapshot.task.endConditions ?? fallback.endConditions),
      endConditions: props.snapshot.task.endConditions ?? fallback.endConditions,
    });
    setEditingEndConditions(true);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 truncate font-heading text-xl font-semibold text-dls-text">{props.snapshot.task.idea}</h2>
            <StatusBadge size="sm" shape="soft" tone={taskCenterStatusTone(displayStatus)}>
              <StatusDot size="xs" tone={taskCenterStatusDotTone(displayStatus)} pulse={displayStatus === "running"} />
              {t(taskCenterStatusLabelKey(displayStatus))}
            </StatusBadge>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-dls-secondary">
            <span className="truncate">{props.snapshot.task.workspaceRoot}</span>
            {currentProfile && currentAttempt ? <span className="inline-flex items-center gap-1.5"><Bot className="size-3.5" aria-hidden />{t("task_center.current_actor_detail", { actor: currentAttempt.kind, agent: currentProfile.label })}</span> : null}
            {run ? <span>{t("task_center.updated_at", { time: formatTaskCenterTimestamp(run.updatedAt) })}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!archived && active && run ? <Button type="button" variant="outline" disabled={props.actionPending?.stop ?? props.busy} onClick={props.onStop}><Square className="size-3.5" aria-hidden />{t("task_center.stop")}</Button> : null}
          {canPause && run ? <Button type="button" variant="outline" disabled={props.actionPending?.pause ?? props.busy} onClick={props.onPause}><Pause className="size-3.5" aria-hidden />{t("task_center.pause")}</Button> : null}
          {canResume && run ? <Button type="button" variant="outline" data-task-center-resume-cta disabled={props.actionPending?.resume ?? props.busy} onClick={props.onResume}><Play className="size-3.5" aria-hidden />{t("task_center.resume")}</Button> : null}
          {!archived && !active && retryablePrimary && run ? <Button type="button" variant="outline" disabled={props.actionPending?.retry ?? props.busy} onClick={() => props.onRetry(retryablePrimary.id)}><RotateCcw className="size-3.5" aria-hidden />{t("task_center.retry_primary")}</Button> : null}
          {!archived && recoveryCandidate && run ? <Button type="button" variant="outline" disabled={props.actionPending?.recovery ?? props.busy} data-task-center-recovery-cta onClick={() => props.onRecovery(recoveryCandidate.id)}><RotateCcw className="size-3.5" aria-hidden />{t("task_center.recover_run")}</Button> : null}
          {canStart ? <Button type="button" disabled={props.actionPending?.start ?? props.busy} onClick={props.onStart}><Play className="size-3.5" aria-hidden />{t("task_center.run")}</Button> : null}
          {archived ? <Button type="button" variant="outline" data-task-center-restore-cta disabled={props.actionPending?.restore ?? props.busy} onClick={props.onRestore}><ArchiveRestore className="size-3.5" aria-hidden />{t("task_center.restore")}</Button> : null}
          {!archived && authoritative?.task.definitionStatus !== "legacy-readonly" ? <Button type="button" variant="outline" data-task-center-archive-cta disabled={!canArchive || props.actionPending?.archive || props.busy} onClick={() => setArchiveDialogOpen(true)}><Archive className="size-3.5" aria-hidden />{t("task_center.archive")}</Button> : null}
        </div>
      </div>

      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("task_center.archive_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("task_center.archive_impact", { idea: props.snapshot.task.idea })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="lg">{t("task_center.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              size="lg"
              disabled={props.actionPending?.archive || props.busy}
              onClick={() => {
                setArchiveDialogOpen(false);
                props.onArchive();
              }}
            >
              {props.actionPending?.archive ? t("task_center.archiving") : t("task_center.confirm_archive")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {historyRuns.length || run ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dls-border bg-dls-surface-muted p-3" data-task-center-run-selector>
          <div className="min-w-48 flex-1 space-y-1">
            <label className="text-xs font-semibold text-dls-secondary" htmlFor="task-center-run-history">{t("task_center.run_history_selector")}</label>
            <Select value={props.selectedTaskRunId ?? "latest"} onValueChange={(value) => props.onSelectRun?.(value && value !== "latest" ? value : null)}>
              <SelectTrigger id="task-center-run-history" size="sm" className="w-full">
                <SelectValue>{(value) => {
                  if (!value || value === "latest") return t("task_center.latest_run");
                  const selected = historyRuns.find((historyRun) => historyRun.id === value);
                  return selected
                    ? t("task_center.run_history_option", { status: t(taskCenterStatusLabelKey(selected.status)), time: formatTaskCenterTimestamp(selected.updatedAt) })
                    : t("task_center.latest_run");
                }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">{t("task_center.latest_run")}</SelectItem>
                {historyRuns.map((historyRun) => <SelectItem key={historyRun.id} value={historyRun.id}>{t("task_center.run_history_option", { status: t(taskCenterStatusLabelKey(historyRun.status)), time: formatTaskCenterTimestamp(historyRun.updatedAt) })}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {props.runsHasMore ? <Button type="button" variant="outline" size="sm" disabled={props.runsLoading} onClick={props.onLoadMoreRuns}>{props.runsLoading ? t("task_center.loading_more") : t("task_center.load_more_runs")}</Button> : null}
        </div>
      ) : null}

      {props.snapshot.task.permissionMode === "full-allow" ? <NoticeBox tone="warning" data-permission-mode="full-allow">{t("task_center.permission_full_allow_notice")}</NoticeBox> : <NoticeBox tone="neutral" data-permission-mode="restricted">{t("task_center.permission_restricted_notice")}</NoticeBox>}
      {props.snapshot.truncation?.truncated ? <NoticeBox tone="warning" data-task-center-snapshot-truncated>{t("task_center.snapshot_truncated_notice", { count: props.snapshot.truncation.omitted.events + props.snapshot.truncation.omitted.artifacts })}</NoticeBox> : null}
      {desktopInterruption ? (
        <NoticeBox tone="warning" data-task-center-recovery-notice>
          {recoveryCandidate ? t("task_center.recovery_notice") : t("task_center.recovery_limit_notice")}
        </NoticeBox>
      ) : run?.error ? <NoticeBox tone="error">{run.error}</NoticeBox> : null}
      {run?.pause ? <NoticeBox tone={run.status === "paused" ? "info" : "warning"} data-task-center-pause-status>{t("task_center.pause_status", { reason: t(taskCenterPauseReasonLabelKey(run.pause.reason)), resumable: run.pause.resumeEligible ? t("task_center.pause_resumable") : t("task_center.pause_not_resumable") })}</NoticeBox> : null}
      {canEditEndConditions && !editingEndConditions ? <div className="flex justify-end"><Button type="button" variant="outline" size="sm" onClick={beginEndConditionEdit}>{t("task_center.edit_end_conditions")}</Button></div> : null}
      {editingEndConditions ? (
        <div className="space-y-3" data-edit-end-conditions>
          <EndConditionCard draft={endConditionDraft} onChange={setEndConditionDraft} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditingEndConditions(false)}>{t("task_center.cancel_edit_end_conditions")}</Button>
            <Button type="button" disabled={props.actionPending?.update ?? props.busy} onClick={() => { props.onUpdateEndConditions(endConditionDraft.endConditions); setEditingEndConditions(false); }}>{t("task_center.save_end_conditions")}</Button>
          </div>
        </div>
      ) : null}
      {(props.snapshot.task.permissionMode === "restricted" || props.snapshot.gates.some((gate) => gate.kind === "manual-review")) ? (
        <TaskCenterPendingGates gates={props.snapshot.gates} busy={props.actionPending?.gate ?? props.busy} readOnly={archived} onResolve={props.onResolveGate} />
      ) : null}
      <SegmentedTabGroup density="panel" role="tablist" className="h-auto">
        {taskCenterTabs.map((item) => <NavTabButton key={item} type="button" role="tab" size="tab" shape="tab" active={tab === item} aria-selected={tab === item} data-task-center-tab={item} data-task-center-execution-tab={item === "execution" ? "true" : undefined} onClick={() => setTab(item)}>{t(taskCenterTabLabelKey(item))}</NavTabButton>)}
      </SegmentedTabGroup>
      <DetailTabPanel tab={tab} snapshot={props.snapshot} busy={props.busy} readOnly={archived} actionPending={props.actionPending} onAlignmentMessage={props.onAlignmentMessage} onAlignmentCancel={props.onAlignmentCancel} onFinalize={props.onFinalize} events={props.events} eventsHasMore={props.eventsHasMore} eventsLoading={props.eventsLoading} onLoadMoreEvents={props.onLoadMoreEvents} turnHistory={props.turnHistory} turnHistoryHasMore={props.turnHistoryHasMore} turnHistoryLoading={props.turnHistoryLoading} turnHistoryError={props.turnHistoryError} onRetryTurnHistory={props.onRetryTurnHistory} onLoadMoreTurnHistory={props.onLoadMoreTurnHistory} operationsDiagnostics={props.operationsDiagnostics} operationsDiagnosticsLoading={props.operationsDiagnosticsLoading} operationsDiagnosticsError={props.operationsDiagnosticsError} onRetryOperationsDiagnostics={props.onRetryOperationsDiagnostics} artifactMetadata={props.artifactMetadata} artifactContent={props.artifactContent} artifactsHasMore={props.artifactsHasMore} artifactsLoading={props.artifactsLoading} artifactsError={props.artifactsError} onRetryArtifacts={props.onRetryArtifacts} onLoadMoreArtifacts={props.onLoadMoreArtifacts} onLoadArtifact={props.onLoadArtifact} />
    </div>
  );
}
