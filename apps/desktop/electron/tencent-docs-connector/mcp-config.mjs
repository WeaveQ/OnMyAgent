/**
 * Read/write OpenCode global mcp entries for Tencent Docs (headers auth).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { MCP_SERVERS, PLUGIN_ID } from "./constants.mjs";

/**
 * @param {string} globalOpencodeRoot
 */
export function resolveGlobalOpencodeConfigPaths(globalOpencodeRoot) {
  return {
    jsoncPath: path.join(globalOpencodeRoot, "opencode.jsonc"),
    jsonPath: path.join(globalOpencodeRoot, "opencode.json"),
  };
}

/**
 * @param {string} globalOpencodeRoot
 * @param {(p: string) => Promise<boolean>} pathExists
 */
export async function resolveGlobalOpencodeConfigPath(
  globalOpencodeRoot,
  pathExists,
) {
  const { jsoncPath, jsonPath } =
    resolveGlobalOpencodeConfigPaths(globalOpencodeRoot);
  if (await pathExists(jsoncPath)) return jsoncPath;
  if (await pathExists(jsonPath)) return jsonPath;
  return jsonPath;
}

/**
 * Strip // and /* *\/ comments for a best-effort JSONC parse.
 * @param {string} raw
 */
export function stripJsonc(raw) {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * @param {string} raw
 * @returns {Record<string, unknown>}
 */
export function parseConfigObject(raw) {
  if (!raw?.trim()) {
    return { $schema: "https://opencode.ai/config.json" };
  }
  try {
    const parsed = JSON.parse(stripJsonc(raw));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return /** @type {Record<string, unknown>} */ (parsed);
    }
  } catch {
    // fall through
  }
  return { $schema: "https://opencode.ai/config.json" };
}

/**
 * @param {string} accessToken
 * @returns {Record<string, unknown>}
 */
export function buildTencentDocsMcpMap(accessToken) {
  /** @type {Record<string, unknown>} */
  const map = {};
  for (const server of MCP_SERVERS) {
    map[server.name] = {
      type: "remote",
      url: server.url,
      enabled: true,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      // Product marker (ignored by OpenCode; helps disconnect ownership checks).
      _onmyagent: {
        owner: "onmyagent",
        pluginId: PLUGIN_ID,
        role: server.role,
      },
    };
  }
  return map;
}

/**
 * @param {Record<string, unknown>} config
 * @param {string} accessToken
 */
export function upsertTencentDocsMcp(config, accessToken) {
  const next = { ...config };
  if (!next.$schema) {
    next.$schema = "https://opencode.ai/config.json";
  }
  const existing =
    next.mcp && typeof next.mcp === "object" && !Array.isArray(next.mcp)
      ? { .../** @type {Record<string, unknown>} */ (next.mcp) }
      : {};
  Object.assign(existing, buildTencentDocsMcpMap(accessToken));
  next.mcp = existing;
  return next;
}

/**
 * @param {Record<string, unknown>} config
 * @param {readonly string[]} serverNames
 */
export function removeTencentDocsMcp(config, serverNames) {
  const next = { ...config };
  const existing =
    next.mcp && typeof next.mcp === "object" && !Array.isArray(next.mcp)
      ? { .../** @type {Record<string, unknown>} */ (next.mcp) }
      : {};
  for (const name of serverNames) {
    const entry = existing[name];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      delete existing[name];
      continue;
    }
    const markerRaw = /** @type {Record<string, unknown>} */ (entry)._onmyagent;
    // Remove product-managed entries, or same-name remote URLs we own by convention.
    if (markerRaw && typeof markerRaw === "object" && !Array.isArray(markerRaw)) {
      const marker = /** @type {Record<string, unknown>} */ (markerRaw);
      if (marker.pluginId === PLUGIN_ID) {
        delete existing[name];
        continue;
      }
    }
    // If user rewrote the entry without marker, still remove known product names
    // only when URL matches our catalog (avoid deleting unrelated custom MCP).
    const url =
      typeof /** @type {Record<string, unknown>} */ (entry).url === "string"
        ? /** @type {Record<string, unknown>} */ (entry).url
        : "";
    const known = MCP_SERVERS.find((s) => s.name === name);
    if (known && url === known.url) {
      delete existing[name];
    }
  }
  next.mcp = existing;
  return next;
}

/**
 * @param {Record<string, unknown>} config
 * @param {readonly string[]} serverNames
 */
export function hasManagedTencentDocsMcp(config, serverNames) {
  const mcp =
    config.mcp && typeof config.mcp === "object" && !Array.isArray(config.mcp)
      ? /** @type {Record<string, unknown>} */ (config.mcp)
      : null;
  if (!mcp) return false;
  return serverNames.some((name) => {
    const entry = mcp[name];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const rec = /** @type {Record<string, unknown>} */ (entry);
    if (rec.enabled === false) return false;
    return typeof rec.url === "string" && rec.url.length > 0;
  });
}

/**
 * @param {{
 *   globalOpencodeRoot: string,
 *   pathExists: (p: string) => Promise<boolean>,
 * }} io
 * @param {(config: Record<string, unknown>) => Record<string, unknown>} mutate
 */
export async function updateGlobalOpencodeConfig(io, mutate) {
  const configPath = await resolveGlobalOpencodeConfigPath(
    io.globalOpencodeRoot,
    io.pathExists,
  );
  let raw = "";
  if (await io.pathExists(configPath)) {
    raw = await readFile(configPath, "utf8");
  }
  const current = parseConfigObject(raw);
  const next = mutate(current);
  await mkdir(path.dirname(configPath), { recursive: true });
  const text = `${JSON.stringify(next, null, 2)}\n`;
  await writeFile(configPath, text, "utf8");
  return { path: configPath, config: next };
}

/**
 * @param {{
 *   globalOpencodeRoot: string,
 *   pathExists: (p: string) => Promise<boolean>,
 * }} io
 */
export async function readGlobalOpencodeConfig(io) {
  const configPath = await resolveGlobalOpencodeConfigPath(
    io.globalOpencodeRoot,
    io.pathExists,
  );
  if (!(await io.pathExists(configPath))) {
    return { path: configPath, exists: false, config: parseConfigObject("") };
  }
  const raw = await readFile(configPath, "utf8");
  return {
    path: configPath,
    exists: true,
    config: parseConfigObject(raw),
  };
}
