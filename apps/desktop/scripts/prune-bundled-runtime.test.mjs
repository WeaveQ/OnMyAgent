import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  pruneArtifactRuntimeTree,
  prunePackagedRuntime,
  resolvePackagedSidecarKeepList,
  slimPackagedExtraResources,
} from "./prune-bundled-runtime.cjs";

test("prunePackagedRuntime drops headers, docs, extra globals, and idle Python dirs", () => {
  const root = join(
    tmpdir(),
    `oma-prune-runtime-${process.pid}-${Date.now()}`,
  );
  mkdirSync(join(root, "node", "include"), { recursive: true });
  mkdirSync(join(root, "node", "bin"), { recursive: true });
  mkdirSync(join(root, "node", "lib", "node_modules", "npm", "docs"), { recursive: true });
  mkdirSync(join(root, "node", "lib", "node_modules", "npm", "man"), { recursive: true });
  mkdirSync(join(root, "node", "lib", "node_modules", "npm", "bin"), { recursive: true });
  mkdirSync(join(root, "node", "lib", "node_modules", "@xai-official", "grok"), {
    recursive: true,
  });
  mkdirSync(join(root, "python", "lib", "python3.12", "idlelib"), {
    recursive: true,
  });
  mkdirSync(join(root, "python", "lib", "python3.12", "ensurepip"), {
    recursive: true,
  });
  mkdirSync(join(root, "python", "include"), { recursive: true });
  mkdirSync(join(root, "python", "lib", "tcl9.0"), { recursive: true });
  mkdirSync(join(root, "python", "lib", "python3.12", "site-packages", "pip"), {
    recursive: true,
  });
  mkdirSync(join(root, "python", "lib", "python3.12", "site-packages", "pandas"), {
    recursive: true,
  });
  mkdirSync(join(root, "python", "bin"), { recursive: true });
  writeFileSync(join(root, "python", "lib", "libtcl9.0.dylib"), "x");
  writeFileSync(
    join(root, "python", "lib", "python3.12", "site-packages", "pip", "ok"),
    "1",
  );
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
    assert.equal(existsSync(join(root, "node", "lib", "node_modules", "npm", "docs")), false);
    assert.equal(existsSync(join(root, "node", "lib", "node_modules", "npm", "man")), false);
    assert.equal(existsSync(join(root, "node", "lib", "node_modules", "npm", "bin")), true);
    assert.equal(existsSync(join(root, "node", "bin", "node")), true);
    assert.equal(existsSync(join(root, "python", "lib", "python3.12", "idlelib")), false);
    assert.equal(existsSync(join(root, "python", "lib", "python3.12", "ensurepip")), false);
    assert.equal(existsSync(join(root, "python", "include")), false);
    assert.equal(existsSync(join(root, "python", "lib", "tcl9.0")), false);
    assert.equal(existsSync(join(root, "python", "lib", "libtcl9.0.dylib")), false);
    assert.equal(
      existsSync(join(root, "python", "lib", "python3.12", "site-packages", "pandas")),
      false,
    );
    assert.equal(
      existsSync(join(root, "python", "lib", "python3.12", "site-packages", "pip", "ok")),
      true,
    );
    assert.equal(existsSync(join(root, "python", "bin", "python3")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prunePackagedRuntime drops Windows prefix extra globals and keeps npm", () => {
  const root = join(
    tmpdir(),
    `oma-prune-win-node-${process.pid}-${Date.now()}`,
  );
  mkdirSync(join(root, "node", "node_modules", "npm"), { recursive: true });
  mkdirSync(join(root, "node", "node_modules", "corepack"), { recursive: true });
  mkdirSync(join(root, "node", "node_modules", "@xai-official", "grok"), {
    recursive: true,
  });
  writeFileSync(join(root, "node", "node.exe"), "mz");
  writeFileSync(join(root, "node", "node_modules", "npm", "package.json"), "{}\n");
  writeFileSync(join(root, "node", "CHANGELOG.md"), "notes\n");

  try {
    prunePackagedRuntime(root);
    assert.equal(existsSync(join(root, "node", "node_modules", "@xai-official")), false);
    assert.equal(existsSync(join(root, "node", "node_modules", "npm")), true);
    assert.equal(existsSync(join(root, "node", "node_modules", "corepack")), true);
    assert.equal(existsSync(join(root, "node", "node.exe")), true);
    assert.equal(existsSync(join(root, "node", "CHANGELOG.md")), false);
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

test("pruneArtifactRuntimeTree drops maps, types, and markdown", () => {
  const root = join(
    tmpdir(),
    `oma-prune-artifact-${process.pid}-${Date.now()}`,
  );
  const excel = join(root, "node_modules", ".pnpm", "exceljs@4.4.0", "node_modules", "exceljs");
  mkdirSync(excel, { recursive: true });
  mkdirSync(join(root, "node_modules", ".pnpm", "@types+node@24.13.2"), {
    recursive: true,
  });
  writeFileSync(join(excel, "excel.js"), "module.exports = {}\n");
  writeFileSync(join(excel, "exceljs.js.map"), "{}\n");
  writeFileSync(join(excel, "README.md"), "docs\n");
  writeFileSync(join(root, "spreadsheet-runtime.cjs"), "ok\n");
  writeFileSync(join(root, "spreadsheet-runtime.test.cjs"), "test\n");
  try {
    pruneArtifactRuntimeTree(root);
    assert.equal(existsSync(join(excel, "excel.js")), true);
    assert.equal(existsSync(join(excel, "exceljs.js.map")), false);
    assert.equal(existsSync(join(excel, "README.md")), false);
    assert.equal(existsSync(join(root, "spreadsheet-runtime.cjs")), true);
    assert.equal(existsSync(join(root, "spreadsheet-runtime.test.cjs")), false);
    assert.equal(existsSync(join(root, "node_modules", ".pnpm", "@types+node@24.13.2")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pruneArtifactRuntimeTree drops unused Node-package build flavors and keeps required dist", () => {
  const root = join(
    tmpdir(),
    `oma-prune-artifact-flavors-${process.pid}-${Date.now()}`,
  );
  const exceljs = join(root, "node_modules", ".pnpm", "exceljs@4.4.0", "node_modules", "exceljs");
  const pdfLib = join(root, "node_modules", ".pnpm", "pdf-lib@1.17.1", "node_modules", "pdf-lib");
  const pptx = join(root, "node_modules", ".pnpm", "pptxgenjs@4.0.1", "node_modules", "pptxgenjs");
  mkdirSync(join(exceljs, "dist"), { recursive: true });
  mkdirSync(join(exceljs, "lib"), { recursive: true });
  mkdirSync(join(pdfLib, "dist"), { recursive: true });
  mkdirSync(join(pdfLib, "es"), { recursive: true });
  mkdirSync(join(pdfLib, "src"), { recursive: true });
  mkdirSync(join(pdfLib, "cjs"), { recursive: true });
  mkdirSync(join(pptx, "dist"), { recursive: true });
  writeFileSync(join(exceljs, "package.json"), JSON.stringify({ name: "exceljs", main: "./excel.js" }));
  writeFileSync(join(exceljs, "excel.js"), "module.exports = require('./lib/exceljs.nodejs.js');\n");
  writeFileSync(join(exceljs, "lib", "exceljs.nodejs.js"), "module.exports = {};\n");
  writeFileSync(join(exceljs, "dist", "exceljs.min.js"), "browser\n");
  writeFileSync(join(pdfLib, "package.json"), JSON.stringify({ name: "pdf-lib", main: "cjs/index.js" }));
  writeFileSync(join(pdfLib, "cjs", "index.js"), "module.exports = {};\n");
  writeFileSync(join(pdfLib, "dist", "pdf-lib.min.js"), "umd\n");
  writeFileSync(join(pdfLib, "es", "index.js"), "export {};\n");
  writeFileSync(join(pdfLib, "src", "index.ts"), "export {};\n");
  writeFileSync(
    join(pptx, "package.json"),
    JSON.stringify({
      name: "pptxgenjs",
      main: "dist/pptxgen.cjs.js",
      exports: { require: "./dist/pptxgen.cjs.js" },
    }),
  );
  writeFileSync(join(pptx, "dist", "pptxgen.cjs.js"), "module.exports = {};\n");
  try {
    pruneArtifactRuntimeTree(root);
    assert.equal(existsSync(join(exceljs, "excel.js")), true);
    assert.equal(existsSync(join(exceljs, "lib", "exceljs.nodejs.js")), true);
    assert.equal(existsSync(join(exceljs, "dist")), false);
    assert.equal(existsSync(join(pdfLib, "cjs", "index.js")), true);
    assert.equal(existsSync(join(pdfLib, "dist")), false);
    assert.equal(existsSync(join(pdfLib, "es")), false);
    assert.equal(existsSync(join(pdfLib, "src")), false);
    assert.equal(existsSync(join(pptx, "dist", "pptxgen.cjs.js")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("slimPackagedExtraResources prunes runtime and artifact when sidecars are absent", () => {
  const root = join(
    tmpdir(),
    `oma-afterpack-no-sidecar-${process.pid}-${Date.now()}`,
  );
  const triple = "x86_64-pc-windows-msvc";
  const runtimesDir = join(root, "runtimes");
  const target = join(runtimesDir, triple);
  const artifact = join(root, "artifact-runtime");
  mkdirSync(join(target, "node", "include"), { recursive: true });
  mkdirSync(join(target, "node", "node_modules", "npm"), { recursive: true });
  mkdirSync(join(target, "node", "node_modules", "@xai-official", "grok"), {
    recursive: true,
  });
  mkdirSync(join(runtimesDir, "aarch64-apple-darwin", "node"), { recursive: true });
  mkdirSync(artifact, { recursive: true });
  writeFileSync(join(target, "node", "CHANGELOG.md"), "notes\n");
  writeFileSync(join(target, "node", "node_modules", "npm", "package.json"), "{}\n");
  writeFileSync(join(artifact, "runtime.cjs"), "ok\n");
  writeFileSync(join(artifact, "runtime.cjs.map"), "{}\n");
  writeFileSync(join(artifact, "README.md"), "docs\n");

  try {
    slimPackagedExtraResources({
      sidecarsDir: join(root, "sidecars"),
      runtimesDir,
      triple,
      executableSuffix: ".exe",
      artifactRuntimeDir: artifact,
    });
    assert.equal(existsSync(join(root, "sidecars")), false);
    assert.equal(existsSync(join(target, "node", "include")), false);
    assert.equal(existsSync(join(target, "node", "CHANGELOG.md")), false);
    assert.equal(existsSync(join(target, "node", "node_modules", "@xai-official")), false);
    assert.equal(existsSync(join(target, "node", "node_modules", "npm")), true);
    assert.equal(existsSync(join(runtimesDir, "aarch64-apple-darwin")), false);
    assert.equal(existsSync(join(artifact, "runtime.cjs")), true);
    assert.equal(existsSync(join(artifact, "runtime.cjs.map")), false);
    assert.equal(existsSync(join(artifact, "README.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("slimPackagedExtraResources keeps short sidecar aliases when sidecars exist", () => {
  const root = join(
    tmpdir(),
    `oma-afterpack-sidecars-${process.pid}-${Date.now()}`,
  );
  const triple = "aarch64-apple-darwin";
  const sidecarsDir = join(root, "sidecars");
  const runtimesDir = join(root, "runtimes");
  const target = join(runtimesDir, triple);
  mkdirSync(sidecarsDir, { recursive: true });
  mkdirSync(join(target, "node"), { recursive: true });
  writeFileSync(join(sidecarsDir, `opencode-${triple}`), "opencode\n");
  writeFileSync(join(sidecarsDir, `onmyagent-orchestrator-${triple}`), "orch\n");
  writeFileSync(join(sidecarsDir, `versions.json-${triple}`), "{}\n");
  writeFileSync(join(sidecarsDir, `opencode-x86_64-apple-darwin`), "stale\n");

  try {
    slimPackagedExtraResources({
      sidecarsDir,
      runtimesDir,
      triple,
      executableSuffix: "",
      artifactRuntimeDir: join(root, "missing-artifact"),
    });
    assert.equal(existsSync(join(sidecarsDir, "opencode")), true);
    assert.equal(existsSync(join(sidecarsDir, "onmyagent-orchestrator")), true);
    assert.equal(existsSync(join(sidecarsDir, "versions.json")), true);
    assert.equal(existsSync(join(sidecarsDir, `opencode-${triple}`)), false);
    assert.equal(existsSync(join(sidecarsDir, "opencode-x86_64-apple-darwin")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
