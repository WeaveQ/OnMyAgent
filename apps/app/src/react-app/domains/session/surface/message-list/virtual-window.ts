/** Pure helpers for SessionTranscript virtualization windowing. */

import type { CSSProperties } from "react";

export const TRANSCRIPT_VIRTUALIZATION_THRESHOLD = 20;
export const TRANSCRIPT_VIRTUAL_OVERSCAN = 4;

export function shouldVirtualizeTranscript(
  renderItemCount: number,
  messageBlockCount: number,
  threshold: number = TRANSCRIPT_VIRTUALIZATION_THRESHOLD,
  enabled: boolean = true,
): boolean {
  if (!enabled) return false;
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

export function resolveVirtualItemEstimate<T extends { id: string }>(
  item: T | undefined,
  measuredSizes: ReadonlyMap<string, number>,
  estimate: (item: T | undefined) => number,
): number {
  if (!item) return estimate(item);
  return measuredSizes.get(item.id) ?? estimate(item);
}

/**
 * Spacer padding for a flow-based virtual window.
 *
 * Prefer padding + normal flow over `height: totalSize` + absolute children.
 * When estimates under-measure tool-heavy turns, absolute content overflows
 * the fixed shell and paints on top of the detached live tail (stacked/
 * garbled transcript). Flow keeps natural heights so siblings cannot overlap.
 */
export function resolveVirtualWindowPadding(input: {
  totalSize: number;
  firstStart: number | undefined;
  lastEnd: number | undefined;
}): { paddingTop: number; paddingBottom: number } {
  const paddingTop = Math.max(0, input.firstStart ?? 0);
  if (input.lastEnd == null) {
    return { paddingTop, paddingBottom: 0 };
  }
  return {
    paddingTop,
    paddingBottom: Math.max(0, input.totalSize - input.lastEnd),
  };
}

export function shouldRemeasureVirtualHistory(input: {
  previousCount: number;
  currentCount: number;
  shouldVirtualize: boolean;
}): boolean {
  return input.shouldVirtualize && input.previousCount !== input.currentCount;
}

/**
 * Previously reserved ~1 viewport of minHeight on the live turn. That made
 * sticky-bottom land in empty padding (or, with flex-end, left a full-screen
 * blank above the first reply). Sticky follow alone is enough — do not invent
 * extra height on turns.
 */
export function activeTurnReserveStyle(_input: {
  isActiveTurn: boolean;
  isNestedVariant: boolean;
  isDetachedTail: boolean;
  minHeightPx: number;
}): CSSProperties | undefined {
  return undefined;
}
