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

test("Electron development leaves sidecar preparation unforced when artifacts are fresh", async () => {
  const source = await readFile(new URL("./electron-dev.mjs", import.meta.url), "utf8");
  assert.match(source, /shouldForceDevPreparation\(/);
  assert.match(source, /if \(sidecarForceRequired\) prepareSidecarArgs\.push\("--force"\)/);
  assert.match(source, /prepareSidecarArgs\.push\("--prefer-existing-opencode", "--outdir", electronSidecarDir\)/);
});
