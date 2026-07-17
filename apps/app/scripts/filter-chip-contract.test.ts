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
    expect(source).toContain('size="chip"');
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
});
