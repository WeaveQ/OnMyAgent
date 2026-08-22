#!/usr/bin/env node
/**
 * Reachability gate for React kernel composition modules.
 *
 * This is intentionally narrower than a whole-program dead-code analyzer:
 * it protects the provider/entrypoint graph where an orphan can silently
 * become a second state architecture. Existing intentional leftovers stay in
 * a reviewed allowlist; new unreachable kernel modules fail the check.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.UNUSED_COMPOSITION_ROOT
  ? resolve(process.env.UNUSED_COMPOSITION_ROOT)
  : resolve(here, "../..");
const appRoot = join(repoRoot, "apps/app/src");
const baselinePath = join(repoRoot, "scripts/checks/baselines/unused-composition.json");
const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

function normalizeRel(filePath) {
  return normalize(filePath).replaceAll("\\", "/");
}

function sourceFiles(directory) {
  const files = [];
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(absolute));
    else if (entry.isFile() && sourceExtensions.includes(extname(entry.name))) files.push(absolute);
  }
  return files;
}

function resolveModule(fromFile, specifier) {
  const raw = specifier.startsWith("@/react-app/")
    ? join(appRoot, "react-app", specifier.slice("@/react-app/".length))
    : specifier.startsWith("@/")
      ? join(appRoot, specifier.slice(2))
      : specifier.startsWith(".")
        ? resolve(dirname(fromFile), specifier)
        : null;
  if (!raw) return null;
  const candidates = [raw, ...sourceExtensions.map((extension) => `${raw}${extension}`), ...sourceExtensions.map((extension) => join(raw, `index${extension}`))];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function importsFor(filePath) {
  const source = readFileSync(filePath, "utf8");
  const imports = [];
  const pattern = /(?:from\s*|import\s*\()(['"])([^'"]+)\1/g;
  for (const match of source.matchAll(pattern)) {
    const resolved = resolveModule(filePath, match[2]);
    if (resolved) imports.push(resolved);
  }
  return imports;
}

function loadBaseline() {
  if (!existsSync(baselinePath)) return { allow: [] };
  const parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
  return parsed && Array.isArray(parsed.allow) ? parsed : { allow: [] };
}

const roots = [join(appRoot, "index.react.tsx"), join(appRoot, "react-app/shell/providers.tsx")].filter(existsSync);
const reachable = new Set();
const queue = [...roots];
while (queue.length > 0) {
  const current = queue.shift();
  if (!current || reachable.has(current)) continue;
  reachable.add(current);
  for (const imported of importsFor(current)) if (!reachable.has(imported)) queue.push(imported);
}

const allow = new Set(loadBaseline().allow.map((entry) => normalizeRel(entry)));
const kernelFiles = sourceFiles(join(appRoot, "react-app/kernel"));
const orphaned = kernelFiles
  .filter((filePath) => !reachable.has(filePath))
  .map((filePath) => normalizeRel(filePath.slice(repoRoot.length + 1)))
  .filter((relative) => !allow.has(relative));

if (orphaned.length > 0) {
  console.error("unused composition modules (not reachable from app entrypoints):");
  for (const relative of orphaned.sort()) console.error(`  - ${relative}`);
  process.exit(1);
}
console.log(`unused composition gate OK (${kernelFiles.length} kernel modules, ${allow.size} reviewed leftovers)`);
