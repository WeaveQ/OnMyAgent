/** Persist user-pinned skills for the composer tool menu (local-only). */

const STORAGE_KEY = "onmyagent.composer.pinned-skills.v1";
const MAX_PINNED = 24;

export function readPinnedSkillIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim())
      .slice(0, MAX_PINNED);
  } catch {
    return [];
  }
}

export function writePinnedSkillIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const next = Array.from(
      new Set(ids.map((id) => id.trim()).filter(Boolean)),
    ).slice(0, MAX_PINNED);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — ignore; pin is best-effort UX.
  }
}

export function togglePinnedSkillId(
  ids: string[],
  skillId: string,
): { next: string[]; pinned: boolean } {
  const id = skillId.trim();
  if (!id) return { next: ids, pinned: false };
  if (ids.includes(id)) {
    return { next: ids.filter((item) => item !== id), pinned: false };
  }
  return { next: [id, ...ids.filter((item) => item !== id)].slice(0, MAX_PINNED), pinned: true };
}

/** Stable sort: pinned ids first (in pin order), then remaining items. */
export function sortWithPinnedFirst<T>(
  items: T[],
  pinnedIds: string[],
  getId: (item: T) => string,
): T[] {
  if (!pinnedIds.length || !items.length) return items;
  const rank = new Map(pinnedIds.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index, pin: rank.get(getId(item)) }))
    .sort((a, b) => {
      const aPinned = a.pin !== undefined;
      const bPinned = b.pin !== undefined;
      if (aPinned && bPinned) return (a.pin as number) - (b.pin as number);
      if (aPinned) return -1;
      if (bPinned) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}
