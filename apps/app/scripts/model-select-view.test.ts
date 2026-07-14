import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("model select view", () => {
  test("renders a distinct surface and selected state for the model menu", () => {
    const source = readFileSync(
      join(repoRoot, "apps/app/src/components/model-select.tsx"),
      "utf8",
    );

    expect(source).toContain("border border-dls-mist bg-dls-surface");
    expect(source).toContain("autoHighlight={false}");
    expect(source).toContain("keepHighlight={false}");
    expect(source).toContain("ChevronDown, Check, Settings2");
    expect(source).toContain("const selected = isSameModel(value, option);");
    expect(source).toContain("bg-dls-list-selected data-highlighted:bg-dls-list-selected");
    expect(source).toContain("data-highlighted:bg-dls-list-hover");
    expect(source).toContain("{selected ? (");
    expect(source).toContain('<Check className="size-4 shrink-0 text-dls-accent" />');
  });
});
