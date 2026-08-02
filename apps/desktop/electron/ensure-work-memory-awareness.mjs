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
    "# 协作风格\n\n语气与自定义指令。\n\n## 语气\n默认\n\n## 自定义指令\n（在「设置 → 个人」中编辑后可同步到此处）\n",
  "AGENTS.md":
    "# 工作手册\n\n项目 / 协作规范。可直接编辑本文件。\n\n## 规则\n- \n",
  "USER.md":
    "# 用户画像\n\n> 由「设置 → 个人」自动生成。\n\n## 基本信息\n- 称呼：\n- 助手名：\n- MBTI：\n\n## 工作\n- 角色：\n- 行业：\n\n## 习惯\n- 常用工具：\n- 常见任务：\n",
  "MEMORY.md": "# 长期记忆\n\n跨会话确认的事实与偏好。\n",
  "profile.md": "# 用户画像\n\n（与 USER.md 同步）\n",
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
