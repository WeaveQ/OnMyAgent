import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const actionRowPath = join(import.meta.dir, "../src/components/ui/action-row.tsx");

describe("filter chip free-float contract", () => {
  const source = readFileSync(actionRowPath, "utf8");

  test("exports FilterChip and maps it to SegmentedTabButton tone=chip", () => {
    expect(source).toContain("function FilterChip(");
    expect(source).toContain("FilterChip");
    expect(source).toContain('tone="chip"');
    // Default compact strip size; optional chipLg for full-page multi-select (onboarding).
    expect(source).toContain('size = "chip"');
    expect(source).toContain("size={size}");
    expect(source).toContain('chipLg: "h-9 min-h-9');
    expect(source).toContain('width="hug"');
  });

  test("selected free-float chips use soft list-selected wash, not elevated white", () => {
    expect(source).toContain('tone: "chip"');
    expect(source).toContain("bg-dls-list-selected text-dls-text shadow-none");
    expect(source).not.toMatch(
      /tone:\s*"chip"[\s\S]{0,200}active:\s*true[\s\S]{0,200}bg-dls-surface-solid/,
    );
    expect(source).not.toMatch(
      /tone:\s*"chip"[\s\S]{0,200}active:\s*true[\s\S]{0,280}shadow-\[0_1px_2px/,
    );
  });

  test("idle free-float chips stay plain labels", () => {
    expect(source).toContain(
      "bg-transparent text-dls-secondary hover:bg-dls-list-hover/50 hover:text-dls-text",
    );
  });

  test("segmented track nests NavTab radius (xl track + lg tabs, not full sausage)", () => {
    // Track outer radius must exceed tab radius for p-0.5 nesting.
    expect(source).toMatch(/filter:\s*\n\s*"h-8[^"]*rounded-xl/);
    expect(source).toMatch(/panel:\s*\n\s*"h-9[^"]*rounded-xl/);
    expect(source).not.toMatch(/filter:\s*\n\s*"h-8[^"]*rounded-full/);
    expect(source).not.toMatch(/panel:\s*\n\s*"h-9[^"]*rounded-full/);
    // NavTab pills stay rounded-lg (tighter than free-float FilterChip rounded-full).
    expect(source).toMatch(/pill:\s*"rounded-lg"/);
    expect(source).toMatch(/tab:\s*"rounded-lg"/);
    // Free-float FilterChip chips remain full pills.
    expect(source).toContain('chip: "rounded-full"');
  });
});
