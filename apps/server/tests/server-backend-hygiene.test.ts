import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveToyUiEnabled } from "../src/core/capabilities.js";

const repoRoot = join(import.meta.dir, "../../..");
const serverRoot = join(import.meta.dir, "..");

describe("toy UI opt-in (shipped)", () => {
  test("defaults off without env; on with ONMYAGENT_TOY_UI", () => {
    const prevToy = process.env.ONMYAGENT_TOY_UI;
    const prevDev = process.env.ONMYAGENT_DEV_MODE;
    try {
      delete process.env.ONMYAGENT_TOY_UI;
      delete process.env.ONMYAGENT_DEV_MODE;
      expect(resolveToyUiEnabled()).toBe(false);
      process.env.ONMYAGENT_TOY_UI = "1";
      expect(resolveToyUiEnabled()).toBe(true);
      delete process.env.ONMYAGENT_TOY_UI;
      process.env.ONMYAGENT_DEV_MODE = "1";
      expect(resolveToyUiEnabled()).toBe(true);
    } finally {
      if (prevToy === undefined) delete process.env.ONMYAGENT_TOY_UI;
      else process.env.ONMYAGENT_TOY_UI = prevToy;
      if (prevDev === undefined) delete process.env.ONMYAGENT_DEV_MODE;
      else process.env.ONMYAGENT_DEV_MODE = prevDev;
    }
  });
});

describe("backend hygiene structural", () => {
  test("dev-ui-routes lazy-imports toy-ui; file-size baseline exists", () => {
    const routes = readFileSync(
      join(serverRoot, "src/routes/dev-ui-routes.ts"),
      "utf8",
    );
    expect(routes).toContain('import("../toy-ui.js")');
    expect(routes).not.toMatch(/from \"\.\.\/toy-ui\.js\"/);

    const baseline = join(repoRoot, "scripts/checks/baselines/file-size.json");
    expect(existsSync(baseline)).toBe(true);
    const parsed = JSON.parse(readFileSync(baseline, "utf8")) as {
      entries: Record<string, number>;
    };
    expect(parsed.entries["apps/server/src/server.ts"]).toBeGreaterThan(0);
    expect(parsed.entries["apps/server/src/services/session-archive.ts"]).toBeGreaterThan(0);
  });

  test("archive SSE does not open+close store on every tick", () => {
    const source = readFileSync(
      join(serverRoot, "src/routes/workspace-session-archive-routes.ts"),
      "utf8",
    );
    expect(source).toContain("defaultSessionArchiveStorePool");
    expect(source).toContain("resolveArchiveSsePollMs");
    // Acquire once per connection; ticks use input.store (no open/close per interval).
    expect(source).toContain("defaultSessionArchiveStorePool.acquire({ dbPath })");
    expect(source).toContain("const session = input.store.getSession(input.sessionId)");
    expect(source).toContain("const stats = input.store.stats()");
    // Old pattern: open inside setInterval then store.close()
    expect(source).not.toMatch(
      /setInterval\(async \(\) => \{[\s\S]{0,200}openSessionArchiveStore/,
    );
  });
});
