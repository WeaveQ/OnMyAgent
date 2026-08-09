import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEVICES_EMPTY_STATE_ASSET,
  EMPTY_STATE_ILLUSTRATION_CLASS,
  NO_EXPERT_CONVERSATIONS_ASSET,
  PROJECTS_PLACEHOLDER_ASSET,
} from "../src/react-app/domains/session/empty-state-assets";

const root = resolve(import.meta.dir, "../../..");

function publicPath(asset: string) {
  return resolve(root, "apps/app/public", asset.replace(/^\//, ""));
}

describe("empty-state Koboyo local illustrations", () => {
  test("exports three local illustration paths under /illustrations/koboyo/", () => {
    const assets = [
      NO_EXPERT_CONVERSATIONS_ASSET,
      PROJECTS_PLACEHOLDER_ASSET,
      DEVICES_EMPTY_STATE_ASSET,
    ];
    expect(new Set(assets).size).toBe(3);
    for (const asset of assets) {
      expect(asset.startsWith("/illustrations/koboyo/")).toBe(true);
      expect(asset.endsWith(".svg")).toBe(true);
      const full = publicPath(asset);
      expect(existsSync(full), full).toBe(true);
      // Small monochrome SVGs, not multi-hundred-KB rasters.
      expect(statSync(full).size).toBeLessThan(20_000);
      const svg = readFileSync(full, "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain("currentColor");
      expect(svg).toContain("viewBox");
    }
  });

  test("shared layout class is height-driven (not square-forced)", () => {
    expect(EMPTY_STATE_ILLUSTRATION_CLASS).toContain("h-");
    expect(EMPTY_STATE_ILLUSTRATION_CLASS).toContain("w-auto");
    expect(EMPTY_STATE_ILLUSTRATION_CLASS).not.toContain("object-cover");
    expect(EMPTY_STATE_ILLUSTRATION_CLASS).not.toMatch(/\bsize-\[/);
  });

  test("live consumers import the shared asset constants", () => {
    const files = [
      "apps/app/src/react-app/domains/session/pages/expert-page-utils.ts",
      "apps/app/src/react-app/domains/session/pages/expert.tsx",
      "apps/app/src/react-app/domains/session/chat/session-page-light-pages.tsx",
      "apps/app/src/react-app/domains/session/components/side-panel-pages.tsx",
      "apps/app/src/react-app/domains/session/components/feature-preview-placeholder.tsx",
    ];
    for (const rel of files) {
      const src = readFileSync(resolve(root, rel), "utf8");
      if (rel.endsWith("expert-page-utils.ts")) {
        expect(src).toContain("empty-state-assets");
        expect(src).toContain("NO_EXPERT_CONVERSATIONS_ASSET");
        continue;
      }
      if (rel.endsWith("feature-preview-placeholder.tsx")) {
        expect(src).toContain("DEVICES_EMPTY_STATE_ASSET");
        expect(src).toContain("EMPTY_STATE_ILLUSTRATION_CLASS");
        continue;
      }
      if (rel.includes("light-pages") || rel.includes("side-panel-pages")) {
        expect(src).toContain("PROJECTS_PLACEHOLDER_ASSET");
        expect(src).toContain("EMPTY_STATE_ILLUSTRATION_CLASS");
        expect(src).not.toContain("projects-placeholder.jpg");
        continue;
      }
      if (rel.endsWith("expert.tsx")) {
        expect(src).toContain("NO_EXPERT_CONVERSATIONS_ASSET");
        expect(src).toContain("EMPTY_STATE_ILLUSTRATION_CLASS");
        expect(src).not.toContain("no-expert-conversations.png");
      }
    }
  });
});
