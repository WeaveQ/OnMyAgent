import type { DynamicToolUIPart, UIMessage } from "ai";

import type {
  BrowserUseAgentEvent,
  BrowserUseAgentRunResult,
} from "../../../../app/lib/desktop";
import { t } from "../../../../i18n";

type OperationStartedEvent = Extract<BrowserUseAgentEvent, { type: "operation_started" }>;
type OperationProgressEvent = Extract<BrowserUseAgentEvent, { type: "operation_progress" }>;
type OperationCompletedEvent = Extract<BrowserUseAgentEvent, { type: "operation_completed" }>;
type ApprovalEvent = Extract<BrowserUseAgentEvent, { type: "approval" }>;
type ApprovalResolvedEvent = Extract<BrowserUseAgentEvent, { type: "approval_resolved" }>;
type NarrationEvent = Extract<BrowserUseAgentEvent, { type: "narration" }>;
type ModelUpdateEvent = Extract<BrowserUseAgentEvent, { type: "model_update" }>;

type OperationTimeline = {
  started: OperationStartedEvent;
  progress: OperationProgressEvent[];
  completed: OperationCompletedEvent | null;
  approvals: ApprovalEvent[];
  approvalResolutions: ApprovalResolvedEvent[];
  narration: NarrationEvent | null;
};

function messageMetadata(run: BrowserUseAgentRunResult, timestamp: number, kind: string) {
  return {
    opencode: { created: timestamp },
    browserUse: { runId: run.runId, kind },
  };
}

function textMessage(
  run: BrowserUseAgentRunResult,
  event: BrowserUseAgentEvent,
  text: string,
): UIMessage {
  return {
    id: `browser-use:${event.id}`,
    role: "assistant",
    metadata: messageMetadata(run, event.timestamp, event.type),
    parts: [{ type: "text", text, state: "done" }],
  };
}

function resultText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function modelUpdateText(event: ModelUpdateEvent): string {
  const evaluation = event.evaluation.trim();
  const nextGoal = event.nextGoal.trim();
  if (event.step <= 1) return nextGoal || evaluation;
  if (!evaluation || evaluation === nextGoal) return nextGoal || evaluation;
  return nextGoal ? `${evaluation}\n\n${nextGoal}` : evaluation;
}

function collectOperations(events: BrowserUseAgentEvent[]): Map<string, OperationTimeline> {
  const operations = new Map<string, OperationTimeline>();
  const narrationsByStep = new Map<number, NarrationEvent>();
  for (const event of events) {
    if (event.type === "narration") {
      narrationsByStep.set(event.step, event);
      continue;
    }
    if (event.type === "operation_started") {
      operations.set(event.operationId, {
        started: event,
        progress: [],
        completed: null,
        approvals: [],
        approvalResolutions: [],
        narration: narrationsByStep.get(event.step) ?? null,
      });
      continue;
    }
    if (event.type === "operation_progress") {
      operations.get(event.operationId)?.progress.push(event);
      continue;
    }
    if (event.type === "operation_completed") {
      const operation = operations.get(event.operationId);
      if (operation) operation.completed = event;
      continue;
    }
    if (event.type === "approval") {
      const operationId = event.approval.operationId;
      if (operationId) operations.get(operationId)?.approvals.push(event);
      continue;
    }
    if (event.type === "approval_resolved" && event.operationId) {
      operations.get(event.operationId)?.approvalResolutions.push(event);
    }
  }
  return operations;
}

function operationPart(
  run: BrowserUseAgentRunResult,
  operation: OperationTimeline,
): DynamicToolUIPart {
  const input = {
    runId: operation.started.runId,
    operationId: operation.started.operationId,
    step: operation.started.step,
    actions: operation.started.actions,
    actionCount: operation.started.actionCount,
    url: operation.started.url,
    title: operation.started.title,
    currentGoal: operation.narration?.text.trim() || operation.narration?.nextGoal.trim() || "",
    phase: "",
    keepExpanded: false,
    progress: operation.progress.map((event) => ({
      action: event.action,
      observationSource: event.observationSource,
    })),
    approvals: operation.approvals.map((event) => event.approval),
    approvalResolutions: operation.approvalResolutions.map((event) => ({
      approvalId: event.approvalId,
      decision: event.decision,
    })),
  };
  const callProviderMetadata = {
    opencode: { partId: `browser-use-operation-${operation.started.operationId}` },
  };
  if (
    !operation.completed &&
    (run.status === "cancelled" || run.status === "failed" || run.status === "interrupted")
  ) {
    const errorText = run.status === "cancelled"
      ? t("session.browser_use_agent_cancelled")
      : run.status === "interrupted"
        ? t("session.browser_use_agent_interrupted")
        : run.error || t("session.browser_use_agent_failed");
    return {
      type: "dynamic-tool",
      toolName: "browser_use_operation",
      toolCallId: operation.started.operationId,
      state: "output-error",
      input,
      errorText,
      callProviderMetadata,
    };
  }
  if (!operation.completed) {
    return {
      type: "dynamic-tool",
      toolName: "browser_use_operation",
      toolCallId: operation.started.operationId,
      state: "input-available",
      input,
      callProviderMetadata,
    };
  }
  const output = {
    success: operation.completed.success,
    results: operation.completed.results,
    url: operation.completed.url,
    title: operation.completed.title,
    error: operation.completed.error,
  };
  if (!operation.completed.success) {
    return {
      type: "dynamic-tool",
      toolName: "browser_use_operation",
      toolCallId: operation.started.operationId,
      state: "output-error",
      input,
      errorText: operation.completed.error || t("session.browser_use_operation_failed"),
      callProviderMetadata,
    };
  }
  return {
    type: "dynamic-tool",
    toolName: "browser_use_operation",
    toolCallId: operation.started.operationId,
    state: "output-available",
    input,
    output,
    callProviderMetadata,
  };
}

function operationMessage(
  run: BrowserUseAgentRunResult,
  operation: OperationTimeline,
): UIMessage {
  return {
    id: `browser-use:operation:${run.runId}:${operation.started.operationId}`,
    role: "assistant",
    metadata: messageMetadata(
      run,
      operation.narration?.timestamp ?? operation.started.timestamp,
      "operation",
    ),
    parts: [operationPart(run, operation)],
  };
}

function activityMessage(
  run: BrowserUseAgentRunResult,
  event: BrowserUseAgentEvent,
  phase: string,
): UIMessage {
  const text = phase === "observing"
    ? t("session.browser_use_agent_phase_observing")
    : phase === "acting"
      ? t("session.browser_use_agent_phase_acting")
      : phase === "verifying"
        ? t("session.browser_use_agent_phase_verifying")
        : t("session.browser_use_agent_phase_planning");
  return {
    id: `browser-use:activity:${run.runId}`,
    role: "assistant",
    metadata: messageMetadata(run, event.timestamp, "activity"),
    parts: [{ type: "text", text, state: "streaming" }],
  };
}

export function browserUseRunsToMessages(runs: BrowserUseAgentRunResult[]): UIMessage[] {
  return [...runs]
    .sort((left, right) => left.createdAt - right.createdAt)
    .flatMap((run) => {
      const seenEventIds = new Set<string>();
      const events = [...run.events]
        .sort((left, right) => left.sequence - right.sequence)
        .filter((event) => {
          if (seenEventIds.has(event.id)) return false;
          seenEventIds.add(event.id);
          return true;
        });
      const operations = collectOperations(events);
      const latestPhaseEvent = events
        .filter((event) =>
          (event.type === "phase" || event.type === "ready") && Boolean(event.phase),
        )
        .at(-1);
      const latestPhase = latestPhaseEvent?.type === "phase" || latestPhaseEvent?.type === "ready"
        ? latestPhaseEvent.phase ?? ""
        : "";
      const runActive = run.status === "running" || run.status === "pending_approval";
      const timeline = events.flatMap<UIMessage>((event) => {
        if (event.type === "model_update") {
          const text = modelUpdateText(event);
          return text ? [textMessage(run, event, text)] : [];
        }
        if (event.type === "operation_started") {
          const operation = operations.get(event.operationId);
          return operation ? [operationMessage(run, operation)] : [];
        }
        if (event.type === "done") {
          const text = resultText(event.result) || t("session.browser_use_agent_completed");
          return [textMessage(run, event, text)];
        }
        if (event.type === "error") {
          const text = event.errorCode === "interrupted"
            ? t("session.browser_use_agent_interrupted")
            : event.error.trim() || t("session.browser_use_agent_failed");
          return [textMessage(run, event, text)];
        }
        if (event.type === "cancelled") {
          return [textMessage(run, event, t("session.browser_use_agent_cancelled"))];
        }
        return [];
      });
      if (runActive && latestPhaseEvent && latestPhase) {
        timeline.push(activityMessage(run, latestPhaseEvent, latestPhase));
      }
      return timeline;
    });
}

export function mergeBrowserUseTimeline(
  messages: UIMessage[],
  runs: BrowserUseAgentRunResult[],
): UIMessage[] {
  const baseMessages = messages.filter((message) => !message.id.startsWith("browser-use:"));
  const syntheticByUserMessageId = new Map<string, UIMessage[]>();
  const unanchored: UIMessage[] = [];
  for (const run of [...runs].sort((left, right) => left.createdAt - right.createdAt)) {
    const synthetic = browserUseRunsToMessages([run]);
    if (!run.userMessageId) {
      unanchored.push(...synthetic);
      continue;
    }
    const current = syntheticByUserMessageId.get(run.userMessageId) ?? [];
    current.push(...synthetic);
    syntheticByUserMessageId.set(run.userMessageId, current);
  }

  const merged = baseMessages.flatMap((message) => [
    message,
    ...(syntheticByUserMessageId.get(message.id) ?? []),
  ]);
  const anchoredIds = new Set(baseMessages.map((message) => message.id));
  for (const [userMessageId, synthetic] of syntheticByUserMessageId) {
    if (!anchoredIds.has(userMessageId)) unanchored.push(...synthetic);
  }
  return [...merged, ...unanchored];
}
