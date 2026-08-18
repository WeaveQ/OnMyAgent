import { describe, expect, test } from "bun:test";
import { OpenCodeEventNormalizer } from "../src/services/opencode-event-normalizer.js";
import { PrimaryRuntimeEventBus } from "../src/services/primary-runtime-events.js";

describe("OpenCodeEventNormalizer", () => {
  test("maps native message, delta, tool, status and todo events to one product stream", () => {
    const events = new PrimaryRuntimeEventBus();
    events.bindNativeSession("opencode", "native", "product");
    events.beginTurn("opencode", "native", "turn-product");
    const normalizer = new OpenCodeEventNormalizer(events);

    normalizer.handle({ payload: { type: "message.updated", properties: {
      info: { id: "assistant", sessionID: "native", role: "assistant", time: { created: 10 } },
    } } });
    normalizer.handle({ payload: { type: "message.part.updated", properties: {
      part: { id: "text", messageID: "assistant", sessionID: "native", type: "text", text: "Hel" },
    } } });
    normalizer.handle({ payload: { type: "message.part.delta", properties: {
      sessionID: "native", messageID: "assistant", partID: "text", delta: "lo",
    } } });
    normalizer.handle({ payload: { type: "message.part.updated", properties: {
      part: { id: "tool", messageID: "assistant", sessionID: "native", type: "tool", callID: "call", tool: "bash", state: { status: "completed" }, output: "ok" },
    } } });
    normalizer.handle({ payload: { type: "todo.updated", properties: {
      sessionID: "native", todos: [{ id: "todo", content: "Finish", status: "in_progress", priority: "high" }],
    } } });
    normalizer.handle({ payload: { type: "session.status", properties: {
      sessionID: "native", status: { type: "idle" },
    } } });

    expect(events.snapshot("product").events.map((event) => event.kind)).toEqual([
      "message.started",
      "message.delta",
      "message.delta",
      "tool.completed",
      "todo.updated",
      "session.status",
      "turn.completed",
    ]);
    expect(events.snapshot("product").events).toContainEqual(expect.objectContaining({
      kind: "turn.completed",
      turnId: "turn-product",
      outcome: "completed",
    }));
  });

  test("coalesces cumulative part updates and ignores foreign sessions", () => {
    const events = new PrimaryRuntimeEventBus();
    events.bindNativeSession("opencode", "native", "product");
    const normalizer = new OpenCodeEventNormalizer(events);
    const part = (text: string, sessionID = "native") => ({
      payload: { type: "message.part.updated", properties: {
        part: { id: "text", messageID: "assistant", sessionID, type: "reasoning", text },
      } },
    });
    normalizer.handle(part("one"));
    normalizer.handle(part("one two"));
    normalizer.handle(part("foreign", "other"));
    expect(events.snapshot("product").events.map((event) =>
      event.kind === "reasoning.delta" ? event.delta : "")).toEqual(["one", " two"]);
  });

  test("does not duplicate product-owned user text from the native stream", () => {
    const events = new PrimaryRuntimeEventBus();
    events.bindNativeSession("opencode", "native", "product");
    const normalizer = new OpenCodeEventNormalizer(events);
    normalizer.handle({ payload: { type: "message.updated", properties: {
      info: { id: "product-user", sessionID: "native", role: "user", time: { created: 10 } },
    } } });
    normalizer.handle({ payload: { type: "message.part.delta", properties: {
      sessionID: "native", messageID: "product-user", partID: "native-text", delta: "hello",
    } } });
    normalizer.handle({ payload: { type: "message.part.updated", properties: {
      part: { id: "native-text", messageID: "product-user", sessionID: "native", type: "text", text: "hello" },
    } } });

    expect(events.snapshot("product").events.map((event) => event.kind)).toEqual([
      "message.started",
    ]);
  });
});
