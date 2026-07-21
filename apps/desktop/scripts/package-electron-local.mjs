#!/usr/bin/env node
/**
 * Local macOS package: ad-hoc sign (identity "-") + Hardened Runtime entitlements.
 *
 * Does NOT replace Developer ID + notarization for distribution. It makes an
 * unsigned local DMG/.app more stable on the build machine, and less likely to
 * crash under Hardened Runtime after xattr -cr.
 *
 * Usage (from repo root):
 *   pnpm --dir apps/desktop package:electron:local
 *   pnpm --dir apps/desktop package:electron:local -- --dir   # .app only
 *
 * Extra args after `--` are passed to electron-builder.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const extraArgs = process.argv.slice(2);

const env = {
  ...process.env,
  // Force ad-hoc codesign; do not search keychain for a missing Developer ID.
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
  CSC_NAME: "-",
  // Computer Use helper uses the same identity when unset.
  ONMYAGENT_COMPUTER_USE_CODESIGN_IDENTITY:
    process.env.ONMYAGENT_COMPUTER_USE_CODESIGN_IDENTITY || "-",
  // Never notarize ad-hoc local builds.
  MACOS_NOTARIZE: "false",
};

const dirOnly = extraArgs.includes("--dir");
const builderArgs = [
  "exec",
  "electron-builder",
  "--config",
  "electron-builder.yml",
  "--mac",
  "--arm64",
  "--publish",
  "never",
  ...extraArgs.filter((arg) => arg !== "--dir"),
];
if (dirOnly) builderArgs.push("--dir");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: options.cwd ?? desktopRoot,
    env: options.env ?? env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[package:electron:local] ad-hoc identity=\"-\" + entitlements.mac.plist (arm64)");
run("pnpm", ["run", "build:electron"]);
run("node", ["./scripts/patch-nsis-install-details.mjs"]);
run("pnpm", builderArgs);

const appPath = path.join(
  desktopRoot,
  "dist-electron",
  "mac-arm64",
  "OnMyAgent.app",
);
if (existsSync(appPath) && process.platform === "darwin") {
  console.log(`[package:electron:local] clearing quarantine: ${appPath}`);
  spawnSync("xattr", ["-cr", appPath], { stdio: "inherit" });
  const dmg = path.join(desktopRoot, "dist-electron", "onmyagent-mac-arm64-0.2.0.dmg");
  if (existsSync(dmg)) {
    spawnSync("xattr", ["-cr", dmg], { stdio: "inherit" });
  }
  console.log("[package:electron:local] done.");
  console.log(`  app: ${appPath}`);
  console.log("  open: open \"" + appPath + "\"");
  console.log("  Note: WeChat/browser copies still get quarantine — prefer local path or xattr -cr after copy.");
} else {
  console.log("[package:electron:local] done (app path not found for post-clear; check dist-electron/).");
}
