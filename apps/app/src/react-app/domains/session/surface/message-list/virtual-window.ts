/** Pure helpers for SessionTranscript virtualization windowing. */

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
