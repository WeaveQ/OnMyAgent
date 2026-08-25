import { describe, expect, test } from "bun:test";
import { PrimaryRuntimeEventBus } from "../src/services/primary-runtime-events.js";

describe("PrimaryRuntimeEventBus reconnect contract", () => {
  test("keeps one monotonic sequence across detach and reattach", () => {
    const bus = new PrimaryRuntimeEventBus();
    bus.bindNativeSession("grok-build", "native", "product");
    bus.emitForNative("grok-build", "native", {
      kind: "session.status",
      status: { type: "busy" },
    });
    bus.unbindNativeSession("grok-build", "native");
    bus.bindNativeSession("grok-build", "native", "product");
    bus.emitForNative("grok-build", "native", {
      kind: "session.status",
      status: { type: "idle" },
    });
    expect(bus.snapshot("product", { afterSequence: 1 })).toMatchObject({
      generation: bus.generation,
      latestSequence: 2,
      complete: true,
      events: [expect.objectContaining({ sequence: 2 })],
    });
  });

  test("uses a new generation after server restart", () => {
    const first = new PrimaryRuntimeEventBus();
    const second = new PrimaryRuntimeEventBus();
    expect(second.generation).not.toBe(first.generation);
    expect(Number.isSafeInteger(first.generation)).toBe(true);
    expect(Number.isSafeInteger(second.generation)).toBe(true);
  });

  test("marks replay incomplete after the bounded ring evicts events", () => {
    const bus = new PrimaryRuntimeEventBus();
    bus.bindNativeSession("opencode", "native", "product");
    for (let index = 0; index < 513; index += 1) {
      bus.emitForNative("opencode", "native", {
        kind: "session.status",
        status: { type: index % 2 ? "busy" : "idle" },
      });
    }
    expect(bus.snapshot("product", { afterSequence: 0 })).toMatchObject({
      latestSequence: 513,
      complete: false,
    });
    expect(bus.snapshot("product", { afterSequence: 1 })).toMatchObject({
      complete: true,
    });
  });
});
