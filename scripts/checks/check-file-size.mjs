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

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = process.env.FILE_SIZE_ROOT
  ? resolve(process.env.FILE_SIZE_ROOT)
  : dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const baselinePath = join(repoRoot, "scripts/checks/baselines/file-size.json");
const discoveryPath = join(repoRoot, "scripts/checks/baselines/file-size-discovery.json");
const mode = process.argv.includes("--write")
  ? "write"
  : process.argv.includes("--write-discovery")
    ? "write-discovery"
    : process.argv.includes("--discover")
      ? "discover"
      : "enforce";
const discoveryThreshold = Number(process.env.FILE_SIZE_DISCOVERY_THRESHOLD ?? 800);

/** Bundled / generated trees — never ratchet these. */
const FILE_SIZE_IGNORE_PREFIXES = [
  "apps/desktop/resources/marketplace/",
  "apps/desktop/resources/bundled-skills/",
  "graphify-out/",
];
const FILE_SIZE_IGNORE_SEGMENTS = new Set([
  ".git",
  ".opencode",
  "node_modules",
  "dist",
  "dist-electron",
  "coverage",
]);
const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".svelte", ".ts", ".tsx", ".vue"]);

function normalizeRel(rel) {
  return String(rel).replaceAll("\\", "/");
}

function isIgnoredFileSizePath(rel) {
  const normalized = normalizeRel(rel);
  if (normalized.split("/").some((segment) => FILE_SIZE_IGNORE_SEGMENTS.has(segment))) return true;
  return FILE_SIZE_IGNORE_PREFIXES.some(
    (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
  );
}

function sourceFilePaths() {
  try {
    const tracked = execFileSync(
      "git",
      ["-C", repoRoot, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { encoding: "utf8" },
    );
    return tracked.split("\0").filter((rel) => rel && existsSync(join(repoRoot, rel)) && SOURCE_EXTENSIONS.has(join("x", rel).slice(join("x", rel).lastIndexOf("."))) && !isIgnoredFileSizePath(rel));
  } catch {
    const files = [];
    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);
        const relative = normalizeRel(absolute.slice(repoRoot.length + 1));
        if (isIgnoredFileSizePath(relative)) continue;
        if (entry.isDirectory()) walk(absolute);
        else if (entry.isFile() && SOURCE_EXTENSIONS.has(join("x", relative).slice(join("x", relative).lastIndexOf(".")))) files.push(relative);
      }
    };
    walk(repoRoot);
    return files;
  }
}

function discoverLargeFiles() {
  return sourceFilePaths()
    .map((rel) => [rel, countLines(join(repoRoot, rel))])
    .filter(([, lines]) => lines > discoveryThreshold)
    .sort(([a], [b]) => a.localeCompare(b));
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

if (mode === "discover" || mode === "write-discovery") {
  const entries = Object.fromEntries(discoverLargeFiles());
  if (mode === "write-discovery") {
    writeFileSync(discoveryPath, `${JSON.stringify({ threshold: discoveryThreshold, entries }, null, 2)}\n`, "utf8");
    console.log(`Wrote ${discoveryPath} (${Object.keys(entries).length} files)`);
  } else {
    console.log(JSON.stringify({ threshold: discoveryThreshold, entries }, null, 2));
  }
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

if (existsSync(discoveryPath)) {
  const discovery = JSON.parse(readFileSync(discoveryPath, "utf8"));
  const known = discovery.entries && typeof discovery.entries === "object" ? discovery.entries : {};
  const discoveryFailures = [];
  for (const [rel, lines] of discoverLargeFiles()) {
    const max = Number(known[rel]);
    if (!Number.isInteger(max)) discoveryFailures.push(`${rel}: discovered ${lines} lines but is missing from discovery baseline`);
    else if (lines > max) discoveryFailures.push(`${rel}: ${lines} lines > discovery baseline ${max}`);
  }
  if (discoveryFailures.length) {
    console.error("file-size discovery violations (new growth or untracked god file):");
    for (const line of discoveryFailures) console.error(`  - ${line}`);
    process.exit(1);
  }
  console.log(`file-size discovery OK (${discoverLargeFiles().length} files > ${discoveryThreshold} lines)`);
}
console.log("file-size baseline OK");
