import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createDurableJsonStore, createDurableStateRegistry } from "./durable-state.mjs";

test("durable json store serializes atomic writes and keeps state private", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-durable-state-"));
  const target = path.join(root, "runtime", "state.json");
  const store = createDurableJsonStore(target);

  await Promise.all(Array.from({ length: 12 }, (_, index) => store.write({ index })));
  const value = await store.read();
  assert.equal(typeof value?.index, "number");
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), value);
  assert.equal((await stat(path.dirname(target))).mode & 0o777, 0o700);
  assert.equal((await stat(target)).mode & 0o777, 0o600);
});

test("durable json store appends JSON lines without rewriting checkpoint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-durable-lines-"));
  const target = path.join(root, "runtime", "events.jsonl");
  const store = createDurableJsonStore(target);

  await store.appendLines([{ id: 1 }, { id: 2 }]);
  await store.appendLines([{ id: 3 }]);
  assert.deepEqual(
    (await readFile(target, "utf8")).trim().split("\n").map((line) => JSON.parse(line)),
    [{ id: 1 }, { id: 2 }, { id: 3 }],
  );
});

test("durable state registry records ownership and migrates versioned entries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-durable-registry-"));
  const registry = createDurableStateRegistry({
    rootDir: root,
    definitions: {
      sample: {
        owner: "test.sample",
        fileName: "sample.json",
        schemaVersion: 2,
        sensitivity: "secret",
        defaultValue: { version: 1, value: "old" },
        migrate: (value) => ({ version: 2, value: `${value.value}-migrated` }),
      },
    },
  });

  assert.deepEqual(registry.describe("sample"), {
    name: "sample",
    owner: "test.sample",
    schemaVersion: 2,
    sensitivity: "secret",
    ttlMs: null,
    path: path.join(root, "sample.json"),
  });
  assert.deepEqual(await registry.read("sample"), { version: 2, value: "old-migrated" });
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "sample.json"), "utf8")), { version: 2, value: "old-migrated" });
  assert.equal((await stat(path.join(root, "sample.json"))).mode & 0o777, 0o600);
});
