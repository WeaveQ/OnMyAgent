/**
 * Batch-3 hygiene: shared busy/spin helper adopted at refresh icon call sites.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { busySpinClass } from "../src/components/ui/busy-spin";

const appRoot = join(import.meta.dir, "..");

describe("busySpinClass (shipped)", () => {
  test("adds animate-spin only when busy", () => {
    expect(busySpinClass(true)).toContain("animate-spin");
    expect(busySpinClass(false)).not.toContain("animate-spin");
    expect(busySpinClass(true, "size-3.5")).toContain("size-3.5");
    expect(busySpinClass(true, "size-3.5")).toContain("animate-spin");
  });
});

describe("busySpinClass call-site adoption", () => {
  test("at least two former hand-rolled refresh sites use busySpinClass", () => {
    const browser = readFileSync(
      join(appRoot, "src/react-app/domains/settings/browser-config.tsx"),
      "utf8",
    );
    const configSections = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/settings/pages/config-view-sections.tsx",
      ),
      "utf8",
    );
    expect(browser).toContain("busySpinClass");
    expect(browser).toContain('from "@/components/ui/busy-spin"');
    expect(configSections).toContain("busySpinClass");
    expect(configSections).toContain('from "@/components/ui/busy-spin"');
    // Prefer helper over hand-rolled ternary at these sites.
    expect(browser).not.toMatch(/busy\s*\?\s*["']animate-spin["']/);
    expect(configSections).not.toMatch(
      /reloadBusy\s*\?\s*["']animate-spin["']/,
    );
  });
});
