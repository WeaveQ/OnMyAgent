import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("main rail channel icon contract", () => {
  test("uses the WeChat bubble glyph with inactive, hover, and active colors", () => {
    const railSource = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/sidebar/main-rail.tsx",
      ),
      "utf8",
    );
    const primitiveSource = readFileSync(
      join(repoRoot, "apps/app/src/components/ui/action-row.tsx"),
      "utf8",
    );

    expect(railSource).toContain("icon: WeChatBubblesIcon");
    expect(railSource).toContain('props.active\n    ? "fill-current"');
    expect(railSource).toContain(
      ': "fill-none stroke-current transition-colors"',
    );
    expect(railSource).toContain(
      'props.active\n    ? "fill-dls-rail"\n    : "fill-current transition-colors"',
    );
    expect(railSource).toContain("strokeWidth={props.active ? 0 : 1.5}");
    expect(railSource).toContain('props.item.id === "channels" ? "group/channel"');
    expect(railSource).toContain(
      '<Icon active={props.active} className="size-5" />',
    );
    expect(railSource).not.toContain("MessagesSquare");
    expect(railSource).toContain('get label() { return t("nav.channels"); }');
    expect(railSource).toContain('id: "devices"');
    expect(railSource).toContain("icon: DevicesRailIcon");
    expect(railSource).not.toContain("wechat.png");
    expect(primitiveSource).toContain('true: "text-dls-accent"');
    expect(primitiveSource).not.toContain('true: "bg-dls-rail-active text-dls-text"');
    expect(primitiveSource).toContain(
      'false: "text-dls-secondary hover:text-dls-accent"',
    );
    expect(primitiveSource).not.toContain("hover:bg-dls-rail-hover");
  });
});
