/**
 * HR2-B: real per-provider skill/MCP data sources.
 *
 * Pure, read-only helpers. Never writes CLI agent config files. Values coming
 * out of these functions are safe to hand to the renderer.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const SECRET_KEY_RE = /(TOKEN|SECRET|KEY|PASSWORD|PASS|AUTH|BEARER)/i;
const SECRET_VALUE_RE = /^(sk|pk|ghp|gho|ghs|glp|xoxb|xoxp)_[A-Za-z0-9_-]+|^Bearer\s+|^[a-f0-9]{32,}$/i;

function existsDir(p) {
  return stat(p).then((s) => s.isDirectory()).catch(() => false);
}

function existsFile(p) {
  return stat(p).then((s) => s.isFile()).catch(() => false);
}

function providerId(agent) {
  const id = String(agent?.provider ?? agent?.id ?? "").trim().toLowerCase();
  if (id.includes("codex")) return "codex";
  if (id.includes("claude")) return "claude";
  if (id.includes("opencode")) return "opencode";
  if (id.includes("gemini")) return "gemini";
  return id || "unknown";
}

// Aligned with main.mjs::collectAgentSkillRoots. Scans the same roots as the
// management page: workspace walk up to .git, global directories, Studio
// Switch. This ensures the status rail skill count matches the matrix.
export async function resolveNativeSkillRoots(agent, workspaceRoot, overrides = []) {
  const provider = providerId(agent);
  const AGENT_SKILL_SOURCES = [
    { agent: "opencode", subpaths: [[".opencode", "skills"], [".opencode", "skill"]] },
    { agent: "claude", subpaths: [[".claude", "skills"]] },
    { agent: "codex", subpaths: [[".codex", "skills"]] },
    { agent: "hermes", subpaths: [[".hermes", "skills"]] },
    { agent: "openclaw", subpaths: [[".openclaw", "plugin-skills"], [".openclaw", "skills"]] },
    { agent: "onmyagent", subpaths: [[".onmyagent", "skills"]] },
  ];

  const candidates = [];
  const ws = String(workspaceRoot ?? "").trim();
  const seenPaths = new Set();

  const add = async (candidate) => {
    const key = path.resolve(candidate);
    if (seenPaths.has(key)) return;
    seenPaths.add(key);
    if (await existsDir(key)) candidates.push(key);
  };

  // 1. Workspace walk: every directory up to .git boundary (matching the
  //    management page, which scans nested workspaces as well).
  if (ws) {
    let current = path.resolve(ws);
    while (true) {
      if (current === HOME || path.dirname(current) === current) break;
      for (const source of AGENT_SKILL_SOURCES) {
        if (source.agent !== provider) continue;
        for (const subpath of source.subpaths) {
          await add(path.join(current, ...subpath));
        }
      }
      const gitMarker = path.join(current, ".git");
      if (await existsDir(gitMarker) || await existsFile(gitMarker)) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  // 2. Global user-scoped skills (same as management page).
  for (const source of AGENT_SKILL_SOURCES) {
    if (source.agent !== provider) continue;
    for (const subpath of source.subpaths) {
      await add(path.join(HOME, ...subpath));
    }
  }
  // 3. Standard agent skill dir fallback (used by OpenCode which lives under
  //    ~/.config/opencode/skills, not ~/.opencode/skills).
  if (provider === "opencode") {
    await add(path.join(HOME, ".config", "opencode", "skills"));
  }

// 5. Caller-provided overrides (e.g. from native_skills_dirs metadata).
  if (Array.isArray(overrides)) {
    for (const o of overrides) {
      if (typeof o === "string" && o.trim().length) await add(o.trim());
    }
  }

  return candidates;
}

function redactMcpEntry(entry) {
  const redacted = { ...entry };
  if (Array.isArray(redacted.args)) {
    redacted.args = redacted.args.map((a) => (typeof a === "string" && SECRET_VALUE_RE.test(a) ? "<redacted>" : a));
  }
  if (redacted.env && typeof redacted.env === "object") {
    const cleaned = {};
    const redactedKeys = [];
    for (const [k, v] of Object.entries(redacted.env)) {
      if (SECRET_KEY_RE.test(k) || (typeof v === "string" && SECRET_VALUE_RE.test(v))) {
        redactedKeys.push(k);
        continue;
      }
      cleaned[k] = v;
    }
    redacted.env = cleaned;
    if (redactedKeys.length) redacted.redactedEnvKeys = redactedKeys;
  }
  return redacted;
}

function parseTomlMcpServers(text) {
  const servers = [];
  const lines = text.split(/\r?\n/);
  let current = null;
  let inEnv = false;
  let envKey = null;
  for (let raw of lines) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line) continue;
    const section = line.match(/^\[mcp_servers\.([A-Za-z0-9_-]+)(?:\.env)?\s*\]$/);
    if (section) {
      if (line.endsWith(".env ]") || line.endsWith(".env]")) {
        envKey = section[1];
        inEnv = true;
        current = servers.find((s) => s.name === envKey) || null;
        if (!current) {
          current = { name: envKey, type: null, command: null, args: [], env: {}, source: "codex-config" };
          servers.push(current);
        }
        continue;
      }
      inEnv = false;
      envKey = null;
      current = { name: section[1], type: null, command: null, args: [], env: {}, source: "codex-config" };
      servers.push(current);
      continue;
    }
    if (/^\[[^\]]+\]$/.test(line)) {
      current = null;
      inEnv = false;
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();
    if (value.startsWith("\"") && value.endsWith("\"")) value = value.slice(1, -1);
    else if (value.startsWith("[") && value.endsWith("]")) {
      try { value = JSON.parse(value.replace(/'/g, '"')); }
      catch { value = []; }
    } else if (value.startsWith("{") && value.endsWith("}")) {
      try {
        const jsonish = value
          .replace(/([A-Za-z0-9_]+)\s*=/g, '"$1":')
          .replace(/'/g, '"');
        value = JSON.parse(jsonish);
      } catch { value = {}; }
    } else if (/^\d+$/.test(value)) value = Number(value);
    if (inEnv) {
      current.env[key] = value;
      continue;
    }
    if (key === "command") current.command = value;
    else if (key === "args" && Array.isArray(value)) current.args = value;
    else if (key === "type") current.type = value;
    else if (key === "env" && value && typeof value === "object") current.env = { ...(current.env || {}), ...value };
  }
  return servers;
}

async function readCodexMcp(workspaceRoot) {
  const files = [];
  const ws = String(workspaceRoot ?? "").trim();
  if (ws) files.push(path.join(ws, ".codex", "config.toml"));
  files.push(path.join(HOME, ".codex", "config.toml"));
  const results = [];
  const errors = [];
  for (const file of files) {
    if (!(await existsFile(file))) continue;
    try {
      const text = await readFile(file, "utf8");
      const servers = parseTomlMcpServers(text);
      for (const s of servers) {
        results.push(redactMcpEntry({ ...s, transport: s.type || "stdio", enabled: true, sourceFile: file }));
      }
    } catch (e) {
      errors.push({ file, message: String(e?.message || e) });
    }
  }
  return { servers: results, errors };
}

async function readJsonMcp(files, sourceLabel) {
  const results = [];
  const errors = [];
  for (const file of files) {
    if (!(await existsFile(file))) continue;
    try {
      const text = await readFile(file, "utf8");
      const parsed = JSON.parse(text);
      const map = parsed?.mcpServers || parsed?.mcp || {};
      if (map && typeof map === "object") {
        for (const [name, def] of Object.entries(map)) {
          if (!def || typeof def !== "object") continue;
          const d = /** @type any */ (def);
          const entry = {
            name,
            type: d.type || (d.url ? "http" : "stdio"),
            transport: d.transport || d.type || (d.url ? "http" : "stdio"),
            command: d.command || null,
            args: Array.isArray(d.args) ? d.args : Array.isArray(d.command) ? d.command : [],
            env: d.env || d.environment || {},
            url: d.url || null,
            enabled: d.enabled !== false,
            source: sourceLabel,
            sourceFile: file,
          };
          results.push(redactMcpEntry(entry));
        }
      }
    } catch (e) {
      errors.push({ file, message: String(e?.message || e) });
    }
  }
  return { servers: results, errors };
}

async function readClaudeMcp(workspaceRoot) {
  const files = [];
  const ws = String(workspaceRoot ?? "").trim();
  if (ws) files.push(path.join(ws, ".claude", "mcp.json"));
  files.push(path.join(HOME, ".claude.json"));
  files.push(path.join(HOME, ".claude", "mcp.json"));
  return readJsonMcp(files, "claude-config");
}

async function readOpenCodeMcp(workspaceRoot) {
  const files = [];
  const ws = String(workspaceRoot ?? "").trim();
  if (ws) {
    files.push(path.join(ws, "opencode.json"));
    files.push(path.join(ws, ".opencode", "opencode.json"));
  }
  files.push(path.join(HOME, ".config", "opencode", "opencode.json"));
  return readJsonMcp(files, "opencode-config");
}

async function readGeminiMcp(workspaceRoot) {
  const files = [];
  const ws = String(workspaceRoot ?? "").trim();
  if (ws) files.push(path.join(ws, ".gemini", "settings.json"));
  files.push(path.join(HOME, ".gemini", "settings.json"));
  return readJsonMcp(files, "gemini-config");
}

/**
 * Return normalized MCP server list from the CLI provider's own config file(s).
 * Never writes. Redacts values that look like secrets.
 *
 * Result: { servers, errors }.
 */
export async function readNativeMcpConfig(agent, workspaceRoot) {
  const provider = providerId(agent);
  if (provider === "codex") return readCodexMcp(workspaceRoot);
  if (provider === "claude") return readClaudeMcp(workspaceRoot);
  if (provider === "opencode") return readOpenCodeMcp(workspaceRoot);
  if (provider === "gemini") return readGeminiMcp(workspaceRoot);
  return { servers: [], errors: [] };
}
