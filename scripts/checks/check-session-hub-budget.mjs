#!/usr/bin/env node
/**
 * Session hub budget: shrink-only file count for `domains/session`.
 * Forbids new files under `session/knowledge/` (extract pocket).
 *
 *   node scripts/checks/check-session-hub-budget.mjs           # enforce
 *   node scripts/checks/check-session-hub-budget.mjs --write   # shrink baseline
 */

import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = process.env.SESSION_HUB_ROOT
  ? process.env.SESSION_HUB_ROOT
  : dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const sessionRel = "apps/app/src/react-app/domains/session";
const knowledgeRel = `${sessionRel}/knowledge`;
const settingsRel = "apps/app/src/react-app/domains/settings";
const sessionDir = join(repoRoot, sessionRel);
const knowledgeDir = join(repoRoot, knowledgeRel);
const settingsDir = join(repoRoot, settingsRel);
const baselinePath = join(repoRoot, "scripts/checks/baselines/session-hub-budget.json");
const mode = process.argv.includes("--write") ? "write" : "enforce";

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

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let names;
    try {
      names = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of names) {
      const abs = join(current, name);
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!ignoredDirs.has(name)) stack.push(abs);
        continue;
      }
      if (st.isFile()) {
        out.push(relative(repoRoot, abs).split("\\").join("/"));
      }
    }
  }
  return out.sort();
}

function loadBaseline() {
  if (!existsSync(baselinePath)) {
    return { maxSessionFiles: null, maxSessionKnowledgeFiles: null };
  }
  const parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
  return {
    maxSessionFiles: Number(parsed.maxSessionFiles),
    maxSessionKnowledgeFiles: Number(parsed.maxSessionKnowledgeFiles),
    maxSettingsFiles: Number(parsed.maxSettingsFiles),
  };
}

const sessionFiles = listFiles(sessionDir);
const knowledgeFiles = listFiles(knowledgeDir);
const settingsFiles = listFiles(settingsDir);
const baseline = loadBaseline();

if (mode === "write") {
  const next = {
    maxSessionFiles:
      baseline.maxSessionFiles == null || Number.isNaN(baseline.maxSessionFiles)
        ? sessionFiles.length
        : Math.min(baseline.maxSessionFiles, sessionFiles.length),
    maxSessionKnowledgeFiles:
      baseline.maxSessionKnowledgeFiles == null || Number.isNaN(baseline.maxSessionKnowledgeFiles)
        ? knowledgeFiles.length
        : Math.min(baseline.maxSessionKnowledgeFiles, knowledgeFiles.length),
    maxSettingsFiles:
      baseline.maxSettingsFiles == null || Number.isNaN(baseline.maxSettingsFiles)
        ? settingsFiles.length
        : Math.min(baseline.maxSettingsFiles, settingsFiles.length),
  };
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${baselinePath} (session ${next.maxSessionFiles}, knowledge-pocket ${next.maxSessionKnowledgeFiles}, settings ${next.maxSettingsFiles})`,
  );
  process.exit(0);
}

const failures = [];
if (!existsSync(baselinePath)) {
  failures.push("session-hub baseline missing (scripts/checks/baselines/session-hub-budget.json)");
} else {
  if (!Number.isFinite(baseline.maxSessionFiles)) {
    failures.push("session-hub baseline missing maxSessionFiles");
  } else if (sessionFiles.length > baseline.maxSessionFiles) {
    failures.push(
      `${sessionRel}: ${sessionFiles.length} files > baseline max ${baseline.maxSessionFiles}`,
    );
  } else {
    console.log(`  ${sessionRel}: ${sessionFiles.length}/${baseline.maxSessionFiles}`);
  }

  if (!Number.isFinite(baseline.maxSessionKnowledgeFiles)) {
    failures.push("session-hub baseline missing maxSessionKnowledgeFiles");
  } else if (knowledgeFiles.length > baseline.maxSessionKnowledgeFiles) {
    failures.push(
      `${knowledgeRel}: ${knowledgeFiles.length} files > baseline max ${baseline.maxSessionKnowledgeFiles} (no new files in the extract pocket)`,
    );
  } else {
    console.log(`  ${knowledgeRel}: ${knowledgeFiles.length}/${baseline.maxSessionKnowledgeFiles}`);
  }

  if (!Number.isFinite(baseline.maxSettingsFiles)) {
    failures.push("session-hub baseline missing maxSettingsFiles");
  } else if (settingsFiles.length > baseline.maxSettingsFiles) {
    failures.push(
      `${settingsRel}: ${settingsFiles.length} files > baseline max ${baseline.maxSettingsFiles}`,
    );
  } else {
    console.log(`  ${settingsRel}: ${settingsFiles.length}/${baseline.maxSettingsFiles}`);
  }
}

if (failures.length) {
  console.error("session-hub budget violations (growth not allowed):");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log("session-hub budget OK");
