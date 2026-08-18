#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

function resolveRuntimeRoot() {
  const env = process.env.ONMYAGENT_ARTIFACT_RUNTIME_ROOT?.trim();
  let realDir = __dirname;
  try {
    realDir = path.dirname(fs.realpathSync(__filename));
  } catch {
    realDir = __dirname;
  }
  const fromDir = (dir) => [
    // monorepo from bundled-plugins/<plugin>/skills/<skill>/runtime
    path.resolve(dir, "../../../../../../../../packages/artifact-runtime"),
    // packaged electron resources/artifact-runtime
    path.resolve(dir, "../../../../../artifact-runtime"),
    path.resolve(dir, "../../../../artifact-runtime"),
  ];
  const candidates = [env, ...fromDir(realDir), ...fromDir(__dirname)].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "spreadsheet-runtime.cjs"))) {
      return candidate;
    }
  }
  throw new Error(
    "Cannot resolve spreadsheet artifact runtime. Set ONMYAGENT_ARTIFACT_RUNTIME_ROOT.",
  );
}

const runtimeRoot = resolveRuntimeRoot();
process.env.ONMYAGENT_ARTIFACT_RUNTIME_ROOT = runtimeRoot;
const nodeModules = path.join(runtimeRoot, "node_modules");
if (fs.existsSync(nodeModules)) {
  process.env.NODE_PATH = [nodeModules, process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  if (typeof Module._initPaths === "function") Module._initPaths();
}

const { runSpreadsheetRuntime } = require(path.join(runtimeRoot, "spreadsheet-runtime.cjs"));

void runSpreadsheetRuntime();
