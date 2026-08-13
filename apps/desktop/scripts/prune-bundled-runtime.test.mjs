import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  prunePackagedRuntime,
  resolvePackagedSidecarKeepList,
} from "./prune-bundled-runtime.cjs";

test("prunePackagedRuntime drops headers, docs, extra globals, and idle Python dirs", () => {
  const root = join(
    tmpdir(),
    `oma-prune-runtime-${process.pid}-${Date.now()}`,
  );
  mkdirSync(join(root, "node", "include"), { recursive: true });
  mkdirSync(join(root, "node", "bin"), { recursive: true });
  mkdirSync(join(root, "node", "lib", "node_modules", "npm"), { recursive: true });
  mkdirSync(join(root, "node", "lib", "node_modules", "@xai-official", "grok"), {
    recursive: true,
  });
  mkdirSync(join(root, "python", "lib", "python3.12", "idlelib"), {
    recursive: true,
  });
  mkdirSync(join(root, "python", "lib", "python3.12", "ensurepip"), {
    recursive: true,
  });
  mkdirSync(join(root, "python", "bin"), { recursive: true });
  writeFileSync(join(root, "node", "bin", "node"), "#!/bin/sh\n");
  writeFileSync(join(root, "node", "CHANGELOG.md"), "notes\n");
  writeFileSync(join(root, "node", "lib", "node_modules", "npm", "package.json"), "{}\n");
  writeFileSync(join(root, "python", "bin", "python3"), "#!/bin/sh\n");

  try {
    prunePackagedRuntime(root);
    assert.equal(existsSync(join(root, "node", "include")), false);
    assert.equal(existsSync(join(root, "node", "CHANGELOG.md")), false);
    assert.equal(existsSync(join(root, "node", "lib", "node_modules", "@xai-official")), false);
    assert.equal(existsSync(join(root, "node", "lib", "node_modules", "npm")), true);
    assert.equal(existsSync(join(root, "node", "bin", "node")), true);
    assert.equal(existsSync(join(root, "python", "lib", "python3.12", "idlelib")), false);
    assert.equal(existsSync(join(root, "python", "lib", "python3.12", "ensurepip")), false);
    assert.equal(existsSync(join(root, "python", "bin", "python3")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("packaged sidecar keep list is short aliases only", () => {
  const { keep, planned } = resolvePackagedSidecarKeepList(
    "/tmp/sidecars",
    "aarch64-apple-darwin",
    "",
  );
  assert.deepEqual([...keep].sort(), [
    "onmyagent-orchestrator",
    "opencode",
    "versions.json",
  ]);
  assert.equal(planned.length, 2);
  assert.equal(planned[0].targetName, "opencode-aarch64-apple-darwin");
  assert.equal(keep.has("opencode-aarch64-apple-darwin"), false);
});
