#!/usr/bin/env node
/**
 * Freezes line counts for known product god files (baseline only shrinks).
 *
 * Vendor / content-pack trees are not file-size targets (same idea as
 * `.rgignore`): marketplace skills, bundled product skills, generated graphs.
 *
 *   node scripts/checks/check-file-size.mjs           # enforce
 *   node scripts/checks/check-file-size.mjs --write   # regenerate baseline
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = process.env.FILE_SIZE_ROOT
  ? resolve(process.env.FILE_SIZE_ROOT)
  : dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const baselinePath = join(repoRoot, "scripts/checks/baselines/file-size.json");
const mode = process.argv.includes("--write") ? "write" : "enforce";

/** Bundled / generated trees — never ratchet these. */
const FILE_SIZE_IGNORE_PREFIXES = [
  "apps/desktop/resources/marketplace/",
  "apps/desktop/resources/bundled-skills/",
  "graphify-out/",
];

function normalizeRel(rel) {
  return String(rel).replaceAll("\\", "/");
}

function isIgnoredFileSizePath(rel) {
  const normalized = normalizeRel(rel);
  return FILE_SIZE_IGNORE_PREFIXES.some(
    (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
  );
}

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
  const next = { entries: {} };
  for (const [rel, max] of Object.entries(baseline.entries)) {
    if (isIgnoredFileSizePath(rel)) continue;
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) {
      next.entries[rel] = max;
      continue;
    }
    next.entries[rel] = countLines(abs);
  }
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(`Wrote ${baselinePath}`);
  process.exit(0);
}

const failures = [];
for (const [rel, max] of Object.entries(baseline.entries)) {
  if (isIgnoredFileSizePath(rel)) {
    failures.push(`${rel}: vendor/content-pack path is not a file-size target`);
    continue;
  }
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
