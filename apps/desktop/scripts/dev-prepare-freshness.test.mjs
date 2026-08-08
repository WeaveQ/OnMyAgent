import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  resolveDevOrchestratorArtifactPath,
  resolveDevServerArtifactPaths,
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

test("derives every server JavaScript artifact from its TypeScript source tree", () => {
  const artifacts = resolveDevServerArtifactPaths({
    serverSourceDir: "/tmp/server/src",
    serverDistDir: "/tmp/server/dist",
    sourcePaths: [
      "/tmp/server/src/embedded.ts",
      "/tmp/server/src/routes/session.ts",
      "/tmp/server/src/worker.mts",
      "/tmp/server/src/legacy.cts",
      "/tmp/server/src/ambient.d.ts",
    ],
  });
  assert.deepEqual(artifacts, [
    join("/tmp/server/dist", "embedded.js"),
    join("/tmp/server/dist", "routes", "session.js"),
    join("/tmp/server/dist", "worker.mjs"),
    join("/tmp/server/dist", "legacy.cjs"),
  ]);
  assert.equal(
    shouldForceDevPreparation({
      artifactPaths: artifacts,
      inputPaths: ["server-src"],
      getNewest: fromTimes(Object.fromEntries(artifacts.slice(0, -1).map((artifact) => [artifact, 20]))),
    }),
    true,
  );
});

test("types dev freshness entries remain aligned with the tsup entry contract", async () => {
  const source = await readFile(new URL("../../../packages/types/tsup.config.ts", import.meta.url), "utf8");
  const configuredEntries = [...source.matchAll(/^\s*(?:([A-Za-z][A-Za-z0-9]*)|"([^"\n]+)"):\s*"src\/[^"\n]+",$/gm)]
    .map((match) => match[1] ?? match[2])
    .sort();
  const freshnessEntries = resolveDevTypesArtifactPaths("/tmp/types/dist")
    .map((path) => path.slice("/tmp/types/dist/".length, -".js".length))
    .sort();

  assert.deepEqual(freshnessEntries, configuredEntries);
});
