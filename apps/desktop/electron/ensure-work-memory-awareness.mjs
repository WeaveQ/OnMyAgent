/**
 * Seed Work Memory awareness pack under ~/.onmyagent/data/user/awareness/main.
 * Idempotent: creates missing dirs/files only; never overwrites user edits.
 *
 * Called on install/first cold-start (ensureOnMyAgentUserDataDirs) and via IPC
 * workMemoryEnsureAwareness / workMemoryListFiles.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Keep in sync with apps/app WORK_MEMORY_SEED (danger-zone reset templates). */
export const WORK_MEMORY_SEED_FILES = Object.freeze({
  "style.md":
    "# Collaboration style\n\nTone and custom instructions.\n\n## Tone\ndefault\n\n## Custom instructions\n(none)\n",
  "AGENTS.md":
    "# Work handbook\n\nProject / collaboration rules. Edit this file directly.\n\n## Rules\n- \n",
  "USER.md":
    "# User profile\n\n> Generated from Settings → Personal.\n\n## Basics\n- Name:\n- Assistant name:\n- MBTI:\n\n## Work\n- Roles:\n- Industries:\n\n## Habits\n- Tools:\n- Tasks:\n",
  "MEMORY.md":
    "# Long-term memory\n\nConfirmed facts and preferences across sessions.\n",
  "profile.md": "# User profile\n\n(mirrors USER.md)\n",
  "pending.json": "[]\n",
});

/** Product-facing core files (always expected after install). */
export const WORK_MEMORY_CORE_FILES = Object.freeze([
  "style.md",
  "AGENTS.md",
  "USER.md",
  "MEMORY.md",
]);

/**
 * Resolve awareness main directory for a home dir.
 * @param {string} [homeDir]
 */
export function resolveWorkMemoryAwarenessMainDir(homeDir) {
  const home = String(homeDir ?? os.homedir()).trim() || os.homedir();
  return path.join(home, ".onmyagent", "data", "user", "awareness", "main");
}

/**
 * Ensure awareness main dir + seed files exist.
 *
 * @param {{
 *   homeDir?: string,
 *   mkdir?: typeof mkdir,
 *   stat?: typeof stat,
 *   writeFile?: typeof writeFile,
 *   seeds?: Record<string, string>,
 * }} [input]
 * @returns {Promise<{
 *   ok: true,
 *   path: string,
 *   created: string[],
 *   existing: string[],
 * }>}
 */
export async function ensureWorkMemoryAwareness(input = {}) {
  const mkdirFn = input.mkdir ?? mkdir;
  const statFn = input.stat ?? stat;
  const writeFileFn = input.writeFile ?? writeFile;
  const seeds = input.seeds ?? WORK_MEMORY_SEED_FILES;

  const mainDir = resolveWorkMemoryAwarenessMainDir(input.homeDir);
  const shortDir = path.join(mainDir, "memory");
  const expertsDir = path.join(mainDir, "experts");

  await mkdirFn(mainDir, { recursive: true });
  await mkdirFn(shortDir, { recursive: true });
  await mkdirFn(expertsDir, { recursive: true });

  const created = [];
  const existing = [];

  for (const [name, content] of Object.entries(seeds)) {
    const filePath = path.join(mainDir, name);
    try {
      await statFn(filePath);
      existing.push(name);
    } catch {
      await writeFileFn(filePath, content, "utf8");
      created.push(name);
    }
  }

  return { ok: true, path: mainDir, created, existing };
}
