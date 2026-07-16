import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ChevronDown, Loader2, Play, Plus, RefreshCw, Trash2, X, Clock3 } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { EmptyStateBox, NoticeBox } from "@/components/ui/notice-box";
import { CountBadge, StatusBadge, type StatusBadgeTone } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { SelectMenu } from "../../design-system/select-menu";
import type {
  PersonalLocalAgent,
  PersonalLocalAgentConversation,
  PersonalLocalAgentHeartbeatJob,
  PersonalLocalAgentRunResult,
} from "../../../app/lib/desktop";

export type HeartbeatDraft = {
  title: string;
  prompt: string;
  intervalMinutes: string;
  conversationId: string;
};

export const heartbeatClass = {
  overlay: "border-t border-dls-border bg-dls-background px-5 py-3 mac:titlebar-no-drag",
  panel: "max-h-96 overflow-y-auto rounded-lg border border-dls-border bg-dls-surface p-3 text-xs text-dls-text",
  grid: "grid gap-3 md:grid-cols-2 xl:grid-cols-4",
  item: "rounded-lg border border-dls-border bg-dls-surface px-3 py-2.5",
  meta: "mt-1 flex flex-wrap gap-2 text-xs text-dls-secondary",
  runs: "mt-2 w-full rounded-lg border border-dls-border bg-dls-surface-muted p-2",
  runItem: "rounded-md border border-dls-border bg-dls-surface px-2 py-1.5",
};

function ScheduleSection(props: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-dls-border bg-dls-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-dls-text">{props.title}</div>
          {props.description ? <div className="mt-1 text-xs leading-5 text-dls-secondary">{props.description}</div> : null}
        </div>
        {props.actions ? <div className="flex shrink-0 flex-wrap gap-2">{props.actions}</div> : null}
      </div>
      <div className="mt-3">{props.children}</div>
    </section>
  );
}

function ScheduleMetric(props: { label: string; value: string; tone?: StatusBadgeTone }) {
  return (
    <div className="rounded-lg border border-dls-border bg-dls-surface px-3 py-2">
      <div className="text-xs text-dls-secondary">{props.label}</div>
      <div className="mt-1 flex items-center gap-2">
        {props.tone ? <StatusBadge tone={props.tone}>{props.value}</StatusBadge> : <span className="truncate text-sm font-medium text-dls-text">{props.value}</span>}
      </div>
    </div>
  );
}

export function heartbeatStatusTone(status: PersonalLocalAgentRunResult["status"] | null | undefined): StatusBadgeTone {
  if (status === "completed") return "success";
  if (status === "running") return "accent";
  if (status === "cancelled") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

function heartbeatStatusLabel(status: PersonalLocalAgentRunResult["status"]) {
  switch (status) {
    case "running":
      return t("local_agent.status_running");
    case "completed":
      return t("local_agent.status_completed");
    case "failed":
      return t("local_agent.status_failed");
    case "cancelled":
      return t("local_agent.status_cancelled");
    case "missing":
      return t("local_agent.status_missing");
  }
}

export function scheduledRunSummary(run: PersonalLocalAgentHeartbeatJob["runs"][number]) {
  const text = run.error || run.output || "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return t("local_agent.heartbeat_run_no_output");
  return normalized.length > 260 ? `${normalized.slice(0, 260)}...` : normalized;
}

export function scheduledRunMessage(job: PersonalLocalAgentHeartbeatJob, run: PersonalLocalAgentHeartbeatJob["runs"][number]) {
  const title = job.title || t("local_agent.heartbeat_default_title");
  const status = heartbeatStatusLabel(run.status);
  const runIdValue = run.runId ?? run.id;
  const output = scheduledRunSummary(run);
  return {
    id: `scheduled-task-${job.id}-${run.id}`,
    role: "assistant" as const,
    createdAt: run.finishedAt ?? run.startedAt,
    text: t("local_agent.heartbeat_task_completed", { title, status, run: runIdValue, output }),
    run: null,
  };
}

export function scheduledTaskSessionContext(messages: Array<{ id: string; role: string; text: string }> | undefined) {
  const relevant = (messages ?? [])
    .filter((message) => !message.id.startsWith("scheduled-task-"))
    .slice(-12)
    .map((message) => `${message.role}: ${message.text.replace(/\s+/g, " ").trim()}`)
    .filter((line) => line.length > 0);
  return relevant.join("\n").slice(-6000);
}

export function conversationTitle(conversation: PersonalLocalAgentConversation | null | undefined) {
  if (!conversation) return t("local_agent.default_conversation");
  return conversation.title || t("local_agent.default_conversation");
}

export function shortDateTime(value: number | null | undefined) {
  if (!value) return "--";
  return new Date(value).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HeartbeatPanel(props: {
  agent: PersonalLocalAgent;
  jobs: PersonalLocalAgentHeartbeatJob[];
  draft: HeartbeatDraft;
  conversations: PersonalLocalAgentConversation[];
  conversation: PersonalLocalAgentConversation | null;
  busyId: string | null;
  error: string | null;
  onDraftChange: (draft: HeartbeatDraft) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onRunNow: (job: PersonalLocalAgentHeartbeatJob) => void;
  onToggleEnabled: (job: PersonalLocalAgentHeartbeatJob, enabled: boolean) => void;
  onDelete: (job: PersonalLocalAgentHeartbeatJob) => void;
  onClose: () => void;
}) {
  const createBusy = props.busyId === "create";
  const selectedDraftConversation = props.conversations.find((conversation) => conversation.id === props.draft.conversationId) ?? props.conversation;
  const titleTrimmed = props.draft.title.trim();
  const promptTrimmed = props.draft.prompt.trim();
  const intervalValue = Number(props.draft.intervalMinutes);
  const intervalInvalid = !Number.isFinite(intervalValue) || intervalValue < 5;
  const enabledJobs = props.jobs.filter((job) => job.enabled).length;
  const runningJobs = props.jobs.filter((job) => Boolean(job.running)).length;
  const latestRun = props.jobs
    .flatMap((job) => job.runs.map((run) => ({ job, run })))
    .sort((left, right) => (right.run.startedAt ?? 0) - (left.run.startedAt ?? 0))[0] ?? null;
  const createDisabledReason = props.agent.status !== "online"
    ? t("local_agent.heartbeat_agent_offline")
    : !promptTrimmed
      ? t("local_agent.heartbeat_prompt_required")
      : intervalInvalid
        ? t("local_agent.heartbeat_interval_invalid")
        : !props.conversations.length
          ? t("local_agent.loading_conversations")
          : null;
  const createDisabled = createBusy || Boolean(createDisabledReason);
  return (
    <section className={heartbeatClass.panel}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-dls-text">
            <Clock3 className="size-4" />{t("local_agent.heartbeat_title")}
            <CountBadge size="dot" className="bg-dls-accent/10 text-dls-accent">{props.jobs.length}</CountBadge>
          </div>
          <div className="mt-1 text-xs leading-5 text-dls-secondary">
            {t("local_agent.heartbeat_desc", {
              agent: props.agent.name,
              conversation: selectedDraftConversation ? conversationTitle(selectedDraftConversation) : t("local_agent.default_conversation"),
            })}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={props.onRefresh}>
            <RefreshCw className="mr-1.5 size-3.5" />{t("common.refresh")}
          </Button>
          <Button variant="outline" size="icon-sm" onClick={props.onClose} title={t("common.close")} aria-label={t("common.close")}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mb-3 grid gap-2 md:grid-cols-4">
        <ScheduleMetric label={t("local_agent.heartbeat_title")} value={String(props.jobs.length)} />
        <ScheduleMetric label={t("common.on")} value={String(enabledJobs)} tone={enabledJobs ? "accent" : "neutral"} />
        <ScheduleMetric label={t("local_agent.status_running")} value={String(runningJobs)} tone={runningJobs ? "accent" : "neutral"} />
        <ScheduleMetric label={t("local_agent.heartbeat_last", { time: "" }).trim()} value={latestRun ? shortDateTime(latestRun.run.finishedAt ?? latestRun.run.startedAt) : "--"} />
      </div>

      <ScheduleSection title={t("local_agent.heartbeat_create")} description={createDisabledReason ?? t("local_agent.heartbeat_create_ready")}>
        <div className={heartbeatClass.grid}>
          <label className="min-w-0 space-y-1">
            <span className="block text-xs font-medium text-dls-secondary">{t("local_agent.heartbeat_name_placeholder")}</span>
            <InputGroup>
              <InputGroupInput
                value={props.draft.title}
                onChange={(event) => props.onDraftChange({ ...props.draft, title: event.target.value })}
                placeholder={t("local_agent.heartbeat_name_placeholder")}
              />
            </InputGroup>
          </label>
          <label className="min-w-0 space-y-1">
            <span className="block text-xs font-medium text-dls-secondary">{t("local_agent.heartbeat_session")}</span>
            <SelectMenu
              size="compact"
              ariaLabel={t("local_agent.heartbeat_session")}
              options={props.conversations.length
                ? props.conversations.map((conversation) => ({ value: conversation.id, label: conversationTitle(conversation) }))
                : [{ value: "", label: t("local_agent.loading_conversations") }]}
              value={props.draft.conversationId}
              onChange={(value) => props.onDraftChange({ ...props.draft, conversationId: value })}
              disabled={!props.conversations.length}
            />
          </label>
          <label className="min-w-0 space-y-1">
            <span className="block text-xs font-medium text-dls-secondary">{t("local_agent.heartbeat_interval")}</span>
            <InputGroup>
              <InputGroupInput
                type="number"
                min={5}
                value={props.draft.intervalMinutes}
                onChange={(event) => props.onDraftChange({ ...props.draft, intervalMinutes: event.target.value })}
              />
              <InputGroupAddon>{t("local_agent.heartbeat_minutes")}</InputGroupAddon>
            </InputGroup>
          </label>
          <Button size="sm" onClick={props.onCreate} disabled={createDisabled} title={createDisabledReason ?? undefined}>
            {createBusy ? <LoadingSpinner size="sm" className="mr-1.5" /> : <Plus className="mr-1.5 size-3.5" />}
            {t("local_agent.heartbeat_create")}
          </Button>
        </div>
        <div className="mt-3 grid gap-1 text-xs text-dls-secondary md:grid-cols-4">
          <span>{titleTrimmed ? t("local_agent.heartbeat_title_ready") : t("local_agent.heartbeat_title_optional")}</span>
          <span>{props.conversations.length ? t("local_agent.heartbeat_session_ready") : t("local_agent.loading_conversations")}</span>
          <span className={intervalInvalid ? "text-dls-status-danger" : undefined}>{intervalInvalid ? t("local_agent.heartbeat_interval_invalid") : t("local_agent.heartbeat_interval_ready")}</span>
          <span className={createDisabledReason ? "text-dls-secondary" : "text-dls-status-success-fg"}>{createDisabledReason ?? t("local_agent.heartbeat_create_ready")}</span>
        </div>
        <label className="mt-3 block space-y-1.5">
          <span className="block text-xs font-semibold text-dls-text">{t("local_agent.heartbeat_prompt_label")}</span>
          <span className="block text-xs leading-5 text-dls-secondary">{t("local_agent.heartbeat_prompt_help")}</span>
          <Textarea
            rows={3}
            className="min-h-20 resize-none bg-dls-surface"
            value={props.draft.prompt}
            onChange={(event) => props.onDraftChange({ ...props.draft, prompt: event.target.value })}
            placeholder={t("local_agent.heartbeat_prompt_placeholder")}
          />
        </label>
      </ScheduleSection>

      {props.error ? <NoticeBox tone="error" className="mt-2">{props.error}</NoticeBox> : null}

      <ScheduleSection title={t("session.tasks_count", { count: props.jobs.length })} description={props.jobs.length ? t("local_agent.heartbeat_next", { time: shortDateTime(props.jobs[0]?.nextRunAt) }) : t("local_agent.heartbeat_empty")}>
      <div className="grid gap-2">
        {props.jobs.length ? props.jobs.map((job) => {
          const busy = props.busyId === job.id;
          const lastStatus = job.running ? "running" : job.lastRun?.status ?? null;
          return (
            <div key={job.id} className={heartbeatClass.item}>
              <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{job.title}</span>
                    <StatusBadge tone={job.enabled ? "accent" : "neutral"}>{job.enabled ? t("common.on") : t("common.off")}</StatusBadge>
                    {lastStatus ? <StatusBadge tone={heartbeatStatusTone(lastStatus)}>{heartbeatStatusLabel(lastStatus)}</StatusBadge> : null}
                  </div>
                  <div className={heartbeatClass.meta}>
                    <span>{t("local_agent.heartbeat_every", { minutes: job.schedule.intervalMinutes })}</span>
                    <span>{t("local_agent.heartbeat_next", { time: shortDateTime(job.nextRunAt) })}</span>
                    <span>{t("local_agent.heartbeat_last", { time: shortDateTime(job.lastRun?.finishedAt ?? job.lastRun?.startedAt) })}</span>
                    {job.conversationId ? (
                      <span>{t("local_agent.heartbeat_session_bound", {
                        session: conversationTitle(props.conversations.find((conversation) => conversation.id === job.conversationId) ?? null),
                      })}</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => props.onRunNow(job)} disabled={busy || Boolean(job.running)}>
                    {busy ? <LoadingSpinner size="sm" className="mr-1" /> : <Play className="mr-1 size-3.5" />}
                    {t("local_agent.heartbeat_run_now")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => props.onToggleEnabled(job, !job.enabled)} disabled={busy}>
                    {job.enabled ? t("local_agent.heartbeat_pause") : t("local_agent.heartbeat_resume")}
                  </Button>
                  <ScheduledTaskDeleteButton job={job} busy={busy} onDelete={props.onDelete} />
                </div>
              </div>
              <ScheduledTaskRunHistory job={job} />
            </div>
          );
        }) : (
          <div className="rounded-lg border border-dashed border-dls-border px-3 py-3 text-center text-xs text-dls-secondary">
            {t("local_agent.heartbeat_empty")}
          </div>
        )}
      </div>
      </ScheduleSection>
    </section>
  );
}

function ScheduledTaskDeleteButton(props: {
  job: PersonalLocalAgentHeartbeatJob;
  busy: boolean;
  onDelete: (job: PersonalLocalAgentHeartbeatJob) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const disabled = props.busy || Boolean(props.job.running);
  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dls-border bg-dls-surface-muted px-2 py-1">
        <span className="text-xs text-dls-secondary">{t("local_agent.heartbeat_delete_confirm")}</span>
        <Button variant="destructive" size="sm" onClick={() => props.onDelete(props.job)} disabled={disabled}>
          {t("common.delete")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          {t("common.cancel")}
        </Button>
      </div>
    );
  }
  return (
    <Button variant="outline" size="icon-sm" onClick={() => setConfirming(true)} disabled={disabled} title={t("common.delete")} aria-label={t("common.delete")}>
      <Trash2 className="size-3.5" />
    </Button>
  );
}

export function ScheduledTaskRunHistory(props: { job: PersonalLocalAgentHeartbeatJob }) {
  const [expanded, setExpanded] = useState(Boolean(props.job.running));
  const runs = props.job.runs.slice(0, 5);
  const runningRun = props.job.running ? {
    id: `running-${props.job.id}`,
    runId: props.job.running.runId,
    status: "running" as const,
    startedAt: props.job.running.claimedAt,
    finishedAt: null,
    error: null,
    output: "",
  } : null;
  const visibleRuns = runningRun ? [runningRun, ...runs] : runs;
  return (
    <div className={heartbeatClass.runs} data-testid="local-agent-scheduled-task-runs">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium text-dls-text">
        <span>{t("local_agent.heartbeat_runs_title")}</span>
        <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          {t("local_agent.heartbeat_runs_count", { count: props.job.runs.length })}
        </Button>
      </div>
      {expanded && visibleRuns.length ? (
        <div className="grid gap-1.5">
          {visibleRuns.map((run) => (
            <div key={run.id} className={heartbeatClass.runItem}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={heartbeatStatusTone(run.status)}>{heartbeatStatusLabel(run.status)}</StatusBadge>
                <span className="text-dls-secondary">{t("local_agent.heartbeat_run_started", { time: shortDateTime(run.startedAt) })}</span>
                <span className="text-dls-secondary">{t("local_agent.heartbeat_run_finished", { time: shortDateTime(run.finishedAt) })}</span>
                {run.runId ? <span className="font-mono text-dls-secondary">{t("local_agent.heartbeat_run_id", { id: run.runId })}</span> : null}
              </div>
              <div className={cn("mt-1 whitespace-pre-wrap break-words text-xs leading-5", run.error ? "text-dls-status-danger" : "text-dls-secondary")}>
                {scheduledRunSummary(run)}
              </div>
            </div>
          ))}
        </div>
      ) : expanded ? (
        <EmptyStateBox size="compact">
          {t("local_agent.heartbeat_runs_empty")}
        </EmptyStateBox>
      ) : null}
    </div>
  );
}
