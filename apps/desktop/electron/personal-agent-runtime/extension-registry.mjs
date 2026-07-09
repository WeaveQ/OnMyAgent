/**
 * OnMyAgent extension registry.
 *
 * Loads `onmyagent-extension.json` manifests from:
 *   1. `bundledRoots` (Electron resources, ships with the app)
 *   2. `userExtensionsRoot()` under runtime-state (user-installed)
 *
 * Each manifest may contribute `contributes.acpAdapters[]`, aligned to
 * AionUi's `acpAdapter` schema. Each adapter becomes a virtual custom
 * agent (`provider: "custom"`, id = `ext:<extensionName>:<adapterId>`).
 * State (enabled/disabled) is persisted at
 * `personalAgentExtensionStateFile()`.
 */

import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { personalAgentExtensionsRoot, personalAgentExtensionStateFile } from "./runtime-state.mjs";

const CONNECTION_KINDS = new Set(["cli", "raw"]);

function textValue(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function stringList(value) {
  return Array.isArray(value) ? value.map((item) => textValue(item)).filter(Boolean) : [];
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true" || text === "1" || text === "yes" || text === "on") return true;
  if (text === "false" || text === "0" || text === "no" || text === "off") return false;
  return fallback;
}

/**
 * Normalize an acpAdapter contribution into internal shape.
 * Throws when required fields are missing/invalid.
 */
export function normalizeAcpAdapterContribution(adapter, extension) {
  if (!adapter || typeof adapter !== "object") throw new Error("acpAdapter must be an object");
  const id = textValue(adapter.id);
  if (!id) throw new Error("acpAdapter.id is required");
  const rawConn = textValue(adapter.connectionType || "cli").toLowerCase();
  const connectionType = CONNECTION_KINDS.has(rawConn) ? rawConn : "cli";
  const cliCommand = textValue(adapter.cliCommand);
  const defaultCliPath = textValue(adapter.defaultCliPath) || cliCommand;
  if (connectionType === "cli" && !defaultCliPath) {
    throw new Error(`acpAdapter ${id}: cliCommand or defaultCliPath is required for connectionType=cli`);
  }
  return {
    id,
    name: textValue(adapter.name) || id,
    description: textValue(adapter.description) || null,
    icon: textValue(adapter.icon) || null,
    connectionType,
    cliCommand: cliCommand || null,
    defaultCliPath,
    acpArgs: stringList(adapter.acpArgs),
    customArgs: stringList(adapter.customArgs),
    env: adapter.env && typeof adapter.env === "object" && !Array.isArray(adapter.env) ? adapter.env : {},
    authRequired: boolValue(adapter.authRequired, false),
    supportsAcp: connectionType === "cli" ? boolValue(adapter.supportsAcp, true) : false,
    supportsStreaming: boolValue(adapter.supportsStreaming, connectionType === "cli"),
    supportsResume: boolValue(adapter.supportsResume, false),
    supportsApproval: boolValue(adapter.supportsApproval, false),
    supportsModelOverride: boolValue(adapter.supportsModelOverride, false),
    supportsPermissionAutoApprove: boolValue(adapter.supportsPermissionAutoApprove, false),
    extension: {
      name: extension.name,
      version: extension.version,
      source: extension.source,
      installRoot: extension.installRoot,
    },
    fullyQualifiedId: `ext:${extension.name}:${id}`,
  };
}

/**
 * Parse a manifest file and return a normalized extension descriptor.
 * Returns null if the file cannot be parsed as JSON.
 */
export async function readExtensionManifest(manifestPath, source) {
  const raw = await readFile(manifestPath, "utf8").catch(() => "");
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const name = textValue(parsed.name);
  if (!name) return null;
  const installRoot = path.dirname(manifestPath);
  const extension = {
    name,
    version: textValue(parsed.version) || "0.0.0",
    displayName: textValue(parsed.displayName) || name,
    description: textValue(parsed.description) || null,
    author: textValue(parsed.author) || null,
    source, // "bundled" | "user"
    installRoot,
    manifestPath,
  };
  const acpAdaptersInput = Array.isArray(parsed?.contributes?.acpAdapters) ? parsed.contributes.acpAdapters : [];
  const adapters = [];
  const errors = [];
  const seen = new Set();
  for (const contribution of acpAdaptersInput) {
    try {
      const adapter = normalizeAcpAdapterContribution(contribution, extension);
      if (seen.has(adapter.id)) throw new Error(`duplicate adapter id within extension: ${adapter.id}`);
      seen.add(adapter.id);
      adapters.push(adapter);
    } catch (error) {
      errors.push({ contribution, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { extension, adapters, errors };
}

async function scanRoot(root, source) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, entry.name, "onmyagent-extension.json");
    const info = await stat(manifestPath).catch(() => null);
    if (!info || !info.isFile()) continue;
    const parsed = await readExtensionManifest(manifestPath, source);
    if (parsed) found.push(parsed);
  }
  return found;
}

async function readState() {
  try {
    const raw = await readFile(personalAgentExtensionStateFile(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { extensions: {} };
    const extensions = parsed.extensions && typeof parsed.extensions === "object" && !Array.isArray(parsed.extensions) ? parsed.extensions : {};
    return { extensions };
  } catch (error) {
    if (error?.code === "ENOENT") return { extensions: {} };
    throw error;
  }
}

async function writeState(state) {
  const file = personalAgentExtensionStateFile();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/**
 * Discover all extensions and their adapter contributions.
 * Bundled and user extensions are merged; user takes precedence for
 * same-name conflicts. Disabled extensions still appear in the raw list
 * (marked `enabled: false`), but their adapters are omitted from
 * `enabledAdapters`.
 */
export async function loadExtensions({ bundledRoots = [] } = {}) {
  const state = await readState();
  const results = [];
  for (const root of bundledRoots) {
    for (const info of await scanRoot(root, "bundled")) results.push(info);
  }
  for (const info of await scanRoot(personalAgentExtensionsRoot(), "user")) results.push(info);

  // Dedupe by extension name; user wins over bundled.
  const byName = new Map();
  for (const info of results) {
    const existing = byName.get(info.extension.name);
    if (!existing) byName.set(info.extension.name, info);
    else if (info.extension.source === "user") byName.set(info.extension.name, info);
  }

  const extensions = [];
  const enabledAdapters = [];
  for (const info of byName.values()) {
    const persisted = state.extensions[info.extension.name] ?? {};
    const enabled = persisted.enabled !== false; // enabled by default
    const descriptor = { ...info.extension, enabled, errors: info.errors, adapterIds: info.adapters.map((a) => a.id) };
    extensions.push(descriptor);
    if (enabled) {
      for (const adapter of info.adapters) enabledAdapters.push(adapter);
    }
  }
  return { extensions, enabledAdapters };
}

export async function setExtensionEnabled(name, enabled) {
  const state = await readState();
  const key = textValue(name);
  if (!key) throw new Error("extension name is required");
  const current = state.extensions[key] ?? {};
  state.extensions[key] = { ...current, enabled: Boolean(enabled), updatedAt: Date.now() };
  await writeState(state);
  return { name: key, enabled: Boolean(enabled) };
}

/**
 * Convert an adapter contribution into a "virtual custom agent" record
 * compatible with the personal-agent-runtime custom agent shape.
 */
export function adapterToCustomAgent(adapter) {
  return {
    id: adapter.fullyQualifiedId,
    name: adapter.name,
    provider: "custom",
    executablePath: adapter.defaultCliPath,
    customArgs: adapter.customArgs,
    acpArgs: adapter.acpArgs,
    env: adapter.env,
    description: adapter.description,
    nativeSkillsDirs: [],
    behaviorPolicy: {},
    connectionType: adapter.connectionType,
    supportsAcp: adapter.supportsAcp,
    supportsStreaming: adapter.supportsStreaming,
    supportsResume: adapter.supportsResume,
    supportsApproval: adapter.supportsApproval,
    supportsModelOverride: adapter.supportsModelOverride,
    supportsPermissionAutoApprove: adapter.supportsPermissionAutoApprove,
    authRequired: adapter.authRequired,
    status: "online",
    enabled: true,
    agent_source: "extension",
    extensionName: adapter.extension.name,
    customAgentSourceId: adapter.fullyQualifiedId,
    connectionMode: adapter.connectionType === "cli" && adapter.supportsAcp ? "Custom ACP session" : "Custom command",
    icon: adapter.icon,
    updatedAt: Date.now(),
  };
}
