import { describe, expect, test } from "bun:test";

import {
  CAPABILITY_SHELF,
  isRecommendedOnSurface,
  recommendedManagedConnectorIds,
  shelfEntriesForSurface,
  shelfEntryById,
} from "../src/react-app/domains/plugins/capability-shelf";
import { orderedRecommendedCatalogEntries } from "../src/react-app/domains/plugins/managed-desktop-connectors";

describe("capability-shelf registry (shipped)", () => {
  test("matrix covers built-in docs, officecli, connectors, skills", () => {
    const kinds = new Set(CAPABILITY_SHELF.map((e) => e.kind));
    expect(kinds.has("builtin-docs")).toBe(true);
    expect(kinds.has("officecli")).toBe(true);
    expect(kinds.has("connector")).toBe(true);
    expect(kinds.has("skill")).toBe(true);
    expect(kinds.has("managed-cli")).toBe(true);
  });

  test("officecli is recommended on plugins and composer", () => {
    expect(isRecommendedOnSurface("officecli", "plugins")).toBe(true);
    expect(isRecommendedOnSurface("officecli", "composer")).toBe(true);
    expect(isRecommendedOnSurface("builtin-documents", "plugins")).toBe(false);
    expect(shelfEntryById("officecli")?.surfaces.includes("marketplace")).toBe(
      true,
    );
  });

  test("recommended managed ids drive connector catalog order", () => {
    const ids = recommendedManagedConnectorIds();
    expect(ids.includes("officecli")).toBe(true);
    expect(ids.includes("lark-cli")).toBe(true);

    const ordered = orderedRecommendedCatalogEntries();
    const orderedIds = ordered.map((e) => e.id);
    // Every catalog row must be a shelf-recommended id; order follows shelf.
    for (const id of orderedIds) {
      expect(ids.includes(id)).toBe(true);
    }
    expect(orderedIds[0]).toBe(ids.find((id) => orderedIds.includes(id)));
  });

  test("plugins surface lists recommended connectors only for shelf filter", () => {
    const plugins = shelfEntriesForSurface("plugins").filter((e) => e.recommended);
    expect(plugins.some((e) => e.id === "officecli")).toBe(true);
    expect(plugins.some((e) => e.kind === "builtin-docs")).toBe(false);
  });
});
