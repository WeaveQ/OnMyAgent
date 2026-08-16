import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getBuiltInOnMyAgentExtensionManifests } from "../src/app/extensions";
import { ONMYAGENT_EXTENSION_CATALOG } from "../src/app/constants";
import { isRecommendedOnSurface, shelfEntryById } from "../src/react-app/domains/plugins/capability-shelf";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("knowledge-search built-in connector", () => {
  test("ships as a trusted built-in extension, not a recommended market card", () => {
    const manifest = getBuiltInOnMyAgentExtensionManifests().find(
      (item) => item.id === "knowledge-search",
    );
    expect(manifest).toBeTruthy();
    expect(manifest?.source.origin).toBe("builtin");
    expect(manifest?.source.trusted).toBe(true);
    expect(manifest?.defaultEnabled).toBe(true);
    expect(manifest?.resources.some((item) => item.type === "opencode-plugin")).toBe(true);

    const catalog = ONMYAGENT_EXTENSION_CATALOG.find((item) => item.id === "knowledge-search");
    expect(catalog).toBeTruthy();
    expect(catalog?.kind).toBe("extension");

    const shelf = shelfEntryById("knowledge-search");
    expect(shelf?.kind).toBe("connector");
    expect(shelf?.recommended).toBe(false);
    expect(shelf?.surfaces.includes("plugins")).toBe(true);
    expect(isRecommendedOnSurface("knowledge-search", "plugins")).toBe(false);
  });

  test("builtin connector grid lists knowledge-search with computer-use and browser-skill", () => {
    const page = readFileSync(
      join(root, "src/react-app/domains/plugins/plugins-page.tsx"),
      "utf8",
    );
    expect(page).toContain('"knowledge-search"');
    const constants = readFileSync(join(root, "src/app/constants.ts"), "utf8");
    expect(constants).toContain('"knowledge-search"');
  });
});
