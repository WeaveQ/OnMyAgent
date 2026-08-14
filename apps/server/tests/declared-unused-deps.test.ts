import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8")) as Record<string, unknown>;
}

function depNames(pkg: Record<string, unknown>, key: "dependencies" | "devDependencies"): string[] {
  const block = pkg[key];
  if (!block || typeof block !== "object") return [];
  return Object.keys(block as Record<string, string>);
}

describe("declared unused native/cli deps", () => {
  test("server and desktop do not declare better-sqlite3", () => {
    const server = readJson("apps/server/package.json");
    const desktop = readJson("apps/desktop/package.json");
    const names = [
      ...depNames(server, "dependencies"),
      ...depNames(server, "devDependencies"),
      ...depNames(desktop, "dependencies"),
      ...depNames(desktop, "devDependencies"),
    ];
    expect(names).not.toContain("better-sqlite3");
    expect(names).not.toContain("@types/better-sqlite3");
  });

  test("server does not declare @types/minimatch", () => {
    const server = readJson("apps/server/package.json");
    expect(depNames(server, "devDependencies")).not.toContain("@types/minimatch");
    expect(depNames(server, "dependencies")).not.toContain("@types/minimatch");
  });

  test("app does not list shadcn under production dependencies", () => {
    const app = readJson("apps/app/package.json");
    expect(depNames(app, "dependencies")).not.toContain("shadcn");
  });

  test("workspace onlyBuiltDependencies does not list better-sqlite3", () => {
    const yaml = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    expect(yaml).not.toMatch(/^\s*-\s*["']?better-sqlite3["']?\s*$/m);
  });
});
