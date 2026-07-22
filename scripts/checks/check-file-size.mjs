#!/usr/bin/env node
/**
 * Freezes line counts for known god files (baseline only shrinks).
 *
 *   node scripts/checks/check-file-size.mjs           # enforce
 *   node scripts/checks/check-file-size.mjs --write   # regenerate baseline
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const baselinePath = join(repoRoot, "scripts/checks/baselines/file-size.json");
const mode = process.argv.includes("--write") ? "write" : "enforce";

function countLines(absolutePath) {
  const text = readFileSync(absolutePath, "utf8");
  if (text.length === 0) return 0;
  const matches = text.match(/\n/g);
  return matches ? matches.length : 1;
}

function loadBaseline() {
  if (!existsSync(baselinePath)) return { entries: {} };
  return JSON.parse(readFileSync(baselinePath, "utf8"));
}

const baseline = loadBaseline();
if (!baseline.entries || typeof baseline.entries !== "object") {
  console.error("file-size baseline missing entries map");
  process.exit(2);
}

if (mode === "write") {
  const next = { entries: { ...baseline.entries } };
  for (const rel of Object.keys(next.entries)) {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) continue;
    next.entries[rel] = countLines(abs);
  }
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(`Wrote ${baselinePath}`);
  process.exit(0);
}

const failures = [];
for (const [rel, max] of Object.entries(baseline.entries)) {
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) {
    failures.push(`${rel}: missing (baseline max ${max})`);
    continue;
  }
  const lines = countLines(abs);
  if (lines > max) {
    failures.push(`${rel}: ${lines} lines > baseline max ${max}`);
  } else {
    console.log(`  ${rel}: ${lines}/${max}`);
  }
}

if (failures.length) {
  console.error("file-size baseline violations (growth not allowed):");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log("file-size baseline OK");
