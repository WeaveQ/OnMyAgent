/** Pure helpers for SessionTranscript virtualization windowing. */

import type { CSSProperties } from "react";

export const TRANSCRIPT_VIRTUALIZATION_THRESHOLD = 20;
export const TRANSCRIPT_VIRTUAL_OVERSCAN = 4;

export function shouldVirtualizeTranscript(
  renderItemCount: number,
  messageBlockCount: number,
  threshold: number = TRANSCRIPT_VIRTUALIZATION_THRESHOLD,
): boolean {
  return renderItemCount >= threshold || messageBlockCount >= threshold;
}

export function selectVirtualRenderWindow<T>(
  renderItems: readonly T[],
  shouldVirtualize: boolean,
): {
  virtualItems: readonly T[];
  detachedTail: T | null;
  detachedIndex: number;
} {
  if (!shouldVirtualize || renderItems.length === 0) {
    return { virtualItems: renderItems, detachedTail: null, detachedIndex: -1 };
  }
  const detachedIndex = renderItems.length - 1;
  return {
    virtualItems: renderItems.slice(0, detachedIndex),
    detachedTail: renderItems[detachedIndex] ?? null,
    detachedIndex,
  };
}

export function resolveVirtualItemKey<T extends { id?: string }>(
  virtualItems: readonly T[],
  index: number,
): string {
  return virtualItems[index]?.id ?? `item-${index}`;
}

/**
 * Reserve nearly one viewport for the *live* turn so sticky-bottom stays stable
 * while the assistant streams. Content must sit at the **bottom** of that box
 * (flex-end); otherwise sticky-bottom shows the empty padding and users must
 * scroll through a huge blank region to find the new messages.
 *
 * Never apply this to historical virtualized rows — only the live tail.
 */
export function activeTurnReserveStyle(input: {
  isActiveTurn: boolean;
  isNestedVariant: boolean;
  /** When virtualizing, only the detached newest row may reserve height. */
  isDetachedTail: boolean;
  minHeightPx: number;
}): CSSProperties | undefined {
  if (
    !input.isActiveTurn ||
    input.isNestedVariant ||
    !input.isDetachedTail ||
    input.minHeightPx <= 0
  ) {
    return undefined;
  }
  return {
    minHeight: `${input.minHeightPx}px`,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
  };
}
