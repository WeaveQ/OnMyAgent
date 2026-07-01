import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type ResolvedSandboxMode = "none" | "docker" | "container";

export type SandboxAllowedRoot = {
  path: string;
  allowReadWrite?: boolean;
  description?: string;
};

export type SandboxMountAllowlist = {
  allowedRoots: SandboxAllowedRoot[];
  blockedPatterns?: string[];
};

export type SandboxMount = {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
};

const DEFAULT_SANDBOX_BLOCKED_PATTERNS = [
  ".ssh",
  ".gnupg",
  ".gpg",
  ".aws",
  ".azure",
  ".gcloud",
  ".kube",
  ".docker",
  "credentials",
  ".env",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "id_rsa",
  "id_ed25519",
  "private_key",
  ".secret",
];

let cachedSandboxAllowlist: SandboxMountAllowlist | null | undefined;
let cachedSandboxAllowlistError: string | null = null;
let cachedSandboxAllowlistPath: string | null = null;

function resolveSandboxAllowlistPath(): string {
  const override = process.env.ONMYAGENT_SANDBOX_MOUNT_ALLOWLIST?.trim();
  if (override) return resolve(override);
  return join(homedir(), ".config", "onmyagent", "sandbox-mount-allowlist.json");
}

function expandTildePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

async function isDir(input: string): Promise<boolean> {
  try {
    return (await stat(input)).isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveHostOpencodeGlobalConfigDir(options: {
  devMode: boolean;
}): Promise<string | null> {
  const internalDevMode = options.devMode;
  const enabled =
    (
      process.env.ONMYAGENT_SANDBOX_MOUNT_OPENCODE_CONFIG ??
      (internalDevMode ? "0" : "1")
    ).trim() !== "0";
  if (!enabled) return null;

  const candidates: string[] = [];
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) candidates.push(join(xdg, "opencode"));
  candidates.push(join(homedir(), ".config", "opencode"));
  if (process.platform === "darwin") {
    candidates.push(
      join(homedir(), "Library", "Application Support", "opencode"),
    );
  }

  const files = ["opencode.jsonc", "opencode.json", "config.json", "AGENTS.md"];
  for (const candidate of Array.from(
    new Set(candidates.map((item) => resolve(expandTildePath(item)))),
  )) {
    if (!(await isDir(candidate))) continue;
    for (const file of files) {
      try {
        await access(join(candidate, file));
        return candidate;
      } catch {
        // keep looking
      }
    }

    // Fall back to any non-empty config directory. Some setups keep
    // provider/auth material in files that are not part of the strict list above.
    try {
      const entries = await readdir(candidate);
      if (entries.length > 0) return candidate;
    } catch {
      // keep looking
    }
  }

  return null;
}

export async function resolveHostOpencodeGlobalDataDir(options: {
  devMode: boolean;
}): Promise<string | null> {
  const internalDevMode = options.devMode;
  const enabled =
    (
      process.env.ONMYAGENT_SANDBOX_MOUNT_OPENCODE_CONFIG ??
      (internalDevMode ? "0" : "1")
    ).trim() !== "0";
  if (!enabled) return null;

  const candidates: string[] = [];
  const xdgData = process.env.XDG_DATA_HOME?.trim();
  if (xdgData) candidates.push(join(xdgData, "opencode"));
  candidates.push(join(homedir(), ".local", "share", "opencode"));
  if (process.platform === "darwin") {
    candidates.push(
      join(homedir(), "Library", "Application Support", "opencode"),
    );
  }

  const files = ["auth.json", "mcp-auth.json"];
  for (const candidate of Array.from(
    new Set(candidates.map((item) => resolve(expandTildePath(item)))),
  )) {
    if (!(await isDir(candidate))) continue;
    for (const file of files) {
      try {
        await access(join(candidate, file));
        return candidate;
      } catch {
        // keep looking
      }
    }
  }

  return null;
}

async function realpathOrNull(input: string): Promise<string | null> {
  try {
    return await realpath(input);
  } catch {
    return null;
  }
}

function matchesBlockedPattern(
  real: string,
  patterns: string[],
): string | null {
  const parts = real.split(sep);
  for (const pattern of patterns) {
    for (const part of parts) {
      if (part === pattern || part.includes(pattern)) return pattern;
    }
    if (real.includes(pattern)) return pattern;
  }
  return null;
}

async function findAllowedRoot(
  real: string,
  roots: SandboxAllowedRoot[],
): Promise<SandboxAllowedRoot | null> {
  for (const root of roots) {
    const expanded = resolve(expandTildePath(root.path));
    const realRoot = await realpathOrNull(expanded);
    if (!realRoot) continue;
    const rel = relative(realRoot, real);
    if (!rel.startsWith("..") && !isAbsolute(rel)) {
      return root;
    }
  }
  return null;
}

async function loadSandboxAllowlist(): Promise<SandboxMountAllowlist | null> {
  const path = resolveSandboxAllowlistPath();
  if (cachedSandboxAllowlistPath !== path) {
    cachedSandboxAllowlistPath = path;
    cachedSandboxAllowlist = undefined;
    cachedSandboxAllowlistError = null;
  }
  if (cachedSandboxAllowlist !== undefined) return cachedSandboxAllowlist;
  if (cachedSandboxAllowlistError) return null;
  try {
    if (!(await fileExists(path))) {
      cachedSandboxAllowlistError = `Mount allowlist not found at ${path}`;
      cachedSandboxAllowlist = null;
      return null;
    }
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as SandboxMountAllowlist;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.allowedRoots)
    ) {
      throw new Error("allowedRoots must be an array");
    }
    const blocked = Array.isArray(parsed.blockedPatterns)
      ? parsed.blockedPatterns
      : [];
    parsed.blockedPatterns = [
      ...new Set([...DEFAULT_SANDBOX_BLOCKED_PATTERNS, ...blocked]),
    ];
    cachedSandboxAllowlist = parsed;
    return parsed;
  } catch (error) {
    cachedSandboxAllowlistError =
      error instanceof Error ? error.message : String(error);
    cachedSandboxAllowlist = null;
    return null;
  }
}

function isValidSandboxContainerSubPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes("..")) return false;
  if (trimmed.startsWith("/")) return false;
  if (trimmed.includes("\\")) return false;
  const parts = trimmed.split("/").filter(Boolean);
  if (!parts.length) return false;
  if (parts.some((part) => part === "." || part === "..")) return false;
  return true;
}

function parseSandboxMountSpec(spec: string): {
  hostPath: string;
  containerSubPath: string;
  requestedReadWrite: boolean;
} {
  const trimmed = spec.trim();
  if (!trimmed) {
    throw new Error("Empty --sandbox-mount entry");
  }

  let requestedReadWrite = true;
  let base = trimmed;
  if (trimmed.endsWith(":ro")) {
    requestedReadWrite = false;
    base = trimmed.slice(0, -3);
  } else if (trimmed.endsWith(":rw")) {
    requestedReadWrite = true;
    base = trimmed.slice(0, -3);
  }

  const idx = base.indexOf(":");
  if (idx <= 0 || idx >= base.length - 1) {
    throw new Error(
      `Invalid --sandbox-mount value: ${spec}. Use hostPath:subpath[:ro|rw].`,
    );
  }

  const hostPath = base.slice(0, idx).trim();
  const containerSubPath = base.slice(idx + 1).trim();
  if (!hostPath)
    throw new Error(
      `Invalid --sandbox-mount value: ${spec}. Host path is empty.`,
    );
  if (!containerSubPath)
    throw new Error(
      `Invalid --sandbox-mount value: ${spec}. Container subpath is empty.`,
    );

  return { hostPath, containerSubPath, requestedReadWrite };
}

function generateSandboxAllowlistTemplate(): string {
  const template: SandboxMountAllowlist = {
    allowedRoots: [
      {
        path: "~/projects",
        allowReadWrite: true,
        description: "Development projects",
      },
      {
        path: "~/Documents",
        allowReadWrite: false,
        description: "Documents (read-only)",
      },
    ],
    blockedPatterns: ["password", "secret", "token"],
  };
  return JSON.stringify(template, null, 2);
}

export async function resolveSandboxExtraMounts(
  specs: string[],
  sandboxMode: ResolvedSandboxMode,
): Promise<SandboxMount[]> {
  if (!specs.length) return [];
  const allowlistPath = resolveSandboxAllowlistPath();
  const allowlist = await loadSandboxAllowlist();
  if (!allowlist) {
    const template = generateSandboxAllowlistTemplate();
    throw new Error(
      `Additional sandbox mounts are blocked. Create ${allowlistPath} to enable.\n\nExample:\n${template}`,
    );
  }
  const blocked = allowlist.blockedPatterns ?? DEFAULT_SANDBOX_BLOCKED_PATTERNS;
  const roots = allowlist.allowedRoots;

  const mounts: SandboxMount[] = [];
  for (const spec of specs) {
    const parsed = parseSandboxMountSpec(spec);
    if (!isValidSandboxContainerSubPath(parsed.containerSubPath)) {
      throw new Error(
        `Invalid sandbox container subpath: "${parsed.containerSubPath}". Use a relative path without "/" prefix or "..".`,
      );
    }
    const expanded = resolve(expandTildePath(parsed.hostPath));
    const real = await realpathOrNull(expanded);
    if (!real) {
      throw new Error(
        `Sandbox mount host path does not exist: ${parsed.hostPath} (expanded: ${expanded})`,
      );
    }
    const blockedMatch = matchesBlockedPattern(real, blocked);
    if (blockedMatch) {
      throw new Error(
        `Sandbox mount rejected (blocked pattern "${blockedMatch}"): ${real}`,
      );
    }
    const allowedRoot = await findAllowedRoot(real, roots);
    if (!allowedRoot) {
      const allowedList = roots
        .map((root) => resolve(expandTildePath(root.path)))
        .join(", ");
      throw new Error(
        `Sandbox mount rejected: ${real} is not under any allowed root. Allowed: ${allowedList}`,
      );
    }
    const allowReadWrite = allowedRoot.allowReadWrite === true;
    const readonly = parsed.requestedReadWrite ? !allowReadWrite : true;
    if (sandboxMode === "container") {
      const info = await stat(real);
      if (!info.isDirectory()) {
        throw new Error(
          `Apple container sandbox mounts must be directories: ${real}`,
        );
      }
    }
    mounts.push({
      hostPath: real,
      containerPath: `/workspace/extra/${parsed.containerSubPath}`,
      readonly,
    });
  }
  return mounts;
}
