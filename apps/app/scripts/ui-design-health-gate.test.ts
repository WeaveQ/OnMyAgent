/**
 * Structural design-health gate for the UI design audit.
 * Drives real repo files (DESIGN.md, theme-system, primitives, token usage)
 * so a broken or deleted design contract fails the suite.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(import.meta.dir, "..");
const repoRoot = join(appRoot, "../..");

function countMatches(root: string, pattern: RegExp, globExt: string[]): number {
  let count = 0;
  const walk = (dir: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true }).map((e) => e.name);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
      const full = join(dir, name);
      const ent = readdirSync(dir, { withFileTypes: true }).find((e) => e.name === name);
      if (!ent) continue;
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!globExt.some((ext) => name.endsWith(ext))) continue;
      const text = readFileSync(full, "utf8");
      const matches = text.match(pattern);
      if (matches) count += matches.length;
    }
  };
  walk(root);
  return count;
}

describe("UI design contract files exist", () => {
  test("DESIGN.md is the root visual contract", () => {
    const path = join(repoRoot, "DESIGN.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("## 14. Known Gaps");
    expect(text).toContain("components.contracts");
  });

  test("theme-system.md points at DESIGN.md and documents shell hierarchy", () => {
    const path = join(repoRoot, "docs/design/theme-system.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("DESIGN.md");
    expect(text).toContain("Flat first");
    expect(text).toContain("SegmentedTabGroup");
  });

  test("ui primitives directory has core atoms", () => {
    const uiDir = join(appRoot, "src/components/ui");
    const files = readdirSync(uiDir);
    for (const required of [
      "button.tsx",
      "input.tsx",
      "status-badge.tsx",
      "loading-spinner.tsx",
      "send-button.tsx",
      "skeleton.tsx",
    ]) {
      expect(files.includes(required), `missing ${required}`).toBe(true);
    }
    expect(files.length).toBeGreaterThan(30);
  });
});

describe("token adoption vs raw palette", () => {
  test("dls- token usage dominates raw Tailwind palette classes", () => {
    const roots = [
      join(appRoot, "src/react-app"),
      join(appRoot, "src/components"),
    ];
    let dls = 0;
    let raw = 0;
    const dlsRe = /dls-[a-z0-9-]+/g;
    const rawRe =
      /(bg|text|border|ring|from|to|via)-(slate|gray|zinc|neutral|stone|blue|indigo|sky|cyan|red|green|amber|yellow|orange|purple|violet|pink|rose)-[0-9]{2,3}/g;
    for (const root of roots) {
      dls += countMatches(root, dlsRe, [".ts", ".tsx", ".css"]);
      raw += countMatches(root, rawRe, [".ts", ".tsx"]);
    }
    // Health bar: semantic tokens should overwhelm raw palette hits.
    expect(dls).toBeGreaterThan(1000);
    expect(raw).toBeLessThan(80);
    expect(dls).toBeGreaterThan(raw * 20);
  });
});

describe("settings AI provider badge policy (source)", () => {
  test("ai-view: Zen free only; custom before OpenCode engine badge; Cloud i18n", () => {
    const aiView = readFileSync(
      join(appRoot, "src/react-app/domains/settings/pages/ai-view.tsx"),
      "utf8",
    );
    expect(aiView).toContain('provider.id === "opencode"');
    expect(aiView).toContain("model_picker.free");
    expect(aiView).toContain("settings.provider_badge_cloud");
    expect(aiView).not.toMatch(/>\s*Cloud\s*</);
    expect(aiView).toMatch(
      /provider\.id === "opencode" \? null : provider\.source ===\s*"custom"/,
    );
  });

  test("no residual arbitrary text-[Npx] font sizes in message chrome", () => {
    const chrome = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/session/surface/message-list/chrome.tsx",
      ),
      "utf8",
    );
    expect(chrome).not.toMatch(/text-\[[0-9]+px\]/);
    expect(chrome).toContain("text-2xs");
  });
});
