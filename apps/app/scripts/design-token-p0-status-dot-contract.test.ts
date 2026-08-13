import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const themeCss = "apps/app/src/app/index.css";
const statusDotSites = [
  "apps/app/src/react-app/domains/plugins/artifact-plugin-card.tsx",
  "apps/app/src/react-app/domains/plugins/artifact-plugin-detail.tsx",
  "apps/app/src/react-app/domains/plugins/plugins-page.tsx",
  "apps/app/src/react-app/design-system/extension-detail-modal.tsx",
  "apps/app/src/react-app/domains/plugins/connector-status-card.tsx",
  "apps/app/src/react-app/domains/plugins/custom-connector-dialog.tsx",
] as const;

function darkThemeBlock(css: string): string {
  const marker = '[data-theme="dark"] {\n  color-scheme: dark;';
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const brace = css.indexOf("{", start);
  expect(brace).toBeGreaterThan(start);
  let depth = 0;
  for (let i = brace; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(brace, i + 1);
    }
  }
  throw new Error("unclosed [data-theme=dark] theme assignment block");
}

describe("P0 design tokens + plugin status dots", () => {
  test("dark theme declares chat-agent text independently of light #263033", () => {
    const css = read(themeCss);
    const dark = darkThemeBlock(css);
    const match = dark.match(/--dls-chat-agent-text:\s*([^;]+);/);
    expect(match).not.toBeNull();
    const value = match?.[1]?.trim() ?? "";
    expect(value.length).toBeGreaterThan(0);
    expect(value.toLowerCase()).not.toBe("#263033");
  });

  test("theme CSS assigns --dls-text, --dls-focus, and --dls-secondary-rgb", () => {
    const css = read(themeCss);
    expect(css).toMatch(/^\s*--dls-text:\s*[^;]+;/m);
    expect(css).toMatch(/^\s*--dls-focus:\s*[^;]+;/m);

    // Shipped .ow-dot-ticker uses rgba(var(--dls-secondary-rgb, 120, 120, 120), a).
    // Channels must be comma-separated; space-separated values IACVT to transparent.
    const consumers = [
      ...css.matchAll(
        /rgba\(\s*var\(--dls-secondary-rgb(?:,\s*[^)]+)?\)\s*,\s*[\d.]+\s*\)/g,
      ),
    ];
    expect(consumers.length).toBeGreaterThanOrEqual(3);

    const commaRgb = /^\s*--dls-secondary-rgb:\s*\d+,\s*\d+,\s*\d+\s*;/m;
    expect(css).toMatch(commaRgb);
    expect(darkThemeBlock(css)).toMatch(commaRgb);
    expect(css).not.toMatch(/^\s*--dls-secondary-rgb:\s*\d+ \d+ \d+\s*;/m);
  });

  test("plugin and connector status dots use StatusDot, not raw emerald/rose/amber", () => {
    const rawDot =
      /(?:size-1\.5|rounded-full)[^\n]{0,80}bg-(?:emerald-500|rose-500|amber-400)|bg-(?:emerald-500|rose-500|amber-400)[^\n]{0,80}(?:size-1\.5|rounded-full)/;
    for (const rel of statusDotSites) {
      const src = read(rel);
      expect(src).toContain('from "@/components/ui/status-dot"');
      expect(src).toContain("<StatusDot");
      expect(src).not.toMatch(rawDot);
    }
  });
});
