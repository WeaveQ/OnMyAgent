import type { PrimaryRuntimeEventBus } from "./primary-runtime-events.js";
import { GROK_SESSION_UPDATE_METHODS } from "./grok-extension-registry.js";

type JsonObject = Record<string, unknown>;
type ToolStatus = "pending" | "running" | "completed" | "error" | "cancelled";
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export class GrokEventNormalizer {
  readonly #events: PrimaryRuntimeEventBus;
  readonly #replayBySession = new Map<string, {
    promptKey: string;
    userText: string;
  }>();
  readonly #commandsBySession = new Map<string, Array<{ name: string; description?: string }>>();

  constructor(events: PrimaryRuntimeEventBus) {
    this.#events = events;
  }

  commandCatalog(sessionId: string): Array<{ name: string; description?: string }> {
    return this.#commandsBySession.get(sessionId) ?? [];
  }

  handle(method: string, value: unknown): void {
    if (!GROK_SESSION_UPDATE_METHODS.includes(method as typeof GROK_SESSION_UPDATE_METHODS[number])) return;
    const params = asObject(value);
    const sessionId = text(params.sessionId ?? params.session_id, 200);
    if (!sessionId) return;
    const update = asObject(params.update);
    const nativeType = text(update.sessionUpdate ?? update.session_update, 100)
      || "unknown";
    const content = asObject(update.content);
    const delta = chunkText(content.text, 128 * 1024);
    if (nativeType === "user_message_chunk" && delta) {
      // The registry already published the live user turn before prompt. Grok
      // echoes it back, so only session/load replay needs normalization here.
      if (this.#events.activeTurnId("grok-build", sessionId)) return;
      const productSessionId = this.#events.productSessionIdForNative(
        "grok-build",
        sessionId,
      );
      if (!productSessionId) return;
      const promptKey = replayPromptKey(params, update, content);
      const previous = this.#replayBySession.get(sessionId);
      const userText = previous?.promptKey === promptKey
        ? previous.userText + delta
        : delta;
      this.#replayBySession.set(sessionId, { promptKey, userText });
      this.#events.emitForNative("grok-build", sessionId, {
        kind: "message.completed",
        message: {
          id: `user-replay-${promptKey}`,
          productSessionId,
          role: "user",
          parts: [{ type: "text", id: `user-text-replay-${promptKey}`, text: userText }],
          createdAt: Date.now(),
          completedAt: Date.now(),
        },
      });
      return;
    }
    if (nativeType === "agent_message_chunk" && delta) {
      const turnId = this.#events.activeTurnId("grok-build", sessionId)
        ?? `replay-${this.#replayBySession.get(sessionId)?.promptKey
          ?? eventId(paramsMeta(params), eventId(update, "turn"))}`;
      this.#events.emitForNative("grok-build", sessionId, {
        kind: "message.delta",
        messageId: nativeMessageId(update, `assistant-${turnId}`),
        partId: nativePartId(content, `assistant-text-${turnId}`),
        delta,
      });
      return;
    }
    if (nativeType === "agent_thought_chunk" && delta) {
      const turnId = this.#events.activeTurnId("grok-build", sessionId)
        ?? `replay-${this.#replayBySession.get(sessionId)?.promptKey
          ?? eventId(paramsMeta(params), eventId(update, "turn"))}`;
      this.#events.emitForNative("grok-build", sessionId, {
        kind: "reasoning.delta",
        messageId: nativeMessageId(update, `assistant-${turnId}`),
        partId: nativePartId(content, `assistant-reasoning-${turnId}`),
        delta,
      });
      return;
    }
    if (nativeType === "tool_call" || nativeType === "tool_call_update") {
      const toolCallId = text(update.toolCallId ?? update.tool_call_id, 200)
        || eventId(update, "tool-call");
      const status = toolStatus(update.status, nativeType);
      this.#events.emitForNative("grok-build", sessionId, {
        kind: status === "completed" || status === "error" || status === "cancelled"
          ? "tool.completed"
          : nativeType === "tool_call"
            ? "tool.started"
            : "tool.updated",
        part: {
          type: "tool",
          id: toolCallId,
          toolCallId,
          name: text(update.kind ?? update.name ?? update.title, 100) || "unknown-tool",
          status,
          ...(boundedJson(update.rawInput ?? update.raw_input ?? update.input) !== undefined
            ? { input: boundedJson(update.rawInput ?? update.raw_input ?? update.input) }
            : {}),
          ...(boundedJson(update.output ?? update.content) !== undefined
            ? { output: boundedJson(update.output ?? update.content) }
            : {}),
        },
      });
      return;
    }
    if (nativeType === "plan") {
      const entries = Array.isArray(update.entries) ? update.entries : [];
      this.#events.emitForNative("grok-build", sessionId, {
        kind: "plan.updated",
        items: entries.slice(0, 100).map((entry, index) => {
          const item = asObject(entry);
          return {
            id: text(item.id, 200) || `plan-${index}`,
            text: text(item.content ?? item.text, 2_000) || "Plan item",
            status: planStatus(item.status),
          };
        }),
      });
      return;
    }
    if (
      nativeType === "available_commands_update"
      || nativeType === "available_commands"
    ) {
      const commands = Array.isArray(update.availableCommands)
        ? update.availableCommands
        : Array.isArray(update.available_commands)
          ? update.available_commands
          : Array.isArray(update.commands)
            ? update.commands
            : [];
      const items = commands.slice(0, 256).flatMap((entry) => {
        const command = asObject(entry);
        const name = text(command.name, 200);
        return name
          ? [{
            name,
            ...(text(command.description, 500)
              ? { description: text(command.description, 500) }
              : {}),
          }]
          : [];
      });
      this.#commandsBySession.set(sessionId, items);
      this.#events.emitForNative("grok-build", sessionId, {
        kind: "command.catalog.updated",
        items,
        complete: commands.length <= 256,
      });
      return;
    }
    if (
      nativeType === "turn_completed"
      || nativeType === "turn_complete"
      || nativeType === "agent_turn_complete"
    ) {
      const stopReason = text(update.stop_reason ?? update.stopReason, 100);
      const usage = usageFrom(asObject(update.usage));
      const nativeTurnId = text(update.prompt_id ?? update.promptId, 200)
        || "turn";
      this.#events.emitForNative("grok-build", sessionId, {
        kind: "turn.completed",
        turnId: this.#events.resolveTurnId(
          "grok-build",
          sessionId,
          nativeTurnId,
        ),
        outcome: /cancel/i.test(stopReason)
          ? "cancelled"
          : /error|fail/i.test(stopReason)
            ? "error"
            : "completed",
        ...(usage ? { usage } : {}),
      });
      this.#events.emitForNative("grok-build", sessionId, {
        kind: "session.status",
        status: { type: "idle" },
      });
      this.#events.endTurn("grok-build", sessionId);
      return;
    }
    this.#events.emitForNative("grok-build", sessionId, {
      kind: "runtime.unknown",
      nativeType,
      summary: `Unsupported Grok update: ${nativeType}`,
    });
  }
}

function replayPromptKey(
  params: JsonObject,
  update: JsonObject,
  content: JsonObject,
): string {
  const promptIndex = integer(asObject(content._meta).promptIndex);
  if (promptIndex !== null) return `prompt-${promptIndex}`;
  return eventId(paramsMeta(params), eventId(update, "unknown-prompt"));
}

function paramsMeta(params: JsonObject): JsonObject {
  return asObject(params._meta);
}

function usageFrom(value: JsonObject) {
  const model = asObject(value.model ?? value.total ?? value);
  const inputTokens = integer(model.input_tokens ?? model.inputTokens);
  const outputTokens = integer(model.output_tokens ?? model.outputTokens);
  if (inputTokens === null || outputTokens === null) return null;
  const reasoningTokens = integer(model.reasoning_tokens ?? model.reasoningTokens);
  const cacheReadTokens = integer(model.cached_read_tokens ?? model.cache_read_input_tokens);
  const cacheWriteTokens = integer(model.cache_creation_tokens ?? model.cache_creation_input_tokens);
  const usageIsIncomplete = value.usage_is_incomplete === true
    || value.usageIsIncomplete === true;
  const costIsPartial = value.cost_is_partial === true
    || value.costIsPartial === true;
  const costTicks = usageIsIncomplete || costIsPartial
    ? null
    : integer(model.cost_usd_ticks);
  return {
    inputTokens,
    outputTokens,
    ...(reasoningTokens !== null ? { reasoningTokens } : {}),
    ...(cacheReadTokens !== null ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== null ? { cacheWriteTokens } : {}),
    ...(costTicks !== null ? { costUsd: costTicks / 10_000_000_000 } : {}),
  };
}

function boundedJson(value: unknown, depth = 0): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return text(value, 8_000);
  if (depth >= 4) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => boundedJson(item, depth + 1) ?? null);
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonObject).slice(0, 50)
      .map(([key, item]) => [
        key.slice(0, 100),
        boundedJson(item, depth + 1) ?? null,
      ]));
  }
  return String(value).slice(0, 200);
}

function toolStatus(value: unknown, nativeType: string): ToolStatus {
  const status = text(value, 50).toLowerCase();
  if (/complete|success/.test(status)) return "completed";
  if (/fail|error/.test(status)) return "error";
  if (/cancel/.test(status)) return "cancelled";
  if (/progress|running/.test(status)) return "running";
  return nativeType === "tool_call" ? "running" : "pending";
}

function planStatus(value: unknown): "pending" | "in_progress" | "completed" | "cancelled" {
  const status = text(value, 50).toLowerCase();
  if (/complete|done/.test(status)) return "completed";
  if (/progress|running/.test(status)) return "in_progress";
  if (/cancel/.test(status)) return "cancelled";
  return "pending";
}

function eventId(value: JsonObject, fallback: string): string {
  return text(value.id ?? value.messageId ?? value.message_id, 200) || fallback;
}

function nativeMessageId(value: JsonObject, fallback: string): string {
  return text(value.messageId ?? value.message_id, 200) || fallback;
}

function nativePartId(value: JsonObject, fallback: string): string {
  return text(value.id ?? value.partId ?? value.part_id, 200) || fallback;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function chunkText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const bounded = value.slice(0, limit);
  return bounded.trim() ? bounded : "";
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}
