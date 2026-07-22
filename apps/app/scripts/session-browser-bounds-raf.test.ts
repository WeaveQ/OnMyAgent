import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  shouldRunBrowserBoundsRaf,
  shouldStartBrowserBoundsLoop,
} from "../src/react-app/domains/session/browser/browser-bounds-raf";

describe("browser bounds rAF policy (shipped)", () => {
  test("stops loop when inactive or disposed", () => {
    expect(
      shouldRunBrowserBoundsRaf({ disposed: false, active: true }),
    ).toBe(true);
    expect(
      shouldRunBrowserBoundsRaf({ disposed: false, active: false }),
    ).toBe(false);
    expect(
      shouldRunBrowserBoundsRaf({ disposed: true, active: true }),
    ).toBe(false);
  });

  test("starts loop only when active (covers inactive mount)", () => {
    expect(shouldStartBrowserBoundsLoop(false)).toBe(false);
    expect(shouldStartBrowserBoundsLoop(true)).toBe(true);
  });

  test("EmbeddedBrowserViewport restarts rAF when active becomes true", () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/browser/browser-panel.tsx",
      ),
      "utf8",
    );
    // Uses pure policy for both continue-frame and start-on-effect.
    expect(source).toContain("shouldRunBrowserBoundsRaf");
    expect(source).toContain("shouldStartBrowserBoundsLoop");
    // Effect depends on `active` so false→true remounts the loop.
    const effectIdx = source.indexOf("const watchBounds = () =>");
    expect(effectIdx).toBeGreaterThan(-1);
    const effectTail = source.slice(effectIdx, effectIdx + 1800);
    expect(effectTail).toMatch(/shouldStartBrowserBoundsLoop\(activeRef\.current\)/);
    expect(effectTail).toMatch(/\},\s*\[active\]\s*\);/);
  });
});
