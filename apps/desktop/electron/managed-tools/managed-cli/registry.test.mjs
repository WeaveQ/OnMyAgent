import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  loadManagedCliPluginEntry,
  loadManagedCliRegistry,
  resolveManagedCliRegistryPath,
} from "./config.mjs";

test("loadManagedCliRegistry maps plugin manifest URLs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-cli-registry-"));
  try {
    const registryPath = path.join(root, "managed-cli-registry.json");
    await writeFile(
      registryPath,
      JSON.stringify({
        schemaVersion: 1,
        plugins: {
          officecli: {
            manifestUrl: "https://example.com/officecli/manifest.json",
          },
          "feishu-cli": {
            manifestUrl: "https://example.com/feishu-cli/manifest.json",
          },
        },
      }),
      "utf8",
    );

    const registry = loadManagedCliRegistry(registryPath);
    assert.equal(registry.schemaVersion, 1);
    assert.equal(
      registry.plugins.officecli.manifestUrl,
      "https://example.com/officecli/manifest.json",
    );
    assert.equal(
      loadManagedCliPluginEntry("feishu-cli", registryPath).manifestUrl,
      "https://example.com/feishu-cli/manifest.json",
    );
    assert.equal(loadManagedCliPluginEntry("missing", registryPath).manifestUrl, null);
    assert.equal(resolveManagedCliRegistryPath(registryPath), registryPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
