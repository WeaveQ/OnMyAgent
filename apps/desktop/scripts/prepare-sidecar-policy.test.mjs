import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const policyModule = await import("./prepare-sidecar-policy.mjs").catch(() => null);

test("development can reuse a valid OpenCode sidecar when its version differs from the pin", () => {
  assert.ok(policyModule, "prepare-sidecar-policy.mjs must exist");
  assert.equal(
    policyModule.shouldDownloadOpencode({
      candidateExists: true,
      candidateIsStub: false,
      existingVersion: "1.17.11",
      pinnedVersion: "1.17.20",
      preferExisting: true,
    }),
    false,
  );
});

test("release preparation still downloads when the existing OpenCode version differs from the pin", () => {
  assert.ok(policyModule, "prepare-sidecar-policy.mjs must exist");
  assert.equal(
    policyModule.shouldDownloadOpencode({
      candidateExists: true,
      candidateIsStub: false,
      existingVersion: "1.17.11",
      pinnedVersion: "1.17.20",
      preferExisting: false,
    }),
    true,
  );
});

test("a warm development sidecar is not replaced by a local OpenCode binary", () => {
  assert.ok(policyModule, "prepare-sidecar-policy.mjs must exist");
  assert.equal(
    policyModule.shouldCopyLocalOpencode({
      candidateExists: true,
      candidateIsStub: false,
      localVersion: "1.17.11",
      pinnedVersion: "1.17.20",
      preferExisting: true,
    }),
    false,
  );
});

test("release only copies a local OpenCode binary at the pinned version", () => {
  assert.ok(policyModule, "prepare-sidecar-policy.mjs must exist");
  assert.equal(
    policyModule.shouldCopyLocalOpencode({
      candidateExists: false,
      candidateIsStub: true,
      localVersion: "1.17.11",
      pinnedVersion: "1.17.20",
      preferExisting: false,
    }),
    false,
  );
  assert.equal(
    policyModule.shouldCopyLocalOpencode({
      candidateExists: false,
      candidateIsStub: true,
      localVersion: "1.17.20",
      pinnedVersion: "1.17.20",
      preferExisting: false,
    }),
    true,
  );
});

test("a matching sidecar manifest skips repeat hashing and writes", () => {
  assert.ok(policyModule, "prepare-sidecar-policy.mjs must exist");
  const expectedEntries = {
    opencode: {
      version: "1.17.20",
      file: { size: 100, mtimeMs: 200 },
    },
    "onmyagent-server": { version: "0.4.17" },
    "onmyagent-orchestrator": {
      version: "0.4.17",
      file: { size: 300, mtimeMs: 400 },
    },
  };
  const manifest = {
    opencode: { version: "1.17.20", sha256: "a", size: 100, mtimeMs: 200 },
    "onmyagent-server": { version: "0.4.17", sha256: "in-process" },
    "onmyagent-orchestrator": { version: "0.4.17", sha256: "b", size: 300, mtimeMs: 400 },
  };

  assert.equal(policyModule.canReuseSidecarManifest({ manifest, expectedEntries, didMutate: false }), true);
  assert.equal(policyModule.canReuseSidecarManifest({ manifest, expectedEntries, didMutate: true }), false);
  assert.equal(
    policyModule.canReuseSidecarManifest({
      manifest: { ...manifest, opencode: { ...manifest.opencode, mtimeMs: 201 } },
      expectedEntries,
      didMutate: false,
    }),
    false,
  );
});

test("prepare writes only the short alias for a target triple", () => {
  assert.ok(policyModule, "prepare-sidecar-policy.mjs must exist");
  const actions = policyModule.sidecarNormalizeActions({
    aliasName: "opencode",
    leftoverNames: ["opencode-aarch64-apple-darwin"],
    existingNames: [],
  });
  assert.deepEqual(actions.writeNames, ["opencode"]);
  assert.equal(actions.present, false);
  assert.equal(actions.renameFrom, null);
  assert.deepEqual(actions.prune, ["opencode-aarch64-apple-darwin"]);
});

test("a leftover triple-named sidecar counts as present without the unused sibling", () => {
  assert.ok(policyModule, "prepare-sidecar-policy.mjs must exist");
  const leftoverOnly = policyModule.sidecarNormalizeActions({
    aliasName: "opencode",
    leftoverNames: ["opencode-aarch64-apple-darwin"],
    existingNames: ["opencode-aarch64-apple-darwin"],
  });
  assert.equal(leftoverOnly.present, true);
  assert.equal(leftoverOnly.renameFrom, "opencode-aarch64-apple-darwin");
  assert.deepEqual(leftoverOnly.writeNames, ["opencode"]);

  const aliasOnly = policyModule.sidecarNormalizeActions({
    aliasName: "opencode",
    leftoverNames: ["opencode-aarch64-apple-darwin"],
    existingNames: ["opencode"],
  });
  assert.equal(aliasOnly.present, true);
  assert.equal(aliasOnly.renameFrom, null);

  const both = policyModule.sidecarNormalizeActions({
    aliasName: "onmyagent-orchestrator",
    leftoverNames: [
      "onmyagent-orchestrator-aarch64-apple-darwin",
      "onmyagent-orchestrator-bun-darwin-arm64",
    ],
    existingNames: ["onmyagent-orchestrator", "onmyagent-orchestrator-bun-darwin-arm64"],
  });
  assert.equal(both.present, true);
  assert.equal(both.renameFrom, null);
  assert.deepEqual(both.writeNames, ["onmyagent-orchestrator"]);
  assert.deepEqual(both.prune, [
    "onmyagent-orchestrator-aarch64-apple-darwin",
    "onmyagent-orchestrator-bun-darwin-arm64",
  ]);
});

test("prepare-sidecar.mjs writes through sidecarNormalizeActions and not a dual dest list", async () => {
  const source = await readFile(new URL("./prepare-sidecar.mjs", import.meta.url), "utf8");
  assert.match(source, /sidecarNormalizeActions\(/);
  assert.match(source, /writeSidecarAlias\(/);
  assert.doesNotMatch(source, /\[opencodeTargetPath,\s*opencodePath\]/);
  assert.doesNotMatch(source, /copyFileSync\(orchestratorBuildPath,\s*orchestratorTargetPath\)/);
});

test("Electron development leaves sidecar preparation unforced when artifacts are fresh", async () => {
  const source = await readFile(new URL("./electron-dev.mjs", import.meta.url), "utf8");
  assert.match(source, /shouldForceDevPreparation\(/);
  assert.match(source, /if \(sidecarForceRequired\) prepareSidecarArgs\.push\("--force"\)/);
  assert.match(source, /prepareSidecarArgs\.push\("--prefer-existing-opencode", "--outdir", electronSidecarDir\)/);
});
