/**
 * Contract: messaging channel detail panels (WeChat / Feishu / Telegram+Discord)
 * share the same card + runtime status-strip chrome. Prevents same-family
 * layout drift after the WeChat-style alignment pass.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const messagingDir = join(
  repoRoot,
  "apps/app/src/react-app/domains/messaging",
);

const PANEL_FILES = [
  "weixin-channel-panel.tsx",
  "feishu-channel-panel.tsx",
  "token-channel-panel.tsx",
] as const;

/** Shared card section shell (DESIGN flat card: rounded-xl + border + surface + pad). */
const CARD_SECTION_CLASS =
  "flex h-full min-w-0 flex-col gap-3 rounded-xl border border-dls-border bg-dls-surface p-4";

/** Runtime status strip with start/stop affordances on the trailing edge. */
const STATUS_STRIP_CLASS =
  "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-dls-border bg-dls-surface px-4 py-3 text-xs text-dls-secondary";

function readPanel(name: (typeof PANEL_FILES)[number]): string {
  return readFileSync(join(messagingDir, name), "utf8");
}

describe("messaging channel panel layout contract", () => {
  test("token channel boot effect is not keyed on refresh (avoids Telegram/Discord flicker)", () => {
    const source = readPanel("token-channel-panel.tsx");
    expect(source).toContain("refreshRef.current = refresh");
    expect(source).toContain("await refreshRef.current()");
    expect(source).not.toContain("}, [kind, refresh]);");
  });

  test("all channel detail panels share card PanelSection shell", () => {
    const primitives = readFileSync(
      join(messagingDir, "settings-primitives.tsx"),
      "utf8",
    );
    expect(primitives).toContain("export function PanelSection");
    expect(primitives).toContain(CARD_SECTION_CLASS);
    for (const file of PANEL_FILES) {
      const source = readPanel(file);
      expect(source, `${file} must import shared PanelSection`).toContain(
        'from "./settings-primitives"',
      );
      expect(source, `${file} must render PanelSection`).toContain("<PanelSection");
    }
  });

  test("all channel detail panels share runtime status strip + start/stop", () => {
    for (const file of PANEL_FILES) {
      const source = readPanel(file);
      expect(source, `${file} must include status strip chrome`).toContain(
        STATUS_STRIP_CLASS,
      );
      expect(source, `${file} must pin actions with ml-auto`).toContain(
        "ml-auto flex flex-wrap items-center gap-1.5",
      );
      // Start / stop live on the strip (primary + outline), not a separate "running" card only.
      expect(source).toMatch(/busy === "start"/);
      expect(source).toMatch(/busy === "stop"/);
    }
  });

  test("channel detail panels use compact size-3.5 action icons (not size-4 for strip CTAs)", () => {
    for (const file of PANEL_FILES) {
      const source = readPanel(file);
      expect(source).toContain('className="size-3.5"');
      // Outer stack spacing matches WeChat baseline.
      expect(source).toContain('className="space-y-4"');
    }
  });
});
