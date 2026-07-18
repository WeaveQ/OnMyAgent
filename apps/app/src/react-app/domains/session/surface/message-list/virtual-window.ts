/**
 * Pure virtualization window helpers for the session transcript list.
 *
 * Kept free of React so unit tests and the real SessionTranscript surface
 * share one shipped implementation.
 */

/** Start virtualizing once the list is large enough that eager DOM hurts. */
export const TRANSCRIPT_VIRTUALIZATION_THRESHOLD = 20;

/** Extra rows to keep mounted above/below the viewport. */
export const TRANSCRIPT_VIRTUAL_OVERSCAN = 4;

export function shouldVirtualizeTranscript(
  renderItemCount: number,
  messageBlockCount: number,
  threshold: number = TRANSCRIPT_VIRTUALIZATION_THRESHOLD,
): boolean {
  return renderItemCount >= threshold || messageBlockCount >= threshold;
}

export type VirtualRenderWindow<T> = {
  /** Items owned by the virtualizer (excludes detached tail when present). */
  virtualItems: T[];
  /** Newest item kept in normal document flow while virtualizing. */
  detachedTail: T | null;
  /** Index of detachedTail in the full list, or -1. */
  detachedIndex: number;
};

/**
 * Split a render list into the virtualizer-owned prefix and an optional
 * detached newest row (avoids re-measure jank when the live tail grows).
 */
export function selectVirtualRenderWindow<T>(
  items: readonly T[],
  virtualize: boolean,
): VirtualRenderWindow<T> {
  if (!virtualize || items.length === 0) {
    return {
      virtualItems: items.slice(),
      detachedTail: null,
      detachedIndex: -1,
    };
  }
  const detachedIndex = items.length - 1;
  return {
    virtualItems: items.slice(0, detachedIndex),
    detachedTail: items[detachedIndex] ?? null,
    detachedIndex,
  };
}

/** Stable TanStack Virtual getItemKey helper. */
export function resolveVirtualItemKey(
  items: ReadonlyArray<{ id: string }>,
  index: number,
): string {
  return items[index]?.id ?? `item-${index}`;
}
