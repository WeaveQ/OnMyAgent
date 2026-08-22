/**
 * Product-owned OpenCode plugin that exposes knowledge_search.
 * Not a skill: never written to the skills root / listSkills catalog.
 */
import { readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveKnowledgeRoot,
  resolveKnowledgeSessionDefaultsPath,
} from "./knowledge-vault-paths.mjs";
import { resolveUserVaultDirFromKnowledgeRoot } from "./knowledge-vault-config.mjs";
import {
  KNOWLEDGE_MATCH_INLINE_SOURCE,
  knowledgeTextMatchesQuery,
} from "./knowledge-search-match.mjs";
import { walkKnowledgeTree } from "./knowledge-vault-walk.mjs";

export const KNOWLEDGE_SEARCH_PLUGIN_FILE = "knowledge-search.mjs";
export const KNOWLEDGE_TOOL_PLUGIN_FILES = Object.freeze([
  "knowledge-search.mjs",
  "knowledge-read.mjs",
  "knowledge-create.mjs",
  "knowledge-append.mjs",
  "knowledge-property.mjs",
]);
export const KNOWLEDGE_VAULT_SKILL_NAME = "knowledge-vault";
export const KNOWLEDGE_WORKSPACE_ENV = "ONMYAGENT_KNOWLEDGE_WORKSPACE_ID";
export const KNOWLEDGE_EXPERT_ENV = "ONMYAGENT_KNOWLEDGE_EXPERT_ID";

/**
 * @param {{ workspaceId?: string, expertId?: string }} [args]
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {{ workspaceId?: string, expertId?: string }} [defaults]
 */
export function resolveKnowledgeSearchIds(args = {}, env = process.env, defaults = {}) {
  return {
    workspaceId: String(
      args.workspaceId || defaults.workspaceId || env[KNOWLEDGE_WORKSPACE_ENV] || "",
    ).trim(),
    expertId: String(
      args.expertId || defaults.expertId || env[KNOWLEDGE_EXPERT_ENV] || "",
    ).trim(),
  };
}

/**
 * @param {string} [homeDir]
 */
export function readKnowledgeSessionDefaultsSync(homeDir) {
  try {
    const raw = readFileSync(resolveKnowledgeSessionDefaultsPath(homeDir), "utf8");
    const parsed = JSON.parse(raw);
    return {
      workspaceId: String(parsed?.workspaceId ?? "").trim(),
      expertId: String(parsed?.expertId ?? "").trim(),
    };
  } catch {
    return { workspaceId: "", expertId: "" };
  }
}

export async function readKnowledgeSessionDefaults(homeDir) {
  return readKnowledgeSessionDefaultsSync(homeDir);
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ workspaceId?: string, expertId?: string }} ids
 */
export function applyKnowledgeSearchEnv(env, ids = {}) {
  const workspaceId = String(ids.workspaceId ?? "").trim();
  const expertId = String(ids.expertId ?? "").trim();
  if (workspaceId) env[KNOWLEDGE_WORKSPACE_ENV] = workspaceId;
  if (expertId) env[KNOWLEDGE_EXPERT_ENV] = expertId;
  return env;
}

function snippet(body, query) {
  const text = String(body ?? "").replace(/\s+/g, " ").trim();
  const needle = String(query ?? "").trim();
  if (!text) return "";
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  const width = 180;
  if (index < 0) return text.slice(0, width);
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, start + width);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

/**
 * Walk-search used by the generated plugin (and tests).
 * @param {{
 *   knowledgeRoot: string,
 *   query: string,
 *   scope?: "user" | "project" | "expert" | "all",
 *   workspaceId?: string,
 *   expertId?: string,
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   defaults?: { workspaceId?: string, expertId?: string },
 * }} input
 */
export async function executeKnowledgeSearch(input) {
  const query = String(input.query ?? "").trim();
  if (!query) return { ok: false, reason: "empty_query", hits: [] };
  const root = String(input.knowledgeRoot ?? "").trim();
  const fileDefaults = input.defaults ?? (await readFileDefaults(root));
  const ids = resolveKnowledgeSearchIds(input, input.env ?? process.env, fileDefaults);
  const scope =
    input.scope === "user" || input.scope === "project" || input.scope === "expert"
      ? input.scope
      : "all";
  const targets = [];
  if (scope === "all" || scope === "user") {
    targets.push({ scope: "user", dir: resolveUserVaultDirFromKnowledgeRoot(root) });
  }
  if ((scope === "all" || scope === "project") && ids.workspaceId) {
    targets.push({ scope: "project", dir: path.join(root, "projects", ids.workspaceId) });
  }
  if ((scope === "all" || scope === "expert") && ids.expertId) {
    targets.push({ scope: "expert", dir: path.join(root, "experts", ids.expertId) });
  }
  const hits = [];
  for (const target of targets) {
    const files = await walkKnowledgeTree(target.dir);
    for (const file of files) {
      const body = await readFile(file.abs, "utf8").catch(() => "");
      const rel = file.relPath;
      const titleLine = body.match(/^\s*#\s+(.+)$/m);
      const title =
        (titleLine && titleLine[1].trim()) ||
        path.posix.basename(rel, path.posix.extname(rel));
      if (
        knowledgeTextMatchesQuery(title, query) ||
        knowledgeTextMatchesQuery(rel, query) ||
        knowledgeTextMatchesQuery(body, query)
      ) {
        hits.push({
          scope: target.scope,
          relPath: rel,
          title,
          snippet: snippet(body, query),
        });
      }
      if (hits.length >= 20) break;
    }
    if (hits.length >= 20) break;
  }
  return { ok: true, query, hits };
}

async function readFileDefaults(root) {
  try {
    const raw = await readFile(path.join(root, "session-defaults.json"), "utf8");
    const parsed = JSON.parse(raw);
    return {
      workspaceId: String(parsed?.workspaceId ?? "").trim(),
      expertId: String(parsed?.expertId ?? "").trim(),
    };
  } catch {
    return { workspaceId: "", expertId: "" };
  }
}

/**
 * @param {string} knowledgeRoot
 */
function renderNamedToolPlugin(knowledgeRoot, spec) {
  const rootJson = JSON.stringify(knowledgeRoot);
  const argLines = spec.args
    .map((item) => `    ${item.name}: ${item.schema},`)
    .join("\n");
  return `import { tool } from "./knowledge-plugin-runtime.mjs"
import { ${spec.fn} } from "./knowledge-ops.mjs"
const ROOT = ${rootJson}
export default async () => ({
  tool: {
    ${spec.toolName}: tool({
      description: ${JSON.stringify(spec.description)},
      args: {
${argLines}
      },
      async execute(args) {
        const result = await ${spec.fn}({ knowledgeRoot: ROOT, ...args })
        return JSON.stringify(result)
      },
    }),
  },
})
`;
}

export function renderKnowledgeReadPluginSource(knowledgeRoot) {
  return renderNamedToolPlugin(knowledgeRoot, {
    toolName: "knowledge_read",
    fn: "knowledgeReadNote",
    description:
      "Read one note from the local OnMyAgent knowledge vault. Prefer file= (wikilink / note name). Use path= for an exact vault-relative path. Optional vault= selects a space. NOT Obsidian CLI.",
    args: [
      { name: "file", schema: 'tool.schema.string().optional().describe("Note name or [[wikilink]], no path required")' },
      { name: "path", schema: 'tool.schema.string().optional().describe("Exact path from the vault root")' },
      { name: "vault", schema: 'tool.schema.string().optional().describe("Space / vault folder name")' },
    ],
  });
}

export function renderKnowledgeCreatePluginSource(knowledgeRoot) {
  return renderNamedToolPlugin(knowledgeRoot, {
    toolName: "knowledge_create",
    fn: "knowledgeCreateNote",
    description:
      "Create a Markdown note in the local knowledge vault. Use only when the user asked to write a new note. name or path required. NOT a skill install.",
    args: [
      { name: "name", schema: 'tool.schema.string().optional().describe("Note name or folder/name")' },
      { name: "path", schema: 'tool.schema.string().optional().describe("Exact vault-relative path")' },
      { name: "content", schema: 'tool.schema.string().optional().describe("Markdown body")' },
      { name: "vault", schema: 'tool.schema.string().optional().describe("Space / vault folder name")' },
      { name: "overwrite", schema: "tool.schema.boolean().optional().describe(\"Replace an existing note\")" },
    ],
  });
}

export function renderKnowledgeAppendPluginSource(knowledgeRoot) {
  return renderNamedToolPlugin(knowledgeRoot, {
    toolName: "knowledge_append",
    fn: "knowledgeAppendNote",
    description:
      "Append text to an existing knowledge-vault note. Requires file= or path=. Use only when the user asked to add to that note.",
    args: [
      { name: "content", schema: 'tool.schema.string().describe("Text to append")' },
      { name: "file", schema: 'tool.schema.string().optional().describe("Note name or [[wikilink]]")' },
      { name: "path", schema: 'tool.schema.string().optional().describe("Exact vault-relative path")' },
      { name: "vault", schema: 'tool.schema.string().optional().describe("Space / vault folder name")' },
    ],
  });
}

export function renderKnowledgePropertyPluginSource(knowledgeRoot) {
  return renderNamedToolPlugin(knowledgeRoot, {
    toolName: "knowledge_property_set",
    fn: "knowledgeSetProperty",
    description:
      "Set a frontmatter property on a knowledge-vault note. Supported names: title, created, updated, tags.",
    args: [
      { name: "name", schema: 'tool.schema.string().describe("Property name: title, created, updated, tags")' },
      { name: "value", schema: 'tool.schema.string().describe("New value. tags are comma-separated.")' },
      { name: "file", schema: 'tool.schema.string().optional().describe("Note name or [[wikilink]]")' },
      { name: "path", schema: 'tool.schema.string().optional().describe("Exact vault-relative path")' },
      { name: "vault", schema: 'tool.schema.string().optional().describe("Space / vault folder name")' },
    ],
  });
}

export function renderKnowledgeSearchPluginSource(knowledgeRoot) {
  const rootJson = JSON.stringify(knowledgeRoot);
  const workspaceEnv = JSON.stringify(KNOWLEDGE_WORKSPACE_ENV);
  const expertEnv = JSON.stringify(KNOWLEDGE_EXPERT_ENV);
  return `import { readFile } from "node:fs/promises"
import path from "node:path"
import { tool } from "./knowledge-plugin-runtime.mjs"
import { walkKnowledgeTree } from "./knowledge-vault-walk.mjs"

const ROOT = ${rootJson}
const WORKSPACE_ENV = ${workspaceEnv}
const EXPERT_ENV = ${expertEnv}

const readDefaults = async () => {
  try {
    const parsed = JSON.parse(await readFile(path.join(ROOT, "session-defaults.json"), "utf8"))
    return {
      workspaceId: String(parsed?.workspaceId ?? "").trim(),
      expertId: String(parsed?.expertId ?? "").trim(),
    }
  } catch {
    return { workspaceId: "", expertId: "" }
  }
}

${KNOWLEDGE_MATCH_INLINE_SOURCE}

const snippet = (body, query) => {
  const text = String(body ?? "").replace(/\\s+/g, " ").trim()
  const needle = String(query ?? "").trim()
  if (!text) return ""
  const index = text.toLowerCase().indexOf(needle.toLowerCase())
  const width = 180
  if (index < 0) return text.slice(0, width)
  const start = Math.max(0, index - 50)
  const end = Math.min(text.length, start + width)
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "")
}

export default async () => ({
  tool: {
    knowledge_search: tool({
      description:
        "Search the user's local OnMyAgent knowledge vault (Markdown / txt / csv notes). Use this when the user asks about notes, 知识库, saved briefs, or prior written material. This is NOT skills and NOT work memory. Do not list or install skills. Returns title, path, and a short snippet.",
      args: {
        query: tool.schema.string().describe("Keywords to find in note titles or bodies"),
        scope: tool.schema
          .enum(["user", "project", "expert", "all"])
          .optional()
          .describe("Which vault to search. Default all available."),
        workspaceId: tool.schema.string().optional().describe("Current workspace id for project notes"),
        expertId: tool.schema.string().optional().describe("Current expert id for expert notes"),
      },
      async execute(args) {
        const query = String(args.query ?? "").trim()
        if (!query) return JSON.stringify({ ok: false, reason: "empty_query", hits: [] })
        const fileDefaults = await readDefaults()
        const ids = {
          workspaceId: String(args.workspaceId || fileDefaults.workspaceId || process.env[WORKSPACE_ENV] || "").trim(),
          expertId: String(args.expertId || fileDefaults.expertId || process.env[EXPERT_ENV] || "").trim(),
        }
        const scope = args.scope === "user" || args.scope === "project" || args.scope === "expert" ? args.scope : "all"
        const targets = []
        if (scope === "all" || scope === "user") {
          let userDir = path.join(ROOT, "vault")
          try {
            const parsed = JSON.parse(await readFile(path.join(ROOT, "config.json"), "utf8"))
            const override = String(parsed?.personalVaultPath ?? "").trim()
            if (override) userDir = override
          } catch {}
          targets.push({ scope: "user", dir: userDir })
        }
        if ((scope === "all" || scope === "project") && ids.workspaceId) {
          targets.push({ scope: "project", dir: path.join(ROOT, "projects", ids.workspaceId) })
        }
        if ((scope === "all" || scope === "expert") && ids.expertId) {
          targets.push({ scope: "expert", dir: path.join(ROOT, "experts", ids.expertId) })
        }
        const hits = []
        for (const target of targets) {
          const files = await walkKnowledgeTree(target.dir)
          for (const file of files) {
            const body = await readFile(file.abs, "utf8").catch(() => "")
            const rel = file.relPath
            const titleLine = body.match(/^\\s*#\\s+(.+)$/m)
            const title = (titleLine && titleLine[1].trim()) || path.posix.basename(rel, path.posix.extname(rel))
            if (
              knowledgeTextMatchesQuery(title, query) ||
              knowledgeTextMatchesQuery(rel, query) ||
              knowledgeTextMatchesQuery(body, query)
            ) {
              hits.push({
                scope: target.scope,
                relPath: rel,
                title,
                snippet: snippet(body, query),
              })
            }
            if (hits.length >= 20) break
          }
          if (hits.length >= 20) break
        }
        return JSON.stringify({ ok: true, query, hits })
      },
    }),
  },
})
`;
}

/**
 * @param {{
 *   configDir: string,
 *   homeDir?: string,
 * }} input
 */
export async function installKnowledgeSearchPlugin(input) {
  const configDir = String(input.configDir ?? "").trim();
  if (!configDir) return { ok: false, reason: "missing_config_dir" };
  const knowledgeRoot = resolveKnowledgeRoot(input.homeDir);
  const pluginDir = path.join(configDir, "plugins");
  await mkdir(pluginDir, { recursive: true });
  const here = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));
  await copyFile(here("knowledge-vault-walk.mjs"), path.join(pluginDir, "knowledge-vault-walk.mjs"));
  await copyFile(here("knowledge-target.mjs"), path.join(pluginDir, "knowledge-target.mjs"));
  await copyFile(here("knowledge-ops.mjs"), path.join(pluginDir, "knowledge-ops.mjs"));
  await copyFile(here("knowledge-plugin-runtime.mjs"), path.join(pluginDir, "knowledge-plugin-runtime.mjs"));
  const writers = {
    "knowledge-search.mjs": renderKnowledgeSearchPluginSource,
    "knowledge-read.mjs": renderKnowledgeReadPluginSource,
    "knowledge-create.mjs": renderKnowledgeCreatePluginSource,
    "knowledge-append.mjs": renderKnowledgeAppendPluginSource,
    "knowledge-property.mjs": renderKnowledgePropertyPluginSource,
  };
  const pluginPaths = [];
  for (const file of KNOWLEDGE_TOOL_PLUGIN_FILES) {
    const pluginPath = path.join(pluginDir, file);
    await writeFile(pluginPath, writers[file](knowledgeRoot), "utf8");
    pluginPaths.push(pluginPath);
  }
  const skillDir = path.join(configDir, "skills", KNOWLEDGE_VAULT_SKILL_NAME);
  await mkdir(skillDir, { recursive: true });
  const skillSource = fileURLToPath(
    new URL("../resources/bundled-connectors/knowledge-search/SKILL.md", import.meta.url),
  );
  const skillPath = path.join(skillDir, "SKILL.md");
  await copyFile(skillSource, skillPath);
  return {
    ok: true,
    pluginPath: pluginPaths[0],
    pluginPaths,
    skillPath,
    knowledgeRoot,
  };
}
