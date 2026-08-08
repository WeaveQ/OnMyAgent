import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  resolveDevOrchestratorArtifactPath,
  resolveDevTypesArtifactPaths,
  shouldForceDevPreparation,
} from "./dev-prepare-freshness.mjs";

function fromTimes(times) {
  return (path) => times[path] ?? null;
}

test("forces preparation when an artifact is missing", () => {
  assert.equal(
    shouldForceDevPreparation({
      artifactPaths: ["artifact"],
      inputPaths: ["source"],
      getNewest: fromTimes({ source: 10 }),
    }),
    true,
  );
});

test("forces preparation when an input is newer than an artifact", () => {
  assert.equal(
    shouldForceDevPreparation({
      artifactPaths: ["artifact"],
      inputPaths: ["source", "lock"],
      getNewest: fromTimes({ artifact: 10, source: 11, lock: 9 }),
    }),
    true,
  );
});

test("reuses fresh artifacts", () => {
  assert.equal(
    shouldForceDevPreparation({
      artifactPaths: ["artifact-a", "artifact-b"],
      inputPaths: ["source", "constants"],
      getNewest: fromTimes({ "artifact-a": 12, "artifact-b": 13, source: 11, constants: 10 }),
    }),
    false,
  );
});

test("explicit force always wins", () => {
  assert.equal(
    shouldForceDevPreparation({
      artifactPaths: ["artifact"],
      inputPaths: ["source"],
      force: true,
      getNewest: fromTimes({ artifact: 100, source: 1 }),
    }),
    true,
  );
});

test("resolves the Windows canonical orchestrator artifact and treats it as fresh", () => {
  const artifact = resolveDevOrchestratorArtifactPath({
    sidecarDir: "/tmp/sidecars",
    platform: "win32",
  });
  assert.equal(artifact, join("/tmp/sidecars", "onmyagent-orchestrator.exe"));
  assert.equal(
    shouldForceDevPreparation({
      artifactPaths: [artifact],
      inputPaths: ["source"],
      getNewest: fromTimes({ [artifact]: 20, source: 19 }),
    }),
    false,
  );
});

test("uses the Windows artifact suffix for a Windows target override", () => {
  assert.equal(
    resolveDevOrchestratorArtifactPath({
      sidecarDir: "/tmp/sidecars",
      platform: "darwin",
      targetTriple: "x86_64-pc-windows-msvc",
    }),
    join("/tmp/sidecars", "onmyagent-orchestrator.exe"),
  );
});

test("requires a types build when a runtime package export is missing", () => {
  const artifacts = resolveDevTypesArtifactPaths("/tmp/types/dist");
  assert.equal(artifacts.includes(join("/tmp/types/dist", "artifact-plugin.js")), true);
  assert.equal(artifacts.includes(join("/tmp/types/dist", "session-archive.js")), true);
  assert.equal(
    shouldForceDevPreparation({
      artifactPaths: artifacts,
      inputPaths: ["types-src"],
      getNewest: fromTimes(Object.fromEntries(artifacts.map((artifact) => [artifact, 20]))),
    }),
    false,
  );
  assert.equal(
    shouldForceDevPreparation({
      artifactPaths: artifacts,
      inputPaths: ["types-src"],
      getNewest: fromTimes(Object.fromEntries(artifacts.filter((artifact) => !artifact.endsWith("artifact-plugin.js")).map((artifact) => [artifact, 20]))),
    }),
    true,
  );
});

test("server build is stale when its source changes", () => {
  assert.equal(
    shouldForceDevPreparation({
      artifactPaths: ["server-embedded"],
      inputPaths: ["server-src", "server-package", "server-tsconfig", "lock", "types-index"],
      getNewest: fromTimes({
        "server-embedded": 20,
        "server-src": 21,
        "server-package": 19,
        "server-tsconfig": 19,
        lock: 19,
        "types-index": 20,
      }),
    }),
    true,
  );
});

test("server build is stale when a rebuilt types artifact changes", () => {
  assert.equal(
    shouldForceDevPreparation({
      artifactPaths: ["server-embedded"],
      inputPaths: ["server-src", "types-server", "types-session-archive"],
      getNewest: fromTimes({
        "server-embedded": 20,
        "server-src": 19,
        "types-server": 21,
        "types-session-archive": 21,
      }),
    }),
    true,
  );
});
