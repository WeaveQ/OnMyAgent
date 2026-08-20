/**
 * Locate / open / safely repair OpenCode engine config that can block boot
 * (invalid mcp.* entries, broken JSON, etc.).
 */
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONFIG_BASENAMES = ["opencode.jsonc", "opencode.json"];

/**
 * @param {string} candidate
 */
async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Strip // and /* * / comments for a best-effort parse of .jsonc.
 * @param {string} text
 */
export function stripJsoncComments(text) {
  let out = "";
  let i = 0;
  let inString = false;
  let stringQuote = "";
  let escaped = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === stringQuote) {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Drop trailing commas before `}` / `]` outside strings.
 * @param {string} text
 */
export function stripJsoncTrailingCommas(text) {
  let out = "";
  let i = 0;
  let inString = false;
  let stringQuote = "";
  let escaped = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === stringQuote) {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r")) {
        j += 1;
      }
      if (text[j] === "}" || text[j] === "]") {
        i += 1;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * @param {unknown} entry
 */
export function isValidMcpEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const rec = /** @type {Record<string, unknown>} */ (entry);
  if (typeof rec.enabled !== "boolean") return false;
  if (rec.type === "remote") {
    return typeof rec.url === "string" && rec.url.trim().length > 0;
  }
  if (rec.type === "local") {
    return (
      (typeof rec.command === "string" && rec.command.trim().length > 0) ||
      Array.isArray(rec.command)
    );
  }
  return false;
}

/**
 * Auto-fix common broken remote MCP shapes (url only → remote + enabled).
 * Returns null when the entry cannot be salvaged.
 * @param {unknown} entry
 */
export function tryRepairMcpEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const rec = { .../** @type {Record<string, unknown>} */ (entry) };
  if (typeof rec.url === "string" && rec.url.trim() && rec.type !== "local") {
    rec.type = "remote";
    if (typeof rec.enabled !== "boolean") rec.enabled = true;
  }
  if (isValidMcpEntry(rec)) return rec;
  return null;
}

/**
 * @param {string} raw
 * @returns {{ ok: true, data: Record<string, unknown> } | { ok: false, error: string }}
 */
export function parseOpencodeConfigText(raw) {
  try {
    const stripped = stripJsoncTrailingCommas(stripJsoncComments(raw));
    const data = JSON.parse(stripped);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "root_not_object" };
    }
    return { ok: true, data: /** @type {Record<string, unknown>} */ (data) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {Record<string, unknown>} data
 */
export function repairOpencodeConfigData(data) {
  const next = { ...data };
  /** @type {string[]} */
  const removedMcp = [];
  /** @type {string[]} */
  const fixedMcp = [];
  const mcp = next.mcp;
  if (mcp && typeof mcp === "object" && !Array.isArray(mcp)) {
    /** @type {Record<string, unknown>} */
    const nextMcp = {};
    for (const [name, entry] of Object.entries(
      /** @type {Record<string, unknown>} */ (mcp),
    )) {
      if (isValidMcpEntry(entry)) {
        nextMcp[name] = entry;
        continue;
      }
      const fixed = tryRepairMcpEntry(entry);
      if (fixed) {
        nextMcp[name] = fixed;
        fixedMcp.push(name);
        continue;
      }
      removedMcp.push(name);
    }
    if (Object.keys(nextMcp).length > 0) next.mcp = nextMcp;
    else delete next.mcp;
  }
  return { data: next, removedMcp, fixedMcp };
}

/**
 * Collect candidate OpenCode config directories for this install.
 * @param {{
 *   userDataDir?: string;
 *   homeDir?: string;
 *   env?: NodeJS.ProcessEnv;
 *   runtimeConfigDirs?: string[];
 * }} options
 */
export function collectOpencodeConfigDirs(options = {}) {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? os.homedir();
  const userDataDir = options.userDataDir?.trim() || "";
  /** @type {string[]} */
  const dirs = [];
  const push = (value) => {
    const trimmed = String(value ?? "").trim();
    if (trimmed && !dirs.includes(trimmed)) dirs.push(trimmed);
  };

  for (const d of options.runtimeConfigDirs ?? []) push(d);
  if (env.OPENCODE_CONFIG_DIR?.trim()) push(env.OPENCODE_CONFIG_DIR.trim());
  if (env.XDG_CONFIG_HOME?.trim()) {
    push(path.join(env.XDG_CONFIG_HOME.trim(), "opencode"));
  }
  if (userDataDir) {
    push(path.join(userDataDir, "onmyagent-dev-data", "xdg", "config", "opencode"));
    push(path.join(userDataDir, "onmyagent-dev-data", "config", "opencode"));
    push(path.join(userDataDir, "config", "opencode"));
  }
  push(path.join(home, ".config", "opencode"));
  push(path.join(home, ".opencode"));
  return dirs;
}

/**
 * @param {string[]} dirs
 */
export async function listOpencodeConfigFiles(dirs) {
  /** @type {string[]} */
  const files = [];
  for (const dir of dirs) {
    for (const name of CONFIG_BASENAMES) {
      const full = path.join(dir, name);
      if (await pathExists(full)) files.push(full);
    }
  }
  return files;
}

/**
 * @param {{
 *   userDataDir?: string;
 *   homeDir?: string;
 *   env?: NodeJS.ProcessEnv;
 *   runtimeConfigDirs?: string[];
 *   shellOpenPath: (target: string) => Promise<string>;
 * }} options
 */
export async function openOpencodeConfigDir(options) {
  const dirs = collectOpencodeConfigDirs(options);
  const files = await listOpencodeConfigFiles(dirs);
  const target =
    files[0] != null
      ? path.dirname(files[0])
      : dirs[0] ??
        path.join(options.homeDir ?? os.homedir(), ".config", "opencode");
  await mkdir(target, { recursive: true });
  const err = await options.shellOpenPath(target);
  return {
    ok: !err || String(err).trim() === "",
    path: target,
    files,
    error: err && String(err).trim() ? String(err) : null,
  };
}

/**
 * Backup + repair (or reset to empty) all found OpenCode config files.
 * @param {{
 *   userDataDir?: string;
 *   homeDir?: string;
 *   env?: NodeJS.ProcessEnv;
 *   runtimeConfigDirs?: string[];
 *   resetToEmpty?: boolean;
 * }} options
 */
export async function repairOpencodeEngineConfigs(options = {}) {
  const dirs = collectOpencodeConfigDirs(options);
  const files = await listOpencodeConfigFiles(dirs);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  /** @type {Array<Record<string, unknown>>} */
  const results = [];

  if (files.length === 0) {
    // Ensure a clean default in the preferred dir so next boot is stable.
    const preferred =
      dirs[0] ??
      path.join(options.homeDir ?? os.homedir(), ".config", "opencode");
    await mkdir(preferred, { recursive: true });
    const target = path.join(preferred, "opencode.jsonc");
    const empty = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
    await writeFile(target, empty, "utf8");
    results.push({
      path: target,
      action: "created_empty",
      removedMcp: [],
      fixedMcp: [],
    });
    return { ok: true, results, dirs };
  }

  for (const filePath of files) {
    const raw = await readFile(filePath, "utf8");
    const backupPath = `${filePath}.broken.${stamp}`;
    await copyFile(filePath, backupPath);

    if (options.resetToEmpty) {
      const empty = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
      await writeFile(filePath, empty, "utf8");
      results.push({
        path: filePath,
        backupPath,
        action: "reset_empty",
        removedMcp: [],
        fixedMcp: [],
      });
      continue;
    }

    const parsed = parseOpencodeConfigText(raw);
    if (!parsed.ok) {
      const empty = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
      await writeFile(filePath, empty, "utf8");
      const failed = /** @type {{ ok: false; error: string }} */ (parsed);
      results.push({
        path: filePath,
        backupPath,
        action: "reset_empty_invalid_json",
        parseError: failed.error,
        removedMcp: [],
        fixedMcp: [],
      });
      continue;
    }

    const repaired = repairOpencodeConfigData(parsed.data);
    const body = `${JSON.stringify(repaired.data, null, 2)}\n`;
    await writeFile(filePath, body, "utf8");
    results.push({
      path: filePath,
      backupPath,
      action:
        repaired.removedMcp.length || repaired.fixedMcp.length
          ? "repaired"
          : "rewrote",
      removedMcp: repaired.removedMcp,
      fixedMcp: repaired.fixedMcp,
    });
  }

  return { ok: true, results, dirs };
}
