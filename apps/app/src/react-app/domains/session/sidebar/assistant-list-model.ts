/**
 * Pure view-model for the assistant sidebar list.
 * Keeps pin / space / recent / automation rules in one place so the panel stays thin.
 *
 * Rules (product):
 * - Global pins: non-space sessions + folders + automations (ordered). Space
 *   sessions never enter global session pins — they pin inside their folder only.
 * - Pins are category-scoped at display time via `selectVisiblePins`.
 * - Spaces: folders not in *visible* global pins; sessions inside sorted by local pins.
 * - Recent: unpinned non-space sessions by recency.
 */
import { isIsolatedExpertSessionDirectory } from "../../../capabilities/session-identity/expert-session-directory";
import { filterGroupsExcludingArchived } from "../../shared";
import {
  groupAssistantAutomationItems,
  type AssistantAutomationGroup,
} from "./assistant-automation-groups";
import type { AgentConversationGroup } from "./conversation-model";
import {
  applySpaceFolderOrder,
  automationLocalPinScope,
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
  /**
   * Full space-directory order for reorder merge (saved storage order + any
   * newly discovered dirs). Includes globally pinned folders so drag of the
   * visible subset does not scramble pin slots. Never use Map key iteration
   * order here.
   */
  allSpaceDirectories: string[];
};

/**
 * Storage-aware directory order: prefer `spaceFolderOrder`, append unknown
 * known directories. Used as `fullDirectories` for space-folder drag merge.
 */
export function orderedSpaceDirectories(input: {
  knownDirectories: Iterable<string>;
  spaceFolderOrder: readonly string[];
}): string[] {
  const known: string[] = [];
  const seen = new Set<string>();
  for (const raw of [
    ...input.spaceFolderOrder,
    ...input.knownDirectories,
  ]) {
    const dir = raw.trim();
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    known.push(dir);
  }
  return applySpaceFolderOrder(
    known.map((directory) => [directory, true] as [string, boolean]),
    [...input.spaceFolderOrder],
  ).map(([directory]) => directory);
}

export type AssistantAutomationRecordInput = {
  sessionId: string;
  automationId: string;
  title: string;
  category: string;
  createdAt: number;
};

export type AssistantSidebarModel = {
  listModel: AssistantListModel;
  /** Category automations after archive filter + local pin sort (incl. elevated). */
  automationGroupsAll: AssistantAutomationGroup<AgentConversationGroup>[];
  /** Schedules section: excludes groups elevated into global pins. */
  automationGroups: AssistantAutomationGroup<AgentConversationGroup>[];
  /** Non-automation groups after archive filter (feeds list model). */
  regularGroups: AgentConversationGroup[];
  /** Raw automation groups before local-pin sort / archive item filter (hydrate key). */
  automationGroupsRaw: AssistantAutomationGroup<AgentConversationGroup>[];
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

function toAutomationIdSet(
  automationIds?: ReadonlySet<string> | readonly string[],
): Set<string> {
  if (automationIds instanceof Set) return automationIds;
  return new Set(automationIds ?? []);
}

/**
 * Category-visible pin selection: storage stays workspace-global; only pins
 * that resolve in the current category’s groups / automation id set appear.
 */
export function selectVisiblePins(input: {
  globalPins: readonly AssistantGlobalPin[];
  /** sessionId set (or map keys) present in the active category list. */
  sessionIds: ReadonlySet<string> | Iterable<string>;
  /**
   * directory → item count (or items). Folder pin shows only when count > 0
   * in the active category.
   */
  folderSessionCounts: ReadonlyMap<string, number> | Map<string, unknown[]>;
  /** Automation group ids present in the active category. */
  automationIds?: ReadonlySet<string> | readonly string[];
}): AssistantGlobalPin[] {
  const sessionIds =
    input.sessionIds instanceof Set
      ? input.sessionIds
      : new Set(input.sessionIds);
  const automationIdSet = toAutomationIdSet(input.automationIds);

  return input.globalPins.filter((pin) => {
    if (pin.kind === "session") return sessionIds.has(pin.id);
    if (pin.kind === "folder") {
      const value = input.folderSessionCounts.get(pin.id);
      if (value == null) return false;
      if (typeof value === "number") return value > 0;
      return Array.isArray(value) && value.length > 0;
    }
    if (pin.kind === "automation") return automationIdSet.has(pin.id);
    return false;
  });
}

/** Deep-equal for id → ordered sessionId[] pin maps (hydrate bail-out). */
export function localPinMapsEqual(
  left: Record<string, string[]>,
  right: Record<string, string[]>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    const a = left[key];
    const b = right[key];
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
  }
  return true;
}

/**
 * Build automation local-pin map from storage. Pure given `readPins(scope)`.
 */
export function buildAutomationLocalPinsMap(
  automationGroupIds: readonly string[],
  readPins: (scope: string) => string[],
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const id of automationGroupIds) {
    const scope = automationLocalPinScope(id);
    if (!scope) continue;
    next[id] = readPins(scope);
  }
  return next;
}

/**
 * Partition category groups into regular tasks vs automation-run groups (raw).
 */
export function partitionCategoryGroupsForSidebar(input: {
  categoryGroups: AgentConversationGroup[];
  categoryId: string;
  automationRecords: readonly AssistantAutomationRecordInput[];
}): {
  regularGroups: AgentConversationGroup[];
  automationGroupsRaw: AssistantAutomationGroup<AgentConversationGroup>[];
} {
  const recordBySessionId = new Map(
    input.automationRecords.map((record) => [record.sessionId, record]),
  );
  const automationGroupsRaw = groupAssistantAutomationItems(
    input.categoryGroups.flatMap((item) => {
      const record = recordBySessionId.get(item.latestSession.id);
      if (!record || record.category !== input.categoryId) return [];
      return [
        {
          item,
          automationId: record.automationId,
          title: record.title,
          updatedAt:
            item.latestSession.time?.updated ??
            item.latestSession.time?.created ??
            record.createdAt,
        },
      ];
    }),
  );
  const automationSessionIds = new Set(
    input.automationRecords.map((record) => record.sessionId),
  );
  const regularGroups = input.categoryGroups.filter(
    (item) => !automationSessionIds.has(item.latestSession.id),
  );
  return { regularGroups, automationGroupsRaw };
}

export function buildAssistantListModel(input: {
  groups: AgentConversationGroup[];
  globalPins: AssistantGlobalPin[];
  spaceLocalPinsByDirectory: Record<string, string[]>;
  spaceFolderOrder: string[];
  /** sessionId → project directory binding. */
  workspaceBySessionId: Map<string, { directory: string }>;
  /**
   * Automation group ids present in the active category.
   * When omitted, automation pins are hidden from the list model.
   */
  automationIds?: ReadonlySet<string> | readonly string[];
}): AssistantListModel {
  const groupsBySessionId = new Map(
    input.groups.map((group) => [group.latestSession.id, group]),
  );

  const folderPathBySessionId = new Map<string, string>();
  for (const [sessionId, record] of input.workspaceBySessionId) {
    const dir = record.directory?.trim();
    if (dir) folderPathBySessionId.set(sessionId, dir);
  }

  // Group every space-bound session by directory (current category only).
  // Source of truth for 「空间」: only folders that already have tasks.
  // Expert auto-isolation dirs (…/{agent}/{timestamp}/) are session artifact
  // roots — keep them out of Spaces so they do not look like user spaces.
  const spaceItemsByDirectory = new Map<string, AgentConversationGroup[]>();
  for (const group of input.groups) {
    const dir = folderPathBySessionId.get(group.latestSession.id);
    if (!dir || isIsolatedExpertSessionDirectory(dir)) continue;
    const list = spaceItemsByDirectory.get(dir) ?? [];
    list.push(group);
    spaceItemsByDirectory.set(dir, list);
  }

  // Apply local pin order inside each folder.
  for (const [dir, items] of spaceItemsByDirectory) {
    const localPins = input.spaceLocalPinsByDirectory[dir] ?? [];
    spaceItemsByDirectory.set(
      dir,
      sortGroupsByPinnedSessionIds(items, localPins),
    );
  }

  const folderSessionCounts = new Map<string, number>();
  for (const [dir, items] of spaceItemsByDirectory) {
    folderSessionCounts.set(dir, items.length);
  }

  const visibleGlobalPins = selectVisiblePins({
    globalPins: input.globalPins,
    sessionIds: groupsBySessionId.keys(),
    folderSessionCounts,
    automationIds: input.automationIds,
  });

  const globalSessionPinIds = new Set(
    visibleGlobalPins
      .filter((pin) => pin.kind === "session")
      .map((pin) => pin.id),
  );
  // Stored session pins (even other-category) stay out of 最近 when present.
  const storedSessionPinIds = new Set(
    input.globalPins
      .filter((pin) => pin.kind === "session")
      .map((pin) => pin.id),
  );
  const pinnedFolderIds = new Set(
    visibleGlobalPins
      .filter((pin) => pin.kind === "folder")
      .map((pin) => pin.id),
  );

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

  const recentGroups = input.groups
    .filter((group) => {
      const id = group.latestSession.id;
      if (storedSessionPinIds.has(id) || globalSessionPinIds.has(id)) {
        return false;
      }
      if (folderPathBySessionId.has(id)) return false;
      return true;
    })
    .sort((left, right) => sessionTime(right) - sessionTime(left));

  const allSpaceDirectories = orderedSpaceDirectories({
    knownDirectories: spaceItemsByDirectory.keys(),
    spaceFolderOrder: input.spaceFolderOrder,
  });

  return {
    globalPins: visibleGlobalPins,
    groupsBySessionId,
    spaceItemsByDirectory,
    spaceFolders,
    recentGroups,
    folderPathBySessionId,
    spaceLocalPinsByDirectory: input.spaceLocalPinsByDirectory,
    allSpaceDirectories,
  };
}

/**
 * Single sidebar model entry: archive filter, automation local pins, list model,
 * schedules vs elevated pins.
 */
export function buildAssistantSidebarModel(input: {
  categoryGroups: AgentConversationGroup[];
  categoryId: string;
  globalPins: AssistantGlobalPin[];
  spaceLocalPinsByDirectory: Record<string, string[]>;
  spaceFolderOrder: string[];
  workspaceBySessionId: Map<string, { directory: string }>;
  automationRecords: readonly AssistantAutomationRecordInput[];
  archivedIdSet: ReadonlySet<string>;
  automationLocalPinsById: Record<string, string[]>;
}): AssistantSidebarModel {
  const { regularGroups, automationGroupsRaw } =
    partitionCategoryGroupsForSidebar({
      categoryGroups: input.categoryGroups,
      categoryId: input.categoryId,
      automationRecords: input.automationRecords,
    });

  const visibleRegularGroups = filterGroupsExcludingArchived(
    regularGroups,
    input.archivedIdSet,
  );

  const automationGroupsAll = automationGroupsRaw
    .map((group) => {
      const items = filterGroupsExcludingArchived(
        group.items,
        input.archivedIdSet,
      );
      const localPins = input.automationLocalPinsById[group.id] ?? [];
      return {
        ...group,
        items: sortGroupsByPinnedSessionIds(items, localPins),
      };
    })
    .filter((group) => group.items.length > 0);

  const pinnedAutomationIds = new Set(
    input.globalPins
      .filter((pin) => pin.kind === "automation")
      .map((pin) => pin.id),
  );

  const automationGroups = automationGroupsAll.filter(
    (group) => !pinnedAutomationIds.has(group.id),
  );

  const listModel = buildAssistantListModel({
    groups: visibleRegularGroups,
    globalPins: input.globalPins,
    spaceLocalPinsByDirectory: input.spaceLocalPinsByDirectory,
    spaceFolderOrder: input.spaceFolderOrder,
    workspaceBySessionId: input.workspaceBySessionId,
    automationIds: automationGroupsAll.map((group) => group.id),
  });

  return {
    listModel,
    automationGroupsAll,
    automationGroups,
    regularGroups: visibleRegularGroups,
    automationGroupsRaw,
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

/**
 * Reorder a category-visible subset, then stitch back into full storage order
 * so other-category pins keep their relative slots.
 */
export function mergeVisibleReorderIntoFull<T>(input: {
  full: readonly T[];
  visible: readonly T[];
  fromIndex: number;
  toIndex: number;
  keyOf: (item: T) => string;
}): T[] {
  const reorderedVisible = reorderList(
    [...input.visible],
    input.fromIndex,
    input.toIndex,
  );
  if (
    reorderedVisible.length === input.visible.length &&
    reorderedVisible.every((item, i) => item === input.visible[i])
  ) {
    return [...input.full];
  }
  const visibleKey = new Set(input.visible.map(input.keyOf));
  let visibleCursor = 0;
  return input.full.map((item) => {
    if (!visibleKey.has(input.keyOf(item))) return item as T;
    const replacement = reorderedVisible[visibleCursor];
    visibleCursor += 1;
    return (replacement ?? item) as T;
  });
}

/** Pin-key helper for mergeVisibleReorderIntoFull. */
export function globalPinKey(pin: AssistantGlobalPin): string {
  return `${pin.kind}:${pin.id}`;
}

/**
 * Reorder space-folder directories after a drag on the visible (non-global-pin)
 * subset. Globally pinned folders stay in `fullDirectories` and keep relative
 * storage slots via {@link mergeVisibleReorderIntoFull}.
 */
export function reorderSpaceFolderDirectories(input: {
  fullDirectories: readonly string[];
  visibleDirectories: readonly string[];
  fromIndex: number;
  toIndex: number;
}): string[] {
  const fullBase = [...input.fullDirectories];
  const fullSet = new Set(fullBase);
  for (const dir of input.visibleDirectories) {
    if (!fullSet.has(dir)) {
      fullBase.push(dir);
      fullSet.add(dir);
    }
  }
  return mergeVisibleReorderIntoFull({
    full: fullBase,
    visible: input.visibleDirectories,
    fromIndex: input.fromIndex,
    toIndex: input.toIndex,
    keyOf: (directory) => directory,
  });
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
