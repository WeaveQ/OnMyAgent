#!/usr/bin/env node
/**
 * One-shot migration: flatten historical workspace roots into product layout
 *
 *   uploads/   — loose user files at root
 *   tasks/     — automation runs (自动化任务-*)
 *   experts/   — expert agent archives
 *   projects/  — other user/project folders
 *
 * Usage:
 *   node scripts/migrate-workspace-files-layout.mjs /path/to/workspace [--dry-run]
 *   node scripts/migrate-workspace-files-layout.mjs /path/to/workspace --rewrite-sessions /path/to/runtime-state
 */

import { existsSync, mkdirSync, readdirSync, renameSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const LAYOUT = {
  uploads: "uploads",
  tasks: "tasks",
  experts: "experts",
  projects: "projects",
};

const KEEP_AT_ROOT = new Set([
  "uploads",
  "tasks",
  "experts",
  "projects",
  "opencode.jsonc",
  "opencode.json",
  "registry.json",
  "package.json",
  "pnpm-lock.yaml",
  "README.md",
  "README-zh.md",
  ".gitignore",
  ".DS_Store",
]);

const SYSTEM_DIRS = new Set([
  ".git",
  ".opencode",
  ".omo",
  ".onmyagent",
  ".codegraph",
  ".memsearch",
  "node_modules",
  ".turbo",
  ".github",
]);

const EXPERT_PACKAGE_SLUG_LONG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+){2,}$/;
const AUTOMATION_RE = /^自动化任务-\d{4}-\d{2}-\d{2}/;
// Date.now() ms, short hex ids, or datetime folders like 2026-07-23_155052
const SESSION_KEY_RE =
  /^(\d{10,16}|[a-f0-9]{8,12}|\d{4}-\d{2}-\d{2}[_-]\d{4,6})$/i;

function isLikelyExpertName(name) {
  if (!name || SYSTEM_DIRS.has(name) || KEEP_AT_ROOT.has(name)) return false;
  if (AUTOMATION_RE.test(name)) return false;
  if (EXPERT_PACKAGE_SLUG_LONG_RE.test(name)) return true;
  const m = name.match(/^(.*)-([a-z][a-z0-9]*(?:-[a-z0-9]+)+)$/);
  if (m) {
    const prefix = m[1];
    const slug = m[2];
    if (/[^\u0000-\u007f]/.test(prefix)) return true;
    if (slug.split("-").length >= 3) return true;
  }
  if (/专家$/.test(name) && name.length >= 4) return true;
  return false;
}

function hasSessionLikeChildren(absDir) {
  try {
    const kids = readdirSync(absDir, { withFileTypes: true });
    return kids.some((d) => d.isDirectory() && SESSION_KEY_RE.test(d.name));
  } catch {
    return false;
  }
}

function classify(name, absPath, isDir) {
  if (KEEP_AT_ROOT.has(name) || SYSTEM_DIRS.has(name)) return "keep";
  if (!isDir) {
    // Loose user-facing files → uploads
    if (/\.(xlsx?|docx?|pptx?|pdf|png|jpe?g|gif|webp|csv|txt|md|zip)$/i.test(name)) {
      return "uploads";
    }
    return "keep";
  }
  if (AUTOMATION_RE.test(name)) return "tasks";
  if (isLikelyExpertName(name)) return "experts";
  // CJK expert display folders with session children (legacy)
  if (hasSessionLikeChildren(absPath)) return "experts";
  // Remaining dirs → projects
  return "projects";
}

function ensureDir(path, dryRun) {
  if (existsSync(path)) return;
  if (dryRun) {
    console.log(`[dry-run] mkdir ${path}`);
    return;
  }
  mkdirSync(path, { recursive: true });
}

function uniqueDest(destDir, name) {
  let candidate = join(destDir, name);
  if (!existsSync(candidate)) return candidate;
  let i = 2;
  while (existsSync(join(destDir, `${name}__migrated_${i}`))) i += 1;
  return join(destDir, `${name}__migrated_${i}`);
}

function migrateWorkspace(workspaceRoot, dryRun) {
  const root = resolve(workspaceRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  const moves = [];
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    const abs = join(root, name);
    const kind = classify(name, abs, entry.isDirectory());
    if (kind === "keep") continue;
    const destRoot = join(root, LAYOUT[kind]);
    ensureDir(destRoot, dryRun);
    const dest = uniqueDest(destRoot, name);
    moves.push({ from: abs, to: dest, kind, name });
  }

  console.log(`Workspace: ${root}`);
  console.log(`Planned moves: ${moves.length}${dryRun ? " (dry-run)" : ""}`);
  for (const m of moves) {
    console.log(`  [${m.kind}] ${m.name} → ${LAYOUT[m.kind]}/${basename(m.to)}`);
    if (!dryRun) {
      ensureDir(dirname(m.to), false);
      renameSync(m.from, m.to);
    }
  }

  return { root, moves };
}

function rewriteSessionPaths(runtimeStateRoot, pathMap, dryRun) {
  if (!runtimeStateRoot || !existsSync(runtimeStateRoot)) {
    console.log("No runtime-state path; skip session rewrite.");
    return { files: 0, replacements: 0 };
  }

  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(abs);
    }
  }
  walk(runtimeStateRoot);

  // Longest paths first so nested replacements are correct
  const pairs = [...pathMap.entries()].sort((a, b) => b[0].length - a[0].length);
  let filesTouched = 0;
  let replacements = 0;

  for (const file of files) {
    let text = readFileSync(file, "utf8");
    let next = text;
    for (const [from, to] of pairs) {
      if (next.includes(from)) {
        const count = next.split(from).length - 1;
        next = next.split(from).join(to);
        replacements += count;
      }
    }
    if (next !== text) {
      filesTouched += 1;
      console.log(`  rewrite ${file} (${replacements} total so far)`);
      if (!dryRun) writeFileSync(file, next, "utf8");
    }
  }

  console.log(
    `Session rewrite: ${filesTouched} file(s), ${replacements} path occurrence(s)${dryRun ? " (dry-run)" : ""}`,
  );
  return { files: filesTouched, replacements };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const rewriteIdx = args.indexOf("--rewrite-sessions");
  const rewriteRoot =
    rewriteIdx >= 0 && args[rewriteIdx + 1] ? resolve(args[rewriteIdx + 1]) : null;
  const workspace = args.find((a) => !a.startsWith("--") && a !== rewriteRoot);
  if (!workspace) {
    console.error(
      "Usage: node scripts/migrate-workspace-files-layout.mjs <workspace> [--dry-run] [--rewrite-sessions <runtime-state>]",
    );
    process.exit(1);
  }

  const { root, moves } = migrateWorkspace(workspace, dryRun);
  const pathMap = new Map();
  for (const m of moves) {
    pathMap.set(m.from, m.to);
    // also map without trailing slash variants
    pathMap.set(m.from + "/", m.to + "/");
  }

  if (rewriteRoot) {
    rewriteSessionPaths(rewriteRoot, pathMap, dryRun);
  }

  console.log("Done.");
  if (dryRun) console.log("Re-run without --dry-run to apply.");
  return { root, moves };
}

main();
