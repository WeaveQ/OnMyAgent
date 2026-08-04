import { describe, expect, test } from "bun:test";

import {
  resolveActiveTurnVirtualIndex,
  resolveVirtualRowMeasurePolicy,
  shouldAttachVirtualMeasure,
  shouldBatchRemeasureOnStreamEnd,
} from "../src/react-app/domains/session/surface/message-list/virtual-measure-policy";

describe("virtual measure policy", () => {
  test("during streaming only measures active turn index", () => {
    const active = resolveVirtualRowMeasurePolicy({
      isStreaming: true,
      scrollBlocksMeasure: false,
      activeTurnVirtualIndex: 4,
      virtualIndex: 4,
    });
    expect(active.shouldMeasure).toBe(true);
    expect(active.measureActiveTurnOnly).toBe(true);

    const historical = resolveVirtualRowMeasurePolicy({
      isStreaming: true,
      scrollBlocksMeasure: false,
      activeTurnVirtualIndex: 4,
      virtualIndex: 1,
    });
    expect(historical.shouldMeasure).toBe(false);
    expect(historical.measureActiveTurnOnly).toBe(true);
  });

  test("detached active turn measures visible history while streaming", () => {
    const policy = resolveVirtualRowMeasurePolicy({
      isStreaming: true,
      scrollBlocksMeasure: false,
      activeTurnVirtualIndex: null,
      virtualIndex: 3,
    });
    expect(policy.shouldMeasure).toBe(true);
    expect(policy.measureActiveTurnOnly).toBe(false);
  });

  test("idle measures all rows unless scroll blocks", () => {
    expect(
      resolveVirtualRowMeasurePolicy({
        isStreaming: false,
        scrollBlocksMeasure: false,
        activeTurnVirtualIndex: null,
        virtualIndex: 0,
      }).shouldMeasure,
    ).toBe(true);
    expect(
      resolveVirtualRowMeasurePolicy({
        isStreaming: false,
        scrollBlocksMeasure: true,
        activeTurnVirtualIndex: null,
        virtualIndex: 0,
      }).shouldMeasure,
    ).toBe(false);
  });

  test("list-level attach: streaming always, idle respects scroll block", () => {
    expect(
      shouldAttachVirtualMeasure({
        isStreaming: true,
        scrollBlocksMeasure: true,
      }),
    ).toBe(true);
    expect(
      shouldAttachVirtualMeasure({
        isStreaming: false,
        scrollBlocksMeasure: true,
      }),
    ).toBe(false);
    expect(
      shouldAttachVirtualMeasure({
        isStreaming: false,
        scrollBlocksMeasure: false,
      }),
    ).toBe(true);
  });

  test("preserves measurements when a detached tail finishes streaming", () => {
    expect(
      shouldBatchRemeasureOnStreamEnd({
        wasStreaming: true,
        isStreaming: false,
        hasDetachedTail: true,
      }),
    ).toBe(false);
    expect(
      shouldBatchRemeasureOnStreamEnd({
        wasStreaming: true,
        isStreaming: false,
        hasDetachedTail: false,
      }),
    ).toBe(true);
    expect(
      shouldBatchRemeasureOnStreamEnd({
        wasStreaming: false,
        isStreaming: false,
        hasDetachedTail: false,
      }),
    ).toBe(false);
    expect(
      shouldBatchRemeasureOnStreamEnd({
        wasStreaming: true,
        isStreaming: true,
        hasDetachedTail: false,
      }),
    ).toBe(false);
  });

  test("active turn virtual index is last item unless detached", () => {
    expect(
      resolveActiveTurnVirtualIndex({
        detachedTail: true,
        virtualItemCount: 10,
      }),
    ).toBeNull();
    expect(
      resolveActiveTurnVirtualIndex({
        detachedTail: false,
        virtualItemCount: 5,
      }),
    ).toBe(4);
    expect(
      resolveActiveTurnVirtualIndex({
        detachedTail: false,
        virtualItemCount: 0,
      }),
    ).toBeNull();
  });
});
