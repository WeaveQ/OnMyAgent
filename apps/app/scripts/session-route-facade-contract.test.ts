import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const shell = join(repoRoot, "apps/app/src/react-app/shell");
const facadeIndex = join(shell, "session-route/index.ts");
const facadeRender = join(shell, "session-route/render.tsx");
const legacyGodFile = join(shell, "session-route.tsx");
const legacyRenderFile = join(shell, "session-route-render.tsx");
const sharedPagesDir = join(
  repoRoot,
  "apps/app/src/react-app/domains/session/components/shared-pages",
);

describe("session-route folder facade contract", () => {
  test("uses folder facade entrypoints (not a root-level god file)", () => {
    expect(existsSync(facadeIndex)).toBe(true);
    expect(existsSync(facadeRender)).toBe(true);
    expect(existsSync(legacyGodFile)).toBe(false);
    expect(existsSync(legacyRenderFile)).toBe(false);
  });

  test("index.ts stays a thin public facade", () => {
    const source = readFileSync(facadeIndex, "utf8");
    expect(source.split("\n").length).toBeLessThanOrEqual(80);
    expect(source).toContain("export { SessionRouteRender as SessionRoute");
    expect(source).toContain('from "./render"');
  });

  test("app-root imports the folder facade", () => {
    const appRoot = readFileSync(join(shell, "app-root.tsx"), "utf8");
    expect(appRoot).toContain('from "./session-route"');
  });

  test("cleared shared-pages directory stays gone", () => {
    expect(existsSync(sharedPagesDir)).toBe(false);
  });
});
