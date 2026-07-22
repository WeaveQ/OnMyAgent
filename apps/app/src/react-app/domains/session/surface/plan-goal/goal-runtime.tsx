/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { CirclePause, CirclePlay, Clock3, Goal, Trash2 } from "lucide-react";

import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  TodoItem,
} from "../../../../../app/types";
import { currentLocale, t } from "../../../../../i18n";
import { Button } from "@/components/ui/button";
import { summarizeGoalObjective } from "../session-run-controller";
import { shouldTickGoalRuntimeClock } from "../../sync/session-poll-policy";

export type SessionTranscriptNotice = {
  id: string;
  kind:
    | "cancelled"
    | "stopped"
    | "compacting"
    | "compacted"
    | "stalled"
    | "permission-rejected"
    | "permission-auto-approved";
  afterMessageCount: number;
  runKey?: string;
  runStartedAt?: number;
  elapsedMs?: number;
};

export function shouldRecordSessionInterruption(input: {
  existing: SessionTranscriptNotice[];
  candidate: SessionTranscriptNotice;
}) {
  const candidateTerminal =
    input.candidate.kind === "cancelled" || input.candidate.kind === "stopped";
  return !input.existing.some((notice) => {
    const noticeTerminal = notice.kind === "cancelled" || notice.kind === "stopped";
    if (
      candidateTerminal &&
      noticeTerminal &&
      input.candidate.runKey &&
      notice.runKey
    ) {
      return notice.runKey === input.candidate.runKey;
    }
    return (
      notice.runStartedAt !== undefined &&
      input.candidate.runStartedAt !== undefined &&
      notice.runStartedAt === input.candidate.runStartedAt &&
      (notice.kind === input.candidate.kind ||
        (input.candidate.kind === "cancelled" && notice.kind === "stopped"))
    );
  });
}

export function createSessionInterruptionNotice(input: {
  sessionId: string;
  kind: "cancelled" | "stopped";
  runKey: string;
  afterMessageCount: number;
  runStartedAt: number;
  now: number;
  elapsedMs?: number;
}): SessionTranscriptNotice {
  return {
    id: `${input.sessionId}:${input.kind}:${input.runKey}`,
    kind: input.kind,
    runKey: input.runKey,
    afterMessageCount: input.afterMessageCount,
    runStartedAt: input.runStartedAt,
    ...(input.kind === "stopped"
      ? {
          elapsedMs: Math.max(
            0,
            input.elapsedMs ?? input.now - input.runStartedAt,
          ),
        }
      : {}),
  };
}

export function preferLatestGoalRuntime(
  current: CollaborationGoalRuntime | null,
  incoming: CollaborationGoalRuntime | null | undefined,
) {
  if (!incoming) return null;
  if (!current || incoming.updatedAt > current.updatedAt) return incoming;
  if (incoming.updatedAt === current.updatedAt && incoming.status === current.status) {
    return incoming;
  }
  return current;
}

export const GOAL_RUNTIME_TICK_MS = 1000;

export function buildLocaleRuntimeInstruction() {
  return t("session.runtime_language_requirement", currentLocale());
}

export function buildGoalHiddenSystemPrompt(runtime: CollaborationGoalRuntime) {
  const details: string[] = [];
  if (runtime.summary?.trim()) {
    details.push(`${t("session.goal_hidden_summary_label")} ${runtime.summary.trim()}`);
  }
  if (runtime.currentCheckpoint?.trim()) {
    details.push(`${t("session.goal_hidden_checkpoint_label")} ${runtime.currentCheckpoint.trim()}`);
  }
  if (runtime.completionCriteria?.length) {
    details.push(
      `${t("session.goal_hidden_completion_criteria_label")}\n${runtime.completionCriteria
        .map((item) => `- ${item}`)
        .join("\n")}`,
    );
  }
  if (runtime.validationCommands?.length) {
    details.push(
      `${t("session.goal_hidden_validation_label")}\n${runtime.validationCommands
        .map((item) => `- ${item}`)
        .join("\n")}`,
    );
  }
  if (runtime.lastKnownTodos?.length) {
    details.push(
      `${t("session.goal_hidden_todos_label")}\n${runtime.lastKnownTodos
        .map((item) => `- [${item.status}] ${item.content}`)
        .join("\n")}`,
    );
  }
  if (runtime.progressLog?.length) {
    details.push(
      `${t("session.goal_hidden_progress_label")}\n${runtime.progressLog
        .map((item) => `- ${item}`)
        .join("\n")}`,
    );
  }
  return [
    buildLocaleRuntimeInstruction(),
    "",
    t("session.goal_hidden_objective_label"),
    runtime.objective,
    details.length ? `\n${details.join("\n\n")}` : "",
    "",
    t("session.goal_hidden_success_criterion"),
    t("session.goal_hidden_next_step"),
    t("session.goal_runtime_system_turn_boundary"),
    t("session.goal_hidden_track_progress"),
    t("session.goal_hidden_stall_recovery"),
    t("session.goal_hidden_blocker"),
  ].join("\n");
}

export function buildPlanExecutionHiddenSystemPrompt(runtime: CollaborationPlanRuntime) {
  return [
    buildLocaleRuntimeInstruction(),
    "",
    t("session.plan_hidden_execute_now"),
    t("session.plan_hidden_approval_granted"),
    t("session.plan_hidden_use_tools"),
    "",
    t("session.plan_hidden_original_request_label"),
    runtime.originalPrompt,
    "",
    t("session.plan_hidden_approved_plan_label"),
    runtime.planText?.trim() || t("session.plan_runtime_empty"),
  ].join("\n");
}

export function goalElapsedMs(runtime: CollaborationGoalRuntime, now: number) {
  if (runtime.status === "paused") {
    const pauseStartedAt = runtime.pauseStartedAt ?? runtime.updatedAt;
    return Math.max(
      0,
      pauseStartedAt - runtime.startedAt - runtime.totalPausedMs,
    );
  }
  if (runtime.status === "waiting") {
    if (runtime.waitingReason === "compacting") {
      return Math.max(
        0,
        now - runtime.startedAt - runtime.totalPausedMs,
      );
    }
    if (runtime.waitingReason === "user") {
      const pauseStartedAt = runtime.pauseStartedAt ?? runtime.updatedAt;
      return Math.max(
        0,
        pauseStartedAt - runtime.startedAt - runtime.totalPausedMs,
      );
    }
    return Math.max(
      0,
      runtime.updatedAt - runtime.startedAt - runtime.totalPausedMs,
    );
  }
  const endAt = runtime.completedAt ?? now;
  return Math.max(0, endAt - runtime.startedAt - runtime.totalPausedMs);
}

export function formatGoalElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const minuteText = String(minutes).padStart(2, "0");
  const secondText = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${hours}:${minuteText}:${secondText}`
    : `${minutes}:${secondText}`;
}

export function formatInterruptionElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function transcriptNoticeLabel(notice: SessionTranscriptNotice) {
  if (notice.kind === "stopped" && notice.elapsedMs !== undefined) {
    return t("session.user_stopped_after", {
      duration: formatInterruptionElapsed(notice.elapsedMs),
    });
  }
  if (notice.kind === "compacting") return t("session.assistant_compacting");
  if (notice.kind === "compacted") return t("session.assistant_compacted");
  if (notice.kind === "stalled") {
    return t("session.assistant_stalled_inline");
  }
  if (notice.kind === "permission-rejected") {
    return t("session.permission_rejected_notice");
  }
  if (notice.kind === "permission-auto-approved") {
    return t("session.permission_auto_approved_notice");
  }
  return t("session.user_cancelled");
}

export function removeRecordKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export function normalizedTodoItems(todos: TodoItem[] | undefined) {
  return (todos ?? []).filter((todo) => todo.content.trim());
}

export function goalCheckpointFromTodos(todos: TodoItem[]) {
  const active = todos.find((todo) => todo.status === "in_progress");
  if (active) return active.content.trim();
  const pending = todos.find((todo) => todo.status === "pending");
  if (pending) return pending.content.trim();
  const completed = [...todos]
    .reverse()
    .find((todo) => todo.status === "completed");
  return completed?.content.trim() ?? "";
}

export function appendGoalProgressLog(
  runtime: CollaborationGoalRuntime,
  runText: string,
) {
  const trimmed = runText.replace(/\s+/g, " ").trim();
  if (!trimmed) return runtime.progressLog;
  const entry = trimmed.length > 400 ? `${trimmed.slice(0, 400).trimEnd()}...` : trimmed;
  const existing = runtime.progressLog ?? [];
  if (existing[existing.length - 1] === entry) return existing;
  return [...existing, entry].slice(-8);
}

export function isGoalIntentRuntime(
  runtime: CollaborationGoalRuntime | null | undefined,
): runtime is CollaborationGoalRuntime {
  return runtime?.source === "goal_intent";
}

export function GoalPreviewPanel(props: { onClear: () => void }) {
  return (
    <div className="border-b border-dls-border bg-transparent px-4 py-2">
      <div className="flex items-center gap-2">
        <Goal size={14} strokeWidth={1.8} className="shrink-0 text-dls-secondary" />
        <span className="text-sm font-medium text-dls-text">
          {t("session.goal_runtime_title")}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-dls-secondary">
          {t("session.goal_runtime_hint")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="shrink-0 text-dls-secondary hover:text-dls-text"
          onClick={props.onClear}
        >
          {t("session.goal_runtime_clear")}
        </Button>
      </div>
    </div>
  );
}

export function GoalRuntimePanel(props: {
  runtime: CollaborationGoalRuntime;
  busy: boolean;
  canPause: boolean;
  canResume: boolean;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const elapsed = formatGoalElapsed(goalElapsedMs(props.runtime, now));
  const objective = summarizeGoalObjective({
    objective: props.runtime.objective,
    summary: props.runtime.summary,
  });

  useEffect(() => {
    if (
      !shouldTickGoalRuntimeClock({
        status: props.runtime.status,
        waitingReason: props.runtime.waitingReason,
      })
    ) {
      setNow(Date.now());
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), GOAL_RUNTIME_TICK_MS);
    return () => window.clearInterval(id);
  }, [props.runtime.status, props.runtime.waitingReason]);

  return (
    <div className="overflow-hidden border-b border-dls-border bg-transparent">
      <div className="flex items-center gap-3 px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <Goal
            size={14}
            strokeWidth={1.8}
            className="shrink-0 text-dls-secondary"
          />
          <span className="shrink-0 font-medium text-dls-text">
            {t("session.goal_runtime_active")}
          </span>
          <span
            className="min-w-0 truncate text-dls-secondary"
            title={objective}
          >
            {objective || t("session.goal_runtime_untitled")}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-dls-secondary">
            <Clock3 size={12} />
            {t("session.goal_runtime_elapsed", { duration: elapsed })}
          </span>
          {props.canResume ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="text-dls-secondary hover:text-dls-text"
              onClick={props.onResume}
              disabled={props.busy}
              aria-label={t("session.goal_runtime_resume")}
              title={t("session.goal_runtime_resume")}
            >
              <CirclePlay size={14} />
            </Button>
          ) : null}
          {props.canPause ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="text-dls-secondary hover:text-dls-text"
              onClick={props.onPause}
              aria-label={t("session.goal_runtime_pause")}
              title={t("session.goal_runtime_pause")}
            >
              <CirclePause size={14} />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="text-dls-text"
            onClick={props.onClear}
            aria-label={t("session.goal_runtime_clear")}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
