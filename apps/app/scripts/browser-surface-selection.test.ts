import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  recommendBrowserSurface,
  type BrowserSurfaceId,
} from "../src/react-app/domains/plugins/browser-surface-selection";

const repoRoot = join(import.meta.dir, "../../..");

const BUNDLED_SKILL_PATHS = [
  "apps/desktop/resources/bundled-skills/browser-automation/SKILL.md",
  "apps/desktop/resources/bundled-skills/browser-skill/SKILL.md",
  "apps/desktop/resources/bundled-skills/computer-use/SKILL.md",
] as const;

/** Shared anchor phrase required in all three selection sections. */
const SURFACE_ANCHOR = "Choose the right surface";

describe("recommendBrowserSurface", () => {
  test("defaults to in-app browser-automation", () => {
    expect(recommendBrowserSurface()).toBe("browser-automation");
    expect(recommendBrowserSurface({})).toBe("browser-automation");
    expect(
      recommendBrowserSurface({ wantsInAppPreview: true }),
    ).toBe("browser-automation");
  });

  test("real browser logins → browser-skill", () => {
    expect(
      recommendBrowserSurface({ needsRealBrowserLogins: true }),
    ).toBe("browser-skill");
    expect(
      recommendBrowserSurface({
        needsRealBrowserLogins: true,
        wantsInAppPreview: true,
      }),
    ).toBe("browser-skill");
  });

  test("native app UI → computer-use (wins over logins)", () => {
    expect(
      recommendBrowserSurface({ needsNativeAppUi: true }),
    ).toBe("computer-use");
    expect(
      recommendBrowserSurface({
        needsNativeAppUi: true,
        needsRealBrowserLogins: true,
        wantsInAppPreview: true,
      }),
    ).toBe("computer-use");
  });

  test("returns only known surface ids", () => {
    const cases: Array<Parameters<typeof recommendBrowserSurface>[0]> = [
      undefined,
      {},
      { wantsInAppPreview: true },
      { needsRealBrowserLogins: true },
      { needsNativeAppUi: true },
      {
        needsNativeAppUi: true,
        needsRealBrowserLogins: true,
        wantsInAppPreview: true,
      },
    ];
    const allowed = new Set<BrowserSurfaceId>([
      "browser-automation",
      "browser-skill",
      "computer-use",
    ]);
    for (const intent of cases) {
      expect(allowed.has(recommendBrowserSurface(intent))).toBe(true);
    }
  });
});

describe("bundled skill surface selection copy", () => {
  test('all three SKILL.md files include "Choose the right surface"', () => {
    for (const rel of BUNDLED_SKILL_PATHS) {
      const path = join(repoRoot, rel);
      expect(existsSync(path)).toBe(true);
      const body = readFileSync(path, "utf8");
      expect(body).toContain(SURFACE_ANCHOR);
      // Table rows should name the three surfaces for agents scanning any skill.
      expect(body).toContain("browser-automation");
      expect(body).toContain("browser-skill");
      expect(body).toContain("computer-use");
      expect(body).toMatch(/in-app browser|OnMyAgent in-app browser/i);
      expect(body).toMatch(/bsk|real Chrome\/Edge/i);
      expect(body).toMatch(/native macOS|native app UI/i);
    }
  });

  test("browser-skill skill points doctor setup at Extensions → BrowserSkill", () => {
    const skill = readFileSync(
      join(repoRoot, "apps/desktop/resources/bundled-skills/browser-skill/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("Extensions → BrowserSkill");
  });
});
