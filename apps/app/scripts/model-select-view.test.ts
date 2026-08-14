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
    expect(source).toContain("resolveModelSelectTriggerLabel");
    expect(source).not.toContain("value.modelID ?? t(\"session.default_model\")");
  });

  test("keeps the last model visible until the catalog arrives", async () => {
    const { resolveModelSelectTriggerLabel } = await import(
      "../src/components/model-select"
    );
    expect(
      resolveModelSelectTriggerLabel({
        catalogReady: false,
        modelID: "deepseek-v4-flash-ga-260731",
        unresolvedLabel: "选择模型",
      }),
    ).not.toBe("选择模型");
    expect(
      resolveModelSelectTriggerLabel({
        catalogReady: true,
        modelID: "big-pickle",
        unresolvedLabel: "选择模型",
      }),
    ).toBe("选择模型");
    expect(
      resolveModelSelectTriggerLabel({
        selectedTitle: "DeepSeek V4 Flash",
        catalogReady: true,
        modelID: "deepseek-v4-flash",
        unresolvedLabel: "选择模型",
      }),
    ).toBe("DeepSeek V4 Flash");
  });
});
