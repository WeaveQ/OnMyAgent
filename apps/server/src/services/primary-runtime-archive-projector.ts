import { hostname } from "node:os";
import type {
  AgentRuntimeEvent,
  AgentRuntimeMessage,
  AgentRuntimePart,
} from "@onmyagent/types/agent-runtime";
import type {
  SessionArchiveMessage,
  SessionArchiveSession,
  SessionArchiveToolCall,
} from "@onmyagent/types/session-archive";
import type { WorkspaceInfo } from "@onmyagent/types/server";
import type { PrimaryRuntimeEventBus } from "./primary-runtime-events.js";
import { resolveSessionArchiveRuntimePaths } from "./session-archive-sync.js";
import { withSessionArchiveStore } from "./session-archive-store-pool.js";

export type PrimaryRuntimeArchiveProjector = {
  stop: () => Promise<void>;
  flush: () => Promise<void>;
};

export function startPrimaryRuntimeArchiveProjector(input: {
  events: PrimaryRuntimeEventBus;
  workspaces: readonly WorkspaceInfo[];
  resolveDbPath?: (workspace: WorkspaceInfo) => string;
  onError?: (error: unknown) => void;
}): PrimaryRuntimeArchiveProjector {
  const workspaces = new Map(input.workspaces.map((workspace) => [workspace.id, workspace]));
  const resolveDbPath = input.resolveDbPath
    ?? ((workspace: WorkspaceInfo) => resolveSessionArchiveRuntimePaths({ workspace }).dbPath);
  const queues = new Map<string, Promise<void>>();
  let stopped = false;

  const enqueue = (event: AgentRuntimeEvent) => {
    if (stopped) return;
    const binding = input.events.bindingForProductSession(
      event.productSessionId,
      event.runtimeKind,
    );
    const previous = queues.get(event.productSessionId) ?? Promise.resolve();
    const next = previous
      .then(() => projectEvent(event, binding))
      .catch((error) => input.onError?.(error))
      .finally(() => {
        if (queues.get(event.productSessionId) === next) {
          queues.delete(event.productSessionId);
        }
      });
    queues.set(event.productSessionId, next);
  };

  const projectEvent = async (
    event: AgentRuntimeEvent,
    binding: ReturnType<PrimaryRuntimeEventBus["bindingForProductSession"]>,
  ): Promise<void> => {
    const workspaceId = event.kind === "session.created" || event.kind === "session.updated"
      ? event.session.workspaceId
      : binding?.workspaceId;
    if (!workspaceId) return;
    const workspace = workspaces.get(workspaceId);
    if (!workspace) return;
    const archiveId = canonicalArchiveSessionId(event.runtimeKind, event.productSessionId);
    await withSessionArchiveStore({ dbPath: resolveDbPath(workspace) }, async (store) => {
      const existing = store.getSessionIncludingDeleted(archiveId);
      const session = mergeArchiveSession({ event, existing, binding, workspace, archiveId });
      store.upsertSession(session);
      if (event.kind === "message.completed") {
        const messages = store.listAllMessages(archiveId);
        const next = upsertArchiveMessage(messages, event.message, event.runtimeKind);
        store.replaceSessionMessages(archiveId, next);
        store.upsertSession({
          ...session,
          first_message: firstUserMessage(next),
          message_count: next.length,
          user_message_count: next.filter((message) => message.role === "user").length,
          ended_at: new Date(event.emittedAt).toISOString(),
        });
      }
      if (
        event.kind === "usage.updated"
        || (event.kind === "turn.completed" && event.usage)
      ) {
        const usage = event.kind === "usage.updated" ? event.usage : event.usage!;
        const existingUsage = store.listUsageEvents(archiveId);
        const dedupKey = event.kind === "turn.completed"
          ? `turn:${event.turnId}`
          : `event:${event.eventId}`;
        const withoutSame = existingUsage.filter((item) => item.dedup_key !== dedupKey);
        const model = usage.modelRef
          ? [usage.modelRef.providerId, usage.modelRef.modelId].filter(Boolean).join("/")
          : "";
        const nextUsage = [...withoutSame, {
          session_id: archiveId,
          source: "primary-runtime-canonical",
          model,
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          cache_creation_input_tokens: usage.cacheWriteTokens ?? 0,
          cache_read_input_tokens: usage.cacheReadTokens ?? 0,
          reasoning_tokens: usage.reasoningTokens ?? 0,
          cost_usd: usage.costUsd ?? null,
          cost_status: usage.costUsd === undefined ? "unknown" : "exact",
          cost_source: event.runtimeKind,
          occurred_at: timestamp(event.emittedAt),
          dedup_key: dedupKey,
        }];
        store.replaceSessionUsageEvents(archiveId, nextUsage);
        store.upsertSession({
          ...session,
          total_output_tokens: nextUsage.reduce(
            (total, item) => total + item.output_tokens + (item.reasoning_tokens ?? 0),
            0,
          ),
          peak_context_tokens: Math.max(
            0,
            ...nextUsage.map((item) =>
              item.input_tokens + (item.cache_read_input_tokens ?? 0)),
          ),
          has_total_output_tokens: true,
          has_peak_context_tokens: true,
        });
      }
    });
  };

  const unsubscribe = input.events.subscribeAll(enqueue);
  const flush = async () => {
    while (queues.size > 0) await Promise.all([...queues.values()]);
  };
  return {
    flush,
    async stop() {
      stopped = true;
      unsubscribe();
      await flush();
    },
  };
}

export function canonicalArchiveSessionId(
  runtimeKind: AgentRuntimeEvent["runtimeKind"],
  productSessionId: string,
): string {
  return `primary:${runtimeKind}:${productSessionId}`;
}

function mergeArchiveSession(input: {
  event: AgentRuntimeEvent;
  existing: SessionArchiveSession | null;
  binding: ReturnType<PrimaryRuntimeEventBus["bindingForProductSession"]>;
  workspace: WorkspaceInfo;
  archiveId: string;
}): SessionArchiveSession {
  const nativeSession = input.event.kind === "session.created"
    || input.event.kind === "session.updated"
    ? input.event.session
    : null;
  const createdAt = nativeSession?.createdAt
    ?? input.existing?.started_at
    ?? input.event.emittedAt;
  const runtimeSessionId = nativeSession?.runtimeSessionId
    ?? input.binding?.runtimeSessionId
    ?? input.existing?.runtime_session_id;
  const profileId = nativeSession?.profileId
    ?? input.binding?.profileId
    ?? input.existing?.runtime_profile_id;
  const cwd = nativeSession?.cwd ?? input.binding?.cwd ?? input.existing?.cwd
    ?? input.workspace.path;
  return {
    id: input.archiveId,
    project: input.workspace.path,
    machine: input.existing?.machine || hostname(),
    agent: "onmyagent",
    first_message: input.existing?.first_message ?? null,
    display_name: nativeSession?.title ?? input.existing?.display_name ?? null,
    started_at: timestamp(createdAt),
    ended_at: input.existing?.ended_at ?? null,
    message_count: input.existing?.message_count ?? 0,
    user_message_count: input.existing?.user_message_count ?? 0,
    deleted_at: input.event.kind === "session.deleted"
      ? timestamp(input.event.emittedAt)
      : input.existing?.deleted_at ?? null,
    cwd,
    source_session_id: input.event.productSessionId,
    source_version: "primary-runtime-canonical-v1",
    runtime_kind: input.event.runtimeKind,
    ...(runtimeSessionId ? { runtime_session_id: runtimeSessionId } : {}),
    ...(profileId ? { runtime_profile_id: profileId } : {}),
    total_output_tokens: input.existing?.total_output_tokens ?? 0,
    peak_context_tokens: input.existing?.peak_context_tokens ?? 0,
    is_automated: input.existing?.is_automated ?? false,
    created_at: input.existing?.created_at ?? timestamp(input.event.emittedAt),
  };
}

function upsertArchiveMessage(
  messages: SessionArchiveMessage[],
  message: AgentRuntimeMessage,
  runtimeKind: AgentRuntimeEvent["runtimeKind"],
): SessionArchiveMessage[] {
  const existingIndex = messages.findIndex((item) => item.source_uuid === message.id);
  const converted = archiveMessage(message, runtimeKind, existingIndex >= 0
    ? messages[existingIndex]!.ordinal
    : messages.length);
  const next = [...messages];
  if (existingIndex >= 0) next[existingIndex] = converted;
  else next.push(converted);
  return next.map((item, ordinal) => ({ ...item, ordinal }));
}

function archiveMessage(
  message: AgentRuntimeMessage,
  runtimeKind: AgentRuntimeEvent["runtimeKind"],
  ordinal: number,
): SessionArchiveMessage {
  const text = message.parts.filter(isPart("text")).map((part) => part.text).join("");
  const thinking = message.parts.filter(isPart("reasoning")).map((part) => part.text).join("");
  const toolCalls = message.parts.filter(isPart("tool")).map(archiveToolCall);
  return {
    id: ordinal,
    session_id: canonicalArchiveSessionId(runtimeKind, message.productSessionId),
    ordinal,
    role: message.role,
    content: text,
    timestamp: timestamp(message.createdAt),
    has_thinking: Boolean(thinking),
    thinking_text: thinking,
    has_tool_use: toolCalls.length > 0,
    content_length: text.length,
    model: "",
    context_tokens: 0,
    output_tokens: 0,
    tool_calls: toolCalls,
    is_system: message.role === "system",
    source_type: "primary-runtime-canonical",
    source_subtype: runtimeKind,
    source_uuid: message.id,
    ...(message.parentMessageId ? { source_parent_uuid: message.parentMessageId } : {}),
  };
}

function archiveToolCall(part: Extract<AgentRuntimePart, { type: "tool" }>): SessionArchiveToolCall {
  return {
    tool_name: part.name,
    tool_use_id: part.toolCallId,
    ...(part.input === undefined ? {} : { input_json: JSON.stringify(part.input) }),
    ...(part.output === undefined ? {} : {
      result_content: JSON.stringify(part.output),
      result_content_length: JSON.stringify(part.output).length,
    }),
  };
}

function isPart<Type extends AgentRuntimePart["type"]>(type: Type) {
  return (part: AgentRuntimePart): part is Extract<AgentRuntimePart, { type: Type }> =>
    part.type === type;
}

function firstUserMessage(messages: SessionArchiveMessage[]): string | null {
  return messages.find((message) => message.role === "user" && message.content.trim())
    ?.content ?? null;
}

function timestamp(value: number | string): string {
  return typeof value === "number" ? new Date(value).toISOString() : value;
}
