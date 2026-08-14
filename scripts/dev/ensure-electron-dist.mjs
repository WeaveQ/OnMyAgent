#!/usr/bin/env node
/**
 * Repair a silently failed electron postinstall on Windows.
 * Extracts the cached zip into node_modules/.../electron/dist and writes path.txt.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function electronVersion() {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "apps", "desktop", "package.json"), "utf8"));
  return String(pkg.devDependencies?.electron ?? "").replace(/^\^/, "").trim() || "39.8.10";
}

function findElectronPackageDir(version) {
  const pnpmRoot = join(repoRoot, "node_modules", ".pnpm");
  if (!existsSync(pnpmRoot)) return null;
  const prefix = `electron@${version}`;
  const match = readdirSync(pnpmRoot).find((name) => name === prefix || name.startsWith(`${prefix}_`));
  if (!match) return null;
  return join(pnpmRoot, match, "node_modules", "electron");
}

function isHealthy(electronDir) {
  const pathTxt = join(electronDir, "path.txt");
  const exe = join(electronDir, "dist", "electron.exe");
  if (!existsSync(exe) || !existsSync(pathTxt)) return false;
  return readFileSync(pathTxt, "utf8") === "electron.exe";
}

function cachedZip(version) {
  const cache = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "electron", "Cache")
    : "";
  if (!cache || !existsSync(cache)) return null;
  const name = `electron-v${version}-win32-${process.arch === "arm64" ? "arm64" : "x64"}.zip`;
  const full = join(cache, name);
  return existsSync(full) ? full : null;
}

const version = electronVersion();
const electronDir = findElectronPackageDir(version);
if (!electronDir) {
  console.error(`[ensure-electron-dist] electron@${version} is not installed. Run pnpm install first.`);
  process.exit(1);
}

if (isHealthy(electronDir)) {
  console.log(`[ensure-electron-dist] ok: ${join(electronDir, "dist", "electron.exe")}`);
  process.exit(0);
}

if (process.platform !== "win32") {
  console.error("[ensure-electron-dist] Windows-only repair. Re-run pnpm install on this host.");
  process.exit(1);
}

const zip = cachedZip(version);
const distDir = join(electronDir, "dist");
mkdirSync(distDir, { recursive: true });
if (!zip) {
  console.error(
    `[ensure-electron-dist] missing cache zip for v${version}. See docs/windows-compat.md (Electron post-install).`,
  );
  process.exit(1);
}

const extract = spawnSync("tar", ["-xf", zip, "-C", distDir], { stdio: "inherit" });
if (extract.status !== 0) {
  console.error("[ensure-electron-dist] tar extract failed");
  process.exit(extract.status ?? 1);
}
writeFileSync(join(electronDir, "path.txt"), "electron.exe");
if (!isHealthy(electronDir)) {
  console.error("[ensure-electron-dist] extract finished but electron.exe / path.txt still invalid");
  process.exit(1);
}
console.log(`[ensure-electron-dist] repaired ${join(distDir, "electron.exe")}`);
