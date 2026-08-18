import type { PrimaryRuntimeEventBus } from "./primary-runtime-events.js";

type JsonObject = Record<string, unknown>;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type ToolStatus = "pending" | "running" | "completed" | "error" | "cancelled";

export class OpenCodeEventNormalizer {
  readonly #events: PrimaryRuntimeEventBus;
  readonly #partText = new Map<string, string>();
  readonly #messageRoles = new Map<string, "system" | "user" | "assistant" | "tool">();

  constructor(events: PrimaryRuntimeEventBus) {
    this.#events = events;
  }

  handle(value: unknown): void {
    const envelope = object(value);
    const event = object(envelope.payload ?? envelope);
    const type = text(event.type, 100);
    const properties = object(event.properties);
    const sessionId = sessionIdFor(type, properties);
    if (!type || !sessionId) return;

    if (type === "session.status") {
      const status = object(properties.status);
      const nativeType = text(status.type, 50);
      this.#events.emitForNative("opencode", sessionId, {
        kind: "session.status",
        status: nativeType === "busy"
          ? { type: "busy", startedAt: Date.now() }
          : nativeType === "retry"
            ? {
                type: "retry",
                attempt: Math.max(1, integer(status.attempt) ?? 1),
                message: text(status.message, 500) || "OpenCode retry",
                ...(integer(status.next) !== null
                  ? { nextAt: integer(status.next)! }
                  : { nextAt: Date.now() }),
              }
            : { type: "idle" },
      });
      if (nativeType !== "busy" && nativeType !== "retry") {
        this.#completeTurn(sessionId, "completed");
      }
      return;
    }
    if (type === "session.idle") {
      this.#events.emitForNative("opencode", sessionId, {
        kind: "session.status",
        status: { type: "idle" },
      });
      this.#completeTurn(sessionId, "completed");
      return;
    }
    if (type === "session.error") {
      this.#events.emitForNative("opencode", sessionId, {
        kind: "session.error",
        error: {
          code: "agent_runtime_native_error",
          message: safeErrorMessage(properties.error),
          retriable: true,
        },
      });
      this.#completeTurn(sessionId, "error");
      return;
    }
    if (type === "message.updated") {
      this.#messageUpdated(sessionId, object(properties.info));
      return;
    }
    if (type === "message.part.delta") {
      const messageId = text(properties.messageID ?? properties.messageId, 200);
      const partId = text(properties.partID ?? properties.partId, 200);
      const delta = text(properties.delta, 128 * 1024, false);
      if (!messageId || !partId || !delta) return;
      if (this.#messageRoles.get(messageKey(sessionId, messageId)) === "user") return;
      this.#partText.set(partKey(sessionId, partId),
        `${this.#partText.get(partKey(sessionId, partId)) ?? ""}${delta}`);
      this.#emitDelta(sessionId, messageId, partId, delta, false);
      return;
    }
    if (type === "message.part.updated") {
      this.#partUpdated(sessionId, object(properties.part));
      return;
    }
    if (type === "todo.updated") {
      const todos = Array.isArray(properties.todos) ? properties.todos : [];
      this.#events.emitForNative("opencode", sessionId, {
        kind: "todo.updated",
        items: todos.slice(0, 200).flatMap((entry, index) => {
          const todo = object(entry);
          const content = text(todo.content ?? todo.text, 4_000);
          if (!content) return [];
          const nativeStatus = text(todo.status, 50);
          return [{
            id: text(todo.id, 200) || `todo-${index}`,
            text: content,
            status: /complete|done/.test(nativeStatus)
              ? "completed" as const
              : /progress|running/.test(nativeStatus)
                ? "in_progress" as const
                : /cancel/.test(nativeStatus)
                  ? "cancelled" as const
                  : "pending" as const,
            ...(/^(low|medium|high)$/.test(text(todo.priority, 20))
              ? { priority: text(todo.priority, 20) as "low" | "medium" | "high" }
              : {}),
          }];
        }),
      });
    }
  }

  #messageUpdated(sessionId: string, info: JsonObject): void {
    const messageId = text(info.id, 200);
    const role = messageRole(info.role);
    if (!messageId || !role) return;
    this.#rememberMessageRole(sessionId, messageId, role);
    const time = object(info.time);
    this.#events.emitForNative("opencode", sessionId, {
      kind: integer(time.completed) === null ? "message.started" : "message.completed",
      message: {
        id: messageId,
        productSessionId: this.#events.productSessionIdForNative("opencode", sessionId) ?? sessionId,
        role,
        parts: [],
        ...(text(info.parentID ?? info.parentId, 200)
          ? { parentMessageId: text(info.parentID ?? info.parentId, 200) }
          : {}),
        createdAt: integer(time.created) ?? Date.now(),
        ...(integer(time.completed) !== null ? { completedAt: integer(time.completed)! } : {}),
      },
    });
  }

  #partUpdated(sessionId: string, part: JsonObject): void {
    const messageId = text(part.messageID ?? part.messageId, 200);
    const partId = text(part.id, 200);
    const nativeType = text(part.type, 100);
    if (!messageId || !partId || !nativeType) return;
    if (this.#messageRoles.get(messageKey(sessionId, messageId)) === "user") return;
    if (nativeType === "text" || nativeType === "reasoning") {
      const next = text(part.text, 128 * 1024, false);
      const key = partKey(sessionId, partId);
      const previous = this.#partText.get(key) ?? "";
      const delta = next.startsWith(previous) ? next.slice(previous.length) : next;
      this.#partText.set(key, next);
      if (delta) this.#emitDelta(sessionId, messageId, partId, delta, nativeType === "reasoning");
      return;
    }
    if (nativeType === "tool") {
      const status = toolStatus(part.state ?? part.status);
      const toolCallId = text(part.callID ?? part.callId ?? part.toolCallId ?? part.id, 200);
      if (!toolCallId) return;
      this.#events.emitForNative("opencode", sessionId, {
        kind: status === "completed" || status === "error" || status === "cancelled"
          ? "tool.completed"
          : status === "running"
            ? "tool.started"
            : "tool.updated",
        messageId,
        part: {
          type: "tool",
          id: partId,
          toolCallId,
          name: text(part.tool, 100) || "unknown-tool",
          status,
          ...(jsonValue(part.input) !== undefined ? { input: jsonValue(part.input) } : {}),
          ...(jsonValue(part.output) !== undefined ? { output: jsonValue(part.output) } : {}),
        },
      });
    }
  }

  #emitDelta(
    sessionId: string,
    messageId: string,
    partId: string,
    delta: string,
    reasoning: boolean,
  ): void {
    this.#events.emitForNative("opencode", sessionId, {
      kind: reasoning ? "reasoning.delta" : "message.delta",
      messageId,
      partId,
      delta,
    });
  }

  #completeTurn(sessionId: string, outcome: "completed" | "error"): void {
    const turnId = this.#events.activeTurnId("opencode", sessionId);
    if (!turnId) return;
    this.#events.emitForNative("opencode", sessionId, {
      kind: "turn.completed",
      turnId,
      outcome,
    });
    this.#events.endTurn("opencode", sessionId);
    const prefix = `${sessionId}\0`;
    for (const key of this.#messageRoles.keys()) {
      if (key.startsWith(prefix)) this.#messageRoles.delete(key);
    }
  }

  #rememberMessageRole(
    sessionId: string,
    messageId: string,
    role: "system" | "user" | "assistant" | "tool",
  ): void {
    this.#messageRoles.set(messageKey(sessionId, messageId), role);
    if (this.#messageRoles.size <= 2_048) return;
    const oldest = this.#messageRoles.keys().next().value;
    if (oldest) this.#messageRoles.delete(oldest);
  }
}

function sessionIdFor(type: string, properties: JsonObject): string {
  if (type === "message.updated") return text(object(properties.info).sessionID, 200);
  if (type === "message.part.updated") return text(object(properties.part).sessionID, 200);
  return text(properties.sessionID ?? properties.sessionId, 200);
}

function messageRole(value: unknown) {
  return value === "system" || value === "user" || value === "assistant" || value === "tool"
    ? value
    : null;
}

function toolStatus(value: unknown): ToolStatus {
  const state = object(value);
  const type = text(state.status ?? state.type ?? value, 50);
  if (/complete|success/.test(type)) return "completed";
  if (/error|fail/.test(type)) return "error";
  if (/cancel/.test(type)) return "cancelled";
  if (/running|progress/.test(type)) return "running";
  return "pending";
}

function safeErrorMessage(value: unknown): string {
  const error = object(value);
  return text(error.message ?? error.name, 500) || "OpenCode runtime error";
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  try {
    const encoded = JSON.stringify(value);
    if (encoded.length > 16_000) return "[truncated]";
    return JSON.parse(encoded) as JsonValue;
  } catch {
    return undefined;
  }
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown, max: number, trim = true): string {
  if (typeof value !== "string") return "";
  const next = trim ? value.trim() : value;
  return next.slice(0, max);
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function partKey(sessionId: string, partId: string): string {
  return `${sessionId}\0${partId}`;
}

function messageKey(sessionId: string, messageId: string): string {
  return `${sessionId}\0${messageId}`;
}
