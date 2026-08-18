import { describe, expect, test } from "bun:test";
import { ensureBunTest } from "./ensure-bun-test";
ensureBunTest(import.meta.path);
import type { AgentRuntimeEvent } from "@onmyagent/types/agent-runtime";
import {
  applyCanonicalRuntimeEvent,
  canonicalMessagesToUI,
  emptyCanonicalRuntimeState,
  seedCanonicalRuntimeMessages,
} from "../src/react-app/domains/session/sync/canonical-runtime-state";
import {
  applySnapshot,
  applyLiveCanonicalRuntimeEvent,
  CanonicalRuntimeSequenceGapError,
  canonicalQuestionsToPending,
  readSse,
} from "../src/react-app/domains/session/sync/canonical-runtime-sync";

function event(
  sequence: number,
  value: Omit<AgentRuntimeEvent, "eventId" | "runtimeKind" | "productSessionId" | "emittedAt" | "sequence" | "generation">,
): AgentRuntimeEvent {
  return {
    eventId: `event-${sequence}`,
    runtimeKind: "grok-build",
    productSessionId: "product",
    emittedAt: sequence,
    sequence,
    generation: 7,
    ...value,
  } as AgentRuntimeEvent;
}

describe("canonical runtime renderer state", () => {
  test("replays user and streaming assistant messages without duplicate sequences", () => {
    const user = event(1, {
      kind: "message.completed",
      message: {
        id: "user-turn",
        productSessionId: "product",
        role: "user",
        parts: [{ type: "text", id: "user-text", text: "hello" }],
        createdAt: 1,
        completedAt: 1,
      },
    });
    const delta = event(2, {
      kind: "message.delta",
      messageId: "assistant-turn",
      partId: "assistant-text",
      delta: "world",
    });
    const done = event(3, {
      kind: "turn.completed",
      turnId: "turn",
      outcome: "completed",
    });
    let state = emptyCanonicalRuntimeState();
    for (const item of [user, delta, delta, done]) {
      state = applyCanonicalRuntimeEvent(state, item);
    }
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({
      id: "assistant-turn",
      completedAt: 3,
      parts: [{ id: "assistant-text", text: "world" }],
    });
    expect(canonicalMessagesToUI(state.messages)).toMatchObject([
      { id: "user-turn", role: "user", parts: [{ type: "text", text: "hello" }] },
      { id: "assistant-turn", role: "assistant", parts: [{ type: "text", text: "world", state: "done" }] },
    ]);
  });

  test("stores command.catalog.updated for the Grok slash picker", () => {
    const state = applyCanonicalRuntimeEvent(emptyCanonicalRuntimeState(), event(1, {
      kind: "command.catalog.updated",
      items: [{ name: "compact", description: "Compact history" }],
      complete: true,
    }));
    expect(state.commandCatalog).toEqual([
      { name: "compact", description: "Compact history" },
    ]);
  });

  test("merges snapshot generations and reports incomplete replay", () => {
    const snapshot = applySnapshot(emptyCanonicalRuntimeState(), {
      productSessionId: "product",
      generation: 7,
      latestSequence: 9,
      complete: false,
      events: [event(8, { kind: "session.status", status: { type: "busy" } })],
    });
    expect(snapshot).toMatchObject({
      generation: 7,
      sequence: 8,
      complete: false,
      status: { type: "busy" },
    });
  });

  test("seeds durable messages before SSE without duplicating snapshot messages", () => {
    const message = {
      id: "durable-user",
      productSessionId: "product",
      role: "user" as const,
      parts: [{ type: "text" as const, id: "text", text: "hello" }],
      createdAt: 1,
      completedAt: 1,
    };
    const seeded = seedCanonicalRuntimeMessages(
      emptyCanonicalRuntimeState(),
      [message],
      true,
    );
    const replayed = applyCanonicalRuntimeEvent(seeded, event(1, {
      kind: "message.completed",
      message,
    }));
    expect(replayed.messages).toEqual([message]);
  });

  test("does not erase streamed parts when native message completion carries metadata only", () => {
    const delta = event(1, {
      kind: "message.delta",
      messageId: "assistant",
      partId: "text",
      delta: "answer",
    });
    const completed = event(2, {
      kind: "message.completed",
      message: {
        id: "assistant",
        productSessionId: "product",
        role: "assistant",
        parts: [],
        createdAt: 1,
        completedAt: 2,
      },
    });
    const state = applyCanonicalRuntimeEvent(
      applyCanonicalRuntimeEvent(emptyCanonicalRuntimeState(), delta),
      completed,
    );
    expect(state.messages[0]).toMatchObject({
      completedAt: 2,
      parts: [{ id: "text", text: "answer" }],
    });
  });

  test("rejects sequence gaps and ignores events from a stale stream generation", () => {
    const current = {
      ...emptyCanonicalRuntimeState(),
      generation: 7,
      sequence: 2,
    };
    expect(applyLiveCanonicalRuntimeEvent(
      current,
      8,
      event(3, { kind: "session.status", status: { type: "busy" } }),
    )).toBe(current);
    expect(() => applyLiveCanonicalRuntimeEvent(
      current,
      7,
      event(4, { kind: "session.status", status: { type: "busy" } }),
    )).toThrow(CanonicalRuntimeSequenceGapError);
  });

  test("parses fragmented CRLF SSE frames", async () => {
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event: generation\r\ndata: {\"generation\":7}"));
        controller.enqueue(encoder.encode("\r\n\r\nevent: runtime-event\ndata: {\"kind\":\"runtime.unknown\"}\n\n"));
        controller.close();
      },
    }));
    const frames = [];
    for await (const frame of readSse(response)) frames.push(frame);
    expect(frames).toEqual([
      { event: "generation", data: "{\"generation\":7}" },
      { event: "runtime-event", data: "{\"kind\":\"runtime.unknown\"}" },
    ]);
  });

  test("projects canonical multi-question requests with a runtime reply marker", () => {
    expect(canonicalQuestionsToPending("product", [{
      questionId: "question-1",
      productSessionId: "product",
      prompt: "Which scope?",
      options: [],
      allowFreeText: true,
      requestedAt: 1,
      items: [{
        key: "scope",
        prompt: "Which scope?",
        options: [{ optionId: "local", label: "Local", description: "Workspace" }],
        allowFreeText: true,
        multiple: false,
      }],
    }])).toEqual([{
      id: "question-1",
      sessionID: "product",
      questions: [{
        question: "Which scope?",
        header: "Which scope?",
        options: [{ label: "Local", description: "Workspace" }],
        multiple: false,
        custom: true,
      }],
      tool: {
        messageID: "onmyagent:grok-runtime-question",
        callID: "question-1",
      },
      receivedAt: 1,
    }]);
  });
});
