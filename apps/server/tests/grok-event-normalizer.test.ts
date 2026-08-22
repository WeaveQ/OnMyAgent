import { describe, expect, test } from "bun:test";
import { GrokEventNormalizer } from "../src/services/grok-event-normalizer.js";
import { PrimaryRuntimeEventBus } from "../src/services/primary-runtime-events.js";

describe("GrokEventNormalizer", () => {
  test("maps available_commands_update into a command catalog event", () => {
    const events = new PrimaryRuntimeEventBus();
    events.bindNativeSession("grok-build", "native", "product");
    const seen: unknown[] = [];
    events.subscribe("product", (event) => seen.push(event));
    new GrokEventNormalizer(events).handle("session/update", {
      sessionId: "native",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "compact", description: "Compact" }],
      },
    });
    expect(seen).toMatchObject([{
      kind: "command.catalog.updated",
      items: [{ name: "compact", description: "Compact" }],
      complete: true,
    }]);
  });

  test("maps message, reasoning, tool, plan and usage without raw ACP leakage", () => {
    const events = new PrimaryRuntimeEventBus();
    events.bindNativeSession("grok-build", "native", "product");
    const seen: unknown[] = [];
    events.subscribe("product", (event) => seen.push(event));
    const normalizer = new GrokEventNormalizer(events);
    events.beginTurn("grok-build", "native", "product-turn");
    const send = (update: Record<string, unknown>) => normalizer.handle(
      "session/update",
      { sessionId: "native", update },
    );
    send({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } });
    send({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "think" } });
    send({
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "read_file",
      status: "in_progress",
      rawInput: { path: "/fixture" },
    });
    send({
      sessionUpdate: "plan",
      entries: [{ id: "p1", content: "Inspect", status: "in_progress" }],
    });
    send({
      sessionUpdate: "turn_completed",
      prompt_id: "turn-1",
      stop_reason: "end_turn",
      usage: {
        input_tokens: 12,
        output_tokens: 3,
        reasoning_tokens: 2,
        cost_usd_ticks: 50_000_000,
      },
      secret: "must-not-pass",
    });
    expect(seen).toHaveLength(6);
    expect(seen.map((event) => (event as { kind: string }).kind)).toEqual([
      "message.delta",
      "reasoning.delta",
      "tool.started",
      "plan.updated",
      "turn.completed",
      "session.status",
    ]);
    expect(seen[4]).toMatchObject({
      productSessionId: "product",
      runtimeKind: "grok-build",
      kind: "turn.completed",
      turnId: "product-turn",
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        reasoningTokens: 2,
        costUsd: 0.005,
      },
    });
    expect(JSON.stringify(seen)).not.toContain("must-not-pass");
    expect(seen[5]).toMatchObject({
      kind: "session.status",
      status: { type: "idle" },
    });
    expect(events.resolveTurnId("grok-build", "native", "native-next"))
      .toBe("native-next");
  });

  test("treats turn_complete aliases as a finished turn", () => {
    const events = new PrimaryRuntimeEventBus();
    events.bindNativeSession("grok-build", "native", "product");
    const seen: unknown[] = [];
    events.subscribe("product", (event) => seen.push(event));
    events.beginTurn("grok-build", "native", "product-turn");
    new GrokEventNormalizer(events).handle("session/update", {
      sessionId: "native",
      update: { sessionUpdate: "agent_turn_complete", stopReason: "end_turn" },
    });
    expect(seen).toMatchObject([
      { kind: "turn.completed", turnId: "product-turn", outcome: "completed" },
      { kind: "session.status", status: { type: "idle" } },
    ]);
    expect(events.activeTurnId("grok-build", "native")).toBeNull();
  });

  test("maps unknown updates to a bounded safe fallback and ignores unbound native ids", () => {
    const events = new PrimaryRuntimeEventBus();
    const seen: unknown[] = [];
    events.subscribe("product", (event) => seen.push(event));
    const normalizer = new GrokEventNormalizer(events);
    normalizer.handle("session/update", {
      sessionId: "native",
      update: { sessionUpdate: "future_update", content: "secret raw" },
    });
    expect(seen).toEqual([]);
    events.bindNativeSession("grok-build", "native", "product");
    normalizer.handle("session/update", {
      sessionId: "native",
      update: { sessionUpdate: "future_update", content: "secret raw" },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      kind: "runtime.unknown",
      nativeType: "future_update",
      summary: "Unsupported Grok update: future_update",
    });
    expect(JSON.stringify(seen[0])).not.toContain("secret raw");
  });

  test("does not publish partial native cost as a final cost", () => {
    const events = new PrimaryRuntimeEventBus();
    events.bindNativeSession("grok-build", "native", "product");
    const seen: unknown[] = [];
    events.subscribe("product", (event) => seen.push(event));
    new GrokEventNormalizer(events).handle("session/update", {
      sessionId: "native",
      update: {
        sessionUpdate: "turn_completed",
        usage: {
          input_tokens: 12,
          output_tokens: 3,
          cost_usd_ticks: 50_000_000,
          cost_is_partial: true,
        },
      },
    });
    expect(seen[0]).toMatchObject({
      kind: "turn.completed",
      usage: { inputTokens: 12, outputTokens: 3 },
    });
    expect(JSON.stringify(seen[0])).not.toContain("costUsd");
  });

  test("uses the active product turn to keep id-less chunks isolated across turns", () => {
    const events = new PrimaryRuntimeEventBus();
    events.bindNativeSession("grok-build", "native", "product");
    const seen: Array<{ kind: string; messageId?: string; partId?: string }> = [];
    events.subscribe("product", (event) => seen.push(event));
    const normalizer = new GrokEventNormalizer(events);
    for (const turnId of ["product-turn-a", "product-turn-b"]) {
      events.beginTurn("grok-build", "native", turnId);
      normalizer.handle("session/update", {
        sessionId: "native",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: turnId },
        },
      });
      normalizer.handle("session/update", {
        sessionId: "native",
        update: { sessionUpdate: "turn_completed" },
      });
    }
    expect(seen.filter((event) => event.kind === "message.delta")).toEqual([
      expect.objectContaining({
        messageId: "assistant-product-turn-a",
        partId: "assistant-text-product-turn-a",
      }),
      expect.objectContaining({
        messageId: "assistant-product-turn-b",
        partId: "assistant-text-product-turn-b",
      }),
    ]);
  });

  test("reconstructs session/load user and assistant replay without duplicating live echoes", () => {
    const events = new PrimaryRuntimeEventBus();
    events.bindNativeSession("grok-build", "native", "product");
    const seen: Array<{ kind: string; message?: { id: string; productSessionId: string; parts: Array<{ text?: string }> }; messageId?: string }> = [];
    events.subscribe("product", (event) => seen.push(event));
    const normalizer = new GrokEventNormalizer(events);
    const replay = (update: Record<string, unknown>) => normalizer.handle(
      "session/update",
      { sessionId: "native", update },
    );
    replay({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "hello ", _meta: { promptIndex: 3 } },
    });
    replay({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "world", _meta: { promptIndex: 3 } },
    });
    replay({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answer" } });
    expect(seen).toMatchObject([
      {
        kind: "message.completed",
        message: {
          id: "user-replay-prompt-3",
          productSessionId: "product",
          parts: [{ text: "hello " }],
        },
      },
      {
        kind: "message.completed",
        message: {
          id: "user-replay-prompt-3",
          productSessionId: "product",
          parts: [{ text: "hello world" }],
        },
      },
      { kind: "message.delta", messageId: "assistant-replay-prompt-3" },
    ]);

    events.beginTurn("grok-build", "native", "live-turn");
    replay({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "live echo", _meta: { promptIndex: 4 } },
    });
    expect(seen).toHaveLength(3);
  });

  test("provides bounded sequence replay and reports truncated history", () => {
    const events = new PrimaryRuntimeEventBus();
    events.bindNativeSession("grok-build", "native", "product");
    for (let index = 0; index < 515; index += 1) {
      events.emitForNative("grok-build", "native", {
        kind: "runtime.unknown",
        nativeType: `fixture-${index}`,
      });
    }
    const truncated = events.snapshot("product", { afterSequence: 0 });
    expect(truncated.events).toHaveLength(512);
    expect(truncated.latestSequence).toBe(515);
    expect(truncated.complete).toBe(false);
    expect(truncated.events[0]?.sequence).toBe(4);
    const resume = events.snapshot("product", {
      afterSequence: 510,
      limit: 3,
    });
    expect(resume.events.map((event) => event.sequence)).toEqual([511, 512, 513]);
    expect(resume.complete).toBe(false);
    expect(events.snapshot("product", { afterSequence: 512 }).complete).toBe(true);
  });
});
