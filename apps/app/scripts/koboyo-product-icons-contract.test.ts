import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  ARTIFACT_PLUGIN_KOBOYO_BY_ID,
  BUILTIN_EXTENSION_KOBOYO_BY_ID,
  BUILTIN_PLUGIN_ICON_PNG_BY_ID,
  KOBOYO_BROWSER_WINDOW,
  KOBOYO_CLICK_CURSOR,
  KOBOYO_COMPASS,
  KOBOYO_FILE_SPREADSHEET,
  KOBOYO_PDF_BOOKMARK,
  KOBOYO_WORD_DOCUMENT,
} from "../src/react-app/design-system/koboyo-product-icons";

const root = resolve(import.meta.dir, "../../..");

function publicPath(asset: string) {
  return resolve(root, "apps/app/public", asset.replace(/^\//, ""));
}

const LEGACY_KOBOYO_ASSETS = [
  KOBOYO_CLICK_CURSOR,
  KOBOYO_COMPASS,
  KOBOYO_BROWSER_WINDOW,
  KOBOYO_WORD_DOCUMENT,
  KOBOYO_FILE_SPREADSHEET,
  KOBOYO_PDF_BOOKMARK,
] as const;

const PRODUCT_PNG_IDS = [
  "computer-use",
  "browser-skill",
  "browser",
  "documents",
  "pdf",
  "spreadsheets",
] as const;

describe("Builtin product icons (PNG app marks + legacy Koboyo glyphs)", () => {
  test("soft-UI PNG icons exist for all six built-ins", () => {
    for (const id of PRODUCT_PNG_IDS) {
      const asset = BUILTIN_PLUGIN_ICON_PNG_BY_ID[id];
      expect(asset, id).toBeTruthy();
      expect(asset.startsWith("/connector-icons/builtin/")).toBe(true);
      expect(asset.endsWith(".png")).toBe(true);
      const full = publicPath(asset);
      expect(existsSync(full), full).toBe(true);
      expect(statSync(full).size).toBeGreaterThan(5_000);
      expect(statSync(full).size).toBeLessThan(200_000);
    }
  });

  test("legacy Koboyo SVGs remain available as monochrome fallbacks", () => {
    for (const asset of LEGACY_KOBOYO_ASSETS) {
      const full = publicPath(asset);
      expect(existsSync(full), full).toBe(true);
      const svg = readFileSync(full, "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain("currentColor");
    }
    expect(BUILTIN_EXTENSION_KOBOYO_BY_ID["computer-use"]).toBe(
      KOBOYO_CLICK_CURSOR,
    );
    expect(ARTIFACT_PLUGIN_KOBOYO_BY_ID.browser).toBe(KOBOYO_BROWSER_WINDOW);
  });

  test("extensionIcon and ArtifactPluginIcon use PNG product map", () => {
    const extensionIcon = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/plugins/extension-icon.tsx",
      ),
      "utf8",
    );
    const artifactDetail = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/plugins/artifact-plugin-detail.tsx",
      ),
      "utf8",
    );

    expect(extensionIcon).toContain("BUILTIN_PLUGIN_ICON_PNG_BY_ID");
    expect(extensionIcon).not.toMatch(/MousePointerClick/);
    expect(extensionIcon).not.toMatch(/Compass/);

    expect(artifactDetail).toContain("BUILTIN_PLUGIN_ICON_PNG_BY_ID");
    expect(artifactDetail).not.toMatch(/AppWindow/);
    expect(artifactDetail).not.toMatch(/FileSpreadsheet/);
    expect(artifactDetail).not.toMatch(/FileType/);
  });

  test("KoboyoIcon still paints via CSS mask (theme-safe chrome)", () => {
    const icon = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/design-system/koboyo-icon.tsx",
      ),
      "utf8",
    );
    expect(icon).toContain("mask-image");
    expect(icon).toContain("-webkit-mask-image");
    expect(icon).toContain("bg-current");
    expect(icon).toMatch(/return\s*\(\s*<span/);
    expect(icon).not.toMatch(/return\s*\(\s*<img/);
  });
});
