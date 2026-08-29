import type {
  PersonalLocalAgentConversationMessage,
  PersonalLocalAgentRunEvent,
  PersonalLocalAgentRunResult,
  PersonalLocalAgentRuntimeEvent,
} from "../../../../app/lib/desktop";

export const LOCAL_AGENT_STREAM_SILENCE_MS = 2_000;

export function createRunRefreshGate() {
  const inFlight = new Set<string>();
  const dirty = new Set<string>();
  const terminal = new Set<string>();

  return {
    begin(runId: string, options: { terminal?: boolean } = {}) {
      const id = runId.trim();
      if (!id) return false;
      if (inFlight.has(id)) {
        dirty.add(id);
        if (options.terminal) terminal.add(id);
        return false;
      }
      inFlight.add(id);
      return true;
    },
    settle(runId: string) {
      const id = runId.trim();
      inFlight.delete(id);
      const retry = dirty.delete(id);
      const terminalPending = terminal.delete(id);
      return { retry, terminalPending };
    },
    clear(runId: string) {
      const id = runId.trim();
      inFlight.delete(id);
      dirty.delete(id);
      terminal.delete(id);
    },
  };
}

export function shouldPollSilentRun(input: {
  hidden: boolean;
  now: number;
  lastPresentationAt: number | null;
  silenceMs?: number;
}) {
  if (input.hidden || input.lastPresentationAt === null) return false;
  return input.now - input.lastPresentationAt >= (input.silenceMs ?? LOCAL_AGENT_STREAM_SILENCE_MS);
}

function appendLiveMessages(
  current: readonly PersonalLocalAgentConversationMessage[] | undefined,
  events: readonly PersonalLocalAgentRunEvent[],
) {
  const messages = [...(current ?? [])];
  let liveAssistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "user" || message.type === "finish") break;
    if (message.role === "assistant" && (message.type === "text" || message.type === "content")) {
      liveAssistantIndex = index;
      break;
    }
  }
  for (const event of events) {
    const type = event.type === "chunk" ? "assistant_chunk" : event.type;
    if (type === "user" && event.text) {
      messages.push({
        id: event.eventId ?? `delta-user-${event.at}`,
        type: "text",
        role: "user",
        text: event.text,
        createdAt: event.at,
        sourceEventType: "user",
      });
      liveAssistantIndex = -1;
      continue;
    }
    if (type === "assistant_chunk" && event.text) {
      if (liveAssistantIndex >= 0) {
        const previous = messages[liveAssistantIndex];
        if (previous) {
          messages[liveAssistantIndex] = {
            ...previous,
            text: `${previous.text}${event.text}`,
            createdAt: event.at,
          };
        }
      } else {
        liveAssistantIndex = messages.length;
        messages.push({
          id: event.eventId ?? `delta-assistant-${event.at}`,
          type: "text",
          role: "assistant",
          text: event.text,
          createdAt: event.at,
          sourceEventType: "assistant_chunk",
        });
      }
      continue;
    }
    if ((type === "assistant" || type === "finish") && event.text) {
      messages.push({
        id: event.eventId ?? `delta-finish-${event.at}`,
        type: "finish",
        role: "assistant",
        text: event.text,
        createdAt: event.at,
        sourceEventType: type,
        stopReason: event.stopReason ?? null,
        truncated: Boolean(event.truncated),
      });
      liveAssistantIndex = -1;
    }
  }
  return messages;
}

const SNAPSHOT_EVENT_TYPES = new Set([
  "tool",
  "acp_tool_call",
  "tool_group",
  "plan",
  "thinking",
  "thought",
  "tips",
  "error",
  "approval_request",
  "approval_decision",
  "artifact",
]);

export function deltaNeedsAuthoritativeSnapshot(event: PersonalLocalAgentRuntimeEvent) {
  if (event.snapshotRequired || !event.events?.length) return true;
  return event.events.some((item) =>
    SNAPSHOT_EVENT_TYPES.has(item.type)
    || (item.type === "status" && /^acp_(?:available_commands|context_usage|usage_update)>/.test(item.text ?? "")),
  );
}

export function applyPersonalLocalAgentRuntimeDelta(
  run: PersonalLocalAgentRunResult,
  event: PersonalLocalAgentRuntimeEvent,
): PersonalLocalAgentRunResult | null {
  if (!event.runId || event.runId !== run.runId || event.snapshotRequired) return null;
  const currentRevision = Number.isSafeInteger(Number(run.eventRevision))
    ? Number(run.eventRevision)
    : run.events.length;
  const revision = Number.isSafeInteger(Number(event.revision))
    ? Number(event.revision)
    : currentRevision;
  const events = event.events ?? [];
  const revisionStart = Number.isSafeInteger(Number(event.revisionStart))
    ? Number(event.revisionStart)
    : revision - events.length + 1;
  if (revision <= currentRevision) return run;
  if (!events.length || revisionStart !== currentRevision + 1) return null;

  const status = event.status === "running"
    || event.status === "completed"
    || event.status === "failed"
    || event.status === "cancelled"
    || event.status === "missing"
    ? event.status
    : run.status;
  const finish = [...events].reverse().find((item) => item.type === "finish" || item.type === "assistant");
  const error = [...events].reverse().find((item) => item.type === "error");
  return {
    ...run,
    ok: status === "completed",
    status,
    finishedAt: status === "running" ? run.finishedAt : (run.finishedAt ?? event.updatedAt),
    output: finish?.text?.trim() || run.output,
    error: error?.text?.trim() || (status === "completed" ? null : run.error),
    events: [...run.events, ...events],
    conversationMessages: appendLiveMessages(run.conversationMessages, events),
    eventRevision: revision,
  };
}

export function shouldApplyRunSnapshot(
  current: PersonalLocalAgentRunResult | undefined,
  snapshot: PersonalLocalAgentRunResult,
) {
  if (!current || snapshot.status !== "running") return true;
  if (current.status !== "running") return false;
  const currentRevision = Number(current.eventRevision) || 0;
  const snapshotRevision = Number(snapshot.eventRevision) || 0;
  return snapshotRevision >= currentRevision;
}
