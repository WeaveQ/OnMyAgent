import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

/**
 * Coach chrome and form tab bar must share the same header height so the
 * dual-pane tops align (user complaint: coach header taller than right tabs).
 */
describe("expert creation dual-pane header align", () => {
  test("coach surface and form tabs use h-14 chrome", () => {
    const coach = read(
      "src/react-app/domains/session/pages/expert-creation-coach-surface.tsx",
    );
    const page = read(
      "src/react-app/domains/agents/expert-creation-page.tsx",
    ) + read(
      "src/react-app/domains/agents/expert-creation-coach-preview.tsx",
    );

    expect(coach).toContain("flex h-14 shrink-0 items-center");
    expect(coach).toContain("size-8 shrink-0 rounded-full");
    expect(coach).not.toContain("size-10 shrink-0 rounded-full");
    expect(coach).not.toContain("pb-3.5");

    expect(page).toContain(
      "grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center",
    );
    // Fallback coach path (no SessionSurface inject) also h-14.
    expect(page).toMatch(/hideHeader/);
  });
});
