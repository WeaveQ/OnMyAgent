/**
 * Contract: marketplace grid + CountBadge meta are single-sourced design tokens
 * consumed by skills/company/expert shelves and file-tree counts.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  MARKETPLACE_CARD_GRID,
  MARKETPLACE_CARD_GRID_COMPACT,
} from "../src/components/ui/skill-marketplace-card";
import { countBadgeVariants } from "../src/components/ui/status-badge";

const root = resolve(import.meta.dir, "../../..");
const appSrc = resolve(root, "apps/app/src");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

function collectTsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === "node_modules" || name.name === "dist") continue;
      collectTsx(full, out);
    } else if (name.name.endsWith(".tsx") || name.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const GRID_TAIL =
  "gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
const HAND_ROLLED_FILE_CHIP =
  "rounded-full bg-dls-surface-muted px-2 py-0.5 text-[11px]";

describe("marketplace card grid single-source", () => {
  test("exports the shared grid class constants from skill-marketplace-card", () => {
    expect(MARKETPLACE_CARD_GRID).toContain("grid grid-cols-1 items-start");
    expect(MARKETPLACE_CARD_GRID).toContain(GRID_TAIL);
    expect(MARKETPLACE_CARD_GRID).toContain("2xl:grid-cols-5");
    expect(MARKETPLACE_CARD_GRID_COMPACT).toContain(GRID_TAIL);
    expect(MARKETPLACE_CARD_GRID_COMPACT).not.toContain("2xl:grid-cols-5");
  });

  test("skills, company, expert, plugins, expert-creation import shared grid", () => {
    const consumers = [
      "apps/app/src/react-app/domains/plugins/skills-marketplace/skills-marketplace-page.tsx",
      "apps/app/src/react-app/domains/plugins/company-store-page.tsx",
      "apps/app/src/react-app/domains/plugins/expert-marketplace/expert-marketplace-dialog.tsx",
      "apps/app/src/react-app/domains/plugins/plugins-page.tsx",
      "apps/app/src/react-app/domains/agents/expert-creation-page.tsx",
    ];
    for (const rel of consumers) {
      const src = read(rel);
      expect(src).toContain("from \"@/components/ui/skill-marketplace-card\"");
      expect(
        src.includes("MARKETPLACE_CARD_GRID") ||
          src.includes("MARKETPLACE_CARD_GRID_COMPACT"),
      ).toBe(true);
      // No page-local full grid string copy of the shared tail with 2xl.
      if (!rel.includes("skill-marketplace-card")) {
        expect(src).not.toMatch(
          /grid grid-cols-1 items-start gap-2\.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5/,
        );
      }
    }
  });

  test("only skill-marketplace-card.tsx defines the full 2xl marketplace grid string", () => {
    const files = collectTsx(appSrc);
    const hits: string[] = [];
    const needle =
      "grid grid-cols-1 items-start gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (text.includes(needle)) hits.push(file);
    }
    expect(hits.length).toBe(1);
    expect(hits[0].replace(/\\/g, "/")).toContain(
      "components/ui/skill-marketplace-card.tsx",
    );
  });
});

describe("CountBadge meta + file count chips", () => {
  test("countBadgeVariants exposes meta size with ring and text-2xs", () => {
    // Drive the real CVA config from the shipped module (not a re-implementation).
    const className = countBadgeVariants({ size: "meta" });
    expect(className).toContain("text-2xs");
    expect(className).toContain("ring-1");
    expect(className).toContain("rounded-full");
  });

  test("workspace file tree and uploads use CountBadge size=meta", () => {
    const tree = read(
      "apps/app/src/react-app/domains/workspace/workspace-files-tree-dir-row.tsx",
    );
    const uploads = read(
      "apps/app/src/react-app/domains/workspace/workspace-files-uploads-panel.tsx",
    );
    expect(tree).toContain("CountBadge");
    expect(tree).toContain('size="meta"');
    expect(tree).not.toContain(HAND_ROLLED_FILE_CHIP);
    expect(uploads).toContain("CountBadge");
    expect(uploads).toContain('size="meta"');
    expect(uploads).not.toContain(HAND_ROLLED_FILE_CHIP);
  });
});

describe("design token cleanup for targeted surfaces", () => {
  test("no arbitrary text-[Npx] under react-app/components", () => {
    const files = collectTsx(appSrc).filter(
      (f) => f.includes("/react-app/") || f.includes("/components/"),
    );
    const hits: string[] = [];
    const re = /text-\[[0-9]+px\]/;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (re.test(text)) hits.push(file);
    }
    expect(hits).toEqual([]);
  });

  test("company store errors use NoticeBox not raw red palette", () => {
    const src = read(
      "apps/app/src/react-app/domains/plugins/company-store-page.tsx",
    );
    expect(src).toContain("NoticeBox");
    expect(src).toContain('tone="error"');
    expect(src).not.toContain("text-red-600");
    expect(src).not.toContain("text-red-400");
  });
});
