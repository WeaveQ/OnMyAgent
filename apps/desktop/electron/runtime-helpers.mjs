/**
 * Pure helpers extracted from runtime.mjs (path normalize, env flags,
 * version pin decisions, Docker parse/status mappers, software status).
 * Safe to unit-test without Electron.
 */
import path from "node:path";

import {
  compareVersions,
  isVersionAtLeast,
} from "./opencode-binary-policy.mjs";

export const BUNDLED_SKILLS_RESOURCE_DIR = "bundled-skills";
export const BUNDLED_PLUGINS_RESOURCE_DIR = "bundled-plugins";
export const BUNDLED_EXTENSIONS_RESOURCE_DIR = "onmyagent-extensions";

export const OPENCODE_BIN_ENV_KEYS = [
  "OPENCODE_BIN",
  "ONMYAGENT_OPENCODE_BIN",
  "ONMYAGENT_LOCAL_OPENCODE_BIN",
];

export const PI_BIN_ENV_KEYS = [
  "ONMYAGENT_PI_BIN",
  "PI_BIN",
];

export const DOCKER_BIN_ENV_KEYS = [
  "ONMYAGENT_DOCKER_BIN",
  "OPENWRK_DOCKER_BIN", // legacy
  "DOCKER_BIN",
];

/**
 * @param {string | null | undefined} value
 * @param {{ resolve?: (p: string) => string, sep?: string }} [pathApi]
 */
export function normalizeWorkspaceKey(value, pathApi = path) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return pathApi.resolve(trimmed).replace(/\\/g, "/").toLowerCase();
}

/**
 * Only an explicit `"pi"` / `"opencode"` is a choice. Missing stays missing
 * so persisted server.json can still apply.
 * @param {unknown} value
 * @returns {"opencode" | "pi" | undefined}
 */
export function readExplicitAgentEngine(value) {
  return value === "pi" || value === "opencode" ? value : undefined;
}

/**
 * Map a desktop workspace path or spec to the server CLI workspace entry.
 * Does not invent `opencode` for a field-less path.
 * @param {string | { path?: unknown, agentEngine?: unknown } | null | undefined} entry
 * @returns {{ path: string, agentEngine?: "opencode" | "pi" } | null}
 */
export function toServerWorkspaceSpec(entry) {
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    return trimmed ? { path: trimmed } : null;
  }
  if (!entry || typeof entry !== "object") return null;
  const pathValue = String(entry.path ?? "").trim();
  if (!pathValue) return null;
  const agentEngine = readExplicitAgentEngine(entry.agentEngine);
  return agentEngine ? { path: pathValue, agentEngine } : { path: pathValue };
}

/**
 * Dedup workspace specs by path. A field-less prepend never clobbers a later
 * explicit engine; a later field-less path never strips an explicit engine.
 * @param {Array<string | { path?: unknown, agentEngine?: unknown } | null | undefined>} entries
 * @param {{ resolve?: (p: string) => string, sep?: string }} [pathApi]
 * @returns {Array<{ path: string, agentEngine?: "opencode" | "pi" }>}
 */
export function mergeWorkspaceEngineSpecs(entries, pathApi = path) {
  const order = [];
  const byKey = new Map();
  for (const entry of entries ?? []) {
    const spec = toServerWorkspaceSpec(entry);
    if (!spec) continue;
    const key = normalizeWorkspaceKey(spec.path, pathApi);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...spec });
      order.push(key);
      continue;
    }
    if (existing.agentEngine == null && spec.agentEngine != null) {
      existing.agentEngine = spec.agentEngine;
    }
  }
  return order.map((key) => byKey.get(key));
}

export function prioritizeWorkspacePaths(preferredPath, workspacePaths = [], pathApi = path) {
  const preferred = String(preferredPath ?? "").trim();
  const paths = [];
  const seen = new Set();
  const add = (value) => {
    const workspacePath = String(value ?? "").trim();
    const key = normalizeWorkspaceKey(workspacePath, pathApi);
    if (!workspacePath || !key || seen.has(key)) return;
    paths.push(workspacePath);
    seen.add(key);
  };
  add(preferred);
  for (const workspacePath of workspacePaths) add(workspacePath);
  return paths;
}

/**
 * Build candidate roots for a packaged resource directory (prod + dev).
 * @param {string} runtimeDir dirname of runtime.mjs (electron/)
 * @param {string} resourceDir e.g. "bundled-skills"
 * @param {string | null | undefined} resourcesPath process.resourcesPath
 * @param {{ resolve?: (...parts: string[]) => string }} [pathApi]
 */
export function buildBundledResourceCandidates(
  runtimeDir,
  resourceDir,
  resourcesPath,
  pathApi = path,
) {
  return [
    resourcesPath ? pathApi.resolve(resourcesPath, resourceDir) : null,
    pathApi.resolve(runtimeDir, "..", "resources", resourceDir),
  ].filter(Boolean);
}

/**
 * @template T
 * @param {T[]} candidates
 * @param {(candidate: T) => boolean} existsFn
 * @returns {T | null}
 */
export function firstExisting(candidates, existsFn) {
  return candidates.find((candidate) => existsFn(candidate)) ?? null;
}

/**
 * @param {T[]} candidates
 * @param {(candidate: T) => boolean} existsFn
 * @returns {T[]}
 * @template T
 */
export function filterExisting(candidates, existsFn) {
  return candidates.filter((candidate) => existsFn(candidate));
}

/**
 * Strip optional leading `v` from an OpenCode version for package.json pins.
 * @param {string | null | undefined} opencodeVersion
 */
export function desiredOpencodePluginVersion(opencodeVersion) {
  return String(opencodeVersion ?? "").replace(/^v/i, "").trim();
}

/**
 * Whether package.json should rewrite @opencode-ai/plugin to match product.
 * Newer pins than product are allowed (forward compatible).
 * @param {string | null | undefined} current
 * @param {string | null | undefined} desired
 */
export function shouldAlignOpencodePluginPin(current, desired) {
  const want = desiredOpencodePluginVersion(desired);
  if (!want) return false;
  const have = String(current ?? "").trim();
  if (!have) return true;
  if (isVersionAtLeast(have, want) && compareVersions(have, want) === 0) {
    return false;
  }
  if (isVersionAtLeast(have, want)) {
    return false;
  }
  return true;
}

/**
 * First env key whose value is a non-empty existing path.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {string[]} keys
 * @param {(p: string) => boolean} existsFn
 */
export function envForcedBinaryPath(env, keys, existsFn) {
  for (const key of keys) {
    const value = String(env?.[key] ?? "").trim();
    if (value && existsFn(value)) return value;
  }
  return null;
}

/**
 * Env keys that force a product runtime binary (node/python).
 * @param {"node" | "python" | string} tool
 */
export function productRuntimeBinaryEnvKeys(tool) {
  if (tool === "node") return ["ONMYAGENT_NODE_BIN", "NODE_BINARY"];
  if (tool === "python") return ["ONMYAGENT_PYTHON_BIN", "PYTHON_BINARY"];
  return [];
}

/**
 * Relative path of a bundled product runtime binary under runtimeRoot.
 * @param {"node" | "python" | string} tool
 * @param {NodeJS.Platform | string} platform
 */
export function productRuntimeBinaryRelativePath(tool, platform) {
  if (tool === "node") {
    return platform === "win32" ? path.join("node", "node.exe") : path.join("node", "bin", "node");
  }
  if (tool === "python") {
    return platform === "win32"
      ? path.join("python", "python.exe")
      : path.join("python", "bin", "python3");
  }
  return null;
}

/**
 * Filenames to search on PATH for a product runtime tool.
 * @param {"node" | "python" | string} tool
 * @param {NodeJS.Platform | string} platform
 */
export function productRuntimeBinaryNames(tool, platform) {
  if (tool === "node") {
    return platform === "win32" ? ["node.exe"] : ["node"];
  }
  if (tool === "python") {
    return platform === "win32" ? ["python.exe", "python3.exe"] : ["python3", "python"];
  }
  return [];
}

/**
 * @param {string | null | undefined} stdout
 */
export function parseDockerClientVersion(stdout) {
  const line = String(stdout ?? "").split(/\r?\n/)[0]?.trim() ?? "";
  return line.toLowerCase().startsWith("docker version") ? line : null;
}

/**
 * @param {string | null | undefined} stdout
 */
export function parseDockerServerVersion(stdout) {
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("Server Version:")) {
      return trimmed.slice("Server Version:".length).trim() || null;
    }
  }
  return null;
}

/**
 * Sanitize a run id into an orchestrator docker container name.
 * @param {string | null | undefined} runId
 */
export function deriveOrchestratorContainerName(runId) {
  const sanitized = String(runId ?? "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .slice(0, 24);
  return `onmyagent-orchestrator-${sanitized}`;
}

/**
 * Names of OnMyAgent-managed docker containers from `docker ps` output lines.
 * @param {string | null | undefined} stdout
 */
export function parseManagedContainerNames(stdout) {
  return String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (name) =>
        name &&
        (name.startsWith("onmyagent-orchestrator-") ||
          name.startsWith("onmyagent-dev-") ||
          name.startsWith("openwrk-")),
    )
    .sort();
}

/**
 * Map docker info failure text to daemon/permission flags.
 * @param {string | null | undefined} combinedText
 */
export function interpretDockerInfoFailure(combinedText) {
  const combined = String(combinedText ?? "").toLowerCase();
  const permissionOk =
    !combined.includes("permission denied") && !combined.includes("access is denied");
  const daemonRunning =
    !combined.includes("cannot connect to the docker daemon") &&
    !combined.includes("is the docker daemon running") &&
    !combined.includes("connection refused") &&
    !combined.includes("no such file or directory");
  return { permissionOk, daemonRunning, ready: false };
}

/**
 * Validate a container name before docker stop (managed prefix + safe charset).
 * @param {string | null | undefined} containerName
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
/**
 * @param {unknown} containerName
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
export function validateStoppableSandboxContainerName(containerName) {
  const name = String(containerName ?? "").trim();
  if (!name) {
    return { ok: false, error: "containerName is required" };
  }
  if (!name.startsWith("onmyagent-orchestrator-")) {
    return {
      ok: false,
      error: "Refusing to stop container: expected name starting with 'onmyagent-orchestrator-'",
    };
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    return { ok: false, error: "containerName contains invalid characters" };
  }
  return { ok: true, name };
}

/**
 * Default docker binary paths for a platform (no existence check).
 * @param {NodeJS.Platform | string} platform
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {{ join?: (...parts: string[]) => string }} [pathApi]
 */
export function dockerPlatformDefaultPaths(platform, env = process.env, pathApi = path) {
  if (platform === "win32") {
    return [
      env.ProgramFiles
        ? pathApi.join(env.ProgramFiles, "Docker", "Docker", "resources", "bin", "docker.exe")
        : null,
      env["ProgramFiles(x86)"]
        ? pathApi.join(
            env["ProgramFiles(x86)"],
            "Docker",
            "Docker",
            "resources",
            "bin",
            "docker.exe",
          )
        : null,
      env.LOCALAPPDATA
        ? pathApi.join(
            env.LOCALAPPDATA,
            "Programs",
            "Docker",
            "Docker",
            "resources",
            "bin",
            "docker.exe",
          )
        : null,
    ].filter(Boolean);
  }
  return [
    "/opt/homebrew/bin/docker",
    "/usr/local/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
  ];
}

/**
 * Ordered docker candidate paths from env + PATH + platform defaults (no exists).
 * @param {{
 *   platform?: NodeJS.Platform | string,
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   pathDelimiter?: string,
 *   pathApi?: { join?: (...parts: string[]) => string },
 * }} [options]
 */
export function collectDockerCandidatePaths(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const delimiter = options.pathDelimiter ?? path.delimiter;
  const pathApi = options.pathApi ?? path;
  const candidates = [];
  const seen = new Set();

  const push = (value) => {
    const candidate = String(value ?? "").trim();
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push(candidate);
  };

  for (const key of DOCKER_BIN_ENV_KEYS) {
    push(env[key]);
  }

  const dockerName = platform === "win32" ? "docker.exe" : "docker";
  for (const entry of String(env.PATH ?? "").split(delimiter).filter(Boolean)) {
    push(pathApi.join(entry, dockerName));
  }

  for (const candidate of dockerPlatformDefaultPaths(platform, env, pathApi)) {
    push(candidate);
  }

  return candidates;
}

/**
 * @param {{
 *   path?: string | null,
 *   source?: string | null,
 *   reason?: string | null,
 *   notice?: string | null,
 *   bundledVersion?: string | null,
 *   localVersion?: string | null,
 * } | null | undefined} decision
 * @param {(binary: string) => string | null} probeVersion
 */
export function isSoftwareToolInstalled(decision, probeVersion) {
  return Boolean(
    decision?.path &&
      (decision.bundledVersion ||
        decision.localVersion ||
        probeVersion(decision.path)),
  );
}

/**
 * @param {{
 *   path?: string | null,
 *   source?: string | null,
 *   reason?: string | null,
 *   notice?: string | null,
 *   bundledVersion?: string | null,
 *   localVersion?: string | null,
 * } | null | undefined} decision
 * @param {(binary: string) => string | null} probeVersion
 */
export function softwareToolDetail(decision, probeVersion) {
  const installed = isSoftwareToolInstalled(decision, probeVersion);
  return {
    installed,
    bundled: decision?.source === "bundled",
    path: decision?.path ?? null,
    version:
      decision?.bundledVersion ??
      decision?.localVersion ??
      (decision?.path ? probeVersion(decision.path) : null),
    source: decision?.source ?? null,
    reason: decision?.reason ?? null,
    notice: decision?.notice ?? null,
  };
}

/**
 * @typedef {{
 *   path?: string | null,
 *   source?: string | null,
 *   reason?: string | null,
 *   notice?: string | null,
 *   bundledVersion?: string | null,
 *   localVersion?: string | null,
 * } | null | undefined} SoftwareBinaryDecision
 */

/**
 * Map Node/Python/OpenCode binary decisions into softwareEnvironmentInfo shape.
 * @param {SoftwareBinaryDecision} nodeDecision
 * @param {SoftwareBinaryDecision} pythonDecision
 * @param {SoftwareBinaryDecision} opencodeDecision
 * @param {(binary: string) => string | null} probeVersion
 */
export function buildSoftwareEnvironmentInfo(nodeDecision, pythonDecision, opencodeDecision, probeVersion) {
  const nodeDetail = softwareToolDetail(nodeDecision, probeVersion);
  const pythonDetail = softwareToolDetail(pythonDecision, probeVersion);
  const opencodeDetail = softwareToolDetail(opencodeDecision, probeVersion);
  return {
    node: nodeDetail.installed,
    python: pythonDetail.installed,
    opencode: opencodeDetail.installed,
    details: {
      node: nodeDetail,
      python: pythonDetail,
      opencode: opencodeDetail,
    },
  };
}

/**
 * Whether a local OpenCode candidate should be skipped (bundled/sidecar copy).
 * @param {string} candidate
 * @param {string | null | undefined} bundledResolved
 * @param {{ resolve?: (p: string) => string, sep?: string }} [pathApi]
 */
export function shouldSkipLocalOpencodeCandidate(candidate, bundledResolved, pathApi = path) {
  if (bundledResolved && pathApi.resolve(candidate) === bundledResolved) return true;
  if (candidate.includes(`${pathApi.sep}resources${pathApi.sep}sidecars${pathApi.sep}`)) {
    return true;
  }
  return false;
}

/**
 * Pick the newest compatible local OpenCode path from probed candidates.
 * @param {{ path: string, version: string | null }[]} probed
 * @param {string | null | undefined} bundledVersion
 * @param {{
 *   isVersionAtLeast?: typeof isVersionAtLeast,
 *   compareVersions?: typeof compareVersions,
 * }} [policy]
 * @returns {{ bestCompatible: { path: string, version: string | null } | null, firstExisting: { path: string, version: string | null } | null }}
 */
export function selectBestLocalOpencodeFromProbed(probed, bundledVersion, policy = {}) {
  const atLeast = policy.isVersionAtLeast ?? isVersionAtLeast;
  const compare = policy.compareVersions ?? compareVersions;
  /** @type {{ path: string, version: string | null } | null} */
  let bestCompatible = null;
  /** @type {{ path: string, version: string | null } | null} */
  let firstExisting = null;

  for (const entry of probed) {
    if (!firstExisting) firstExisting = entry;
    if (!entry.version) continue;
    if (bundledVersion && !atLeast(entry.version, bundledVersion)) continue;
    if (
      !bestCompatible ||
      !bestCompatible.version ||
      (compare(entry.version, bestCompatible.version) ?? -1) > 0
    ) {
      bestCompatible = entry;
    }
  }

  return { bestCompatible, firstExisting };
}

/**
 * Fixed homebrew / system paths for local OpenCode discovery (non-Windows).
 */
export function localOpencodeUnixExtraPaths(homeDir) {
  return [
    path.join(homeDir, ".opencode", "bin", "opencode"),
    "/opt/homebrew/bin/opencode",
    "/usr/local/bin/opencode",
    "/usr/bin/opencode",
  ];
}

/**
 * Fixed Windows paths for local OpenCode discovery.
 * @param {string} homeDir
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 */
export function localOpencodeWindowsExtraPaths(homeDir, env = process.env) {
  const candidates = [];
  if (env.LOCALAPPDATA) {
    candidates.push(
      path.join(env.LOCALAPPDATA, "opencode", "bin", "opencode.exe"),
      path.join(env.LOCALAPPDATA, "Programs", "opencode", "opencode.exe"),
    );
  }
  candidates.push(path.join(homeDir, ".opencode", "bin", "opencode.exe"));
  return candidates;
}

/**
 * Build ordered local OpenCode binary candidates from PATH + platform extras.
 * @param {{
 *   platform?: NodeJS.Platform | string,
 *   homeDir: string,
 *   pathEnv?: string | null,
 *   pathDelimiter?: string,
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 * }} options
 */
export function buildLocalOpencodeBinaryCandidates(options) {
  const platform = options.platform ?? process.platform;
  const delimiter = options.pathDelimiter ?? path.delimiter;
  const binaryName = platform === "win32" ? "opencode.exe" : "opencode";
  const candidates = [];

  for (const entry of String(options.pathEnv ?? "").split(delimiter).filter(Boolean)) {
    candidates.push(path.join(entry, binaryName));
  }

  if (platform !== "win32") {
    candidates.push(...localOpencodeUnixExtraPaths(options.homeDir));
  } else {
    candidates.push(...localOpencodeWindowsExtraPaths(options.homeDir, options.env));
  }

  return [...new Set(candidates.filter(Boolean))];
}
