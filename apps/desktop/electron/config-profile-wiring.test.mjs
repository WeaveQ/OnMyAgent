/**
 * Structural wiring: desktop boot + expert marketplace use shipped resolve/migrate.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const dir = path.dirname(fileURLToPath(import.meta.url));

describe("config-profile wiring", () => {
  test("desktop-paths soft-calls ensureLocalConfigMigrated and resolveLocalSkillsRoot", async () => {
    const source = await readFile(path.join(dir, "desktop-paths.mjs"), "utf8");
    assert.match(source, /from "\.\/config-profile-paths\.mjs"/);
    assert.match(source, /from "\.\/ensure-local-config-migrated\.mjs"/);
    assert.match(source, /ensureLocalConfigMigrated\(/);
    assert.match(source, /resolveLocalSkillsRoot\(/);
    assert.match(source, /\[config-profile\] local migrate failed/);
  });

  test("expert-marketplace resolves roots via resolveLocalExpertsRoot", async () => {
    const source = await readFile(
      path.join(dir, "expert-marketplace.mjs"),
      "utf8",
    );
    assert.match(source, /from "\.\/config-profile-paths\.mjs"/);
    assert.match(source, /resolveLocalExpertsRoot\(/);
    assert.doesNotMatch(source, /\.onmyagent", "marketplaces"/);
  });
});
