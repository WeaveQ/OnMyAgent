#!/usr/bin/env node
/**
 * Dual-runtime process boundary gate (architecture P2).
 *
 * Enforces the Dual Runtime Boundary hard rules that can be checked statically:
 * 1. Renderer / app UI source must not import personal-agent-runtime internals
 *    (must go through desktop IPC only).
 * 2. personal-agent-runtime must not import server archive hot-path modules
 *    (session-archive*) — Personal must not write/open OpenCode archive stores.
 *
 * Usage:
 *   node scripts/checks/check-dual-runtime-boundary.mjs
 *   CIRCULAR_DEPS_ROOT=/path/to/fixture node ...   (tests override repo root)
 */

import { existsSync, readdirSync, readFileSync, lstatSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = process.env.DUAL_RUNTIME_ROOT
  ? process.env.DUAL_RUNTIME_ROOT
  : process.env.CIRCULAR_DEPS_ROOT
    ? process.env.CIRCULAR_DEPS_ROOT
    : dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs"]);
const ignoredDirs = new Set([
  ".git",
  ".turbo",
  "dist",
  "build",
  "out",
  "node_modules",
  "graphify-out",
  "coverage",
]);

/** @type {{ id: string, roots: string[], forbiddenImport: RegExp, message: string }[]} */
const rules = [
  {
    id: "renderer-no-personal-runtime",
    roots: ["apps/app/src"],
    // Import of personal-agent-runtime package path or relative path into electron kernel
    forbiddenImport:
      /from\s+["'][^"']*personal-agent-runtime[^"']*["']|import\s*\(\s*["'][^"']*personal-agent-runtime[^"']*["']\s*\)|require\s*\(\s*["'][^"']*personal-agent-runtime[^"']*["']\s*\)/,
    message:
      "Renderer/app must not import personal-agent-runtime (use desktop IPC / desktop.ts only)",
  },
  {
    id: "personal-no-server-archive",
    roots: ["apps/desktop/electron/personal-agent-runtime"],
    forbiddenImport:
      /from\s+["'][^"']*session-archive[^"']*["']|import\s*\(\s*["'][^"']*session-archive[^"']*["']\s*\)|require\s*\(\s*["'][^"']*session-archive[^"']*["']\s*\)|from\s+["'][^"']*apps\/server\/src\/services\/session-archive/,
    message:
      "Personal agent runtime must not import server session-archive hot path (no cross-runtime store writes)",
  },
];

function collectFiles(roots) {
  const out = [];
  for (const root of roots) {
    const abs = join(repoRoot, root);
    if (!existsSync(abs)) continue;
    const st = lstatSync(abs);
    if (st.isFile()) {
      out.push(abs);
      continue;
    }
    walk(abs, out);
  }
  return out;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const p = join(dir, entry);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      walk(p, out);
      continue;
    }
    if (!st.isFile()) continue;
    if (!sourceExtensions.has(extname(p))) continue;
    // Skip tests
    const rel = relative(repoRoot, p).split(/[\\/]/).join("/");
    if (/\.(test|spec)\.[a-z]+$/.test(rel)) continue;
    if (/(^|\/)(__tests__|fixtures|__mocks__)(\/|$)/.test(rel)) continue;
    out.push(p);
  }
}

const violations = [];

for (const rule of rules) {
  for (const file of collectFiles(rule.roots)) {
    const source = readFileSync(file, "utf8");
    if (rule.forbiddenImport.test(source)) {
      violations.push({
        rule: rule.id,
        file: relative(repoRoot, file).split(/[\\/]/).join("/"),
        message: rule.message,
      });
    }
  }
}

if (violations.length === 0) {
  console.log(
    `Dual-runtime boundary check passed (${rules.length} rule(s), repo=${relative(process.cwd(), repoRoot) || "."}).`,
  );
  process.exit(0);
}

console.error(`\nDual-runtime boundary violations (${violations.length}):\n`);
for (const v of violations) {
  console.error(`  ✗ [${v.rule}] ${v.file}`);
  console.error(`      ${v.message}\n`);
}
console.error(
  "See docs/Architecture.md § Dual Runtime Boundary. Fix imports; do not widen the gate.",
);
process.exit(1);
