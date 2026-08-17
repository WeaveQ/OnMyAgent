/**
 * BrowserSkill (Tencent/bsk) health helpers for the desktop bridge.
 * External CLI + Chrome extension — not bundled; we only discover/status
 * and open guided install surfaces (Terminal / Web Store / docs).
 */
import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { resolveWindowsAwareSpawnSpec } from "./personal-agent-runtime/windows-spawn.mjs";

const INSTALL_SH =
  "https://raw.githubusercontent.com/Tencent/BrowserSkill/main/install.sh";
const CHROME_WEB_STORE =
  "https://chromewebstore.google.com/detail/hhcmgoofomhgciiibhipgmgkgnoenaoi";
const DOCS =
  "https://github.com/Tencent/BrowserSkill#quick-start";

const WINDOWS_INSTALL_COMMAND =
  "Install bsk.exe from https://github.com/Tencent/BrowserSkill/releases (see the Windows section at https://github.com/Tencent/BrowserSkill#quick-start), add it to PATH, then run: bsk doctor";
const WINDOWS_INSTALL_CLI_URL = "https://github.com/Tencent/BrowserSkill/releases";

/** Platform-aware install copy. Windows must not receive curl|sh. */
export function browserSkillInstallCommand(platform = process.platform) {
  if (platform === "win32") return WINDOWS_INSTALL_COMMAND;
  return `curl -fsSL ${INSTALL_SH} | sh && bsk doctor`;
}

export function browserSkillInstallCliUrl(platform = process.platform) {
  return platform === "win32" ? WINDOWS_INSTALL_CLI_URL : INSTALL_SH;
}

/** One-liner for the current host (desktop status / copy button). */
export const BROWSER_SKILL_INSTALL_COMMAND = browserSkillInstallCommand();

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string }>}
 */
function runCommand(command, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  return new Promise((resolve) => {
    let settled = false;
    /** @type {import("node:child_process").ChildProcessWithoutNullStreams | null} */
    let child = null;
    try {
      const spec = resolveWindowsAwareSpawnSpec(command, args);
      child = spawn(spec.command, spec.args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: spec.windowsVerbatimArguments,
      });
    } catch (error) {
      resolve({
        ok: false,
        code: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child?.kill("SIGTERM");
      } catch {
        // ignore
      }
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: stderr || `timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: error.message || String(error),
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
      });
    });
  });
}

function pathExists(candidate) {
  try {
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    try {
      accessSync(candidate, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

export function windowsBskCandidates(home, env = {}) {
  const localAppData = env.LOCALAPPDATA || join(home, "AppData", "Local");
  return [
    join(home, ".local", "bin", "bsk.exe"),
    join(home, ".local", "bin", "bsk.cmd"),
    join(home, ".local", "bin", "bsk"),
    join(home, ".bsk", "bin", "bsk.exe"),
    join(home, ".bsk", "bin", "bsk.cmd"),
    join(localAppData, "bsk", "bsk.exe"),
    join(localAppData, "Programs", "bsk", "bsk.exe"),
  ];
}

/**
 * Resolve `bsk` binary on PATH or common install locations.
 * @param {{ platform?: NodeJS.Platform; home?: string; env?: NodeJS.ProcessEnv; exists?: (path: string) => boolean }} [options]
 * @returns {{ path: string | null; source: "path" | "home-local" | "missing" }}
 */
export function resolveBskBinary(options = {}) {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const exists = options.exists ?? pathExists;
  const candidates =
    platform === "win32"
      ? windowsBskCandidates(home, env)
      : [join(home, ".local", "bin", "bsk")];

  for (const candidate of candidates) {
    if (exists(candidate)) {
      return { path: candidate, source: "home-local" };
    }
  }

  return { path: platform === "win32" ? "bsk.exe" : "bsk", source: "path" };
}

/**
 * @returns {Promise<import("@onmyagent/types/desktop-ipc").BrowserSkillStatusResult>}
 */
export async function checkBrowserSkillStatus() {
  const resolved = resolveBskBinary();
  const bin = resolved.path ?? "bsk";

  const versionResult = await runCommand(bin, ["--version"], { timeoutMs: 5_000 });
  if (!versionResult.ok) {
    return {
      ok: false,
      installed: false,
      extensionConnected: false,
      version: null,
      binaryPath: resolved.source === "home-local" ? bin : null,
      message:
        versionResult.stderr.trim() ||
        "bsk CLI not found. Use the guided setup to install it.",
      doctorSummary: null,
      installCliUrl: browserSkillInstallCliUrl(),
      chromeWebStoreUrl: CHROME_WEB_STORE,
      docsUrl: DOCS,
      installCommand: browserSkillInstallCommand(),
    };
  }

  const version = versionResult.stdout.trim().split("\n")[0] || null;
  const doctor = await runCommand(bin, ["doctor"], { timeoutMs: 12_000 });
  const combined = `${doctor.stdout}\n${doctor.stderr}`.toLowerCase();
  const extensionFail =
    /extension/.test(combined) &&
    (/\bfail\b/.test(combined) || /0 browsers? connected/.test(combined));
  const extensionOk =
    /extension/.test(combined) &&
    (/\bok\b/.test(combined) || /connected/.test(combined)) &&
    !extensionFail;

  const installed = true;
  const extensionConnected = extensionOk && !extensionFail;
  const ok = doctor.ok && extensionConnected;

  return {
    ok,
    installed,
    extensionConnected,
    version,
    binaryPath: resolved.source === "home-local" ? bin : "bsk (PATH)",
    message: ok
      ? "BrowserSkill is ready — agents can use the real browser via bsk."
      : extensionConnected
        ? doctor.stderr.trim() || doctor.stdout.trim() || "bsk doctor reported issues."
        : "CLI found. Install the Chrome extension and wait until its popup is green.",
    doctorSummary: (doctor.stdout || doctor.stderr || "").trim().slice(0, 4_000) || null,
    installCliUrl: browserSkillInstallCliUrl(),
    chromeWebStoreUrl: CHROME_WEB_STORE,
    docsUrl: DOCS,
    installCommand: BROWSER_SKILL_INSTALL_COMMAND,
  };
}

/**
 * Open macOS Terminal with the official install one-liner.
 * Falls back to docs URL on other platforms or if Terminal open fails.
 * @param {{ shell: { openExternal: (url: string) => Promise<void> } }} deps
 */
export async function openBrowserSkillCliInstall(deps) {
  if (process.platform === "darwin") {
    // AppleScript-escape for double-quoted do script string.
    const escaped = BROWSER_SKILL_INSTALL_COMMAND
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    const script = `tell application "Terminal" to do script "${escaped}"`;
    const result = await runCommand("osascript", ["-e", script], {
      timeoutMs: 8_000,
    });
    if (result.ok) {
      // Bring Terminal forward.
      void runCommand(
        "osascript",
        ["-e", 'tell application "Terminal" to activate'],
        { timeoutMs: 3_000 },
      );
      return {
        ok: true,
        method: "terminal",
        command: BROWSER_SKILL_INSTALL_COMMAND,
      };
    }
  }

  await deps.shell.openExternal(DOCS);
  return {
    ok: true,
    method: "docs",
    url: DOCS,
    command: BROWSER_SKILL_INSTALL_COMMAND,
  };
}

/**
 * @param {{ shell: { openExternal: (url: string) => Promise<void> } }} deps
 * @param {"cli" | "extension" | "docs"} target
 */
export async function openBrowserSkillResource(deps, target) {
  if (target === "cli") {
    return openBrowserSkillCliInstall(deps);
  }
  const url = target === "extension" ? CHROME_WEB_STORE : DOCS;
  await deps.shell.openExternal(url);
  return { ok: true, method: target, url };
}

export function createBrowserSkillDesktopHelpers(deps) {
  return {
    checkBrowserSkillStatus,
    openBrowserSkillInstallPage: (target = "extension") =>
      openBrowserSkillResource(
        deps,
        target === "cli" ? "cli" : target === "docs" ? "docs" : "extension",
      ),
  };
}
