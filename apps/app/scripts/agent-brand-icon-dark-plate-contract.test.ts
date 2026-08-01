import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Brand logos (OpenCode square mark, currentColor monochrome, multi-color
 * SVGs) are authored for a light tile. Dark UI must keep a white plate + dark
 * ink — not dark:bg-dls-surface-solid — or glyphs collapse into blank squares.
 */
const root = join(import.meta.dir, "..");

describe("agent brand icon dark plate contract", () => {
  test("AgentBrandIcon tile uses a light plate in dark mode", () => {
    const source = readFileSync(
      join(root, "src/react-app/domains/local-agents/agent-brand-icon.tsx"),
      "utf8",
    );
    expect(source).toContain("export const agentBrandIconTileClass");
    expect(source).toContain("dark:bg-white");
    expect(source).toContain("dark:text-neutral-800");
    // Regression: dark surface solid + light text washes out brand marks.
    expect(source).not.toMatch(
      /agentBrandIconTileClass\s*=\s*[\s\S]{0,200}dark:bg-dls-surface-solid/,
    );
  });
});
