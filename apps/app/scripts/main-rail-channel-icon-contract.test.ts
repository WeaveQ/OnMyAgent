import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("main rail channel icon contract", () => {
  test("uses a clean fill channels glyph aligned with primary rail icons", () => {
    const railSource = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/sidebar/main-rail.tsx",
      ),
      "utf8",
    );
    const iconSource = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/sidebar/primary-rail-icons.tsx",
      ),
      "utf8",
    );
    const primitiveSource = readFileSync(
      join(repoRoot, "apps/app/src/components/ui/action-row.tsx"),
      "utf8",
    );

    expect(railSource).toContain("icon: ChannelsRailIcon");
    expect(railSource).toContain("ChannelsRailIcon");
    expect(railSource).not.toContain("WeChatBubblesIcon");
    expect(railSource).not.toContain("MessagesSquare");
    expect(railSource).not.toContain("wechat.png");
    expect(railSource).toContain('get label() { return t("nav.channels"); }');
    expect(railSource).toContain('id: "devices"');
    expect(railSource).toContain("icon: DevicesRailIcon");
    expect(railSource).toContain(
      '<Icon active={props.active} className="size-5" />',
    );

    expect(iconSource).toContain("export function ChannelsRailIcon");
    expect(iconSource).toContain('viewBox="0 0 16 16"');
    expect(iconSource).toContain('fill="currentColor"');

    expect(primitiveSource).toContain('true: "text-dls-accent"');
    expect(primitiveSource).not.toContain(
      'true: "bg-dls-rail-active text-dls-text"',
    );
    expect(primitiveSource).toContain(
      'false: "text-dls-secondary hover:text-dls-accent"',
    );
    expect(primitiveSource).not.toContain("hover:bg-dls-rail-hover");
  });
});
