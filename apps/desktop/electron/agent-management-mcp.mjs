import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import YAML from "yaml";

export const AGENT_MANAGEMENT_MCP_APPS = ["claude", "codex", "gemini", "opencode", "hermes"];

const APP_LABELS = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
  hermes: "Hermes",
};

const HERMES_EXTRA_FIELDS = new Set(["enabled", "timeout", "connect_timeout", "tools", "sampling", "roots", "auth"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function jsonObject(value) {
  return isRecord(value) ? cloneJson(value) : {};
}

function parseJsonLike(raw) {
  const text = String(raw ?? "").replace(/^\uFEFF/, "");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
    const withoutLineComments = withoutBlockComments.replace(/(^|[^:])\/\/.*$/gm, "$1");
    const withoutTrailingCommas = withoutLineComments.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(withoutTrailingCommas || "{}");
  }
}

async function readJsonLikeFile(filePath) {
  try {
    return parseJsonLike(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

async function writeJsonFileAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

async function writeTextFileAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

function defaultConfigPaths(homeDir) {
  return {
    claude: path.join(homeDir, ".claude.json"),
    codex: path.join(homeDir, ".codex", "config.toml"),
    gemini: path.join(homeDir, ".gemini", "settings.json"),
    opencode: path.join(homeDir, ".config", "opencode", "opencode.json"),
    hermes: path.join(homeDir, ".hermes", "config.yaml"),
  };
}

function createDefaultEnvironment(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  return {
    homeDir,
    databasePath: options.databasePath || path.join(homeDir, ".studio-switch", "studio-switch.db"),
    configPaths: { ...defaultConfigPaths(homeDir), ...(options.configPaths ?? {}) },
    shouldSync: options.shouldSync || ((app) => {
      const filePath = { ...defaultConfigPaths(homeDir), ...(options.configPaths ?? {}) }[app];
      if (!filePath) return false;
      if (existsSync(filePath)) return true;
      const dir = path.dirname(filePath);
      return existsSync(dir);
    }),
  };
}

function appFlagsFromApps(apps) {
  const set = new Set(apps ?? []);
  return Object.fromEntries(AGENT_MANAGEMENT_MCP_APPS.map((app) => [app, set.has(app)]));
}

function enabledAppsFromFlags(flags) {
  return AGENT_MANAGEMENT_MCP_APPS.filter((app) => Boolean(flags?.[app]));
}

export function validateMcpSpec(spec) {
  if (!isRecord(spec)) throw new Error("MCP server spec must be an object");
  const type = typeof spec.type === "string" ? spec.type : "stdio";
  if (!["stdio", "http", "sse"].includes(type)) throw new Error("MCP type must be stdio, http, or sse");
  if (type === "stdio" && typeof spec.command !== "string") throw new Error("stdio MCP requires command");
  if (type === "stdio" && !spec.command.trim()) throw new Error("stdio MCP requires command");
  if ((type === "http" || type === "sse") && (typeof spec.url !== "string" || !spec.url.trim())) throw new Error(`${type} MCP requires url`);
  return true;
}

function normalizeMcpSpec(spec) {
  const next = jsonObject(spec);
  next.type = typeof next.type === "string" && next.type.trim() ? next.type.trim() : "stdio";
  if (Array.isArray(next.args)) next.args = next.args.filter((item) => typeof item === "string");
  if (isRecord(next.env)) next.env = Object.fromEntries(Object.entries(next.env).filter(([, value]) => typeof value === "string"));
  if (isRecord(next.headers)) next.headers = Object.fromEntries(Object.entries(next.headers).filter(([, value]) => typeof value === "string"));
  validateMcpSpec(next);
  return next;
}

function normalizeMcpServer(input) {
  const id = String(input?.id ?? "").trim();
  if (!id || id.startsWith("-") || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid MCP server id");
  const tags = Array.isArray(input?.tags) ? input.tags.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
  const apps = appFlagsFromApps(enabledAppsFromFlags(input?.apps));
  return {
    id,
    name: String(input?.name ?? id).trim() || id,
    description: typeof input?.description === "string" && input.description.trim() ? input.description.trim() : null,
    homepage: typeof input?.homepage === "string" && input.homepage.trim() ? input.homepage.trim() : null,
    docs: typeof input?.docs === "string" && input.docs.trim() ? input.docs.trim() : null,
    tags,
    server: normalizeMcpSpec(input?.server ?? input?.spec),
    apps,
    createdAt: Number.isFinite(input?.createdAt) ? Number(input.createdAt) : Date.now(),
    updatedAt: Date.now(),
  };
}

function mcpServerFromRow(row) {
  const apps = appFlagsFromApps(AGENT_MANAGEMENT_MCP_APPS.filter((app) => Number(row[`enabled_${app}`]) === 1));
  return normalizeMcpServer({
    id: row.id,
    name: row.name,
    description: row.description,
    homepage: row.homepage,
    docs: row.docs,
    tags: parseJsonLike(row.tags || "[]"),
    server: parseJsonLike(row.server_config || "{}"),
    apps,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function ensureMcpSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    server_config TEXT NOT NULL,
    description TEXT,
    homepage TEXT,
    docs TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    enabled_claude INTEGER NOT NULL DEFAULT 0,
    enabled_codex INTEGER NOT NULL DEFAULT 0,
    enabled_gemini INTEGER NOT NULL DEFAULT 0,
    enabled_opencode INTEGER NOT NULL DEFAULT 0,
    enabled_hermes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  const columns = new Set(db.prepare("PRAGMA table_info(mcp_servers)").all().map((column) => column.name));
  const addColumn = (name, definition) => {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE mcp_servers ADD COLUMN ${name} ${definition}`);
      columns.add(name);
    }
  };
  addColumn("description", "TEXT");
  addColumn("homepage", "TEXT");
  addColumn("docs", "TEXT");
  addColumn("tags", "TEXT NOT NULL DEFAULT '[]'");
  addColumn("enabled_claude", "INTEGER NOT NULL DEFAULT 0");
  addColumn("enabled_codex", "INTEGER NOT NULL DEFAULT 0");
  addColumn("enabled_gemini", "INTEGER NOT NULL DEFAULT 0");
  addColumn("enabled_opencode", "INTEGER NOT NULL DEFAULT 0");
  addColumn("enabled_hermes", "INTEGER NOT NULL DEFAULT 0");
  addColumn("created_at", "INTEGER NOT NULL DEFAULT 0");
  addColumn("updated_at", "INTEGER NOT NULL DEFAULT 0");
  const now = Date.now();
  db.prepare("UPDATE mcp_servers SET created_at = ? WHERE created_at = 0 OR created_at IS NULL").run(now);
  db.prepare("UPDATE mcp_servers SET updated_at = ? WHERE updated_at = 0 OR updated_at IS NULL").run(now);
}

function withMcpDatabase(environment, callback) {
  mkdirSync(path.dirname(environment.databasePath), { recursive: true });
  const db = new DatabaseSync(environment.databasePath);
  try {
    ensureMcpSchema(db);
    return callback(db);
  } finally {
    db.close();
  }
}

export function listMcpServers(options = {}) {
  const environment = createDefaultEnvironment(options);
  return withMcpDatabase(environment, (db) => db.prepare("SELECT * FROM mcp_servers ORDER BY lower(name), lower(id)").all().map(mcpServerFromRow));
}

function saveMcpServer(environment, server) {
  const normalized = normalizeMcpServer(server);
  withMcpDatabase(environment, (db) => {
    db.prepare(`INSERT INTO mcp_servers (
      id, name, server_config, description, homepage, docs, tags,
      enabled_claude, enabled_codex, enabled_gemini, enabled_opencode, enabled_hermes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      server_config = excluded.server_config,
      description = excluded.description,
      homepage = excluded.homepage,
      docs = excluded.docs,
      tags = excluded.tags,
      enabled_claude = excluded.enabled_claude,
      enabled_codex = excluded.enabled_codex,
      enabled_gemini = excluded.enabled_gemini,
      enabled_opencode = excluded.enabled_opencode,
      enabled_hermes = excluded.enabled_hermes,
      updated_at = excluded.updated_at`).run(
      normalized.id,
      normalized.name,
      JSON.stringify(normalized.server),
      normalized.description,
      normalized.homepage,
      normalized.docs,
      JSON.stringify(normalized.tags),
      normalized.apps.claude ? 1 : 0,
      normalized.apps.codex ? 1 : 0,
      normalized.apps.gemini ? 1 : 0,
      normalized.apps.opencode ? 1 : 0,
      normalized.apps.hermes ? 1 : 0,
      normalized.createdAt,
      normalized.updatedAt,
    );
  });
  return normalized;
}

function deleteMcpServer(environment, id) {
  return withMcpDatabase(environment, (db) => db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id).changes > 0);
}

function getMcpServer(environment, id) {
  return withMcpDatabase(environment, (db) => {
    const row = db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id);
    return row ? mcpServerFromRow(row) : null;
  });
}

function appStatus(environment) {
  return Object.fromEntries(AGENT_MANAGEMENT_MCP_APPS.map((app) => {
    const configPath = environment.configPaths[app];
    const configDir = path.dirname(configPath);
    return [app, {
      app,
      label: APP_LABELS[app],
      configPath,
      configExists: existsSync(configPath),
      configDirExists: existsSync(configDir),
      syncSupported: true,
    }];
  }));
}

function readTopLevelTomlTables(raw, sectionName) {
  const tables = {};
  let current = null;
  let currentNested = null;
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      const name = header[1].trim();
      const prefix = `${sectionName}.`;
      current = null;
      currentNested = null;
      if (name.startsWith(prefix)) {
        let id = name.slice(prefix.length);
        for (const nested of ["http_headers", "headers", "env"]) {
          const suffix = `.${nested}`;
          if (id.endsWith(suffix)) {
            id = id.slice(0, -suffix.length);
            currentNested = nested;
            break;
          }
        }
        current = id || null;
        if (current && !tables[current]) tables[current] = {};
        if (current && currentNested && !isRecord(tables[current][currentNested])) tables[current][currentNested] = {};
      }
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/);
    if (!kv) continue;
    if (currentNested) tables[current][currentNested][kv[1]] = parseSimpleTomlValue(kv[2]);
    else tables[current][kv[1]] = parseSimpleTomlValue(kv[2]);
  }
  return tables;
}

function parseSimpleTomlValue(raw) {
  const text = String(raw ?? "").trim().replace(/\s+#.*$/, "");
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^\[.*\]$/.test(text)) {
    try { return JSON.parse(text); } catch { return []; }
  }
  if (/^\{.*\}$/.test(text)) return parseSimpleInlineTable(text);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    try { return JSON.parse(text); } catch { return text.slice(1, -1); }
  }
  return text;
}

function parseSimpleInlineTable(raw) {
  const body = String(raw).trim().replace(/^\{/, "").replace(/\}$/, "");
  const out = {};
  for (const part of body.split(/,\s*/)) {
    const match = part.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/);
    if (match) out[match[1]] = parseSimpleTomlValue(match[2]);
  }
  return out;
}

function tomlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function tomlValue(value) {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.filter((item) => ["string", "number", "boolean"].includes(typeof item)).map(tomlValue).join(", ")}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, item]) => typeof item === "string");
    return `{ ${entries.map(([key, item]) => `${key} = ${tomlString(item)}`).join(", ")} }`;
  }
  return tomlString(value);
}

function sanitizeSpecForJsonClient(spec) {
  const next = normalizeMcpSpec(spec);
  delete next.enabled;
  delete next.source;
  return next;
}

function convertToOpenCodeSpec(spec) {
  const normalized = normalizeMcpSpec(spec);
  if (normalized.type === "stdio") {
    const command = [normalized.command, ...(Array.isArray(normalized.args) ? normalized.args : [])].filter((item) => typeof item === "string");
    const next = { type: "local", command, enabled: true };
    if (isRecord(normalized.env) && Object.keys(normalized.env).length > 0) next.environment = normalized.env;
    return next;
  }
  const next = { type: "remote", url: normalized.url, enabled: true };
  if (isRecord(normalized.headers) && Object.keys(normalized.headers).length > 0) next.headers = normalized.headers;
  return next;
}

function convertFromOpenCodeSpec(spec) {
  const input = jsonObject(spec);
  const type = typeof input.type === "string" ? input.type : "local";
  if (type === "local") {
    const commandList = Array.isArray(input.command) ? input.command.filter((item) => typeof item === "string") : [];
    const command = commandList[0] || (typeof input.command === "string" ? input.command : "");
    const next = { type: "stdio", command };
    const args = commandList.slice(1);
    if (args.length > 0) next.args = args;
    if (isRecord(input.environment)) next.env = input.environment;
    return normalizeMcpSpec(next);
  }
  if (type === "remote") {
    const next = { type: "sse", url: input.url };
    if (isRecord(input.headers)) next.headers = input.headers;
    return normalizeMcpSpec(next);
  }
  return normalizeMcpSpec(input);
}

function convertToHermesSpec(spec, existingSpec = null) {
  const normalized = normalizeMcpSpec(spec);
  /** @type {Record<string, unknown>} */
  const preserved = {};
  if (isRecord(existingSpec)) {
    for (const key of HERMES_EXTRA_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(existingSpec, key)) preserved[key] = existingSpec[key];
    }
  }
  /** @type {Record<string, unknown>} */
  const next = { ...preserved };
  if (normalized.type === "stdio") {
    next.command = normalized.command;
    if (Array.isArray(normalized.args) && normalized.args.length > 0) next.args = normalized.args;
    if (isRecord(normalized.env) && Object.keys(normalized.env).length > 0) next.env = normalized.env;
    delete next.url;
    delete next.headers;
  } else {
    next.url = normalized.url;
    if (isRecord(normalized.headers) && Object.keys(normalized.headers).length > 0) next.headers = normalized.headers;
    delete next.command;
    delete next.args;
    delete next.env;
  }
  if (!Object.prototype.hasOwnProperty.call(next, "enabled")) next.enabled = true;
  return next;
}

function convertFromHermesSpec(id, spec) {
  const input = jsonObject(spec);
  if (typeof input.command === "string") {
    const next = { type: "stdio", command: input.command };
    if (Array.isArray(input.args)) next.args = input.args.filter((item) => typeof item === "string");
    if (isRecord(input.env)) next.env = input.env;
    return normalizeMcpSpec(next);
  }
  if (typeof input.url === "string") {
    const next = { type: "sse", url: input.url };
    if (isRecord(input.headers)) next.headers = input.headers;
    return normalizeMcpSpec(next);
  }
  throw new Error(`Hermes MCP server '${id}' has neither command nor url`);
}

function convertToGeminiSpec(spec) {
  const next = sanitizeSpecForJsonClient(spec);
  if (next.type === "http" && typeof next.url === "string") {
    next.httpUrl = next.url;
    delete next.url;
  }
  delete next.type;
  if (!Object.prototype.hasOwnProperty.call(next, "timeout")) next.timeout = 60000;
  return next;
}

function convertFromGeminiSpec(spec) {
  const input = jsonObject(spec);
  if (typeof input.httpUrl === "string") {
    input.url = input.httpUrl;
    input.type = "http";
    delete input.httpUrl;
  }
  if (typeof input.type !== "string") input.type = typeof input.command === "string" ? "stdio" : "sse";
  return normalizeMcpSpec(input);
}

async function readJsonMcpMap(filePath) {
  const root = await readJsonLikeFile(filePath);
  return isRecord(root.mcpServers) ? root.mcpServers : {};
}

async function writeJsonMcpMap(filePath, map) {
  const root = await readJsonLikeFile(filePath);
  const nextRoot = isRecord(root) ? root : {};
  nextRoot.mcpServers = map;
  await writeJsonFileAtomic(filePath, nextRoot);
}

async function readOpenCodeMcpMap(filePath) {
  const root = await readJsonLikeFile(filePath);
  return isRecord(root.mcp) ? root.mcp : {};
}

async function writeOpenCodeMcpMap(filePath, map) {
  const root = await readJsonLikeFile(filePath);
  const nextRoot = isRecord(root) ? root : {};
  nextRoot.mcp = map;
  await writeJsonFileAtomic(filePath, nextRoot);
}

async function readHermesMcpMap(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const root = YAML.parse(raw) ?? {};
    return isRecord(root.mcp_servers) ? root.mcp_servers : {};
  } catch {
    return {};
  }
}

async function writeHermesMcpMap(filePath, map) {
  let root = {};
  try {
    root = YAML.parse(await readFile(filePath, "utf8")) ?? {};
  } catch {
    root = {};
  }
  const nextRoot = isRecord(root) ? root : {};
  nextRoot.mcp_servers = map;
  await writeTextFileAtomic(filePath, YAML.stringify(nextRoot));
}

function stripTomlSections(raw, sectionNames) {
  const sections = new Set(sectionNames);
  const lines = String(raw ?? "").split(/\r?\n/);
  const out = [];
  let skip = false;
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      const name = header[1].trim();
      skip = Array.from(sections).some((section) => name === section || name.startsWith(`${section}.`));
    }
    if (!skip) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function specToCodexTomlTable(spec) {
  const normalized = normalizeMcpSpec(spec);
  const lines = [`type = ${tomlString(normalized.type)}`];
  if (normalized.type === "stdio") {
    lines.push(`command = ${tomlString(normalized.command)}`);
    if (Array.isArray(normalized.args) && normalized.args.length > 0) lines.push(`args = ${tomlValue(normalized.args)}`);
    if (typeof normalized.cwd === "string" && normalized.cwd.trim()) lines.push(`cwd = ${tomlString(normalized.cwd)}`);
    if (isRecord(normalized.env) && Object.keys(normalized.env).length > 0) lines.push(`env = ${tomlValue(normalized.env)}`);
  } else {
    lines.push(`url = ${tomlString(normalized.url)}`);
    if (isRecord(normalized.headers) && Object.keys(normalized.headers).length > 0) lines.push(`http_headers = ${tomlValue(normalized.headers)}`);
  }
  return lines.join("\n");
}

async function readCodexMcpMap(filePath) {
  let raw = "";
  try { raw = await readFile(filePath, "utf8"); } catch { return {}; }
  const official = readTopLevelTomlTables(raw, "mcp_servers");
  const legacy = readTopLevelTomlTables(raw, "mcp.servers");
  const merged = { ...legacy, ...official };
  return Object.fromEntries(Object.entries(merged).map(([id, spec]) => {
    const next = { ...spec };
    if (isRecord(next.http_headers) && !isRecord(next.headers)) {
      next.headers = next.http_headers;
      delete next.http_headers;
    }
    if (typeof next.type !== "string") next.type = "stdio";
    return [id, normalizeMcpSpec(next)];
  }));
}

async function writeCodexMcpMap(filePath, map) {
  let raw = "";
  try { raw = await readFile(filePath, "utf8"); } catch { raw = ""; }
  const base = stripTomlSections(raw, ["mcp_servers", "mcp.servers"]);
  const ids = Object.keys(map).sort((a, b) => a.localeCompare(b));
  const mcpText = ids.map((id) => `[mcp_servers.${id}]\n${specToCodexTomlTable(map[id])}`).join("\n\n");
  const content = [base, mcpText].filter((part) => part.trim()).join("\n\n");
  await writeTextFileAtomic(filePath, `${content.trimEnd()}\n`);
}

async function readAppMcpServers(environment, app) {
  const filePath = environment.configPaths[app];
  if (app === "claude") return Object.fromEntries(Object.entries(await readJsonMcpMap(filePath)).map(([id, spec]) => [id, normalizeMcpSpec(spec)]));
  if (app === "gemini") return Object.fromEntries(Object.entries(await readJsonMcpMap(filePath)).map(([id, spec]) => [id, convertFromGeminiSpec(spec)]));
  if (app === "codex") return readCodexMcpMap(filePath);
  if (app === "opencode") return Object.fromEntries(Object.entries(await readOpenCodeMcpMap(filePath)).map(([id, spec]) => [id, convertFromOpenCodeSpec(spec)]));
  if (app === "hermes") return Object.fromEntries(Object.entries(await readHermesMcpMap(filePath)).map(([id, spec]) => [id, convertFromHermesSpec(id, spec)]));
  return {};
}

async function syncServerToApp(environment, server, app) {
  if (!environment.shouldSync(app)) return { app, skipped: true };
  const filePath = environment.configPaths[app];
  if (app === "claude") {
    const map = await readJsonMcpMap(filePath);
    map[server.id] = sanitizeSpecForJsonClient(server.server);
    await writeJsonMcpMap(filePath, map);
  } else if (app === "gemini") {
    const map = await readJsonMcpMap(filePath);
    map[server.id] = convertToGeminiSpec(server.server);
    await writeJsonMcpMap(filePath, map);
  } else if (app === "codex") {
    const map = await readCodexMcpMap(filePath);
    map[server.id] = server.server;
    await writeCodexMcpMap(filePath, map);
  } else if (app === "opencode") {
    const map = await readOpenCodeMcpMap(filePath);
    map[server.id] = convertToOpenCodeSpec(server.server);
    await writeOpenCodeMcpMap(filePath, map);
  } else if (app === "hermes") {
    const map = await readHermesMcpMap(filePath);
    map[server.id] = convertToHermesSpec(server.server, map[server.id]);
    await writeHermesMcpMap(filePath, map);
  }
  return { app, skipped: false, configPath: filePath };
}

async function removeServerFromApp(environment, id, app) {
  if (!environment.shouldSync(app)) return { app, skipped: true };
  const filePath = environment.configPaths[app];
  if (app === "claude" || app === "gemini") {
    const map = await readJsonMcpMap(filePath);
    delete map[id];
    await writeJsonMcpMap(filePath, map);
  } else if (app === "codex") {
    const map = await readCodexMcpMap(filePath);
    delete map[id];
    await writeCodexMcpMap(filePath, map);
  } else if (app === "opencode") {
    const map = await readOpenCodeMcpMap(filePath);
    delete map[id];
    await writeOpenCodeMcpMap(filePath, map);
  } else if (app === "hermes") {
    const map = await readHermesMcpMap(filePath);
    delete map[id];
    await writeHermesMcpMap(filePath, map);
  }
  return { app, skipped: false, configPath: filePath };
}

async function syncServerToEnabledApps(environment, server) {
  const results = [];
  for (const app of enabledAppsFromFlags(server.apps)) results.push(await syncServerToApp(environment, server, app));
  return results;
}

function mergeImportedServer(existing, imported, sourceApp) {
  if (existing) {
    return normalizeMcpServer({ ...existing, apps: { ...existing.apps, [sourceApp]: true }, createdAt: existing.createdAt });
  }
  return normalizeMcpServer({ id: imported.id, name: imported.name || imported.id, server: imported.server, apps: { [sourceApp]: true } });
}

export async function agentManagementMcpSnapshot(options = {}) {
  const environment = createDefaultEnvironment(options);
  const servers = listMcpServers(options);
  const countsByApp = Object.fromEntries(AGENT_MANAGEMENT_MCP_APPS.map((app) => [app, servers.filter((server) => server.apps[app]).length]));
  return {
    generatedAt: Date.now(),
    databasePath: environment.databasePath,
    apps: appStatus(environment),
    servers,
    total: servers.length,
    countsByApp,
  };
}

export async function importMcpFromApps(input = {}, options = {}) {
  const environment = createDefaultEnvironment(options);
  const requested = input.app ? [input.app] : (Array.isArray(input.apps) && input.apps.length > 0 ? input.apps : AGENT_MANAGEMENT_MCP_APPS);
  const apps = requested.filter((app) => AGENT_MANAGEMENT_MCP_APPS.includes(app));
  const summary = [];
  let imported = 0;
  let updated = 0;
  for (const app of apps) {
    const discovered = await readAppMcpServers(environment, app).catch(() => ({}));
    let appImported = 0;
    let appUpdated = 0;
    for (const [id, spec] of Object.entries(discovered)) {
      const existing = getMcpServer(environment, id);
      const merged = mergeImportedServer(existing, { id, name: id, server: spec }, app);
      saveMcpServer(environment, merged);
      if (existing) appUpdated += 1;
      else appImported += 1;
    }
    imported += appImported;
    updated += appUpdated;
    summary.push({ app, imported: appImported, updated: appUpdated, total: Object.keys(discovered).length });
  }
  return { ok: true, imported, updated, summary, snapshot: await agentManagementMcpSnapshot(options) };
}

export async function upsertMcpServer(input = {}, options = {}) {
  const environment = createDefaultEnvironment(options);
  const previous = getMcpServer(environment, input.id);
  const server = saveMcpServer(environment, input);
  const syncResults = [];
  for (const app of AGENT_MANAGEMENT_MCP_APPS) {
    const wasEnabled = Boolean(previous?.apps?.[app]);
    const isEnabled = Boolean(server.apps?.[app]);
    if (wasEnabled && !isEnabled) syncResults.push(await removeServerFromApp(environment, server.id, app));
  }
  syncResults.push(...await syncServerToEnabledApps(environment, server));
  return { ok: true, server, syncResults, snapshot: await agentManagementMcpSnapshot(options) };
}

export async function deleteMcpServerAction(input = {}, options = {}) {
  const environment = createDefaultEnvironment(options);
  const id = String(input.id ?? "").trim();
  const previous = getMcpServer(environment, id);
  const removed = deleteMcpServer(environment, id);
  const syncResults = [];
  if (previous) {
    for (const app of enabledAppsFromFlags(previous.apps)) syncResults.push(await removeServerFromApp(environment, id, app));
  }
  return { ok: true, removed, syncResults, snapshot: await agentManagementMcpSnapshot(options) };
}

export async function toggleMcpServerApp(input = {}, options = {}) {
  const environment = createDefaultEnvironment(options);
  const id = String(input.id ?? "").trim();
  const app = String(input.app ?? "").trim();
  if (!AGENT_MANAGEMENT_MCP_APPS.includes(app)) throw new Error("Unsupported MCP agent");
  const existing = getMcpServer(environment, id);
  if (!existing) throw new Error("MCP server not found");
  const enabled = Boolean(input.enabled);
  const nextServer = normalizeMcpServer({ ...existing, apps: { ...existing.apps, [app]: enabled }, createdAt: existing.createdAt });
  const syncResult = enabled ? await syncServerToApp(environment, nextServer, app) : await removeServerFromApp(environment, id, app);
  const server = saveMcpServer(environment, nextServer);
  return { ok: true, server, syncResult, snapshot: await agentManagementMcpSnapshot(options) };
}
