#!/usr/bin/env node
/**
 * AST-only graphify build entry for OnMyAgent.
 *
 * Why: docs/Architecture.md documents `pnpm task graphify build` as a
 * one-command, no-LLM way to refresh `graphify-out/graph.json`. This script
 * is the real implementation of that claim: it shells the local graphify CLI
 * with `update --force --no-cluster` (structure only, no community naming /
 * LLM keys) and verifies the primary AST artifact exists.
 *
 * Exit codes:
 *   0 — graphify-out/graph.json written and parseable
 *   1 — graphify CLI missing, graphify failed, or artifact invalid
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const outDir = join(repoRoot, "graphify-out");
const graphPath = join(outDir, "graph.json");

function findGraphifyBinary() {
  const fromEnv = process.env.GRAPHIFY_BIN?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const which = spawnSync(
    process.platform === "win32" ? "where" : "which",
    ["graphify"],
    { encoding: "utf8" },
  );
  if (which.status === 0) {
    const first = String(which.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (first) return first;
  }

  // Common Homebrew / local installs
  for (const candidate of [
    "/opt/homebrew/bin/graphify",
    "/usr/local/bin/graphify",
    join(process.env.HOME ?? "", ".local/bin/graphify"),
  ]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  const bin = findGraphifyBinary();
  if (!bin) {
    console.error(
      [
        "graphify-build: graphify CLI not found on PATH.",
        "Install graphify (https://github.com/graphify-org/graphify or the project skill install),",
        "or set GRAPHIFY_BIN to the binary path, then re-run:",
        "  pnpm task graphify build",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(`graphify-build: using ${bin}`);
  console.log(`graphify-build: AST-only update of ${repoRoot}`);

  // `update` re-extracts code without an LLM key. `--force` overwrites even
  // when the rebuild shrinks; `--no-cluster` skips community clustering so the
  // run stays pure-structure and fast enough for local gates.
  const result = spawnSync(
    bin,
    ["update", ".", "--force", "--no-cluster"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Never require LLM keys for this path.
        GRAPHIFY_NO_LLM: process.env.GRAPHIFY_NO_LLM ?? "1",
      },
    },
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    console.error(
      `graphify-build: graphify exited with status ${result.status ?? "unknown"}`,
    );
    process.exit(typeof result.status === "number" ? result.status : 1);
  }

  if (!existsSync(graphPath)) {
    console.error(`graphify-build: missing artifact ${graphPath}`);
    process.exit(1);
  }

  const size = statSync(graphPath).size;
  if (size <= 2) {
    console.error(`graphify-build: artifact is empty: ${graphPath}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(graphPath, "utf8"));
  } catch (error) {
    console.error(
      `graphify-build: artifact is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  const nodeCount = Array.isArray(parsed?.nodes)
    ? parsed.nodes.length
    : Array.isArray(parsed?.graph?.nodes)
      ? parsed.graph.nodes.length
      : typeof parsed === "object" && parsed
        ? Object.keys(parsed).length
        : 0;

  if (nodeCount === 0) {
    console.error("graphify-build: artifact parsed but contains no nodes");
    process.exit(1);
  }

  console.log(
    `graphify-build: ok — ${graphPath} (${size} bytes, ~${nodeCount} top-level node entries)`,
  );
  process.exit(0);
}

main();
