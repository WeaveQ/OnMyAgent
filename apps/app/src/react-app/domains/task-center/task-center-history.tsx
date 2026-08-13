/** @jsxImportSource react */
import type {
  TaskOrchestratorAttempt,
  TaskOrchestratorRun,
  TaskOrchestratorTurn,
  TaskOrchestratorTurnHistoryAttempt,
  TaskOrchestratorTurnHistoryCheckerAttempt,
  TaskOrchestratorTurnHistoryItem,
} from "@onmyagent/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { t } from "@/i18n";
import { formatTaskCenterTimestamp } from "./task-center-detail-shared";
import {
  profileForAttempt,
  taskCenterCheckpointTriggerLabelKey,
  taskCenterDecisionLabelKey,
  taskCenterFormatBudgetValue,
  taskCenterFormatDuration,
  taskCenterStatusDotTone,
  taskCenterStatusLabelKey,
  taskCenterStatusTone,
  taskCenterTurnReasonLabelKey,
} from "./task-center-model";

function attemptTitle(attempt: TaskOrchestratorAttempt): string {
  return attempt.kind === "primary" ? t("task_center.primary_attempt") : t("task_center.worker_attempt");
}

function AttemptHistoryRow({ run, attempt }: { run: TaskOrchestratorRun; attempt: TaskOrchestratorAttempt }) {
  const profile = profileForAttempt(run, attempt);
  return (
    <details className="rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2" data-history-attempt={attempt.id}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
        <StatusDot size="sm" tone={taskCenterStatusDotTone(attempt.status)} pulse={attempt.status === "running"} />
        <span className="font-medium">{attemptTitle(attempt)}</span>
        <StatusBadge size="tiny" shape="soft" tone={taskCenterStatusTone(attempt.status)}>{t(taskCenterStatusLabelKey(attempt.status))}</StatusBadge>
        <span className="ms-auto text-xs text-dls-secondary">{formatTaskCenterTimestamp(attempt.updatedAt)}</span>
      </summary>
      <div className="mt-3 space-y-2 border-t border-dls-border pt-3 text-xs text-dls-secondary">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>{t("task_center.history_attempt_id", { id: attempt.id })}</span>
          <span>{t("task_center.history_profile", { profile: profile?.label ?? attempt.profileId })}</span>
          <span>{t("task_center.history_started", { time: formatTaskCenterTimestamp(attempt.startedAt) })}</span>
          <span>{t("task_center.history_finished", { time: formatTaskCenterTimestamp(attempt.finishedAt) })}</span>
        </div>
        {attempt.parentAttemptId ? <div>{t("task_center.history_parent_attempt", { id: attempt.parentAttemptId })}</div> : null}
        {attempt.turnId ? <div>{t("task_center.history_turn_id", { id: attempt.turnId })}</div> : null}
        {attempt.prompt ? <div><div className="font-semibold text-dls-text">{t("task_center.attempt_prompt")}</div><p className="mt-1 whitespace-pre-wrap leading-5">{attempt.prompt}</p></div> : null}
        {attempt.outputArtifactIds.length ? <div>{t("task_center.history_artifacts", { count: attempt.outputArtifactIds.length })}</div> : null}
        {attempt.error ? <div className="text-dls-status-danger-fg">{attempt.error}</div> : null}
      </div>
    </details>
  );
}

function TurnHistoryRow({ turn }: { turn: TaskOrchestratorTurn }) {
  return (
    <details className="rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2" data-history-turn={turn.id}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{t("task_center.turn_value", { count: turn.sequence })}</span>
        <StatusBadge size="tiny" shape="soft" tone={taskCenterStatusTone(turn.status)}>{t(taskCenterStatusLabelKey(turn.status))}</StatusBadge>
        <span className="text-xs text-dls-secondary">{t(taskCenterTurnReasonLabelKey(turn.reason))}</span>
        <span className="ms-auto text-xs text-dls-secondary">{formatTaskCenterTimestamp(turn.updatedAt)}</span>
      </summary>
      <div className="mt-3 space-y-2 border-t border-dls-border pt-3 text-xs text-dls-secondary">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>{t("task_center.history_turn_id", { id: turn.id })}</span>
          <span>{t("task_center.history_started", { time: formatTaskCenterTimestamp(turn.startedAt) })}</span>
          <span>{t("task_center.history_finished", { time: formatTaskCenterTimestamp(turn.finishedAt) })}</span>
          {turn.context?.percent !== null && turn.context?.percent !== undefined ? <span>{t("task_center.context_usage")}: {Math.round(turn.context.percent)}%</span> : null}
        </div>
        <div>{t("task_center.history_worker_count", { count: turn.workerAttemptIds?.length ?? 0 })}</div>
        {turn.checkpointId ? <div>{t("task_center.history_checkpoint_id", { id: turn.checkpointId })}</div> : null}
        {turn.capsuleId ? <div>{t("task_center.history_capsule_id", { id: turn.capsuleId })}</div> : null}
      </div>
    </details>
  );
}

function historyErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return t("task_center.turn_history_error");
}

function immutableAttemptTitle(attempt: TaskOrchestratorTurnHistoryAttempt): string {
  return attempt.kind === "primary" ? t("task_center.history_primary") : t("task_center.history_worker");
}

function providerDetails(
  attempt: TaskOrchestratorTurnHistoryAttempt | TaskOrchestratorTurnHistoryCheckerAttempt,
) {
  const diagnostics = attempt.providerDiagnostics;
  const usage = attempt.providerUsage;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {diagnostics ? (
        <span>
          {t("task_center.history_provider_diagnostics", {
            model: diagnostics.effectiveModel ?? t("task_center.not_available"),
            transport: diagnostics.transport ?? t("task_center.not_available"),
            connection: diagnostics.connectionMode ?? t("task_center.not_available"),
            session: diagnostics.providerSessionId ?? t("task_center.not_available"),
          })}
        </span>
      ) : null}
      {usage ? (
        <span>
          {t("task_center.history_provider_usage", {
            input: taskCenterFormatBudgetValue(usage.inputTokens),
            output: taskCenterFormatBudgetValue(usage.outputTokens),
            total: taskCenterFormatBudgetValue(usage.totalTokens),
            cost: taskCenterFormatBudgetValue(usage.costMicros),
          })}
        </span>
      ) : null}
    </div>
  );
}

function ImmutableAttemptRow(props: {
  attempt: TaskOrchestratorTurnHistoryAttempt;
  label?: string;
}) {
  const { attempt } = props;
  return (
    <details className="rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2" data-history-immutable-attempt={attempt.id}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
        <StatusDot size="sm" tone={taskCenterStatusDotTone(attempt.status)} pulse={attempt.status === "running"} />
        <span className="font-medium">{props.label ?? immutableAttemptTitle(attempt)}</span>
        <StatusBadge size="tiny" shape="soft" tone={taskCenterStatusTone(attempt.status)}>{t(taskCenterStatusLabelKey(attempt.status))}</StatusBadge>
        <span className="ms-auto text-xs text-dls-secondary">{formatTaskCenterTimestamp(attempt.updatedAt)}</span>
      </summary>
      <div className="mt-3 space-y-2 border-t border-dls-border pt-3 text-xs text-dls-secondary">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>{t("task_center.history_attempt_id", { id: attempt.id })}</span>
          <span>{t("task_center.history_profile", { profile: attempt.profileId })}</span>
          <span>{t("task_center.history_started", { time: formatTaskCenterTimestamp(attempt.startedAt) })}</span>
          <span>{t("task_center.history_finished", { time: formatTaskCenterTimestamp(attempt.finishedAt) })}</span>
        </div>
        {attempt.personalRunId ? <div>{t("task_center.history_personal_run", { id: attempt.personalRunId })}</div> : null}
        {attempt.conversationId ? <div>{t("task_center.history_conversation", { id: attempt.conversationId })}</div> : null}
        {providerDetails(attempt)}
        {attempt.outputArtifactIds.length ? <div>{t("task_center.history_artifacts", { count: attempt.outputArtifactIds.length })}</div> : null}
        {attempt.error ? <div className="text-dls-status-danger-fg">{attempt.error}</div> : null}
      </div>
    </details>
  );
}

function ImmutableCheckerRow({ attempt }: { attempt: TaskOrchestratorTurnHistoryCheckerAttempt }) {
  return (
    <details className="rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2" data-history-immutable-checker={attempt.id}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
        <StatusDot size="sm" tone={taskCenterStatusDotTone(attempt.status)} pulse={attempt.status === "running"} />
        <span className="font-medium">{t("task_center.history_checker")}</span>
        <StatusBadge size="tiny" shape="soft" tone={taskCenterStatusTone(attempt.status)}>{t(taskCenterStatusLabelKey(attempt.status))}</StatusBadge>
        <span className="text-xs text-dls-secondary">{t("task_center.history_checker_round", { round: attempt.round })}</span>
        <span className="ms-auto text-xs text-dls-secondary">{formatTaskCenterTimestamp(attempt.updatedAt)}</span>
      </summary>
      <div className="mt-3 space-y-2 border-t border-dls-border pt-3 text-xs text-dls-secondary">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>{t("task_center.history_attempt_id", { id: attempt.id })}</span>
          <span>{t("task_center.history_profile", { profile: attempt.profileId })}</span>
          <span>{t("task_center.history_checker_decision", { id: attempt.primaryDecisionId })}</span>
          <span>{t("task_center.history_started", { time: formatTaskCenterTimestamp(attempt.startedAt) })}</span>
          <span>{t("task_center.history_finished", { time: formatTaskCenterTimestamp(attempt.finishedAt) })}</span>
        </div>
        {attempt.personalRunId ? <div>{t("task_center.history_personal_run", { id: attempt.personalRunId })}</div> : null}
        {attempt.conversationId ? <div>{t("task_center.history_conversation", { id: attempt.conversationId })}</div> : null}
        {providerDetails(attempt)}
        {attempt.outputArtifactIds.length ? <div>{t("task_center.history_artifacts", { count: attempt.outputArtifactIds.length })}</div> : null}
        {attempt.error ? <div className="text-dls-status-danger-fg">{attempt.error}</div> : null}
      </div>
    </details>
  );
}

function ImmutableDecision({ item }: { item: TaskOrchestratorTurnHistoryItem }) {
  const decision = item.decision;
  if (!decision) return <NoticeBox tone="neutral">{t("task_center.history_no_decision")}</NoticeBox>;
  return (
    <div className="space-y-2 rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2" data-history-decision={decision.id}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{t("task_center.history_decision")}</span>
        <StatusBadge size="tiny" shape="soft" tone={decision.kind === "complete" ? "success" : decision.kind === "block" ? "danger" : "warning"}>
          {t(taskCenterDecisionLabelKey(decision.kind))}
        </StatusBadge>
        <span className="ms-auto text-xs text-dls-secondary">{formatTaskCenterTimestamp(decision.createdAt)}</span>
      </div>
      <p className="text-sm leading-5">{decision.summary}</p>
      {decision.acceptanceResults.length ? (
        <ul className="space-y-1 text-xs text-dls-secondary">
          {decision.acceptanceResults.map((criterion) => (
            <li key={`${decision.id}-${criterion.criterionIndex}`} className="flex flex-wrap items-start gap-x-2 gap-y-1" data-history-criterion={criterion.criterionIndex}>
              <StatusBadge size="tiny" shape="soft" tone={criterion.status === "passed" ? "success" : "danger"}>{criterion.status}</StatusBadge>
              <span>{t("task_center.history_criterion", { index: criterion.criterionIndex + 1, summary: criterion.summary })}</span>
              {criterion.evidenceArtifactIds.length ? <span>{t("task_center.history_criterion_evidence", { count: criterion.evidenceArtifactIds.length })}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ImmutableCheckpoint({ item }: { item: TaskOrchestratorTurnHistoryItem }) {
  const checkpoint = item.checkpoint;
  if (!checkpoint) return <NoticeBox tone="neutral">{t("task_center.history_no_checkpoint")}</NoticeBox>;
  return (
    <div className="rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2 text-xs text-dls-secondary" data-history-checkpoint={checkpoint.id}>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="font-medium text-dls-text">{t("task_center.history_checkpoint")}</span>
        <span>{t("task_center.history_checkpoint_id", { id: checkpoint.id })}</span>
        <span>{t(taskCenterCheckpointTriggerLabelKey(checkpoint.trigger))}</span>
        <span>{formatTaskCenterTimestamp(checkpoint.createdAt)}</span>
      </div>
      <div className="mt-1">{t("task_center.history_capsule_id", { id: checkpoint.capsuleId })}</div>
    </div>
  );
}

function ImmutableCapsule({ item }: { item: TaskOrchestratorTurnHistoryItem }) {
  const capsule = item.capsule;
  if (!capsule) return <NoticeBox tone="neutral">{t("task_center.history_no_capsule")}</NoticeBox>;
  const omitted = Object.values(capsule.truncation.omitted).reduce((total, count) => total + count, 0);
  return (
    <div className="space-y-2 rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2" data-history-capsule={capsule.id}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{t("task_center.history_capsule")}</span>
        <span className="ms-auto text-xs text-dls-secondary">{formatTaskCenterTimestamp(capsule.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-5">{capsule.summary}</p>
      <div className="flex flex-wrap gap-1.5 text-xs text-dls-secondary">
        <StatusBadge size="tiny" shape="soft" tone="surface">{t("task_center.capsule_completed", { count: capsule.completed.length })}</StatusBadge>
        <StatusBadge size="tiny" shape="soft" tone="surface">{t("task_center.capsule_pending", { count: capsule.pending.length })}</StatusBadge>
        <StatusBadge size="tiny" shape="soft" tone="surface">{t("task_center.history_capsule_artifacts", { count: capsule.artifactIds.length })}</StatusBadge>
      </div>
      {capsule.truncation.truncated || omitted > 0 ? (
        <NoticeBox tone="warning" data-history-truncation>
          {t("task_center.history_truncated_omitted", { fields: capsule.truncation.textFieldsTruncated, omitted })}
        </NoticeBox>
      ) : null}
    </div>
  );
}

function ImmutableTurnRow({ item }: { item: TaskOrchestratorTurnHistoryItem }) {
  const { turn } = item;
  return (
    <details className="rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2" data-history-immutable-turn={turn.id}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{t("task_center.turn_value", { count: turn.sequence })}</span>
        <StatusBadge size="tiny" shape="soft" tone={taskCenterStatusTone(turn.status)}>{t(taskCenterStatusLabelKey(turn.status))}</StatusBadge>
        <span className="text-xs text-dls-secondary">{t(taskCenterTurnReasonLabelKey(turn.reason))}</span>
        <span className="ms-auto text-xs text-dls-secondary">{formatTaskCenterTimestamp(turn.updatedAt)}</span>
      </summary>
      <div className="mt-3 space-y-3 border-t border-dls-border pt-3 text-xs text-dls-secondary">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>{t("task_center.history_turn_id", { id: turn.id })}</span>
          <span>{t("task_center.history_started", { time: formatTaskCenterTimestamp(turn.startedAt) })}</span>
          <span>{t("task_center.history_finished", { time: formatTaskCenterTimestamp(turn.finishedAt) })}</span>
          {turn.context?.percent !== null && turn.context?.percent !== undefined ? <span>{t("task_center.context_usage")}: {Math.round(turn.context.percent)}%</span> : null}
        </div>
        <section className="space-y-2" data-history-primary>
          <h4 className="text-xs font-semibold text-dls-text">{t("task_center.history_primary")}</h4>
          <ImmutableAttemptRow attempt={item.primaryAttempt} />
        </section>
        <section className="space-y-2" data-history-workers>
          <h4 className="text-xs font-semibold text-dls-text">{t("task_center.history_workers")}</h4>
          {item.workerAttempts.length ? item.workerAttempts.map((attempt) => <ImmutableAttemptRow key={attempt.id} attempt={attempt} />) : <NoticeBox tone="neutral">{t("task_center.no_workers_created")}</NoticeBox>}
        </section>
        <section className="space-y-2" data-history-checkers>
          <h4 className="text-xs font-semibold text-dls-text">{t("task_center.history_checker")}</h4>
          {item.checkerAttempts.length ? item.checkerAttempts.map((attempt) => <ImmutableCheckerRow key={attempt.id} attempt={attempt} />) : <NoticeBox tone="neutral">{t("task_center.history_no_checker")}</NoticeBox>}
        </section>
        <section className="space-y-2" data-history-decision-section>
          <ImmutableDecision item={item} />
        </section>
        <section className="space-y-2" data-history-checkpoint-section>
          <ImmutableCheckpoint item={item} />
        </section>
        <section className="space-y-2" data-history-capsule-section>
          <ImmutableCapsule item={item} />
        </section>
      </div>
    </details>
  );
}

function ImmutableTurnHistoryPanel(props: {
  run: TaskOrchestratorRun;
  items: TaskOrchestratorTurnHistoryItem[];
  hasMore?: boolean;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onLoadMore?: () => void;
}) {
  const { items } = props;
  const hasItems = items.length > 0;
  return (
    <Card size="sm" className="lg:col-span-2" data-task-center-immutable-history>
      <CardHeader>
        <CardTitle>{t("task_center.turn_history_immutable")}</CardTitle>
        <CardDescription>{t("task_center.turn_history_immutable_description", { runId: props.run.id })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.error && !hasItems ? (
          <NoticeBox tone="error" className="flex flex-wrap items-center justify-between gap-3">
            <span>{historyErrorMessage(props.error)}</span>
            {props.onRetry ? <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>{t("task_center.turn_history_retry")}</Button> : null}
          </NoticeBox>
        ) : props.loading && !hasItems ? (
          <div className="flex items-center gap-2 text-sm text-dls-secondary"><LoadingSpinner size="sm" />{t("task_center.turn_history_loading")}</div>
        ) : hasItems ? (
          <div className="space-y-2">
            {props.error ? (
              <NoticeBox tone="warning" className="flex flex-wrap items-center justify-between gap-3">
                <span>{historyErrorMessage(props.error)}</span>
                {props.onRetry ? <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>{t("task_center.turn_history_retry")}</Button> : null}
              </NoticeBox>
            ) : null}
            {items.map((item) => <ImmutableTurnRow key={item.turn.id} item={item} />)}
          </div>
        ) : (
          <NoticeBox tone="neutral">{t("task_center.no_turn_history")}</NoticeBox>
        )}
        {props.hasMore ? (
          <div className="flex justify-center border-t border-dls-border pt-3">
            <Button type="button" variant="outline" size="sm" disabled={props.loading} onClick={props.onLoadMore}>
              {props.loading ? t("task_center.loading_more") : t("task_center.turn_history_load_more")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function TaskCenterRunHistoryPanel(props: {
  run: TaskOrchestratorRun;
  items?: TaskOrchestratorTurnHistoryItem[];
  hasMore?: boolean;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onLoadMore?: () => void;
}) {
  if (props.items !== undefined) {
    return (
      <div className="grid gap-4 lg:grid-cols-2" data-task-center-history>
        <ImmutableTurnHistoryPanel
          run={props.run}
          items={props.items}
          hasMore={props.hasMore}
          loading={props.loading}
          error={props.error}
          onRetry={props.onRetry}
          onLoadMore={props.onLoadMore}
        />
        <NoticeBox tone="info" className="lg:col-span-2">{t("task_center.latest_run_history_notice", { runId: props.run.id, elapsed: taskCenterFormatDuration(props.run.budget?.elapsedMs ?? null) })}</NoticeBox>
      </div>
    );
  }
  const run = props.run;
  const attempts = [...run.primaryAttempts, ...run.workerAttempts].sort((left, right) => left.updatedAt - right.updatedAt);
  const turns = [...(run.turns ?? [])].sort((left, right) => left.sequence - right.sequence);
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-task-center-history>
      <Card size="sm">
        <CardHeader>
          <CardTitle>{t("task_center.attempt_history")}</CardTitle>
          <CardDescription>{t("task_center.attempt_history_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {attempts.length ? attempts.map((attempt) => <AttemptHistoryRow key={attempt.id} run={run} attempt={attempt} />) : <NoticeBox tone="neutral">{t("task_center.no_attempt_history")}</NoticeBox>}
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle>{t("task_center.turn_history")}</CardTitle>
          <CardDescription>{t("task_center.turn_history_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {turns.length ? turns.map((turn) => <TurnHistoryRow key={turn.id} turn={turn} />) : <NoticeBox tone="neutral">{t("task_center.no_turn_history")}</NoticeBox>}
        </CardContent>
      </Card>
      <NoticeBox tone="info" className="lg:col-span-2">{t("task_center.latest_run_history_notice", { runId: run.id, elapsed: taskCenterFormatDuration(run.budget?.elapsedMs ?? null) })}</NoticeBox>
    </div>
  );
}
