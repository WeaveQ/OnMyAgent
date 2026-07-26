/**
 * Pure policy for when TanStack Virtual should attach measureElement during
 * transcript streaming vs idle scroll.
 *
 * Product rule:
 * - While streaming: only measure the active turn index (live row). Historical
 *   virtual rows keep estimates to avoid per-token remeasure storms.
 * - On stream end: batch-measure is allowed (caller remeasures once).
 * - While the user is actively scrolling (and not streaming): skip measure.
 */

export type VirtualMeasurePolicyInput = {
  isStreaming: boolean;
  /** True when mid-gesture scroll should block measure (idle only). */
  scrollBlocksMeasure: boolean;
  /**
   * Index within the virtual item list for the active / live turn.
   * `null` when the active turn is detached (normal-flow tail) so no virtual
   * row is the live turn.
   */
  activeTurnVirtualIndex: number | null;
  /** Index of the virtual row currently being considered for measure. */
  virtualIndex: number;
};

export type VirtualMeasurePolicy = {
  /** Whether measureElement should be attached for this virtual row. */
  shouldMeasure: boolean;
  /**
   * When true, the list should run a one-shot batch remeasure (stream just
   * ended). Callers track streaming edges themselves.
   */
  preferBatchRemeasure: boolean;
  /** Convenience: only the active turn should be live-measured. */
  measureActiveTurnOnly: boolean;
};

/**
 * Resolve measure behavior for a single virtual row.
 */
export function resolveVirtualRowMeasurePolicy(
  input: VirtualMeasurePolicyInput,
): VirtualMeasurePolicy {
  const measureActiveTurnOnly = input.isStreaming;
  const preferBatchRemeasure = !input.isStreaming;

  if (input.isStreaming) {
    const active = input.activeTurnVirtualIndex;
    const shouldMeasure =
      active !== null && input.virtualIndex === active;
    return {
      shouldMeasure,
      preferBatchRemeasure: false,
      measureActiveTurnOnly: true,
    };
  }

  if (input.scrollBlocksMeasure) {
    return {
      shouldMeasure: false,
      preferBatchRemeasure: true,
      measureActiveTurnOnly: false,
    };
  }

  return {
    shouldMeasure: true,
    preferBatchRemeasure,
    measureActiveTurnOnly: false,
  };
}

/**
 * List-level: whether any virtual row may attach measureElement.
 * Historical rows during streaming return false from the per-row helper even
 * when this is true (active-only path).
 */
export function shouldAttachVirtualMeasure(input: {
  isStreaming: boolean;
  scrollBlocksMeasure: boolean;
}): boolean {
  if (input.isStreaming) return true;
  return !input.scrollBlocksMeasure;
}

/**
 * When streaming ends, prefer a single batch remeasure over continuous
 * per-row work during the stream.
 */
export function shouldBatchRemeasureOnStreamEnd(input: {
  wasStreaming: boolean;
  isStreaming: boolean;
}): boolean {
  return input.wasStreaming && !input.isStreaming;
}

/**
 * Active turn index inside the virtual window.
 * Detached tail lives outside the virtualizer → return null so historical
 * virtual rows are not measured while streaming.
 */
export function resolveActiveTurnVirtualIndex(input: {
  detachedTail: boolean;
  virtualItemCount: number;
}): number | null {
  if (input.detachedTail) return null;
  if (input.virtualItemCount <= 0) return null;
  return input.virtualItemCount - 1;
}
