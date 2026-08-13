/** @jsxImportSource react */
import { useState } from "react";
import { Bot, Check, MessageSquare, Send, Users } from "lucide-react";
import type {
  TaskOrchestratorAttempt,
  TaskOrchestratorCheckerAttempt,
  TaskOrchestratorContract,
  TaskOrchestratorEvent,
  TaskOrchestratorOperationsDiagnostics,
  TaskOrchestratorSnapshot,
  TaskOrchestratorTurnHistoryItem,
} from "@onmyagent/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { formatTaskCenterTimestamp } from "./task-center-detail-shared";
import {
  latestPrimaryAttempt,
  profileForAttempt,
  taskCenterAlignmentRoleLabelKey,
  taskCenterActiveWorkerCount,
  taskCenterCheckerVerdictLabelKey,
  taskCenterCheckpointTriggerLabelKey,
  taskCenterContextPercent,
  taskCenterCurrentTurn,
  taskCenterElapsedMs,
  taskCenterEventTypes,
  taskCenterEventLabelKey,
  taskCenterEventTypeLabelKey,
  taskCenterFormatBudgetValue,
  taskCenterFormatDuration,
  taskCenterEndConditionsForPreset,
  taskCenterStatusDotTone,
  taskCenterStatusLabelKey,
  taskCenterStatusTone,
} from "./task-center-model";
import { TaskCenterRunHistoryPanel } from "./task-center-history";

function ContractList(props: { label: string; values: string[] }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-dls-secondary">{props.label}</div>
      {props.values.length ? (
        <ul className="space-y-1.5 text-sm leading-5">
          {props.values.map((value, index) => <li key={`${index}-${value}`} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-dls-status-success-fg" aria-hidden /><span>{value}</span></li>)}
        </ul>
      ) : <div className="text-sm text-dls-secondary">{t("task_center.not_available")}</div>}
    </div>
  );
}

function RunMetric(props: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2.5">
      <dt className="truncate text-xs text-dls-secondary">{props.label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-dls-text">{props.value}</dd>
    </div>
  );
}

function TaskCenterRunObservability({ run }: { run: NonNullable<TaskOrchestratorSnapshot["run"]> }) {
  const turn = taskCenterCurrentTurn(run);
  const budget = run.budget;
  const conditions = run.definition.endConditions ?? taskCenterEndConditionsForPreset("recommended-overnight");
  const contextPercent = taskCenterContextPercent(run);
  const checkpoints = (run.checkpoints ?? []).slice(-5).reverse();
  const capsules = (run.continuationCapsules ?? []).slice(-5).reverse();
  return (
    <div className="space-y-4" data-task-center-observability>
      <Card size="sm">
        <CardHeader>
          <CardTitle>{t("task_center.execution_observability")}</CardTitle>
          <CardDescription>{t("task_center.execution_observability_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <RunMetric label={t("task_center.current_turn")} value={turn ? t("task_center.turn_value", { count: turn.sequence }) : t("task_center.not_available")} />
            <RunMetric label={t("task_center.turn_status")} value={turn ? t(taskCenterStatusLabelKey(turn.status)) : t("task_center.not_available")} />
            <RunMetric label={t("task_center.elapsed_time")} value={taskCenterFormatDuration(taskCenterElapsedMs(run))} />
            <RunMetric label={t("task_center.context_usage")} value={contextPercent === null ? t("task_center.not_available") : `${Math.round(contextPercent)}%`} />
          </dl>
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <RunMetric label={t("task_center.primary_turn_budget")} value={budget ? `${budget.primaryTurnsUsed} / ${conditions.maxPrimaryTurns}` : t("task_center.not_available")} />
            <RunMetric label={t("task_center.worker_attempt_budget")} value={budget ? `${budget.workerAttemptsUsed} / ${conditions.maxWorkerAttempts}` : t("task_center.not_available")} />
            <RunMetric label={t("task_center.worker_concurrency")} value={`${taskCenterActiveWorkerCount(run)} / ${conditions.maxWorkerConcurrency}`} />
            <RunMetric label={t("task_center.retry_count")} value={budget ? `${budget.consecutiveFailures} / ${conditions.maxConsecutiveFailures}` : t("task_center.not_available")} />
          </dl>
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <RunMetric label={t("task_center.deadline")} value={conditions.deadlineAt === null ? t("task_center.no_deadline") : formatTaskCenterTimestamp(conditions.deadlineAt)} />
            <RunMetric label={t("task_center.stall_timeout")} value={taskCenterFormatDuration(conditions.stallTimeoutMs)} />
            <RunMetric label={t("task_center.turn_timeout")} value={taskCenterFormatDuration(conditions.maxTurnRuntimeMs)} />
            <RunMetric label={t("task_center.transport_retries")} value={budget ? `${budget.transportRetries} / ${conditions.maxTransportRetries}` : t("task_center.not_available")} />
          </dl>
          {budget?.tokensUsed !== null && budget?.tokensUsed !== undefined ? <p className="text-xs text-dls-secondary">{t("task_center.tokens_used", { count: taskCenterFormatBudgetValue(budget.tokensUsed) })}</p> : null}
          {budget?.costMicrosUsed !== null && budget?.costMicrosUsed !== undefined ? <p className="text-xs text-dls-secondary">{t("task_center.cost_used", { count: taskCenterFormatBudgetValue(budget.costMicrosUsed) })}</p> : null}
          {contextPercent !== null && contextPercent >= conditions.contextRolloverPercent ? <NoticeBox tone="warning">{t("task_center.context_rollover_warning", { percent: conditions.contextRolloverPercent })}</NoticeBox> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t("task_center.durable_checkpoints")}</CardTitle>
            <CardDescription>{t("task_center.durable_checkpoints_description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {checkpoints.length ? (
              <ol className="space-y-2" aria-label={t("task_center.durable_checkpoints")}>
                {checkpoints.map((checkpoint) => (
                  <li key={checkpoint.id} className="flex items-start justify-between gap-3 rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block font-medium">{t(taskCenterCheckpointTriggerLabelKey(checkpoint.trigger))}</span>
                      <span className="mt-0.5 block text-xs text-dls-secondary">{t("task_center.checkpoint_turn", { turn: checkpoint.turnId })}</span>
                    </span>
                    <span className="shrink-0 text-xs text-dls-secondary">{formatTaskCenterTimestamp(checkpoint.createdAt)}</span>
                  </li>
                ))}
              </ol>
            ) : <NoticeBox tone="neutral">{t("task_center.no_checkpoints")}</NoticeBox>}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t("task_center.continuation_capsules")}</CardTitle>
            <CardDescription>{t("task_center.continuation_capsules_description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <NoticeBox tone="info">{t("task_center.fresh_session_rollover_notice")}</NoticeBox>
            {capsules.length ? capsules.map((capsule) => (
              <article key={capsule.id} className="rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2.5" data-continuation-capsule={capsule.id}>
                <div className="flex items-start justify-between gap-3">
                  <h4 className="text-sm font-medium">{t("task_center.capsule_from_turn", { turn: capsule.fromTurnId })}</h4>
                  <span className="shrink-0 text-xs text-dls-secondary">{formatTaskCenterTimestamp(capsule.createdAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-5">{capsule.summary}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-dls-secondary">
                  <StatusBadge size="tiny" shape="soft" tone="surface">{t("task_center.capsule_completed", { count: capsule.completed.length })}</StatusBadge>
                  <StatusBadge size="tiny" shape="soft" tone="surface">{t("task_center.capsule_pending", { count: capsule.pending.length })}</StatusBadge>
                  {capsule.risks.length ? <StatusBadge size="tiny" shape="soft" tone="warning">{t("task_center.capsule_risks", { count: capsule.risks.length })}</StatusBadge> : null}
                </div>
              </article>
            )) : <NoticeBox tone="neutral">{t("task_center.no_continuation_capsules")}</NoticeBox>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function operationsValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return t("task_center.not_available");
  return String(value);
}

function operationsAge(value: number | null | undefined): string {
  return value === null || value === undefined ? t("task_center.not_available") : taskCenterFormatDuration(value);
}

function OperationsDiagnosticsCard(props: {
  diagnostics?: TaskOrchestratorOperationsDiagnostics;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const diagnostics = props.diagnostics;
  const error = props.error instanceof Error && props.error.message.trim()
    ? props.error.message
    : props.error ? t("task_center.operations_diagnostics_error") : null;
  const state = diagnostics?.truncated ? "truncated" : diagnostics ? "full" : "unavailable";
  const attempt = diagnostics?.attempt;
  const context = diagnostics?.context;
  const retries = diagnostics?.retries;
  const provider = diagnostics?.provider;
  const processes = diagnostics?.processes;
  const storage = diagnostics?.storage;
  return (
    <Card size="sm" data-task-center-operations-diagnostics data-task-center-operations-diagnostics-state={state}>
      <CardHeader>
        <CardTitle>{t("task_center.operations_diagnostics")}</CardTitle>
        <CardDescription>{t("task_center.operations_diagnostics_description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <NoticeBox tone="error" className="flex flex-wrap items-center justify-between gap-3" data-task-center-operations-diagnostics-error>
            <span>{error}</span>
            {props.onRetry ? <Button type="button" variant="outline" size="sm" data-task-center-operations-diagnostics-retry onClick={props.onRetry}>{t("task_center.operations_diagnostics_retry")}</Button> : null}
          </NoticeBox>
        ) : null}
        {props.loading && !diagnostics ? (
          <div className="flex items-center gap-2 text-sm text-dls-secondary" data-task-center-operations-diagnostics-loading><LoadingSpinner size="sm" />{t("task_center.operations_diagnostics_loading")}</div>
        ) : diagnostics ? (
          <>
            {diagnostics.truncated ? <NoticeBox tone="warning" data-task-center-operations-diagnostics-truncated>{t("task_center.operations_diagnostics_truncated")}</NoticeBox> : null}
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <RunMetric label={t("task_center.operations_terminal_reason")} value={diagnostics.terminalReason ? `${diagnostics.terminalReason.code} · ${diagnostics.terminalReason.message}` : t("task_center.not_available")} />
              <RunMetric label={t("task_center.operations_attempt_status")} value={attempt ? operationsValue(attempt.status) : t("task_center.not_available")} />
              <RunMetric label={t("task_center.operations_lease_age")} value={operationsAge(attempt?.leaseAgeMs)} />
              <RunMetric label={t("task_center.operations_progress_age")} value={operationsAge(attempt?.progressAgeMs)} />
            </dl>
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <RunMetric label={t("task_center.operations_lease_expiry")} value={attempt?.leaseExpiresAt === null || attempt?.leaseExpiresAt === undefined ? t("task_center.not_available") : formatTaskCenterTimestamp(attempt.leaseExpiresAt)} />
              <RunMetric label={t("task_center.operations_context_tokens")} value={context ? `${operationsValue(context.usedTokens)} / ${operationsValue(context.totalTokens)}` : t("task_center.not_available")} />
              <RunMetric label={t("task_center.operations_context_percent")} value={context?.percent === null || context?.percent === undefined ? t("task_center.not_available") : `${Math.round(context.percent)}%`} />
              <RunMetric label={t("task_center.operations_context_source")} value={context ? operationsValue(context.source) : t("task_center.not_available")} />
            </dl>
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <RunMetric label={t("task_center.retry_count")} value={retries ? operationsValue(retries.consecutiveFailures) : t("task_center.not_available")} />
              <RunMetric label={t("task_center.transport_retries")} value={retries ? operationsValue(retries.transportRetries) : t("task_center.not_available")} />
              <RunMetric label={t("task_center.primary_turn_budget")} value={retries ? operationsValue(retries.primaryTurnsUsed) : t("task_center.not_available")} />
              <RunMetric label={t("task_center.worker_attempt_budget")} value={retries ? operationsValue(retries.workerAttemptsUsed) : t("task_center.not_available")} />
            </dl>
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <RunMetric label={t("task_center.effective_model")} value={provider ? operationsValue(provider.effectiveModel) : t("task_center.not_available")} />
              <RunMetric label={t("task_center.provider_session")} value={provider ? operationsValue(provider.session) : t("task_center.not_available")} />
              <RunMetric label={t("task_center.provider_transport")} value={provider ? operationsValue(provider.transport) : t("task_center.not_available")} />
              <RunMetric label={t("task_center.provider_connection")} value={provider ? operationsValue(provider.connectionMode) : t("task_center.not_available")} />
              <RunMetric label={t("task_center.provider_request_id")} value={provider ? operationsValue(provider.requestId) : t("task_center.not_available")} />
              <RunMetric label={t("task_center.provider_fallback_count")} value={provider ? operationsValue(provider.fallbackCount) : t("task_center.not_available")} />
            </dl>
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <RunMetric label={t("task_center.process_count")} value={processes ? operationsValue(processes.count) : t("task_center.not_available")} />
              <RunMetric label={t("task_center.process_active")} value={processes ? operationsValue(processes.active) : t("task_center.not_available")} />
              <RunMetric label={t("task_center.storage_health")} value={storage?.observed === false || storage?.healthy === null || storage?.healthy === undefined ? t("task_center.not_available") : storage.healthy ? t("task_center.healthy") : t("task_center.unhealthy")} />
              <RunMetric label={t("task_center.storage_database_size")} value={storage?.databaseBytes === null || storage?.databaseBytes === undefined ? t("task_center.not_available") : taskCenterFormatBudgetValue(storage.databaseBytes)} />
            </dl>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2.5 text-xs text-dls-secondary" data-task-center-operations-processes>
                <div className="font-semibold text-dls-text">{t("task_center.process_states")}</div>
                <div className="mt-1">{processes?.states && Object.keys(processes.states).length ? Object.entries(processes.states).map(([name, count]) => `${name}: ${count}`).join(" · ") : t("task_center.not_available")}</div>
                <div className="mt-1">{t("task_center.process_pids", { pids: processes?.pids?.length ? processes.pids.join(", ") : t("task_center.not_available") })}</div>
              </div>
              <div className="rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2.5 text-xs text-dls-secondary" data-task-center-operations-storage data-task-center-operations-storage-observed={storage?.observed === true ? "true" : storage?.observed === false ? "false" : "unknown"} data-task-center-operations-storage-stale={storage?.stale === true ? "true" : "false"}>
                <div className="font-semibold text-dls-text">{t("task_center.storage_outbox")}</div>
                <div className="mt-1">{storage ? t("task_center.storage_outbox_value", { outbox: operationsValue(storage.outboxCount), processes: operationsValue(storage.processCount), reclaimable: storage.reclaimableBytes === null || storage.reclaimableBytes === undefined ? t("task_center.not_available") : taskCenterFormatBudgetValue(storage.reclaimableBytes), maintenance: storage.lastMaintenanceAt === null || storage.lastMaintenanceAt === undefined ? t("task_center.not_available") : formatTaskCenterTimestamp(storage.lastMaintenanceAt) }) : t("task_center.not_available")}</div>
              </div>
            </div>
          </>
        ) : !props.loading ? <NoticeBox tone="neutral">{t("task_center.operations_diagnostics_unavailable")}</NoticeBox> : null}
      </CardContent>
    </Card>
  );
}

function ContractProposalCard(props: { contract: TaskOrchestratorContract | null; revision?: number | null }) {
  if (!props.contract) {
    return <NoticeBox tone="neutral">{t("task_center.no_contract_proposal")}</NoticeBox>;
  }
  return (
    <Card variant="outline" size="sm" data-contract-proposal>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><Check className="size-4 text-dls-status-success-fg" aria-hidden />{t("task_center.latest_contract_proposal")}</CardTitle>
        {props.revision ? <CardDescription>{t("task_center.contract_revision", { count: props.revision })}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4 md:col-span-2"><div className="text-xs font-semibold text-dls-secondary">{t("task_center.contract_outcome")}</div><p className="whitespace-pre-wrap text-sm leading-6">{props.contract.outcome}</p></div>
        <ContractList label={t("task_center.contract_deliverables")} values={props.contract.deliverables} />
        <ContractList label={t("task_center.contract_acceptance")} values={props.contract.acceptance} />
        <ContractList label={t("task_center.contract_verification")} values={props.contract.verification} />
        <div className="space-y-3">
          <ContractList label={t("task_center.contract_scope_included")} values={props.contract.scope.included} />
          <ContractList label={t("task_center.contract_scope_excluded")} values={props.contract.scope.excluded} />
        </div>
      </CardContent>
    </Card>
  );
}

export function TaskCenterAlignmentPanel(props: {
  snapshot: TaskOrchestratorSnapshot;
  busy: boolean;
  finalizeBusy?: boolean;
  cancelBusy?: boolean;
  readOnly?: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  onFinalize: (proposalId: string, proposalRevision: number) => void;
}) {
  const [message, setMessage] = useState("");
  const alignment = props.snapshot.task.alignment;
  const alignmentStatus = alignment.status ?? "idle";
  const latestProposal = props.snapshot.task.alignment.proposals.find(
    (proposal) => proposal.id === props.snapshot.task.alignment.latestProposalId,
  ) ?? props.snapshot.task.alignment.proposals.at(-1) ?? null;
  const submitMessage = () => {
    const text = message.trim();
    if (!text) return;
    props.onSend(text);
    setMessage("");
  };
  const awaitingConfirmation = props.snapshot.task.definitionStatus === "awaiting-confirmation";
  const autoFinalization = props.snapshot.task.contractFinalization === "model-recommended-auto";
  const alignmentOpen = ["alignment", "awaiting-confirmation"].includes(
    props.snapshot.task.definitionStatus,
  );
  return (
    <div className="space-y-4" data-task-center-alignment>
      {alignmentStatus === "running" ? (
        <NoticeBox tone="info" className="flex flex-wrap items-center justify-between gap-3" data-alignment-running>
          <span>{t("task_center.alignment_in_progress", { time: formatTaskCenterTimestamp(alignment.startedAt ?? null) })}</span>
          {!props.readOnly ? <Button type="button" variant="outline" size="sm" disabled={props.cancelBusy} onClick={props.onCancel}>{props.cancelBusy ? t("task_center.retrying") : t("task_center.alignment_cancel")}</Button> : null}
        </NoticeBox>
      ) : alignmentStatus === "cancelled" ? (
        <NoticeBox tone="warning" data-alignment-cancelled>{t("task_center.alignment_cancelled")}</NoticeBox>
      ) : alignmentStatus === "failed" && alignment.error ? (
        <NoticeBox tone="error" data-alignment-failed>{t("task_center.alignment_failed", { error: alignment.error })}</NoticeBox>
      ) : null}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MessageSquare className="size-4" aria-hidden />{t("task_center.alignment_title")}</CardTitle>
          <CardDescription>{t("task_center.alignment_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {props.snapshot.task.alignment.messages.length ? (
            <ol className="space-y-3" aria-label={t("task_center.alignment_transcript")}>
              {props.snapshot.task.alignment.messages.map((item) => (
                <li key={item.id} className="flex gap-3" data-message-role={item.role}>
                  <StatusDot className="mt-1.5" size="md" tone={item.role === "human" ? "muted" : "active"} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-dls-secondary">{t(taskCenterAlignmentRoleLabelKey(item.role))}</span><span className="text-xs text-dls-secondary">{formatTaskCenterTimestamp(item.at)}</span></div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{item.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : <NoticeBox tone="neutral">{t("task_center.alignment_waiting")}</NoticeBox>}
          {alignmentOpen && !props.readOnly ? (
            <div className="space-y-2 border-t border-dls-border pt-4">
              <Textarea value={message} onChange={(event) => setMessage(event.currentTarget.value)} placeholder={t("task_center.alignment_input_placeholder")} className="min-h-24" disabled={props.busy} aria-label={t("task_center.alignment_input")} />
              <div className="flex justify-end"><Button type="button" variant="outline" disabled={props.busy || !message.trim()} onClick={submitMessage}><Send className="size-3.5" aria-hidden />{t("task_center.alignment_send")}</Button></div>
            </div>
          ) : (
            <NoticeBox tone="success">{t("task_center.contract_frozen_notice")}</NoticeBox>
          )}
        </CardContent>
      </Card>
      <ContractProposalCard contract={latestProposal?.contract ?? null} revision={latestProposal?.revision} />
      {autoFinalization && !props.readOnly ? (
        <NoticeBox tone="info" data-contract-mode="auto">{t("task_center.contract_auto_running")}</NoticeBox>
      ) : awaitingConfirmation && latestProposal && !props.readOnly ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dls-border bg-dls-surface-muted p-3" data-contract-mode="manual">
          <div className="text-sm text-dls-secondary">{t("task_center.contract_manual_ready")}</div>
          <Button type="button" disabled={props.finalizeBusy ?? props.busy} onClick={() => props.onFinalize(latestProposal.id, latestProposal.revision)}>{t("task_center.confirm_contract_and_start")}</Button>
        </div>
      ) : props.readOnly ? <NoticeBox tone="neutral" data-task-center-read-only>{t("task_center.archived_read_only")}</NoticeBox> : null}
    </div>
  );
}

function AttemptCard(props: {
  attempt: TaskOrchestratorAttempt;
  label: string;
  profileLabel: string;
  nested?: boolean;
}) {
  const { attempt } = props;
  return (
    <Card variant="outline" size="sm" className={props.nested ? "ms-6 border-dls-mist" : undefined} data-attempt-kind={attempt.kind} data-attempt-id={attempt.id}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <StatusDot className="mt-1" size="md" tone={taskCenterStatusDotTone(attempt.status)} pulse={attempt.status === "running"} />
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm">{props.label}</CardTitle>
            <CardDescription className="mt-1 truncate">{props.profileLabel}</CardDescription>
          </div>
          <StatusBadge size="tiny" shape="soft" tone={taskCenterStatusTone(attempt.status)}>{t(taskCenterStatusLabelKey(attempt.status))}</StatusBadge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {attempt.providerDiagnostics ? (
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-provider-diagnostics={attempt.id}>
            <RunMetric label={t("task_center.effective_model")} value={attempt.providerDiagnostics.effectiveModel ?? t("task_center.not_available")} />
            <RunMetric label={t("task_center.provider_transport")} value={attempt.providerDiagnostics.transport ?? t("task_center.not_available")} />
            <RunMetric label={t("task_center.provider_connection")} value={attempt.providerDiagnostics.connectionMode ?? t("task_center.not_available")} />
            <RunMetric label={t("task_center.provider_session")} value={attempt.providerDiagnostics.providerSessionId ?? t("task_center.not_available")} />
            <RunMetric label={t("task_center.last_progress")} value={formatTaskCenterTimestamp(attempt.updatedAt)} />
          </dl>
        ) : null}
        {attempt.prompt ? <div><div className="text-xs font-semibold text-dls-secondary">{t("task_center.attempt_prompt")}</div><p className="mt-1 whitespace-pre-wrap leading-5">{attempt.prompt}</p></div> : null}
        {attempt.outputArtifactIds.length ? <div><div className="text-xs font-semibold text-dls-secondary">{t("task_center.artifact_references")}</div><div className="mt-1 flex flex-wrap gap-1.5">{attempt.outputArtifactIds.map((artifactId) => <StatusBadge key={artifactId} size="tiny" shape="soft" tone="surface">{artifactId}</StatusBadge>)}</div></div> : null}
        {attempt.error ? <NoticeBox tone="error">{attempt.error}</NoticeBox> : null}
      </CardContent>
    </Card>
  );
}

function IndependentCheckerCard(props: {
  attempts: TaskOrchestratorCheckerAttempt[];
  verdict?: NonNullable<TaskOrchestratorSnapshot["run"]>["checkerVerdicts"][number] | null;
  profileLabel: string;
}) {
  const latest = props.attempts.at(-1);
  if (!latest && !props.verdict) return null;
  return (
    <Card variant="outline" size="sm" data-independent-checker-status data-task-center-checker-status>
      <CardHeader>
        <div className="flex items-start gap-3">
          <StatusDot className="mt-1" size="md" tone={taskCenterStatusDotTone(latest?.status ?? (props.verdict?.verdict === "approve" ? "succeeded" : "blocked"))} pulse={latest?.status === "running"} />
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm">{t("task_center.independent_checker")}</CardTitle>
            <CardDescription className="mt-1 truncate">{props.profileLabel}</CardDescription>
          </div>
          {latest ? <StatusBadge size="tiny" shape="soft" tone={taskCenterStatusTone(latest.status)}>{latest.status === "running" ? t("task_center.checker_status_checking") : t(taskCenterStatusLabelKey(latest.status))}</StatusBadge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {props.verdict ? (
          <NoticeBox tone={props.verdict.verdict === "approve" ? "success" : props.verdict.verdict === "revise" ? "warning" : "error"}>
            <span className="font-medium">{t("task_center.checker_verdict_label", { verdict: t(taskCenterCheckerVerdictLabelKey(props.verdict.verdict)) })}</span>
            <span className="mt-1 block">{props.verdict.summary}</span>
          </NoticeBox>
        ) : latest?.status === "running" || latest?.status === "ready" ? (
          <NoticeBox tone="info">{t("task_center.checker_status_checking")}</NoticeBox>
        ) : latest?.error ? <NoticeBox tone="error">{latest.error}</NoticeBox> : null}
      </CardContent>
    </Card>
  );
}

export function TaskCenterExecutionPanel(props: {
  snapshot: TaskOrchestratorSnapshot;
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
}) {
  const [eventType, setEventType] = useState("all");
  const snapshot = props.snapshot;
  const run = snapshot.run;
  if (!run) return <NoticeBox tone="neutral">{t("task_center.no_run_description")}</NoticeBox>;
  const primary = latestPrimaryAttempt(run);
  const primaryProfile = primary ? profileForAttempt(run, primary) : run.definition.primary;
  const workers = run.workerAttempts;
  const events = props.events ?? snapshot.events;
  const filteredEvents = eventType === "all" ? events : events.filter((event) => event.type === eventType);
  const eventTypes = taskCenterEventTypes(events);
  return (
    <div className="space-y-4" data-task-center-execution>
      <TaskCenterRunObservability run={run} />
      <OperationsDiagnosticsCard diagnostics={props.operationsDiagnostics} loading={props.operationsDiagnosticsLoading} error={props.operationsDiagnosticsError} onRetry={props.onRetryOperationsDiagnostics} />
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="size-4" aria-hidden />{t("task_center.primary_owner")}</CardTitle>
          <CardDescription>{t("task_center.primary_owner_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {primary ? <AttemptCard attempt={primary} label={t("task_center.primary_attempt")} profileLabel={`${primaryProfile?.label ?? run.definition.primary.label} · ${primaryProfile?.modelLabel ?? primaryProfile?.model ?? t("task_center.default_model")}`} /> : <NoticeBox tone="neutral">{t("task_center.no_primary_attempt")}</NoticeBox>}
          {workers.length ? (
            <div className="space-y-3" data-worker-timeline>
              <div className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4" aria-hidden />{t("task_center.worker_timeline")}</div>
              {workers.map((worker) => {
                const profile = profileForAttempt(run, worker);
                return <AttemptCard key={worker.id} attempt={worker} nested label={t("task_center.worker_attempt")} profileLabel={`${profile?.label ?? worker.profileId} · ${profile?.modelLabel ?? profile?.model ?? t("task_center.default_model")}`} />;
              })}
            </div>
          ) : <NoticeBox tone="neutral">{t("task_center.no_workers_created")}</NoticeBox>}
          <IndependentCheckerCard
            attempts={run.checkerAttempts ?? []}
            verdict={run.checkerVerdicts?.at(-1) ?? null}
            profileLabel={run.definition.independentChecker?.profile?.label ?? t("task_center.independent_checker_primary_only")}
          />
        </CardContent>
      </Card>
      <TaskCenterRunHistoryPanel run={run} items={props.turnHistory} hasMore={props.turnHistoryHasMore} loading={props.turnHistoryLoading} error={props.turnHistoryError} onRetry={props.onRetryTurnHistory} onLoadMore={props.onLoadMoreTurnHistory} />
      <Card size="sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{t("task_center.event_timeline")}</CardTitle>
              <CardDescription>{t("task_center.event_timeline_description", { count: filteredEvents.length })}</CardDescription>
            </div>
            <Select value={eventType} onValueChange={(value) => setEventType(value ?? "all")}>
              <SelectTrigger size="sm" aria-label={t("task_center.event_filter")}>
                <SelectValue>{(value) => value === "all" ? t("task_center.filter_all_events") : t(taskCenterEventTypeLabelKey(value as TaskOrchestratorEvent["type"]))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("task_center.filter_all_events")}</SelectItem>
                {eventTypes.map((type) => <SelectItem key={type} value={type}>{t(taskCenterEventTypeLabelKey(type))}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {events.length ? <>
            {filteredEvents.length ? <ol className="space-y-3">{filteredEvents.map((event) => <li key={event.id} className="flex gap-3 text-sm"><StatusDot className="mt-1.5" size="md" tone="muted" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{t(taskCenterEventLabelKey(event))}</span><span className="text-xs text-dls-secondary">{formatTaskCenterTimestamp(event.at)}</span></div>{event.message ? <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-dls-secondary">{event.message}</p> : null}</div></li>)}</ol> : <NoticeBox tone="neutral">{t("task_center.no_matching_events")}</NoticeBox>}
            {props.eventsHasMore ? <div className="mt-4 flex justify-center border-t border-dls-border pt-3"><Button type="button" variant="outline" size="sm" disabled={props.eventsLoading} onClick={props.onLoadMoreEvents}>{props.eventsLoading ? t("task_center.loading_more") : t("task_center.load_more_events")}</Button></div> : null}
          </> : <NoticeBox tone="neutral">{t("task_center.no_events_description")}</NoticeBox>}
        </CardContent>
      </Card>
    </div>
  );
}
