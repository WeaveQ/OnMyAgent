import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function readScripts(relativePkg: string): Record<string, string> {
  const raw = JSON.parse(readFileSync(join(repoRoot, relativePkg), "utf8")) as {
    scripts?: Record<string, string>;
  };
  return raw.scripts ?? {};
}

describe("default test-gate wiring", () => {
  test("orchestrator bun suite stays on test:unit only", () => {
    const root = readScripts("package.json");
    expect(root["test:unit"] ?? "").toContain("--filter onmyagent-orchestrator");
    expect(root["test:runtime"] ?? "").not.toContain("onmyagent-orchestrator");
  });

  test("desktop test:runtime runs jump-list once and does not nest check:electron", () => {
    const desktop = readScripts("apps/desktop/package.json");
    const runtime = desktop["test:runtime"] ?? "";
    expect(runtime.split("windows-jump-list.test.mjs").length - 1).toBe(1);
    expect(runtime).not.toContain("check:electron");
    expect(runtime).not.toContain("check-electron-bridge");
    expect(desktop["check:electron"] ?? "").toContain("check-electron-bridge.mjs");
  });
});
