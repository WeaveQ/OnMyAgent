/**
 * Vault + note targeting for knowledge_* tools (Obsidian CLI file=/path=/vault=).
 * Copied next to the OpenCode plugin so tools resolve the same way as tests.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";

import { walkKnowledgeTree } from "./knowledge-vault-walk.mjs";

function folderLabel(dir) {
  return path.basename(dir) || dir;
}

function normalizeRel(relPath) {
  return String(relPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

export function normalizeWikilink(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .replace(/\.md$/i, "")
    .trim()
    .toLowerCase();
}

export function listVaultsFromConfig(knowledgeRoot, rawConfig = {}) {
  const root = String(knowledgeRoot ?? "").trim();
  const defaultDir = path.join(root, "vault");
  const override = String(rawConfig.personalVaultPath ?? "").trim();
  const currentDir = override || defaultDir;
  const seen = new Set([path.resolve(currentDir)]);
  const vaults = [
    {
      name: folderLabel(currentDir) === "vault" ? "OnMyAgent" : folderLabel(currentDir),
      path: currentDir,
      isDefault: !override || path.resolve(override) === path.resolve(defaultDir),
    },
  ];
  const extra = Array.isArray(rawConfig.vaults) ? rawConfig.vaults : [];
  for (const item of extra) {
    const abs = String(item?.path ?? "").trim();
    if (!abs || !path.isAbsolute(abs)) continue;
    const resolved = path.resolve(abs);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    vaults.push({
      name: String(item?.name ?? "").trim() || folderLabel(abs),
      path: abs,
      isDefault: false,
    });
  }
  return vaults;
}

export function resolveVaultDir(vaults, vaultName) {
  const needle = String(vaultName ?? "").trim().toLowerCase();
  if (!needle) {
    return vaults[0] ?? null;
  }
  const exact = vaults.find((item) => item.name.toLowerCase() === needle);
  if (exact) return exact;
  const byFolder = vaults.find((item) => folderLabel(item.path).toLowerCase() === needle);
  return byFolder ?? null;
}

/**
 * @param {{
 *   files: Array<{ relPath: string, abs?: string }>,
 *   file?: string,
 *   path?: string,
 *   titles?: Record<string, string>,
 * }} input
 */
/**
 * @returns {{
 *   ok: true, relPath: string, abs?: string
 * } | {
 *   ok: false, reason: string, path?: string, file?: string, candidates?: string[]
 * }}
 */
export function resolveNoteTarget(input) {
  const files = Array.isArray(input.files) ? input.files : [];
  const exactPath = normalizeRel(input.path);
  if (exactPath) {
    if (exactPath.includes("..")) return { ok: false, reason: "unsafe_path" };
    const hit = files.find((item) => normalizeRel(item.relPath) === exactPath);
    if (!hit) return { ok: false, reason: "not_found", path: exactPath };
    return { ok: true, relPath: normalizeRel(hit.relPath), abs: hit.abs };
  }
  const file = String(input.file ?? "").trim();
  if (!file) return { ok: false, reason: "missing_target" };
  const needle = normalizeWikilink(file);
  const titles = input.titles ?? {};
  const matches = files.filter((item) => {
    const rel = normalizeRel(item.relPath);
    const base = path.posix.basename(rel, path.posix.extname(rel)).toLowerCase();
    const title = String(titles[rel] ?? "").trim().toLowerCase();
    return base === needle || title === needle || rel.toLowerCase() === `${needle}.md`;
  });
  if (matches.length === 0) return { ok: false, reason: "not_found", file };
  if (matches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      file,
      candidates: matches.map((item) => normalizeRel(item.relPath)),
    };
  }
  return { ok: true, relPath: normalizeRel(matches[0].relPath), abs: matches[0].abs };
}

export function titleFromMarkdown(body, relPath) {
  const titleLine = String(body ?? "").match(/^\s*#\s+(.+)$/m);
  if (titleLine?.[1]) return titleLine[1].trim();
  return path.posix.basename(relPath, path.posix.extname(relPath));
}

export async function loadVaultFiles(vaultDir) {
  const files = await walkKnowledgeTree(vaultDir);
  /** @type {Record<string, string>} */
  const titles = {};
  for (const file of files) {
    const body = await readFile(file.abs, "utf8").catch(() => "");
    titles[file.relPath] = titleFromMarkdown(body, file.relPath);
  }
  return { files, titles };
}
