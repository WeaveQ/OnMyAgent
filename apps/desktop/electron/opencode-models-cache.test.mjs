import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  resolveBundledOpencodeModelsSnapshot,
  resolveOpencodeModelsCachePath,
  seedOpencodeModelsCache,
} from "./opencode-models-cache.mjs";

test("bundled snapshot is present next to desktop resources", () => {
  const snapshot = resolveBundledOpencodeModelsSnapshot();
  assert.ok(snapshot);
  assert.match(snapshot, /models\.json\.gz$/);
  assert.equal(existsSync(snapshot), true);
});

test("seeds gzip snapshot into empty XDG cache and skips a populated file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-models-cache-"));
  const snapshotPath = path.join(root, "models.json.gz");
  const payload = { openai: { id: "openai", name: "OpenAI", models: {} } };
  await writeFile(snapshotPath, gzipSync(Buffer.from(JSON.stringify(payload))));

  const first = await seedOpencodeModelsCache({
    xdgCacheHome: path.join(root, "cache"),
    snapshotPath,
  });
  assert.equal(first.seeded, true);
  const dest = resolveOpencodeModelsCachePath(path.join(root, "cache"));
  assert.equal(first.dest, dest);
  assert.deepEqual(JSON.parse(await readFile(dest, "utf8")), payload);

  await writeFile(dest, JSON.stringify({ kept: true }));
  const second = await seedOpencodeModelsCache({
    xdgCacheHome: path.join(root, "cache"),
    snapshotPath,
  });
  assert.equal(second.seeded, false);
  assert.equal(second.reason, "exists");
  assert.deepEqual(JSON.parse(await readFile(dest, "utf8")), { kept: true });
});
