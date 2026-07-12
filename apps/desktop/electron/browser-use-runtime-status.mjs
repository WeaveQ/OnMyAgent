import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function desktopRuntimeTarget(
  platform = process.platform,
  arch = process.arch,
) {
  const architecture = arch === "arm64" ? "aarch64" : "x86_64";
  if (platform === "darwin") return `${architecture}-apple-darwin`;
  if (platform === "linux") return `${architecture}-unknown-linux-gnu`;
  if (platform === "win32") return `${architecture}-pc-windows-msvc`;
  throw new Error(`Unsupported Browser Use runtime platform: ${platform}/${arch}`);
}

export function browserUseRuntimeStatus({
  runtimeRoot,
  platform = process.platform,
  arch = process.arch,
}) {
  const targetRoot = path.join(runtimeRoot, desktopRuntimeTarget(platform, arch));
  const manifestPath = path.join(targetRoot, "versions.json");
  const launcherPath = path.join(
    targetRoot,
    "bin",
    platform === "win32" ? "browser-use.cmd" : "browser-use",
  );
  let manifest = {};
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    manifest = {};
  }
  const browserUseVersion =
    typeof manifest.browserUse === "string" ? manifest.browserUse : null;
  const browserHarnessVersion =
    typeof manifest.browserHarness === "string" ? manifest.browserHarness : null;
  return {
    ready:
      existsSync(launcherPath) &&
      Boolean(browserUseVersion) &&
      Boolean(browserHarnessVersion),
    target: "embedded",
    browserUseVersion,
    browserHarnessVersion,
  };
}
