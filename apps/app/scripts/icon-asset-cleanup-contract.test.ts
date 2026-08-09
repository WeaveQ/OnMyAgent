import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

/** Pre-change baselines (bytes) — files must stay under these after cleanup. */
const MAX_BYTES: Record<string, number> = {
  "apps/app/public/connector-icons/officecli.png": 50_000,
  "apps/app/src/assets/agent-icons/hermes.png": 40_000,
};

describe("icon asset cleanup contracts", () => {
  test("dead sidebar-icons directory is gone", () => {
    expect(existsSync(resolve(root, "apps/app/public/sidebar-icons"))).toBe(
      false,
    );
  });

  test("no product source references sidebar-icons path", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        if (
          name.name === "node_modules" ||
          name.name === "dist" ||
          name.name === ".git"
        ) {
          continue;
        }
        const full = resolve(dir, name.name);
        if (name.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx|css|html|md|json)$/.test(name.name)) continue;
        // Skip this contract file (it must mention the path under test).
        if (full.endsWith("icon-asset-cleanup-contract.test.ts")) continue;
        const text = readFileSync(full, "utf8");
        if (text.includes("sidebar-icons")) {
          hits.push(full.replace(root + "/", ""));
        }
      }
    };
    walk(resolve(root, "apps/app"));
    expect(hits).toEqual([]);
  });

  test("main rail and welcome brand use webp asset that exists", () => {
    const webp = resolve(root, "apps/app/public/onmyagent-logo.webp");
    expect(existsSync(webp)).toBe(true);
    expect(statSync(webp).size).toBeLessThan(100_000);
    const rail = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/main-rail.tsx",
      ),
      "utf8",
    );
    const welcome = readFileSync(
      resolve(root, "apps/app/src/react-app/shell/welcome-route.tsx"),
      "utf8",
    );
    expect(rail).toContain("onmyagent-logo.webp");
    expect(welcome).toContain("onmyagent-logo.webp");
  });

  test("heavy product assets stay under post-cleanup size caps", () => {
    for (const [rel, max] of Object.entries(MAX_BYTES)) {
      const full = resolve(root, rel);
      expect(existsSync(full), rel).toBe(true);
      const size = statSync(full).size;
      expect(size, `${rel} size ${size} > ${max}`).toBeLessThan(max);
    }
  });

  test("bundled skill _icon.png files are each under 40KB", () => {
    const skillsRoot = resolve(root, "apps/desktop/resources/bundled-skills");
    const oversized: string[] = [];
    for (const name of readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const icon = resolve(skillsRoot, name.name, "_icon.png");
      if (!existsSync(icon)) continue;
      const size = statSync(icon).size;
      if (size >= 40_000) oversized.push(`${name.name}: ${size}`);
    }
    expect(oversized).toEqual([]);
  });
});
