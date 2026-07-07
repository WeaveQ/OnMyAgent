// cc-switch parity module: local CLI version probing, registry latest-version
// lookup, installation enumeration, anchored upgrade command building, and
// cross-platform terminal launching for the Agent Manager panel.
//
// Ported from /Users/huangchunan/cc-switch src-tauri/src/commands/misc.rs.
// Semver comparator, prerelease-channel picker and probe fallback rules are
// intentionally identical to the Rust implementation.

import { existsSync, statSync } from "node:fs";
import { httpFetch } from "./http-client.mjs";
import { readdir, access } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const VERSION_CACHE_TTL_MS = 60_000;

// -------- provider metadata --------

const PROVIDER_NPM_PACKAGE = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  gemini: "@google/gemini-cli",
  opencode: "opencode-ai",
  openclaw: "openclaw",
};

const PROVIDER_BINARY = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
  openclaw: "openclaw",
  hermes: "hermes",
};

// Mirrors cc-switch npm_prerelease_tags(): only Claude Code opens `next`.
function prereleaseTags(provider) {
  return provider === "claude" ? ["next"] : [];
}

// -------- semver comparator (port of parse_semver / compare_semver) --------

/** parseSemver("2.1.156-beta.1") -> { core: [2,1,156], pre: ["beta","1"] } | null */
export function parseSemver(v) {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  const coreAndPre = trimmed.split("+")[0] || "";
  const dash = coreAndPre.indexOf("-");
  const core = dash >= 0 ? coreAndPre.slice(0, dash) : coreAndPre;
  const pre = dash >= 0 ? coreAndPre.slice(dash + 1) : "";
  const parts = core.split(".");
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const preSegs = pre ? pre.split(".") : [];
  return { core: nums, pre: preSegs };
}

/** compareSemver(a, b) -> -1 | 0 | 1 | null (null when either side unparseable). */
export function compareSemver(a, b) {
  const A = parseSemver(a);
  const B = parseSemver(b);
  if (!A || !B) return null;
  for (let i = 0; i < 3; i++) {
    if (A.core[i] < B.core[i]) return -1;
    if (A.core[i] > B.core[i]) return 1;
  }
  // Core equal: no prerelease > has prerelease.
  if (A.pre.length === 0 && B.pre.length === 0) return 0;
  if (A.pre.length === 0) return 1;
  if (B.pre.length === 0) return -1;
  const n = Math.min(A.pre.length, B.pre.length);
  for (let i = 0; i < n; i++) {
    const x = A.pre[i];
    const y = B.pre[i];
    const xn = /^\d+$/.test(x) ? Number(x) : null;
    const yn = /^\d+$/.test(y) ? Number(y) : null;
    if (xn !== null && yn !== null) {
      if (xn < yn) return -1;
      if (xn > yn) return 1;
      continue;
    }
    if (xn !== null && yn === null) return -1; // numeric < non-numeric
    if (xn === null && yn !== null) return 1;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  if (A.pre.length < B.pre.length) return -1;
  if (A.pre.length > B.pre.length) return 1;
  return 0;
}

/**
 * pickLatestVersion(distTags, prereleaseTagList, localVersion)
 * Mirrors cc-switch pick_latest_version(). Default: `latest`. Only when the
 * local version strictly leads `latest` do we consider the prerelease tags and
 * pick the highest parseable one that beats latest. Unparseable tags fall out.
 */
export function pickLatestVersion(distTags, prereleaseTagList, localVersion) {
  const latest = distTags && typeof distTags.latest === "string" ? distTags.latest : null;
  if (!latest) return null;
  const localAhead = localVersion != null && compareSemver(localVersion, latest) === 1;
  if (!prereleaseTagList?.length || !localAhead) return latest;
  let best = latest;
  for (const tag of prereleaseTagList) {
    const candidate = distTags[tag];
    if (typeof candidate !== "string") continue;
    if (compareSemver(candidate, best) === 1) best = candidate;
  }
  return best;
}

// -------- registry fetchers --------

async function fetchWithTimeout(url, opts = {}) {
  // cc-switch parity: single shared HTTP client that honors user-configured
  // or environment proxy settings and long connect/read timeouts. Individual
  // registry fetchers no longer bake in their own 6-15s timeout.
  return httpFetch(url, opts);
}

/** fetchNpmDistTags(pkg) -> { latest, next, ... } | null */
export async function fetchNpmDistTags(pkg, opts = /** @type {{ fetchImpl?: any, onDiag?: (err: Error) => void }} */ ({})) {
  const impl = opts.fetchImpl ?? fetchWithTimeout;
  try {
    const res = await impl(`https://registry.npmjs.org/${pkg}`);
    if (!res || !res.ok) {
      if (opts.onDiag) opts.onDiag(new Error(`npm registry status ${res?.status ?? "?"}`));
      return null;
    }
    const body = await res.json().catch(() => null);
    const tags = body && typeof body === "object" ? body["dist-tags"] : null;
    return tags && typeof tags === "object" ? tags : null;
  } catch (err) {
    if (opts.onDiag) opts.onDiag(err instanceof Error ? err : new Error(String(err)));
    return null;
  }
}

/** fetchGithubLatestVersion("anomalyco/opencode") -> "1.2.3" | null */
export async function fetchGithubLatestVersion(repo, opts = /** @type {{ fetchImpl?: any, onDiag?: (err: Error) => void }} */ ({})) {
  const impl = opts.fetchImpl ?? fetchWithTimeout;
  try {
    const res = await impl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!res || !res.ok) {
      if (opts.onDiag) opts.onDiag(new Error(`github status ${res?.status ?? "?"}`));
      return null;
    }
    const body = await res.json().catch(() => null);
    const tag = body && typeof body === "object" ? body.tag_name : null;
    if (typeof tag !== "string") return null;
    return tag.replace(/^v/i, "").trim() || null;
  } catch (err) {
    if (opts.onDiag) opts.onDiag(err instanceof Error ? err : new Error(String(err)));
    return null;
  }
}

/** fetchPypiLatestVersion("hermes-agent") -> "1.2.3" | null */
export async function fetchPypiLatestVersion(pkg, opts = /** @type {{ fetchImpl?: any, onDiag?: (err: Error) => void }} */ ({})) {
  const impl = opts.fetchImpl ?? fetchWithTimeout;
  try {
    const res = await impl(`https://pypi.org/pypi/${pkg}/json`);
    if (!res || !res.ok) {
      if (opts.onDiag) opts.onDiag(new Error(`pypi status ${res?.status ?? "?"}`));
      return null;
    }
    const body = await res.json().catch(() => null);
    const version = body && body.info && typeof body.info.version === "string" ? body.info.version : null;
    return version || null;
  } catch (err) {
    if (opts.onDiag) opts.onDiag(err instanceof Error ? err : new Error(String(err)));
    return null;
  }
}

const versionCache = new Map();

/**
 * fetchLatestForProvider(provider, localVersion, opts?)
 * Returns { latestVersion, latestChannel, error }.
 * Uses a 60s in-memory cache keyed by provider+localVersion.
 */
export async function fetchLatestForProvider(provider, localVersion, opts = {}) {
  const now = Date.now();
  const cacheKey = `${provider}::${localVersion ?? ""}`;
  const cached = versionCache.get(cacheKey);
  if (!opts.bypassCache && cached && now - cached.at < VERSION_CACHE_TTL_MS) {
    return cached.value;
  }
  const emit = (value) => {
    versionCache.set(cacheKey, { at: Date.now(), value });
    return value;
  };
  const diagErrors = [];
  const diagOpts = { ...opts, onDiag: (err) => diagErrors.push(err instanceof Error ? err.message : String(err)) };
  const diagText = () => diagErrors.length ? diagErrors.join("; ") : "unknown error";
  try {
    if (provider === "hermes") {
      const v = await fetchPypiLatestVersion("hermes-agent", diagOpts);
      if (!v) return emit({ latestVersion: null, latestChannel: null, error: `PyPI lookup failed: ${diagText()}` });
      return emit({ latestVersion: v, latestChannel: "pypi", error: null });
    }
    const pkg = PROVIDER_NPM_PACKAGE[provider];
    if (pkg) {
      const distTags = await fetchNpmDistTags(pkg, diagOpts);
      if (distTags) {
        const latest = pickLatestVersion(distTags, prereleaseTags(provider), localVersion);
        if (latest) {
          const channel = latest === distTags.latest ? "latest" : "next";
          return emit({ latestVersion: latest, latestChannel: channel, error: null });
        }
      }
      if (provider === "opencode") {
        const gh = await fetchGithubLatestVersion("anomalyco/opencode", diagOpts);
        if (gh) return emit({ latestVersion: gh, latestChannel: "github", error: null });
      }
      return emit({ latestVersion: null, latestChannel: null, error: `Registry lookup failed: ${diagText()}` });
    }
    return emit({ latestVersion: null, latestChannel: null, error: `Unknown provider: ${provider}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return emit({ latestVersion: null, latestChannel: null, error: message });
  }
}

export function _clearVersionCacheForTests() {
  versionCache.clear();
}

// -------- installation enumeration --------

function envType() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  return "unknown";
}

function isExecutable(p) {
  try {
    const st = statSync(p);
    return st.isFile();
  } catch {
    return false;
  }
}

function probeBinaryVersion(binPath) {
  if (!binPath || !existsSync(binPath)) return { version: null, runnable: false, error: "not found" };
  try {
    const args = ["--version"];
    const res = spawnSync(binPath, args, { encoding: "utf8", timeout: 4000, windowsHide: true });
    if (res.error) return { version: null, runnable: false, error: String(res.error.message ?? res.error) };
    if (res.status !== 0) {
      const stderr = String(res.stderr || res.stdout || "").trim();
      return { version: null, runnable: false, error: stderr || `exit ${res.status}` };
    }
    const out = String(res.stdout || res.stderr || "").trim();
    // Extract first semver-like token from output.
    const match = out.match(/(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]+)?)/);
    return { version: match ? match[1] : out, runnable: true, error: null };
  } catch (err) {
    return { version: null, runnable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function pathResolveDefault(binaryName) {
  const which = spawnSync(process.platform === "win32" ? "where" : "which", [binaryName], {
    encoding: "utf8",
    timeout: 2000,
    windowsHide: true,
  });
  if (which.status !== 0) return null;
  const first = String(which.stdout || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return first || null;
}

function candidateBinPaths(binaryName) {
  const home = os.homedir();
  const suffix = process.platform === "win32" ? ".exe" : "";
  const bases = [];
  if (process.platform === "darwin" || process.platform === "linux") {
    bases.push(
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      path.join(home, ".npm-global/bin"),
      path.join(home, ".local/bin"),
      path.join(home, ".volta/bin"),
      path.join(home, ".bun/bin"),
      path.join(home, ".opencode/bin"),
    );
  }
  if (process.platform === "win32") {
    bases.push(
      path.join(process.env.APPDATA || "", "npm"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "OnMyAgent"),
      path.join(home, ".opencode", "bin"),
    );
  }
  return bases.map((dir) => path.join(dir, `${binaryName}${suffix}`));
}

async function collectNvmCandidates(binaryName) {
  const home = os.homedir();
  const suffix = process.platform === "win32" ? ".exe" : "";
  const nvmRoot = path.join(home, ".nvm", "versions", "node");
  try {
    const entries = await readdir(nvmRoot);
    return entries.map((v) => path.join(nvmRoot, v, "bin", `${binaryName}${suffix}`));
  } catch {
    return [];
  }
}

function classifySource(binPath, home) {
  const p = binPath.toLowerCase();
  if (p.includes(path.join(home, ".opencode").toLowerCase())) return "bundled-or-opencode-installer";
  if (p.includes(path.join(home, ".nvm").toLowerCase())) return "nvm";
  if (p.includes(path.join(home, ".volta").toLowerCase())) return "volta";
  if (p.includes(path.join(home, ".bun").toLowerCase())) return "bun";
  if (p.includes("/opt/homebrew") || p.includes("/usr/local/homebrew")) return "homebrew";
  if (p.includes("/pipx/") || p.includes(path.join(home, ".local").toLowerCase())) return "pipx";
  if (p.includes(path.join(home, ".npm-global").toLowerCase()) || p.includes("/npm/")) return "npm-global";
  if (p.startsWith("/usr/local/bin") || p.startsWith("/usr/bin")) return "system";
  return "path";
}

function isBundledOpencodePath(binPath) {
  // OnMyAgent bundled opencode lives under `~/.opencode/bin/opencode` (installed
  // from the bundled resource). We treat this exact location as bundled/read-only.
  const bundledCandidate = path.join(os.homedir(), ".opencode", "bin",
    process.platform === "win32" ? "opencode.exe" : "opencode");
  return path.resolve(binPath) === path.resolve(bundledCandidate);
}

/**
 * enumerateInstallations(provider) -> AgentManagementInstallationEntry[]
 */
export async function enumerateInstallations(provider, opts = {}) {
  const binary = PROVIDER_BINARY[provider];
  if (!binary) return [];
  const home = os.homedir();
  const seen = new Map();
  const pathDefault = pathResolveDefault(binary);
  const candidates = candidateBinPaths(binary);
  candidates.push(...(await collectNvmCandidates(binary)));
  if (pathDefault) candidates.unshift(pathDefault);

  for (const raw of candidates) {
    if (!raw) continue;
    const resolved = path.resolve(raw);
    if (seen.has(resolved)) continue;
    if (!isExecutable(resolved)) continue;
    const probe = probeBinaryVersion(resolved);
    const source = provider === "opencode" && isBundledOpencodePath(resolved)
      ? "bundled"
      : classifySource(resolved, home);
    seen.set(resolved, {
      path: resolved,
      version: probe.version,
      runnable: probe.runnable,
      error: probe.error,
      source,
      isPathDefault: pathDefault ? path.resolve(pathDefault) === resolved : false,
      bundled: provider === "opencode" && isBundledOpencodePath(resolved),
    });
  }
  return [...seen.values()];
}

// -------- command builder (cc-switch parity) --------

const HERMES_UNIX_INSTALL =
  "bash -c 'tmp=$(mktemp) && curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh -o $tmp && bash $tmp; status=$?; rm -f $tmp; exit $status'";
const HERMES_UNIX_UPDATE =
  `hermes update || ${HERMES_UNIX_INSTALL}`;
const HERMES_WINDOWS_INSTALL =
  "powershell -NoProfile -ExecutionPolicy Bypass -Command \"irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1 | iex\"";
const HERMES_WINDOWS_UPDATE = `hermes update || ${HERMES_WINDOWS_INSTALL}`;

const OPENCODE_UNIX_INSTALL =
  "bash -c 'tmp=$(mktemp) && curl -fsSL https://opencode.ai/install -o $tmp && bash $tmp; status=$?; rm -f $tmp; exit $status' || npm i -g opencode-ai@latest";

/**
 * buildLifecycleCommand(provider, action, install?) -> { command, anchored, needsConfirmation }
 * `install` is the AgentManagementInstallationEntry we're anchoring to (may be undefined for install-fresh).
 */
export function buildLifecycleCommand(provider, action, install) {
  const isWin = process.platform === "win32";
  const npmPkg = PROVIDER_NPM_PACKAGE[provider];

  if (provider === "hermes") {
    if (isWin) return { command: action === "install" ? HERMES_WINDOWS_INSTALL : HERMES_WINDOWS_UPDATE, anchored: false, needsConfirmation: false };
    return { command: action === "install" ? HERMES_UNIX_INSTALL : HERMES_UNIX_UPDATE, anchored: false, needsConfirmation: false };
  }

  if (provider === "opencode") {
    // Bundled opencode: refuse to build an upgrade command.
    if (install?.bundled) {
      return {
        command: "",
        anchored: false,
        needsConfirmation: false,
      };
    }
    if (install?.source === "bundled-or-opencode-installer" && install?.path?.includes(path.join(".opencode", "bin"))) {
      // Non-bundled GitHub-installer path: re-run installer.
      return {
        command: OPENCODE_UNIX_INSTALL,
        anchored: false,
        needsConfirmation: false,
      };
    }
    // Fall through to npm anchor.
  }

  if (npmPkg) {
    // Anchor to npm prefix when install path suggests a non-default global root.
    let prefixFlag = "";
    let anchored = false;
    if (install && !install.isPathDefault && install.source !== "system") {
      const binDir = path.dirname(install.path);
      const parent = path.dirname(binDir); // typical: <prefix>/bin/foo -> <prefix>
      if (parent && parent !== "/" && parent !== ".") {
        prefixFlag = ` --prefix="${parent}"`;
        anchored = true;
      }
    }
    const cmd = isWin
      ? `npm i -g ${npmPkg}@latest${prefixFlag}`
      : `npm i -g ${npmPkg}@latest${prefixFlag}`;
    return { command: cmd, anchored, needsConfirmation: false };
  }

  return { command: "", anchored: false, needsConfirmation: false };
}

/**
 * probeInstallations(provider) -> AgentManagementInstallationReport
 */
export async function probeInstallations(provider) {
  const installs = await enumerateInstallations(provider);
  const runnableVersions = new Set(
    installs.filter((i) => i.runnable && i.version).map((i) => i.version),
  );
  const isConflict = runnableVersions.size >= 2;
  // Pick "current" install: PATH default first, else first runnable, else first entry.
  const current =
    installs.find((i) => i.isPathDefault && i.runnable) ||
    installs.find((i) => i.runnable) ||
    installs[0];
  const cmd = buildLifecycleCommand(provider, "update", current);
  return {
    provider,
    installs,
    isConflict,
    needsConfirmation: isConflict || Boolean(current?.bundled),
    command: cmd.command,
    anchored: cmd.anchored,
    envType: envType(),
  };
}

// -------- terminal launcher --------

function osascriptCommand(command) {
  // Escape single quotes and backslashes for AppleScript string literal.
  const esc = command.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  return [
    "-e",
    `tell application "Terminal" to activate`,
    "-e",
    `tell application "Terminal" to do script "${esc}"`,
  ];
}

/**
 * launchInTerminal(command) -> Promise<{ ok, terminalLaunched, error? }>
 * macOS: osascript -> Terminal.app. Windows: `cmd /k`. Linux: try common terminals.
 */
export async function launchInTerminal(command) {
  if (!command) return { ok: false, terminalLaunched: false, error: "empty command" };
  try {
    if (process.platform === "darwin") {
      const child = spawn("/usr/bin/osascript", osascriptCommand(command), {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return { ok: true, terminalLaunched: true };
    }
    if (process.platform === "win32") {
      const child = spawn("cmd.exe", ["/c", "start", "cmd", "/k", command], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      return { ok: true, terminalLaunched: true };
    }
    /** @type {Array<[string, string[]]>} */
    const candidates = [
      ["x-terminal-emulator", ["-e", "bash", "-lc", command]],
      ["gnome-terminal", ["--", "bash", "-lc", command]],
      ["konsole", ["-e", "bash", "-lc", command]],
      ["xterm", ["-e", `bash -lc "${command.replace(/"/g, '\\"')}"`]],
    ];
    for (const [bin, args] of candidates) {
      const probe = spawnSync("which", [bin], { encoding: "utf8", timeout: 2000 });
      if (probe.status === 0 && probe.stdout.trim()) {
        const child = spawn(bin, args, { detached: true, stdio: "ignore" });
        child.unref();
        return { ok: true, terminalLaunched: true };
      }
    }
    return { ok: false, terminalLaunched: false, error: "no supported terminal found" };
  } catch (err) {
    return { ok: false, terminalLaunched: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const _testing = {
  envType,
  isBundledOpencodePath,
  classifySource,
  PROVIDER_NPM_PACKAGE,
  PROVIDER_BINARY,
  prereleaseTags,
  osascriptCommand,
};
