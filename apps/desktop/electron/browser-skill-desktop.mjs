/**
 * BrowserSkill (Tencent/bsk) health helpers for the desktop bridge.
 * External CLI + Chrome extension — not bundled; we only discover/status.
 */
import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const INSTALL_SH =
  "https://raw.githubusercontent.com/Tencent/BrowserSkill/main/install.sh";
const CHROME_WEB_STORE =
  "https://chromewebstore.google.com/detail/hhcmgoofomhgciiibhipgmgkgnoenaoi";
const DOCS =
  "https://github.com/Tencent/BrowserSkill#quick-start";

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
      child = spawn(command, args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
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

/**
 * Resolve `bsk` binary on PATH or common install locations.
 * @returns {{ path: string | null; source: "path" | "home-local" | "missing" }}
 */
export function resolveBskBinary() {
  const homeLocal = join(homedir(), ".local", "bin", "bsk");
  try {
    accessSync(homeLocal, fsConstants.X_OK);
    return { path: homeLocal, source: "home-local" };
  } catch {
    // fall through
  }

  // which-style: try bare name via shell path lookup
  return { path: "bsk", source: "path" };
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
        "bsk CLI not found. Install with: curl -fsSL https://raw.githubusercontent.com/Tencent/BrowserSkill/main/install.sh | sh",
      doctorSummary: null,
      installCliUrl: INSTALL_SH,
      chromeWebStoreUrl: CHROME_WEB_STORE,
      docsUrl: DOCS,
    };
  }

  const version = versionResult.stdout.trim().split("\n")[0] || null;
  const doctor = await runCommand(bin, ["doctor"], { timeoutMs: 12_000 });
  const combined = `${doctor.stdout}\n${doctor.stderr}`.toLowerCase();
  // Heuristics: doctor text varies; treat "extension" + fail as disconnected.
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
      ? "BrowserSkill CLI and extension look healthy."
      : extensionConnected
        ? doctor.stderr.trim() || doctor.stdout.trim() || "bsk doctor reported issues."
        : "Install the BrowserSkill Chrome extension and wait until the popup turns green.",
    doctorSummary: (doctor.stdout || doctor.stderr || "").trim().slice(0, 4_000) || null,
    installCliUrl: INSTALL_SH,
    chromeWebStoreUrl: CHROME_WEB_STORE,
    docsUrl: DOCS,
  };
}

/**
 * @param {{ shell: { openExternal: (url: string) => Promise<void> } }} deps
 * @param {"cli" | "extension" | "docs"} target
 */
export async function openBrowserSkillResource(deps, target) {
  const url =
    target === "cli"
      ? DOCS
      : target === "extension"
        ? CHROME_WEB_STORE
        : DOCS;
  await deps.shell.openExternal(url);
  return { ok: true, url };
}

export function createBrowserSkillDesktopHelpers(deps) {
  return {
    checkBrowserSkillStatus,
    openBrowserSkillInstallPage: (target = "extension") =>
      openBrowserSkillResource(deps, target === "cli" ? "cli" : target === "docs" ? "docs" : "extension"),
  };
}
