/**
 * Capability shelf registry — single config for where product capabilities appear.
 * UI (plugins recommended grid, composer connectors, marketplace) should read this
 * instead of hard-coding recommended vs built-in placement.
 *
 * Product matrix: docs/design/2026-08-09-capability-shelf.md
 * Pointer: docs/Architecture.md Session / Expert / cold-path (skills / OfficeCLI row)
 */

export type CapabilityKind =
  | "builtin-docs"
  | "officecli"
  | "connector"
  | "skill"
  | "managed-cli";

export type ShelfSurface =
  | "settings"
  | "plugins"
  | "composer"
  | "session"
  | "marketplace";

export type CapabilityShelfEntry = {
  id: string;
  kind: CapabilityKind;
  surfaces: readonly ShelfSurface[];
  /** Shown in plugins “recommended” / composer connected recommended. */
  recommended: boolean;
};

/**
 * Canonical placement matrix. Add new managed CLIs / connectors here first.
 */
export const CAPABILITY_SHELF: readonly CapabilityShelfEntry[] = [
  {
    id: "builtin-documents",
    kind: "builtin-docs",
    surfaces: ["session", "settings"],
    recommended: false,
  },
  {
    id: "knowledge-search",
    kind: "connector",
    surfaces: ["plugins", "composer", "session"],
    recommended: false,
  },
  {
    id: "officecli",
    kind: "officecli",
    surfaces: ["plugins", "composer", "marketplace", "session"],
    recommended: true,
  },
  {
    id: "lark-cli",
    kind: "managed-cli",
    surfaces: ["plugins", "composer"],
    recommended: true,
  },
  {
    id: "tencent-docs",
    kind: "connector",
    surfaces: ["plugins", "composer"],
    recommended: true,
  },
  {
    id: "baidu-drive",
    kind: "connector",
    surfaces: ["plugins", "composer"],
    recommended: true,
  },
  {
    id: "kdocs",
    kind: "connector",
    surfaces: ["plugins", "composer"],
    recommended: true,
  },
  {
    id: "dingtalk",
    kind: "connector",
    surfaces: ["plugins", "composer"],
    recommended: true,
  },
  {
    id: "wecom",
    kind: "connector",
    surfaces: ["plugins", "composer"],
    recommended: true,
  },
  {
    id: "tencent-meeting",
    kind: "connector",
    surfaces: ["plugins", "composer"],
    recommended: true,
  },
  {
    id: "skill",
    kind: "skill",
    surfaces: ["marketplace", "session", "plugins"],
    recommended: false,
  },
] as const;

export function shelfEntriesForSurface(
  surface: ShelfSurface,
): CapabilityShelfEntry[] {
  return CAPABILITY_SHELF.filter((entry) => entry.surfaces.includes(surface));
}

export function recommendedIdsForSurface(surface: ShelfSurface): string[] {
  return shelfEntriesForSurface(surface)
    .filter((entry) => entry.recommended)
    .map((entry) => entry.id);
}

export function isRecommendedOnSurface(
  id: string,
  surface: ShelfSurface,
): boolean {
  return recommendedIdsForSurface(surface).includes(id);
}

/** Ordered recommended connector/CLI ids for plugins + composer grids. */
export function recommendedManagedConnectorIds(): string[] {
  return recommendedIdsForSurface("plugins").filter(
    (id) => id !== "builtin-documents" && id !== "skill",
  );
}

export function shelfEntryById(id: string): CapabilityShelfEntry | undefined {
  return CAPABILITY_SHELF.find((entry) => entry.id === id);
}
