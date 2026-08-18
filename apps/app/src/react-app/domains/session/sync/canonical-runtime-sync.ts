import type { UIMessage } from "ai";
import {
  agentRuntimeEventSchema,
  type AgentRuntimeEvent,
  type AgentRuntimeEventSnapshot,
  type AgentRuntimeQuestion,
  type AgentRuntimeStatus,
} from "@onmyagent/types/agent-runtime";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import { OnMyAgentServerError } from "../../../../app/lib/onmyagent-server";
import type { PendingPermission, PendingQuestion, TodoItem } from "../../../../app/types";
import { getReactQueryClient } from "../../../infra/query-client";
import { useSessionActivityStore } from "../status/session-activity-store";
import {
  commandCatalogKey,
  permissionKey,
  questionKey,
  statusKey,
  todoKey,
  transcriptKey,
} from "./session-sync";
import {
  applyCanonicalRuntimeEvent,
  canonicalMessagesToUI,
  emptyCanonicalRuntimeState,
  seedCanonicalRuntimeMessages,
  type CanonicalRuntimeState,
} from "./canonical-runtime-state";

export type CanonicalRuntimeSyncMode = "canonical" | "legacy-opencode";

type SyncInput = {
  client: OnMyAgentServerClient;
  workspaceId: string;
  sessionId: string;
  signal: AbortSignal;
  onMode: (mode: CanonicalRuntimeSyncMode) => void;
  onSessionStatus?: (update: { sessionId: string; status: SessionStatus }) => void;
};

export class IncompleteCanonicalReplayError extends Error {
  constructor() {
    super("Canonical runtime replay is incomplete; reload the session to recover");
    this.name = "IncompleteCanonicalReplayError";
  }
}

export class CanonicalRuntimeSequenceGapError extends Error {
  constructor() {
    super("Canonical runtime event sequence has a gap");
    this.name = "CanonicalRuntimeSequenceGapError";
  }
}

export function applyLiveCanonicalRuntimeEvent(
  current: CanonicalRuntimeState,
  generation: number,
  event: AgentRuntimeEvent,
): CanonicalRuntimeState {
  if (event.generation !== generation) return current;
  if (
    current.generation === generation
    && event.sequence !== undefined
    && event.sequence > current.sequence + 1
  ) throw new CanonicalRuntimeSequenceGapError();
  return applyCanonicalRuntimeEvent(current, event);
}

export async function synchronizeCanonicalRuntimeSession(
  input: SyncInput,
): Promise<void> {
  const session = await resolveRuntimeSession(input);
  if (!session) return;
  input.onMode("canonical");

  let state = emptyCanonicalRuntimeState();
  const history = await input.client.getRuntimeSessionMessages(
    input.workspaceId,
    input.sessionId,
  );
  state = seedCanonicalRuntimeMessages(state, history.messages, history.complete);
  publishState(input, state);
  if (!history.complete) {
    publishSyncError(input, new IncompleteCanonicalReplayError());
    return;
  }
  let reconnectAttempt = 0;
  while (!input.signal.aborted) {
    try {
      const response = await input.client.openRuntimeSessionEvents(
        input.workspaceId,
        input.sessionId,
        { signal: input.signal },
      );
      const stream = readSse(response, input.signal);
      const first = await stream.next();
      if (first.done || first.value.event !== "generation") {
        throw new Error("Canonical runtime stream did not provide a generation");
      }
      const generation = generationFrom(first.value.data);
      const snapshot = await input.client.getRuntimeSessionEventSnapshot(
        input.workspaceId,
        input.sessionId,
        { afterSequence: state.generation === generation ? state.sequence : 0, limit: 512 },
      );
      state = applySnapshot(state, snapshot);
      publishState(input, state);
      if (!snapshot.complete) throw new IncompleteCanonicalReplayError();
      reconnectAttempt = 0;
      for await (const frame of stream) {
        if (frame.event !== "runtime-event") continue;
        const parsed = agentRuntimeEventSchema.safeParse(parseJson(frame.data));
        if (!parsed.success) continue;
        state = applyLiveCanonicalRuntimeEvent(state, generation, parsed.data);
        publishState(input, state);
      }
      if (!input.signal.aborted) throw new Error("Canonical runtime stream closed");
    } catch (error) {
      if (input.signal.aborted) return;
      reconnectAttempt += 1;
      if (!shouldReconnect(error) || reconnectAttempt > 8) {
        publishSyncError(input, error);
        return;
      }
      await waitForReconnect(Math.min(5_000, 250 * 2 ** (reconnectAttempt - 1)), input.signal);
    }
  }
}

export function applySnapshot(
  current: CanonicalRuntimeState,
  snapshot: AgentRuntimeEventSnapshot,
): CanonicalRuntimeState {
  let next = current.generation === snapshot.generation
    ? current
    : { ...emptyCanonicalRuntimeState(), generation: snapshot.generation };
  for (const event of snapshot.events) {
    if (event.generation !== snapshot.generation) continue;
    next = applyCanonicalRuntimeEvent(next, event);
  }
  return {
    ...next,
    generation: snapshot.generation,
    // Never acknowledge retained events that were not actually replayed.
    // Advancing to latestSequence here would permanently hide the gap on the
    // next reconnect.
    sequence: next.sequence,
    complete: snapshot.complete,
  };
}

export async function* readSse(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<{ event: string; data: string }> {
  if (!response.body) throw new Error("Canonical runtime stream has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal?.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseSseBlock(block);
        if (frame) yield frame;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function publishState(input: SyncInput, state: CanonicalRuntimeState): void {
  const queryClient = getReactQueryClient();
  const messages = canonicalMessagesToUI(state.messages);
  queryClient.setQueryData<UIMessage[]>(
    transcriptKey(input.workspaceId, input.sessionId),
    messages,
  );
  const status = toLegacyStatus(state.status);
  queryClient.setQueryData(
    statusKey(input.workspaceId, input.sessionId),
    status,
  );
  queryClient.setQueryData<TodoItem[]>(
    todoKey(input.workspaceId, input.sessionId),
    state.todos.map((todo) => ({
      id: todo.id,
      content: todo.text,
      status: todo.status,
      priority: todo.priority ?? "medium",
    })),
  );
  queryClient.setQueryData<PendingPermission[]>(
    permissionKey(input.workspaceId, input.sessionId),
    state.permissions.map((permission) => ({
      id: permission.permissionId,
      sessionID: input.sessionId,
      permission: "grok_runtime_permission",
      patterns: [],
      metadata: {
        title: permission.title,
        description: permission.description,
        options: permission.options,
      },
      always: [],
      ...(permission.toolCallId
        ? { tool: { messageID: permission.toolCallId, callID: permission.toolCallId } }
        : {}),
      receivedAt: permission.requestedAt,
    })),
  );
  queryClient.setQueryData<PendingQuestion[]>(
    questionKey(input.workspaceId, input.sessionId),
    canonicalQuestionsToPending(input.sessionId, state.questions),
  );
  queryClient.setQueryData<Array<{ name: string; description?: string }>>(
    commandCatalogKey(input.workspaceId, input.sessionId),
    state.commandCatalog,
  );
  const activity = useSessionActivityStore.getState();
  if (state.status.type === "error") {
    activity.setError(input.workspaceId, input.sessionId, state.status.error.message);
  } else {
    activity.setRunStatus(input.workspaceId, input.sessionId, status);
    if (messages.some((message) => message.role === "assistant" && message.parts.length > 0)) {
      activity.markAssistantOutput(input.workspaceId, input.sessionId, undefined, {
        allowUnknownMessageRole: true,
      });
    }
  }
  activity.replaceWaitingRequests(
    input.workspaceId,
    input.sessionId,
    "permission",
    state.permissions.map((permission) => permission.permissionId),
  );
  activity.replaceWaitingRequests(
    input.workspaceId,
    input.sessionId,
    "question",
    state.questions.map((question) => question.questionId),
  );
  input.onSessionStatus?.({ sessionId: input.sessionId, status });
}

export function canonicalQuestionsToPending(
  sessionId: string,
  questions: readonly AgentRuntimeQuestion[],
): PendingQuestion[] {
  return questions.map((question) => ({
      id: question.questionId,
      sessionID: sessionId,
      questions: (question.items ?? [{
        key: question.questionId,
        prompt: question.prompt,
        options: question.options,
        allowFreeText: question.allowFreeText,
        multiple: false,
      }]).map((item) => ({
        question: item.prompt,
        header: item.prompt.slice(0, 30),
        options: item.options.map((option) => ({
          label: option.label,
          description: option.description ?? "",
        })),
        multiple: item.multiple,
        custom: item.allowFreeText,
      })),
      tool: {
        messageID: "onmyagent:grok-runtime-question",
        callID: question.questionId,
      },
      receivedAt: question.requestedAt,
    }));
}

async function resolveRuntimeSession(input: SyncInput) {
  try {
    return (await input.client.getRuntimeSession(input.workspaceId, input.sessionId)).session;
  } catch (error) {
    if (error instanceof OnMyAgentServerError && error.status === 404) {
      input.onMode("legacy-opencode");
      return null;
    }
    throw error;
  }
}

function publishSyncError(input: SyncInput, error: unknown): void {
  const message = error instanceof Error ? error.message : "Canonical runtime stream failed";
  useSessionActivityStore.getState().setError(input.workspaceId, input.sessionId, message);
}

function toLegacyStatus(status: AgentRuntimeStatus): SessionStatus {
  if (status.type === "busy" || status.type === "blocked") return { type: "busy" };
  if (status.type === "retry") {
    return {
      type: "retry",
      attempt: status.attempt,
      message: status.message,
      next: status.nextAt,
    };
  }
  return { type: "idle" };
}

function parseSseBlock(block: string) {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function generationFrom(value: string): number {
  const parsed = parseJson(value);
  const generation = parsed && typeof parsed === "object"
    ? Reflect.get(parsed, "generation")
    : null;
  if (typeof generation !== "number" || !Number.isSafeInteger(generation)) {
    throw new Error("Canonical runtime stream has an invalid generation");
  }
  return generation;
}

function shouldReconnect(error: unknown): boolean {
  return !(error instanceof IncompleteCanonicalReplayError)
    && !(error instanceof OnMyAgentServerError && [401, 403, 404].includes(error.status));
}

function waitForReconnect(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}
