import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("main rail channel icon contract", () => {
  test("uses outline channel/device glyphs aligned with primary rail icons", () => {
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
    expect(railSource).not.toContain("wechat.png");
    // Lucide names live in the icon module, not inlined in main-rail.
    expect(railSource).not.toContain("MessagesSquare");
    expect(railSource).toContain('get label() { return t("nav.channels"); }');
    // Devices entry removed from bottom rail (settings remains on account gear).
    expect(railSource).not.toContain('id: "devices"');
    expect(railSource).not.toContain("DevicesRailIcon");
    expect(railSource).toContain(
      '<Icon active={props.active} className="size-5.5" />',
    );

    expect(iconSource).toContain("export function ChannelsRailIcon");
    expect(iconSource).toContain("MessagesSquare");
    expect(iconSource).toContain("strokeWidth: RAIL_ICON_STROKE");
    expect(iconSource).not.toContain('fill="currentColor"');

    // Free-float selected pill: surface on light; rail-active on dark (no shadow-sm).
    expect(primitiveSource).toContain(
      'true: "bg-dls-surface text-dls-text dark:bg-dls-rail-active"',
    );
    // Idle uses primary ink (near-black light / near-white dark); pill surface marks active.
    expect(primitiveSource).toContain(
      'false:\n          "text-dls-text hover:bg-black/5 dark:hover:bg-white/5"',
    );
    expect(primitiveSource).not.toContain(
      "text-dls-secondary hover:bg-black/5 hover:text-dls-text",
    );
    expect(primitiveSource).toContain(
      'top: "w-12 gap-1 rounded-2xl px-0.5 py-1.5 text-xs leading-none"',
    );
  });
});

