/**
 * Seed the local Markdown knowledge vault.
 * Idempotent: creates missing dirs/files only; never overwrites user edits.
 *
 * Called on install/first cold-start (ensureOnMyAgentUserDataDirs) and via IPC
 * knowledgeEnsureVault / knowledgeList.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { personalVaultHasVisibleEntries, readKnowledgeConfig } from "./knowledge-vault-config.mjs";
import {
  GETTING_STARTED_REL_PATH,
  resolveKnowledgeRoot,
} from "./knowledge-vault-paths.mjs";

/** Default install seed. UI chrome is i18n; this file is the in-vault guide. */
export const KNOWLEDGE_GETTING_STARTED_SEED = `# Knowledge vault / 知识库

This is your local OnMyAgent knowledge vault. Opening **Knowledge** always lands here first.

这是 OnMyAgent 本机知识库。从侧栏进入「知识库」会先打开这份说明。

## What belongs here / 这里放什么

- Notes, briefs, and pasted text you want agents to search later
- 备忘、纪要、以后要让助手检索的材料

## What does not belong here / 不要和这些混在一起

| Area | Path / 路径 | Role |
| --- | --- | --- |
| Skills | \`profiles/local/config/skills\` | How the agent does a job / 怎么做 |
| Memory | \`data/user/awareness/\` | Who you are + confirmed facts / 你是谁、已确认事实 |
| Knowledge | \`data/user/knowledge/\` | Source material to look up / 要查阅的资料 |

Skills, memory, and knowledge stay separate. Notes here are **not** installed skills.

技能、记忆、知识库分开存放。这里的笔记不会进入「已安装」技能列表。

## Scopes / 范围

- **Personal / 个人** — this folder (\`vault/\`)
- **Project / 项目** — notes for the current workspace
- **Expert / 专家** — notes for the expert you have open

## Search / 检索

Full-text search covers \`.md\`, \`.txt\`, and \`.csv\`. Raw Excel / Word / PDF are not indexed in this version (parse-then-index comes later).

全文检索覆盖 Markdown、纯文本和 CSV。Excel / Word / PDF 这一版不进索引。

Sessions can call the \`knowledge_search\` tool. It reads this disk vault only.

会话里的 \`knowledge_search\` 只查这份本机库。

## Edit / 编辑

Edit this file or create a new note. Saves write the Markdown file on disk. Open the folder if you prefer an external editor.

可以直接改这份说明，或新建笔记。保存即写磁盘。也可以打开所在文件夹用外部编辑器。
`;

export const KNOWLEDGE_SEED_FILES = Object.freeze({
  [GETTING_STARTED_REL_PATH]: KNOWLEDGE_GETTING_STARTED_SEED,
});

/**
 * @param {{
 *   homeDir?: string,
 *   mkdir?: typeof mkdir,
 *   stat?: typeof stat,
 *   writeFile?: typeof writeFile,
 *   seeds?: Record<string, string>,
 * }} [input]
 */
export async function ensureKnowledgeVault(input = {}) {
  const mkdirFn = input.mkdir ?? mkdir;
  const statFn = input.stat ?? stat;
  const writeFileFn = input.writeFile ?? writeFile;
  const seeds = input.seeds ?? KNOWLEDGE_SEED_FILES;

  const root = resolveKnowledgeRoot(input.homeDir);
  const config = readKnowledgeConfig(input.homeDir);
  const vaultDir = config.resolvedUserVaultDir;
  const projectsDir = path.join(root, "projects");
  const expertsDir = path.join(root, "experts");

  await mkdirFn(vaultDir, { recursive: true });
  await mkdirFn(projectsDir, { recursive: true });
  await mkdirFn(expertsDir, { recursive: true });

  const created = [];
  const existing = [];
  const skipSeeds = !config.usingDefault && personalVaultHasVisibleEntries(vaultDir);
  if (skipSeeds) {
    return { ok: true, root, path: vaultDir, created, existing, usingDefault: false };
  }

  for (const [name, content] of Object.entries(seeds)) {
    const filePath = path.join(vaultDir, name);
    try {
      await statFn(filePath);
      existing.push(name);
    } catch {
      await writeFileFn(filePath, content, "utf8");
      created.push(name);
    }
  }

  return { ok: true, root, path: vaultDir, created, existing, usingDefault: config.usingDefault };
}
