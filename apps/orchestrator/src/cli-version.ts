/**
 * CLI / sidecar version and local OpenCode path resolution.
 * Extracted from cli-shared.ts (mechanical split; re-exported for compat).
 */
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { localOpencodeWindowsExtraCandidates } from "./cli-opencode-windows-paths.js";
import { fileExists } from "./cli-fs.js";
import { isExecutable } from "./runtime-sandbox.js";
import type { SidecarName } from "./cli-types.js";
import type { VersionManifest } from "./version-manifest.js";

export const FALLBACK_VERSION = "0.1.0";

declare const __ONMYAGENT_ORCHESTRATOR_VERSION__: string | undefined;
declare const __ONMYAGENT_PINNED_OPENCODE_VERSION__: string | undefined;

export const OPENCODE_LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;

export function resolveOpencodeLogLevel(requested?: string): string | undefined {
  const trimmed = requested?.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.toUpperCase();
  if (!(OPENCODE_LOG_LEVELS as readonly string[]).includes(normalized)) {
    throw new Error(
      `Unsupported --opencode-log-level value: ${requested}. Expected one of: ${OPENCODE_LOG_LEVELS.join(", ")}.`,
    );
  }
  return normalized;
}

export async function resolveCliVersion(): Promise<string> {
  if (
    typeof __ONMYAGENT_ORCHESTRATOR_VERSION__ === "string" &&
    __ONMYAGENT_ORCHESTRATOR_VERSION__.trim()
  ) {
    return __ONMYAGENT_ORCHESTRATOR_VERSION__.trim();
  }
  const candidates = [
    join(dirname(process.execPath), "..", "package.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      try {
        const raw = await readFile(candidate, "utf8");
        const parsed = JSON.parse(raw) as { version?: string };
        if (parsed.version) return parsed.version;
      } catch {
        // ignore
      }
    }
  }

  return FALLBACK_VERSION;
}

export async function readPinnedOpencodeVersion(): Promise<string | undefined> {
  if (
    typeof __ONMYAGENT_PINNED_OPENCODE_VERSION__ === "string" &&
    __ONMYAGENT_PINNED_OPENCODE_VERSION__.trim()
  ) {
    return __ONMYAGENT_PINNED_OPENCODE_VERSION__.trim();
  }

  const candidates = [
    join(dirname(process.execPath), "..", "constants.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "constants.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "constants.json"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      try {
        const raw = await readFile(candidate, "utf8");
        const parsed = JSON.parse(raw) as { opencodeVersion?: unknown };
        const value =
          typeof parsed.opencodeVersion === "string"
            ? parsed.opencodeVersion.trim()
            : "";
        if (!value) continue;
        return value.startsWith("v") ? value.slice(1) : value;
      } catch {
        // ignore
      }
    }
  }

  return undefined;
}

export async function resolveLocalOpencodeBin(): Promise<string | undefined> {
  const binaryName = platform() === "win32" ? "opencode.exe" : "opencode";
  const candidates = [
    process.env.OPENCODE_BIN?.trim(),
    process.env.ONMYAGENT_OPENCODE_BIN?.trim(),
    process.env.ONMYAGENT_LOCAL_OPENCODE_BIN?.trim(),
    ...String(process.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((entry) => join(entry, binaryName)),
  ];

  if (platform() === "win32") {
    candidates.push(...localOpencodeWindowsExtraCandidates());
  } else {
    candidates.push(
      join(homedir(), ".opencode", "bin", "opencode"),
      "/opt/homebrew/bin/opencode",
      "/usr/local/bin/opencode",
      "/usr/bin/opencode",
    );
  }

  const uniqueCandidates = [...new Set(candidates)].filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0,
  );
  for (const candidate of uniqueCandidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  return undefined;
}

export async function resolveLocalOpencodeConfigDir(): Promise<string | undefined> {
  const explicit = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (explicit) return explicit;

  const candidates = [
    join(homedir(), ".config", "opencode"),
    process.env.XDG_CONFIG_HOME?.trim()
      ? join(process.env.XDG_CONFIG_HOME.trim(), "opencode")
      : undefined,
  ].filter(Boolean) as string[];

  for (const candidate of [...new Set(candidates)]) {
    if (
      (await fileExists(join(candidate, "opencode.json"))) ||
      (await fileExists(join(candidate, "opencode.jsonc")))
    ) {
      return candidate;
    }
  }
  return undefined;
}
export async function readPackageVersion(path: string): Promise<string | undefined> {
  try {
    const payload = await readFile(path, "utf8");
    const parsed = JSON.parse(payload) as { version?: string };
    if (typeof parsed.version === "string") return parsed.version;
    return undefined;
  } catch {
    return undefined;
  }
}

export async function resolveExpectedVersion(
  manifest: VersionManifest | null,
  name: SidecarName,
): Promise<string | undefined> {
  if (name !== "opencode") {
    const manifestVersion = manifest?.entries[name]?.version;
    if (manifestVersion) return manifestVersion;
  }

  try {
    const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
    if (name === "onmyagent-server") {
      const localPath = join(root, "..", "server", "package.json");
      const localVersion = await readPackageVersion(localPath);
      if (localVersion) return localVersion;
    }
    if (name === "opencode") {
      const pinnedVersion = await readPinnedOpencodeVersion();
      if (pinnedVersion) return pinnedVersion;
    }
  } catch {
    // ignore
  }

  const require = createRequire(import.meta.url);
  if (name === "onmyagent-server") {
    try {
      const pkgPath = require.resolve("onmyagent-server/package.json");
      const version = await readPackageVersion(pkgPath);
      if (version) return version;
    } catch {
      // ignore
    }
  }
  return undefined;
}
