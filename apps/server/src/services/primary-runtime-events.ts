import { randomInt, randomUUID } from "node:crypto";
import {
  agentRuntimeEventSchema,
  type AgentRuntimeEvent,
  type AgentRuntimeKind,
} from "@onmyagent/types/agent-runtime";

type EventEnvelopeKeys =
  | "eventId"
  | "runtimeKind"
  | "productSessionId"
  | "emittedAt"
  | "sequence"
  | "generation";
type EventPayload = AgentRuntimeEvent extends infer Event
  ? Event extends AgentRuntimeEvent
    ? Omit<Event, EventEnvelopeKeys>
    : never
  : never;

type NativeBinding = {
  runtimeKind: AgentRuntimeKind;
  productSessionId: string;
  runtimeSessionId?: string;
  workspaceId?: string;
  cwd?: string;
  profileId?: string;
};

export class PrimaryRuntimeEventBus {
  readonly generation = randomInt(1, 2 ** 48);
  readonly #native = new Map<string, NativeBinding>();
  readonly #listeners = new Map<string, Set<(event: AgentRuntimeEvent) => void>>();
  readonly #allListeners = new Set<(event: AgentRuntimeEvent) => void>();
  readonly #sequences = new Map<string, number>();
  readonly #activeTurns = new Map<string, string>();
  readonly #history = new Map<string, AgentRuntimeEvent[]>();

  bindNativeSession(
    runtimeKind: AgentRuntimeKind,
    runtimeSessionId: string,
    productSessionId: string,
    metadata: Pick<NativeBinding, "workspaceId" | "cwd" | "profileId"> = {},
  ): void {
    this.#native.set(nativeKey(runtimeKind, runtimeSessionId), {
      runtimeKind,
      productSessionId,
      runtimeSessionId,
      ...metadata,
    });
  }

  unbindNativeSession(
    runtimeKind: AgentRuntimeKind,
    runtimeSessionId: string,
  ): void {
    const key = nativeKey(runtimeKind, runtimeSessionId);
    this.#native.delete(key);
    this.#activeTurns.delete(key);
  }

  forgetProductSession(productSessionId: string): void {
    const id = productSessionId.trim();
    if (!id) return;
    this.#history.delete(id);
    this.#sequences.delete(id);
  }

  beginTurn(
    runtimeKind: AgentRuntimeKind,
    runtimeSessionId: string,
    productTurnId: string,
  ): void {
    this.#activeTurns.set(
      nativeKey(runtimeKind, runtimeSessionId),
      productTurnId,
    );
  }

  resolveTurnId(
    runtimeKind: AgentRuntimeKind,
    runtimeSessionId: string,
    nativeTurnId: string,
  ): string {
    return this.#activeTurns.get(nativeKey(runtimeKind, runtimeSessionId))
      ?? nativeTurnId;
  }

  activeTurnId(
    runtimeKind: AgentRuntimeKind,
    runtimeSessionId: string,
  ): string | null {
    return this.#activeTurns.get(nativeKey(runtimeKind, runtimeSessionId)) ?? null;
  }

  productSessionIdForNative(
    runtimeKind: AgentRuntimeKind,
    runtimeSessionId: string,
  ): string | null {
    return this.#native.get(nativeKey(runtimeKind, runtimeSessionId))
      ?.productSessionId ?? null;
  }

  bindingForProductSession(
    productSessionId: string,
    runtimeKind?: AgentRuntimeKind,
  ): NativeBinding | null {
    const id = productSessionId.trim();
    for (const binding of this.#native.values()) {
      if (
        binding.productSessionId === id
        && (!runtimeKind || binding.runtimeKind === runtimeKind)
      ) return { ...binding };
    }
    return null;
  }

  endTurn(runtimeKind: AgentRuntimeKind, runtimeSessionId: string): void {
    this.#activeTurns.delete(nativeKey(runtimeKind, runtimeSessionId));
  }

  emitForNative(
    runtimeKind: AgentRuntimeKind,
    runtimeSessionId: string,
    payload: EventPayload,
  ): AgentRuntimeEvent | null {
    const binding = this.#native.get(nativeKey(runtimeKind, runtimeSessionId));
    if (!binding) return null;
    const sequence = (this.#sequences.get(binding.productSessionId) ?? 0) + 1;
    this.#sequences.set(binding.productSessionId, sequence);
    const parsed = agentRuntimeEventSchema.safeParse({
      ...payload,
      eventId: randomUUID(),
      runtimeKind,
      productSessionId: binding.productSessionId,
      emittedAt: Date.now(),
      sequence,
      generation: this.generation,
    });
    if (!parsed.success) return null;
    const history = this.#history.get(binding.productSessionId) ?? [];
    history.push(parsed.data);
    if (history.length > 512) history.splice(0, history.length - 512);
    this.#history.set(binding.productSessionId, history);
    for (const listener of this.#listeners.get(binding.productSessionId) ?? []) {
      listener(parsed.data);
    }
    for (const listener of this.#allListeners) listener(parsed.data);
    return parsed.data;
  }

  subscribe(
    productSessionId: string,
    listener: (event: AgentRuntimeEvent) => void,
  ): () => void {
    const listeners = this.#listeners.get(productSessionId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(productSessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(productSessionId);
    };
  }

  subscribeAll(listener: (event: AgentRuntimeEvent) => void): () => void {
    this.#allListeners.add(listener);
    return () => this.#allListeners.delete(listener);
  }

  snapshot(
    productSessionId: string,
    options: { afterSequence?: number; limit?: number } = {},
  ) {
    const afterSequence = Number.isSafeInteger(options.afterSequence)
      && (options.afterSequence ?? 0) >= 0
      ? options.afterSequence ?? 0
      : 0;
    const limit = Math.max(1, Math.min(512, options.limit ?? 512));
    const history = this.#history.get(productSessionId) ?? [];
    const matching = history.filter((event) =>
      (event.sequence ?? 0) > afterSequence);
    const events = matching.slice(0, limit);
    const oldestSequence = history[0]?.sequence ?? 0;
    return {
      productSessionId,
      generation: this.generation,
      latestSequence: this.#sequences.get(productSessionId) ?? 0,
      events,
      complete: (
        afterSequence === 0
          ? history.length < 512 || oldestSequence <= 1
          : afterSequence >= oldestSequence - 1
      ) && matching.length <= limit,
    };
  }
}

function nativeKey(runtimeKind: AgentRuntimeKind, runtimeSessionId: string): string {
  return `${runtimeKind}\0${runtimeSessionId.trim()}`;
}
