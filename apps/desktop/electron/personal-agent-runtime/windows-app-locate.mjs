// Locate Windows desktop apps whose install dir is not a well-known folder.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";

const UNINSTALL_CACHE_MS = 30_000;
/** @type {{ at: number, entries: object[] } | null} */
let uninstallCache = null;

export function resetWindowsUninstallCache() {
  uninstallCache = null;
}

function firstExistingPath(candidate) {
  const raw = String(candidate ?? "").trim().replace(/^"+|"+$/g, "");
  if (!raw) return "";
  try {
    return existsSync(raw) ? raw : "";
  } catch {
    return "";
  }
}

export function installDirFromUninstallFields(entry = {}) {
  const location = firstExistingPath(entry.installLocation);
  if (location) return location;

  const icon = String(entry.displayIcon ?? "").trim();
  const iconPath = firstExistingPath(icon.replace(/,\s*-?\d+\s*$/, "").trim());
  if (iconPath) return dirname(iconPath);

  const uninstall = String(entry.uninstallString ?? "").trim();
  if (!uninstall || /\bmsiexec(\.exe)?\b/i.test(uninstall)) return "";
  const quoted = uninstall.match(/"([^"]+\.(?:exe|msi))"/i)?.[1];
  const unquoted = uninstall.match(/^([A-Za-z]:\\[^\s"]+\.(?:exe|msi))/i)?.[1];
  const exe = firstExistingPath(quoted || unquoted || "");
  return exe ? dirname(exe) : "";
}

function parseUninstallJson(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
  } catch {
    return [];
  }
}

function runEncodedPowerShell(script, timeoutMs = 5000) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { encoding: "utf8", timeout: timeoutMs, windowsHide: true },
  );
}

export function readWindowsUninstallEntries({ force = false } = {}) {
  if (process.platform !== "win32") return [];
  const now = Date.now();
  if (!force && uninstallCache && now - uninstallCache.at < UNINSTALL_CACHE_MS) {
    return uninstallCache.entries;
  }
  try {
    const result = runEncodedPowerShell(`
$ErrorActionPreference = 'SilentlyContinue'
$hives = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
)
$rows = foreach ($hive in $hives) {
  if (-not (Test-Path $hive)) { continue }
  Get-ChildItem $hive | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath
    if (-not $p.DisplayName) { return }
    [pscustomobject]@{
      displayName = [string]$p.DisplayName
      installLocation = [string]$p.InstallLocation
      displayIcon = [string]$p.DisplayIcon
      uninstallString = [string]$p.UninstallString
    }
  }
}
$rows | ConvertTo-Json -Compress
`);
    const entries = parseUninstallJson(result.stdout).filter(
      (item) => item && typeof item === "object" && String(item.displayName ?? "").trim(),
    );
    uninstallCache = { at: now, entries };
    return entries;
  } catch {
    uninstallCache = { at: now, entries: [] };
    return [];
  }
}

function walkShortcutFiles(root, depth, namePattern) {
  if (depth < 0) return [];
  const found = [];
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const full = join(root, entry.name);
      if (entry.isDirectory()) {
        found.push(...walkShortcutFiles(full, depth - 1, namePattern));
        continue;
      }
      if (entry.isFile() && /\.lnk$/i.test(entry.name) && namePattern.test(entry.name)) {
        found.push(full);
      }
    }
  } catch {
    // ignore
  }
  return found;
}

export function resolveWindowsShortcutTarget(lnkPath) {
  const raw = String(lnkPath ?? "").trim();
  if (!raw || process.platform !== "win32") return "";
  try {
    const escaped = raw.replace(/'/g, "''");
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(New-Object -ComObject WScript.Shell).CreateShortcut('${escaped}').TargetPath`,
      ],
      { encoding: "utf8", timeout: 4000, windowsHide: true },
    );
    return firstExistingPath(String(result.stdout ?? "").trim().split(/\r?\n/)[0]);
  } catch {
    return "";
  }
}

export function windowsShortcutRoots(env = process.env, home = os.homedir()) {
  return [
    env.APPDATA ? join(env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs") : "",
    env.ProgramData ? join(env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs") : "",
    env.USERPROFILE ? join(env.USERPROFILE, "Desktop") : join(home, "Desktop"),
    env.PUBLIC ? join(env.PUBLIC, "Desktop") : "",
  ].filter(Boolean);
}

export function collectWindowsAppInstallDirs(input) {
  if (process.platform !== "win32") return [];
  const namePattern = input?.namePattern;
  if (!(namePattern instanceof RegExp)) return [];
  const dirs = new Set();
  for (const dir of Array.isArray(input.defaultDirs) ? input.defaultDirs : []) {
    const raw = String(dir ?? "").trim();
    if (raw && firstExistingPath(raw)) dirs.add(raw);
  }
  for (const entry of readWindowsUninstallEntries()) {
    if (!namePattern.test(String(entry.displayName ?? ""))) continue;
    const installDir = installDirFromUninstallFields(entry);
    if (installDir) dirs.add(installDir);
  }
  for (const root of windowsShortcutRoots()) {
    const depth = /Desktop$/i.test(root) ? 0 : 3;
    for (const lnk of walkShortcutFiles(root, depth, namePattern)) {
      const target = resolveWindowsShortcutTarget(lnk);
      if (!target) continue;
      const installDir = dirname(target);
      if (installDir && firstExistingPath(installDir)) dirs.add(installDir);
    }
  }
  return [...dirs];
}
