import type { UIMessage } from "ai";
import type {
  AgentRuntimeEvent,
  AgentRuntimeMessage,
  AgentRuntimePermissionRequest,
  AgentRuntimeQuestion,
  AgentRuntimeStatus,
  AgentRuntimeTodo,
  AgentRuntimeUsage,
} from "@onmyagent/types/agent-runtime";

export type CanonicalRuntimeCommand = {
  name: string;
  description?: string;
};

export type CanonicalRuntimeState = {
  generation: number | null;
  sequence: number;
  complete: boolean;
  status: AgentRuntimeStatus;
  messages: AgentRuntimeMessage[];
  permissions: AgentRuntimePermissionRequest[];
  questions: AgentRuntimeQuestion[];
  todos: AgentRuntimeTodo[];
  usage: AgentRuntimeUsage | null;
  commandCatalog: CanonicalRuntimeCommand[];
};

export function emptyCanonicalRuntimeState(): CanonicalRuntimeState {
  return {
    generation: null,
    sequence: 0,
    complete: true,
    status: { type: "idle" },
    messages: [],
    permissions: [],
    questions: [],
    todos: [],
    usage: null,
    commandCatalog: [],
  };
}

export function applyCanonicalRuntimeEvent(
  current: CanonicalRuntimeState,
  event: AgentRuntimeEvent,
): CanonicalRuntimeState {
  const generation = event.generation ?? current.generation;
  const sequence = event.sequence ?? current.sequence + 1;
  if (current.generation === generation && sequence <= current.sequence) {
    return current;
  }
  let next = current.generation !== null && generation !== current.generation
    ? { ...emptyCanonicalRuntimeState(), generation, complete: false }
    : { ...current, generation, sequence };
  next.sequence = sequence;

  if (event.kind === "session.status") return { ...next, status: event.status };
  if (event.kind === "session.error") {
    return { ...next, status: { type: "error", error: event.error } };
  }
  if (event.kind === "session.deleted") return emptyCanonicalRuntimeState();
  if (event.kind === "message.started" || event.kind === "message.completed") {
    return { ...next, messages: upsertMessage(next.messages, event.message) };
  }
  if (event.kind === "message.delta" || event.kind === "reasoning.delta") {
    const type = event.kind === "message.delta" ? "text" : "reasoning";
    return {
      ...next,
      messages: appendDelta(next.messages, {
        messageId: event.messageId,
        partId: event.partId,
        delta: event.delta,
        type,
        productSessionId: event.productSessionId,
        createdAt: event.emittedAt,
      }),
    };
  }
  if (event.kind === "reasoning.completed") {
    return {
      ...next,
      messages: upsertPart(next.messages, event.messageId, event.part, {
        productSessionId: event.productSessionId,
        createdAt: event.emittedAt,
      }),
    };
  }
  if (
    event.kind === "tool.started"
    || event.kind === "tool.updated"
    || event.kind === "tool.completed"
  ) {
    const messageId = event.messageId ?? `assistant-${event.part.toolCallId}`;
    return {
      ...next,
      messages: upsertPart(next.messages, messageId, event.part, {
        productSessionId: event.productSessionId,
        createdAt: event.emittedAt,
      }),
    };
  }
  if (event.kind === "todo.updated") return { ...next, todos: event.items };
  if (event.kind === "permission.requested") {
    return { ...next, permissions: upsertById(next.permissions, event.permission, "permissionId") };
  }
  if (event.kind === "permission.resolved") {
    return {
      ...next,
      permissions: next.permissions.filter(
        (permission) => permission.permissionId !== event.decision.permissionId,
      ),
    };
  }
  if (event.kind === "question.requested") {
    return { ...next, questions: upsertById(next.questions, event.question, "questionId") };
  }
  if (event.kind === "question.resolved") {
    return {
      ...next,
      questions: next.questions.filter(
        (question) => question.questionId !== event.answer.questionId,
      ),
    };
  }
  if (event.kind === "usage.updated") return { ...next, usage: event.usage };
  if (event.kind === "command.catalog.updated") {
    return { ...next, commandCatalog: event.items };
  }
  if (event.kind === "turn.completed") {
    return {
      ...next,
      status: { type: "idle" },
      usage: event.usage ?? next.usage,
      messages: next.messages.map((message) =>
        message.role === "assistant" && message.completedAt === undefined
          ? { ...message, completedAt: event.emittedAt }
          : message),
    };
  }
  return next;
}

export function seedCanonicalRuntimeMessages(
  current: CanonicalRuntimeState,
  messages: readonly AgentRuntimeMessage[],
  complete: boolean,
): CanonicalRuntimeState {
  return {
    ...current,
    complete: current.complete && complete,
    messages: messages.reduce(
      (items, message) => upsertMessage(items, message),
      current.messages,
    ),
  };
}

export function canonicalMessagesToUI(messages: readonly AgentRuntimeMessage[]): UIMessage[] {
  return messages.flatMap((message) => {
    if (message.role === "tool") return [];
    return [{
      id: message.id,
      role: message.role,
      metadata: {
        opencode: {
          created: message.createdAt,
          ...(message.completedAt === undefined ? {} : { completed: message.completedAt }),
          ...(message.error ? { errorName: message.error.code } : {}),
        },
      },
      parts: message.parts.flatMap((part): UIMessage["parts"] => {
        const providerMetadata = { opencode: { partId: part.id } };
        if (part.type === "text" || part.type === "reasoning") {
          return [{
            type: part.type,
            text: part.text,
            state: message.completedAt === undefined ? "streaming" : "done",
            providerMetadata,
          }];
        }
        if (part.type === "file") {
          return [{
            type: "file",
            url: part.uri,
            filename: part.name,
            mediaType: part.mimeType ?? "application/octet-stream",
            providerMetadata,
          }];
        }
        if (part.type === "tool") {
          if (part.status === "error") {
            return [{
              type: "dynamic-tool",
              toolName: part.name,
              toolCallId: part.toolCallId,
              state: "output-error",
              input: part.input,
              errorText: part.error?.message ?? "Tool failed",
              callProviderMetadata: providerMetadata,
            }];
          }
          if (part.status === "completed") {
            return [{
              type: "dynamic-tool",
              toolName: part.name,
              toolCallId: part.toolCallId,
              state: "output-available",
              input: part.input,
              output: part.output,
              callProviderMetadata: providerMetadata,
            }];
          }
          return [{
            type: "dynamic-tool",
            toolName: part.name,
            toolCallId: part.toolCallId,
            state: "input-available",
            input: part.input,
            callProviderMetadata: providerMetadata,
          }];
        }
        return [];
      }),
    } satisfies UIMessage];
  });
}

function upsertMessage(
  messages: readonly AgentRuntimeMessage[],
  message: AgentRuntimeMessage,
): AgentRuntimeMessage[] {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) return [...messages, message];
  const next = messages.slice();
  const current = messages[index]!;
  const partById = new Map(current.parts.map((part) => [part.id, part]));
  for (const part of message.parts) partById.set(part.id, part);
  next[index] = {
    ...current,
    ...message,
    parts: [...partById.values()],
  };
  return next;
}

function appendDelta(
  messages: readonly AgentRuntimeMessage[],
  input: {
    messageId: string;
    partId: string;
    delta: string;
    type: "text" | "reasoning";
    productSessionId: string;
    createdAt: number;
  },
): AgentRuntimeMessage[] {
  const existing = messages.find((message) => message.id === input.messageId);
  const message: AgentRuntimeMessage = existing ?? {
    id: input.messageId,
    productSessionId: input.productSessionId,
    role: "assistant",
    parts: [],
    createdAt: input.createdAt,
  };
  const currentPart = message.parts.find((part) => part.id === input.partId);
  const nextPart = currentPart?.type === input.type
    ? { ...currentPart, text: currentPart.text + input.delta }
    : { type: input.type, id: input.partId, text: input.delta };
  return upsertMessage(messages, {
    ...message,
    parts: currentPart
      ? message.parts.map((part) => part.id === input.partId ? nextPart : part)
      : [...message.parts, nextPart],
  });
}

function upsertPart(
  messages: readonly AgentRuntimeMessage[],
  messageId: string,
  part: AgentRuntimeMessage["parts"][number],
  fallback: { productSessionId: string; createdAt: number },
): AgentRuntimeMessage[] {
  const existing = messages.find((message) => message.id === messageId);
  const message: AgentRuntimeMessage = existing ?? {
    id: messageId,
    productSessionId: fallback.productSessionId,
    role: "assistant",
    parts: [],
    createdAt: fallback.createdAt,
  };
  const hasPart = message.parts.some((item) => item.id === part.id);
  return upsertMessage(messages, {
    ...message,
    parts: hasPart
      ? message.parts.map((item) => item.id === part.id ? part : item)
      : [...message.parts, part],
  });
}

function upsertById<Item, Key extends keyof Item>(
  items: readonly Item[],
  item: Item,
  key: Key,
): Item[] {
  const index = items.findIndex((candidate) => candidate[key] === item[key]);
  if (index === -1) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
}
