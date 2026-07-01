import { join, resolve } from "node:path";
import { resolveRouterDataDir } from "./data-dir.js";

export type SidecarTarget =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-x64"
  | "linux-arm64"
  | "windows-x64"
  | "windows-arm64";

export type SidecarConfig = {
  dir: string;
  baseUrl: string;
  manifestUrl: string;
  target: SidecarTarget | null;
};

export type SidecarConfigFlags = Map<string, string | boolean>;

type ReadFlag = (flags: SidecarConfigFlags, key: string) => string | undefined;

export function resolveSidecarTarget(): SidecarTarget | null {
  if (process.platform === "darwin") {
    if (process.arch === "arm64") return "darwin-arm64";
    if (process.arch === "x64") return "darwin-x64";
    return null;
  }
  if (process.platform === "linux") {
    if (process.arch === "arm64") return "linux-arm64";
    if (process.arch === "x64") return "linux-x64";
    return null;
  }
  if (process.platform === "win32") {
    if (process.arch === "arm64") return "windows-arm64";
    if (process.arch === "x64") return "windows-x64";
    return null;
  }
  return null;
}

export function resolveSandboxSidecarTarget(
  mode: "none" | "docker" | "container",
): SidecarTarget | null {
  if (mode === "none") return resolveSidecarTarget();
  if (process.arch === "arm64") return "linux-arm64";
  if (process.arch === "x64") return "linux-x64";
  return null;
}

export function resolveSidecarDir(
  flags: SidecarConfigFlags,
  readFlag: ReadFlag,
): string {
  const override =
    readFlag(flags, "sidecar-dir") ?? process.env.ONMYAGENT_SIDECAR_DIR;
  if (override && override.trim()) return resolve(override.trim());
  return join(resolveRouterDataDir(flags, readFlag), "sidecars");
}

export function resolveSidecarBaseUrl(
  flags: SidecarConfigFlags,
  cliVersion: string,
  readFlag: ReadFlag,
): string {
  const override =
    readFlag(flags, "sidecar-base-url") ??
    process.env.ONMYAGENT_SIDECAR_BASE_URL;
  if (override && override.trim()) return override.trim();
  return `https://github.com/WeaveQ/onmyagent/releases/download/onmyagent-orchestrator-v${cliVersion}`;
}

export function resolveSidecarManifestUrl(
  flags: SidecarConfigFlags,
  baseUrl: string,
  readFlag: ReadFlag,
): string {
  const override =
    readFlag(flags, "sidecar-manifest") ??
    process.env.ONMYAGENT_SIDECAR_MANIFEST_URL;
  if (override && override.trim()) return override.trim();
  return `${baseUrl.replace(/\/$/, "")}/onmyagent-orchestrator-sidecars.json`;
}

export function resolveSidecarConfigForTarget(
  flags: SidecarConfigFlags,
  cliVersion: string,
  targetOverride: SidecarTarget | null,
  readFlag: ReadFlag,
): SidecarConfig {
  const baseUrl = resolveSidecarBaseUrl(flags, cliVersion, readFlag);
  return {
    dir: resolveSidecarDir(flags, readFlag),
    baseUrl,
    manifestUrl: resolveSidecarManifestUrl(flags, baseUrl, readFlag),
    target: targetOverride,
  };
}

export function resolveSidecarConfig(
  flags: SidecarConfigFlags,
  cliVersion: string,
  readFlag: ReadFlag,
): SidecarConfig {
  return resolveSidecarConfigForTarget(
    flags,
    cliVersion,
    resolveSidecarTarget(),
    readFlag,
  );
}
