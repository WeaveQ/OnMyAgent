import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

/**
 * Regression: office/code selected pill kept vanishing on dark/mac because
 * page code used `bg-white`, which index.css remaps under [data-theme=dark]
 * to translucent --dls-surface. Free-float selected must use NavTab's
 * inverted `bg-dls-text` (no raw bg-white).
 */
describe("assistant category switch pill contract", () => {
  test("uses free-float NavTab API without bg-white overrides", () => {
    const source = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/assistant-sidebar-controls.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("AssistantCategorySwitch");
    expect(source).toContain("density=\"bare\"");
    expect(source).toContain("size=\"tab\"");
    expect(source).toContain("shape=\"tab\"");
    expect(source).toContain("active={active}");
    // No utility white/neutral overrides that dark theme remaps away.
    expect(source).not.toMatch(/className=\{?["'`][^"'`]*bg-white/);
    expect(source).not.toContain("text-neutral-900");
    expect(source).not.toContain("dark:bg-white");
  });
});
