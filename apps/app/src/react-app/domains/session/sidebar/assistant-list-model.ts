/**
 * Pure view-model for the assistant sidebar list.
 * Keeps pin / space / recent rules in one place so the panel + sections stay thin.
 *
 * Rules (product):
 * - Global pins: non-space sessions + folders (ordered). Space sessions never
 *   enter global session pins — they pin inside their folder only.
 * - Spaces: folders not in global pins; sessions inside sorted by local pins.
 * - Recent: unpinned non-space sessions by recency (single list, no separate tasks).
 */
import type { AgentConversationGroup } from "./conversation-model";
import {
  applySpaceFolderOrder,
  sortGroupsByPinnedSessionIds,
  type AssistantGlobalPin,
} from "./conversation-model";

export type AssistantSpaceFolder = {
  directory: string;
  name: string;
  items: AgentConversationGroup[];
  localPinnedSessionIds: string[];
};

export type AssistantListModel = {
  globalPins: AssistantGlobalPin[];
  /** sessionId → group for resolving global pin session rows. */
  groupsBySessionId: Map<string, AgentConversationGroup>;
  /** directory → sessions (all space folders, incl. globally pinned). */
  spaceItemsByDirectory: Map<string, AgentConversationGroup[]>;
  /** Folders shown under Spaces (excludes globally pinned folders). */
  spaceFolders: AssistantSpaceFolder[];
  /** Unpinned, non-space sessions (recency). */
  recentGroups: AgentConversationGroup[];
  folderPathBySessionId: Map<string, string>;
  spaceLocalPinsByDirectory: Record<string, string[]>;
};

function sessionTime(group: AgentConversationGroup): number {
  return (
    group.latestSession.time?.updated ??
    group.latestSession.time?.created ??
    0
  );
}

function directoryName(directory: string): string {
  return (
    directory
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean)
      .pop() ?? directory
  );
}

export function buildAssistantListModel(input: {
  groups: AgentConversationGroup[];
  globalPins: AssistantGlobalPin[];
  spaceLocalPinsByDirectory: Record<string, string[]>;
  spaceFolderOrder: string[];
  /** sessionId → project directory binding. */
  workspaceBySessionId: Map<string, { directory: string }>;
}): AssistantListModel {
  const groupsBySessionId = new Map(
    input.groups.map((group) => [group.latestSession.id, group]),
  );

  const folderPathBySessionId = new Map<string, string>();
  for (const [sessionId, record] of input.workspaceBySessionId) {
    const dir = record.directory?.trim();
    if (dir) folderPathBySessionId.set(sessionId, dir);
  }

  const globalSessionPinIds = new Set(
    input.globalPins
      .filter((pin) => pin.kind === "session")
      .map((pin) => pin.id),
  );
  const pinnedFolderIds = new Set(
    input.globalPins
      .filter((pin) => pin.kind === "folder")
      .map((pin) => pin.id),
  );

  // Group every space-bound session by directory.
  const spaceItemsByDirectory = new Map<string, AgentConversationGroup[]>();
  for (const group of input.groups) {
    const dir = folderPathBySessionId.get(group.latestSession.id);
    if (!dir) continue;
    const list = spaceItemsByDirectory.get(dir) ?? [];
    list.push(group);
    spaceItemsByDirectory.set(dir, list);
  }

  // Apply local pin order inside each folder.
  for (const [dir, items] of spaceItemsByDirectory) {
    const localPins =
      input.spaceLocalPinsByDirectory[dir] ?? [];
    spaceItemsByDirectory.set(
      dir,
      sortGroupsByPinnedSessionIds(items, localPins),
    );
  }

  const orderedSpaceEntries = applySpaceFolderOrder(
    Array.from(spaceItemsByDirectory.entries()),
    input.spaceFolderOrder,
  );

  const spaceFolders: AssistantSpaceFolder[] = orderedSpaceEntries
    .filter(([directory]) => !pinnedFolderIds.has(directory))
    .map(([directory, items]) => ({
      directory,
      name: directoryName(directory),
      items,
      localPinnedSessionIds: input.spaceLocalPinsByDirectory[directory] ?? [],
    }));

  // Recent = not globally session-pinned, not space-bound.
  const recentGroups = input.groups
    .filter((group) => {
      const id = group.latestSession.id;
      if (globalSessionPinIds.has(id)) return false;
      if (folderPathBySessionId.has(id)) return false;
      return true;
    })
    .sort((left, right) => sessionTime(right) - sessionTime(left));

  return {
    globalPins: input.globalPins,
    groupsBySessionId,
    spaceItemsByDirectory,
    spaceFolders,
    recentGroups,
    folderPathBySessionId,
    spaceLocalPinsByDirectory: input.spaceLocalPinsByDirectory,
  };
}

export function reorderList<T>(list: T[], from: number, to: number): T[] {
  if (
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length ||
    from === to
  ) {
    return list;
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return list;
  next.splice(to, 0, moved);
  return next;
}

/** Drop slot (0..n) → target index after removing `from`. */
export function dropSlotToIndex(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}

export function resolveDropSlot(
  clientY: number,
  rowTop: number,
  rowHeight: number,
  rowIndex: number,
  count: number,
): number {
  const before = clientY < rowTop + rowHeight / 2;
  const slot = before ? rowIndex : rowIndex + 1;
  return Math.max(0, Math.min(count, slot));
}
