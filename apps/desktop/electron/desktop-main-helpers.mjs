/**
 * Pure helpers for Electron main composition root.
 * Extracted from main.mjs (P1-D) so IPC wiring stays thin.
 */
import path from "node:path";

export function isTransientNetworkError(error) {
  if (!error) return false;
  const message = String(error.message ?? "");
  const code = String(error.code ?? error.cause?.code ?? "");
  return (
    /client network socket disconnected|secure tls connection|socket hang up|econnreset|etimedout|enotfound|econnrefused|und_err|proxy/i.test(
      message,
    ) ||
    /^(ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|UND_ERR)$/i.test(code)
  );
}

export function envFlagEnabled(name, env = process.env) {
  const value = env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function forwardedDeepLinks(argv) {
  return argv
    .slice(1)
    .map((entry) => entry.trim())
    .filter(
      (entry) =>
        entry.startsWith("onmyagent://") ||
        entry.startsWith("onmyagent-dev://") ||
        entry.startsWith("https://") ||
        entry.startsWith("http://"),
    );
}

export function execResult(ok, stdout = "", stderr = "", status = ok ? 0 : 1) {
  return { ok, status, stdout, stderr };
}

/**
 * @param {Record<string, unknown> | null | undefined} input
 * @param {{ forceRequireSignin?: boolean }} [options]
 */
export function normalizeDesktopBootstrapConfig(input, options = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const baseUrl =
    typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
  if (!baseUrl) {
    throw new Error("baseUrl is required");
  }

  const apiBaseUrl =
    typeof raw.apiBaseUrl === "string" && raw.apiBaseUrl.trim().length > 0
      ? raw.apiBaseUrl.trim()
      : null;

  return {
    baseUrl,
    apiBaseUrl,
    requireSignin:
      options.forceRequireSignin === true || raw.requireSignin === true,
  };
}

export function defaultWorkspaceOnMyAgentConfig(workspacePath, preset = null) {
  return {
    version: 1,
    workspace: workspacePath
      ? {
          name: path.basename(workspacePath) || "Workspace",
          createdAt: Date.now(),
          preset: preset || null,
        }
      : null,
    authorizedRoots: workspacePath ? [workspacePath] : [],
    reload: null,
  };
}

export function normalizeWorkspaceEntry(input) {
  return {
    id: String(input.id),
    name: String(input.name ?? "Workspace"),
    path: String(input.path ?? ""),
    preset: String(input.preset ?? "starter"),
    workspaceType: input.workspaceType === "remote" ? "remote" : "local",
    remoteType: input.remoteType ?? null,
    baseUrl: input.baseUrl ?? null,
    directory: input.directory ?? null,
    displayName: input.displayName ?? null,
    onmyagentHostUrl: input.onmyagentHostUrl ?? null,
    onmyagentToken: input.onmyagentToken ?? null,
    onmyagentClientToken: input.onmyagentClientToken ?? null,
    onmyagentHostToken: input.onmyagentHostToken ?? null,
    onmyagentWorkspaceId: input.onmyagentWorkspaceId ?? null,
    onmyagentWorkspaceName: input.onmyagentWorkspaceName ?? null,
    sandboxBackend: input.sandboxBackend ?? null,
    sandboxRunId: input.sandboxRunId ?? null,
    sandboxContainerName: input.sandboxContainerName ?? null,
  };
}

/**
 * @param {"project" | "global"} scope
 * @param {string | null | undefined} projectDir
 * @param {string} globalRoot — result of globalOpencodeRoot()
 */
export function resolveOpencodeConfigPath(scope, projectDir, globalRoot) {
  let root;
  if (scope === "project") {
    if (!String(projectDir ?? "").trim()) {
      throw new Error("projectDir is required");
    }
    root = projectDir;
  } else if (scope === "global") {
    root = globalRoot;
  } else {
    throw new Error("scope must be 'project' or 'global'");
  }

  const jsoncPath = path.join(root, "opencode.jsonc");
  const jsonPath = path.join(root, "opencode.json");
  return { jsoncPath, jsonPath };
}

/**
 * @param {"workspace" | "global"} scope
 * @param {string | null | undefined} projectDir
 * @param {string} globalRoot — result of globalOpencodeRoot()
 */
export function resolveCommandsDir(scope, projectDir, globalRoot) {
  if (scope === "workspace") {
    if (!String(projectDir ?? "").trim()) {
      throw new Error("projectDir is required");
    }
    return path.join(projectDir, ".opencode", "commands");
  }
  if (scope === "global") {
    return path.join(globalRoot, "commands");
  }
  throw new Error("scope must be 'workspace' or 'global'");
}

export function extractFrontmatterValue(raw, keys) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (!keys.includes(key)) continue;
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (value) return value;
  }
  return null;
}

export function extractFrontmatterMap(raw, keys) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (!keys.includes(key)) continue;
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (value) out[key] = value;
  }
  return out;
}

export function extractTrigger(raw) {
  return extractFrontmatterValue(raw, ["trigger", "when"]);
}

export function extractDescription(raw) {
  const fm = extractFrontmatterMap(raw, ["description", "name"]);
  if (fm.description) {
    return fm.description.length > 180
      ? `${fm.description.slice(0, 180)}...`
      : fm.description;
  }
  let inFrontmatter = false;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter || trimmed.startsWith("#")) continue;
    const cleaned = trimmed.replace(/`/g, "");
    return cleaned.length > 180 ? `${cleaned.slice(0, 180)}...` : cleaned;
  }
  return null;
}
