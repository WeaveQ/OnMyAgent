import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const USER_ENV_RESERVED_PREFIXES = ["ONMYAGENT_", "OPENCODE_"] as const;

let cachedExtraPathEntries: string[] | null = null;
let cachedExtraPathRoots: { orchestratorRoot: string; repoRoot: string } | null = null;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function splitPathEntries(value?: string): string[] {
  if (!value) return [];
  return value.split(delimiter).map((entry) => entry.trim()).filter(Boolean);
}

function pushPath(entries: string[], path?: string | null) {
  if (!path) return;
  const candidate = resolve(path.trim());
  if (!isDirectory(candidate)) return;
  if (!entries.includes(candidate)) entries.push(candidate);
}

function nvmVersionBinPaths(home: string): string[] {
  const base = join(home, ".nvm", "versions", "node");
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(base, entry.name, "bin"))
      .filter(isDirectory)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function resolveExtraPathEntries(input: { orchestratorRoot: string; repoRoot: string }): string[] {
  if (
    cachedExtraPathEntries &&
    cachedExtraPathRoots?.orchestratorRoot === input.orchestratorRoot &&
    cachedExtraPathRoots.repoRoot === input.repoRoot
  ) {
    return cachedExtraPathEntries;
  }

  const entries: string[] = [];
  // Prefer ONMYAGENT_*; OPENWRK_* is a legacy env fallback for existing installs.
  const sidecarOverride =
    process.env.ONMYAGENT_SIDECAR_DIR ?? process.env.OPENWRK_SIDECAR_DIR;
  const sidecarCandidates = [
    sidecarOverride,
    dirname(process.execPath),
    join(dirname(process.execPath), "sidecars"),
    join(input.orchestratorRoot, "dist"),
    resolve(input.repoRoot, "apps", "desktop", "resources", "sidecars"),
  ];
  for (const candidate of sidecarCandidates) {
    pushPath(entries, candidate);
  }

  const home = homedir();
  if (process.platform === "darwin") {
    for (const candidate of [
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      join(home, ".nvm", "current", "bin"),
      ...nvmVersionBinPaths(home),
      join(home, ".fnm", "current", "bin"),
      join(home, ".volta", "bin"),
      join(home, "Library", "pnpm"),
      join(home, ".bun", "bin"),
      join(home, ".cargo", "bin"),
      join(home, ".pyenv", "shims"),
      join(home, ".local", "bin"),
    ]) {
      pushPath(entries, candidate);
    }
  }

  if (process.platform === "linux") {
    for (const candidate of [
      "/usr/local/bin",
      "/usr/local/sbin",
      join(home, ".nvm", "current", "bin"),
      ...nvmVersionBinPaths(home),
      join(home, ".fnm", "current", "bin"),
      join(home, ".volta", "bin"),
      join(home, ".local", "share", "pnpm"),
      join(home, ".bun", "bin"),
      join(home, ".cargo", "bin"),
      join(home, ".pyenv", "shims"),
      join(home, ".local", "bin"),
    ]) {
      pushPath(entries, candidate);
    }
  }

  if (process.platform === "win32") {
    for (const candidate of [
      join(home, ".volta", "bin"),
      join(home, ".bun", "bin"),
      join(home, ".cargo", "bin"),
      process.env.APPDATA ? join(process.env.APPDATA, "npm") : null,
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "pnpm") : null,
    ]) {
      pushPath(entries, candidate);
    }
  }

  cachedExtraPathEntries = entries;
  cachedExtraPathRoots = input;
  return entries;
}

export function resolveUserEnvFilePath(): string {
  const override = (process.env.ONMYAGENT_ENV_STORE ?? "").trim();
  if (override) return resolve(override);
  if (platform() === "win32") {
    const appData = (process.env.APPDATA ?? "").trim();
    const root = appData || join(homedir(), "AppData", "Roaming");
    return join(root, "onmyagent", "env.json");
  }
  return join(homedir(), ".config", "onmyagent", "env.json");
}

export function loadUserEnvFile(): Record<string, string> {
  try {
    const raw = readFileSync(resolveUserEnvFilePath(), "utf8");
    const parsed = JSON.parse(raw) as { variables?: unknown };
    if (!Array.isArray(parsed.variables)) return {};
    const out: Record<string, string> = {};
    for (const entry of parsed.variables) {
      if (!entry || typeof entry !== "object") continue;
      const { key, value } = entry as { key?: unknown; value?: unknown };
      if (typeof key !== "string" || typeof value !== "string") continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (USER_ENV_RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function buildSpawnEnv(
  env: NodeJS.ProcessEnv | undefined,
  input: { orchestratorRoot: string; repoRoot: string },
): NodeJS.ProcessEnv {
  const base = env ?? process.env;
  const merged: NodeJS.ProcessEnv = { ...loadUserEnvFile() };
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) merged[key] = value;
  }
  const pathKey =
    Object.prototype.hasOwnProperty.call(merged, "PATH") ||
    !Object.prototype.hasOwnProperty.call(merged, "Path")
      ? "PATH"
      : "Path";
  const currentPath = pathKey === "PATH" ? merged.PATH : merged.Path;
  const entries = [
    ...resolveExtraPathEntries(input),
    ...splitPathEntries(currentPath),
  ];
  const deduped = entries.filter((entry, index) => entries.indexOf(entry) === index);
  if (!deduped.length) return merged;
  return { ...merged, [pathKey]: deduped.join(delimiter) };
}
