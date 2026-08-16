/**
 * Disk operations for knowledge_* tools. Same folder the rail edits.
 *
 * @typedef {{
 *   ok: true,
 *   vault: string,
 *   relPath: string,
 *   title: string,
 *   content: string,
 * }} KnowledgeReadOk
 * @typedef {{ ok: false, reason: string, vault?: string, relPath?: string, file?: string, path?: string, candidates?: string[] }} KnowledgeReadErr
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  listVaultsFromConfig,
  loadVaultFiles,
  resolveNoteTarget,
  resolveVaultDir,
  titleFromMarkdown,
} from "./knowledge-target.mjs";

function splitFrontmatter(markdown) {
  const source = String(markdown ?? "");
  const withFields = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (withFields) return { raw: withFields[1] ?? "", body: source.slice(withFields[0].length) };
  const emptyFence = source.match(/^---[ \t]*\r?\n---[ \t]*(?:\r?\n|$)/);
  if (emptyFence) return { raw: "", body: source.slice(emptyFence[0].length) };
  return { raw: "", body: source };
}

function serializeFrontmatter(fields) {
  const lines = [];
  if (fields.title) lines.push(`title: ${JSON.stringify(fields.title)}`);
  if (fields.created) lines.push(`created: ${JSON.stringify(fields.created)}`);
  if (fields.updated) lines.push(`updated: ${JSON.stringify(fields.updated)}`);
  if (Array.isArray(fields.tags) && fields.tags.length) {
    lines.push("tags:");
    for (const tag of fields.tags) lines.push(`  - ${JSON.stringify(tag)}`);
  }
  if (!lines.length) return "";
  return `---\n${lines.join("\n")}\n---\n`;
}

function parseSimpleFields(raw) {
  const fields = { title: "", created: "", updated: "", tags: [] };
  const lines = String(raw ?? "").split(/\r?\n/);
  let inTags = false;
  for (const line of lines) {
    const tagItem = line.match(/^\s+-\s+(.+)$/);
    if (inTags && tagItem) {
      fields.tags.push(tagItem[1].replace(/^["']|["']$/g, "").trim());
      continue;
    }
    inTags = false;
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    const key = pair[1].toLowerCase();
    const value = pair[2].replace(/^["']|["']$/g, "").trim();
    if (key === "tags" && !value) {
      inTags = true;
      continue;
    }
    if (key === "title") fields.title = value;
    if (key === "created") fields.created = value;
    if (key === "updated") fields.updated = value;
  }
  return fields;
}

export async function readKnowledgeConfigJson(knowledgeRoot) {
  try {
    return JSON.parse(await readFile(path.join(knowledgeRoot, "config.json"), "utf8"));
  } catch {
    return {};
  }
}

/**
 * @returns {Promise<
 *   | { ok: true, vaults: ReturnType<typeof listVaultsFromConfig>, vault: { name: string, path: string, isDefault: boolean } }
 *   | { ok: false, reason: string, vault: string }
 * >}
 */
export async function resolveKnowledgeContext(knowledgeRoot, vaultName) {
  const rawConfig = await readKnowledgeConfigJson(knowledgeRoot);
  const vaults = listVaultsFromConfig(knowledgeRoot, rawConfig);
  const vault = resolveVaultDir(vaults, vaultName);
  if (!vault) return { ok: false, reason: "vault_not_found", vault: vaultName ?? "" };
  return { ok: true, vaults, vault };
}

export function suggestCreateRelPath(nameOrPath) {
  const raw = String(nameOrPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!raw || raw.includes("..")) return null;
  if (raw.toLowerCase().endsWith(".md") || raw.toLowerCase().endsWith(".txt")) return raw;
  return `${raw}.md`;
}

/** @returns {Promise<KnowledgeReadOk | KnowledgeReadErr>} */
export async function knowledgeReadNote(input) {
  const ctx = await resolveKnowledgeContext(input.knowledgeRoot, input.vault);
  if (ctx.ok !== true) return { ok: false, reason: ctx.reason, vault: ctx.vault };
  const { files, titles } = await loadVaultFiles(ctx.vault.path);
  const target = resolveNoteTarget({
    files,
    file: input.file,
    path: input.path,
    titles,
  });
  if (target.ok !== true) {
    return { ok: false, reason: target.reason, vault: ctx.vault.name, relPath: target.path, file: target.file };
  }
  const content = await readFile(target.abs, "utf8");
  return {
    ok: true,
    vault: ctx.vault.name,
    relPath: target.relPath,
    title: titleFromMarkdown(content, target.relPath),
    content,
  };
}

export async function knowledgeCreateNote(input) {
  const ctx = await resolveKnowledgeContext(input.knowledgeRoot, input.vault);
  if (ctx.ok !== true) return { ok: false, reason: ctx.reason, vault: ctx.vault };
  const relPath = suggestCreateRelPath(input.path || input.name || input.file);
  if (!relPath) return { ok: false, reason: "invalid_name" };
  const abs = path.join(ctx.vault.path, ...relPath.split("/"));
  const existing = await readFile(abs, "utf8").then(() => true).catch(() => false);
  if (existing && input.overwrite !== true) return { ok: false, reason: "exists", relPath };
  const content = typeof input.content === "string" ? input.content : `# ${path.posix.basename(relPath, path.posix.extname(relPath))}\n`;
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  return {
    ok: true,
    vault: ctx.vault.name,
    relPath,
    title: titleFromMarkdown(content, relPath),
    created: true,
  };
}

export async function knowledgeAppendNote(input) {
  const read = await knowledgeReadNote(input);
  if (read.ok !== true) return read;
  const addition = String(input.content ?? "");
  if (!addition) return { ok: false, reason: "empty_content", relPath: read.relPath };
  const ctx = await resolveKnowledgeContext(input.knowledgeRoot, input.vault);
  if (ctx.ok !== true) return ctx;
  const abs = path.join(ctx.vault.path, ...read.relPath.split("/"));
  const next = read.content.endsWith("\n") ? `${read.content}${addition}` : `${read.content}\n${addition}`;
  await writeFile(abs, next.endsWith("\n") ? next : `${next}\n`, "utf8");
  return { ok: true, vault: read.vault, relPath: read.relPath, title: read.title, appended: true };
}

export async function knowledgeSetProperty(input) {
  const read = await knowledgeReadNote(input);
  if (read.ok !== true) return read;
  const name = String(input.name ?? "").trim().toLowerCase();
  if (!name) return { ok: false, reason: "missing_name" };
  const { raw, body } = splitFrontmatter(read.content);
  const fields = parseSimpleFields(raw);
  const value = String(input.value ?? "").trim();
  if (name === "title") fields.title = value;
  else if (name === "created") fields.created = value;
  else if (name === "updated") fields.updated = value;
  else if (name === "tags") {
    fields.tags = value
      ? value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
      : [];
  } else {
    return { ok: false, reason: "unsupported_property", name };
  }
  const next = `${serializeFrontmatter(fields)}${body}`;
  const ctx = await resolveKnowledgeContext(input.knowledgeRoot, input.vault);
  if (ctx.ok !== true) return ctx;
  const abs = path.join(ctx.vault.path, ...read.relPath.split("/"));
  await writeFile(abs, next, "utf8");
  return { ok: true, vault: read.vault, relPath: read.relPath, name, value };
}
