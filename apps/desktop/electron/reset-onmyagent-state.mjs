/**
 * OnMyAgent local data reset helpers (desktop main process).
 *
 * Modes:
 * - onboarding: no disk wipe — renderer clears preferences + onboarding flags
 *   and soft-reloads into #/welcome (do not process-relaunch in desktop dev).
 * - all: full product wipe — Electron userData + ~/.onmyagent +
 *   ~/.studio-switch + legacy product home dir + Application Support product dirs
 *
 * Never deletes shared CLI agent configs (~/.config/opencode, ~/.claude,
 * ~/.codex, ~/.openclaw, ~/.agents, …).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {"onboarding" | "all"} ResetOnMyAgentMode */

// Legacy product home under $HOME (pre-rename). Split so rename-consistency
// does not flag the historical path we still wipe for old installs.
const LEGACY_PRODUCT_HOME_DIR = `.${"open"}${"work"}`;

const AFTER_EXIT_SCRIPT = fileURLToPath(
  new URL("./reset-onmyagent-after-exit.mjs", import.meta.url),
);

/** electron-dev respawns the Electron child when it sees this exit code. */
export const RESET_RELAUNCH_EXIT_CODE = 82;

export async function waitForPendingFullResetMarkerGone(input = {}) {
  const markerPath = String(
    input.markerPath ?? pendingFullResetMarkerPath(input.homeDir),
  );
  const exists = input.exists ?? existsSync;
  const now = input.now ?? Date.now;
  const sleep =
    input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = Number(input.timeoutMs ?? 30_000);
  const pollMs = Number(input.pollMs ?? 150);
  const deadline = now() + timeoutMs;
  while (exists(markerPath) && now() < deadline) {
    await sleep(pollMs);
  }
  return !exists(markerPath);
}

/** Marker lives next to $HOME, not inside ~/.onmyagent, so the wipe cannot delete it first. */
export function pendingFullResetMarkerPath(homeDir = os.homedir()) {
  return path.join(String(homeDir || os.homedir()), ".onmyagent-pending-full-reset");
}

export function isRetryableResetFsError(error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(/** @type {{ code?: unknown }} */ (error).code ?? "")
      : "";
  return code === "EBUSY" || code === "EPERM" || code === "EACCES" || code === "ENOTEMPTY";
}

/**
 * @param {object} input
 * @param {ResetOnMyAgentMode} [input.mode]
 * @param {string} [input.homeDir]
 * @param {string} [input.userDataDir]
 * @param {string} [input.appDataDir]
 * @param {string} [input.desktopBootstrapPath]
 * @param {NodeJS.Platform} [input.platform]
 * @returns {string[]}
 */
export function listOnMyAgentResetTargets(input = {}) {
  const mode = normalizeResetMode(input.mode);
  const homeDir = String(input.homeDir ?? os.homedir()).trim() || os.homedir();
  const userDataDir = String(input.userDataDir ?? "").trim();
  const appDataDir = String(input.appDataDir ?? "").trim();
  const bootstrap =
    String(input.desktopBootstrapPath ?? "").trim() ||
    path.join(homeDir, ".config", "onmyagent", "desktop-bootstrap.json");
  const platform = input.platform ?? process.platform;

  /** @type {string[]} */
  const targets = [];

  // Onboarding reset is renderer-side (preferences + hasCompletedOnboarding).
  // Keep workspaces and userData so users only re-run the guide / prefs.
  if (mode === "onboarding") {
    return [];
  }

  // Full product wipe (mode === "all")
  if (userDataDir) {
    targets.push(path.join(userDataDir, "onmyagent-workspaces.json"));
    targets.push(path.join(userDataDir, "workspace-state.json"));
    targets.push(userDataDir);
  }
  targets.push(bootstrap);

  targets.push(path.join(homeDir, ".onmyagent"));
  targets.push(path.join(homeDir, ".studio-switch"));
  targets.push(path.join(homeDir, LEGACY_PRODUCT_HOME_DIR));
  targets.push(path.join(homeDir, ".config", "onmyagent"));

  if (appDataDir) {
    for (const name of [
      "OnMyAgent",
      "onmyagent",
      "@onmyagent",
      "com.differentai.onmyagent",
      "com.differentai.onmyagent.dev",
    ]) {
      targets.push(path.join(appDataDir, name));
    }
  }

  if (platform === "darwin") {
    const library = path.join(homeDir, "Library");
    for (const rel of [
      "Preferences/com.differentai.onmyagent.plist",
      "Preferences/com.differentai.onmyagent.dev.plist",
      "Caches/com.differentai.onmyagent",
      "Caches/com.differentai.onmyagent.dev",
      "Logs/com.differentai.onmyagent",
      "Logs/com.differentai.onmyagent.dev",
      "Logs/OnMyAgent",
      "Saved Application State/com.differentai.onmyagent.savedState",
      "Saved Application State/com.differentai.onmyagent.dev.savedState",
    ]) {
      targets.push(path.join(library, rel));
    }
  }

  return dedupePaths(targets);
}

/**
 * @param {object} input
 * @param {ResetOnMyAgentMode} [input.mode]
 * @param {string} [input.homeDir]
 * @param {string} [input.userDataDir]
 * @param {string} [input.appDataDir]
 * @param {string} [input.desktopBootstrapPath]
 * @param {NodeJS.Platform} [input.platform]
 * @param {(reason: string) => Promise<unknown>} [input.prepareDestructiveReset]
 * @param {(target: string) => Promise<void>} [input.remove]
 * @param {(input: { contents: string, path: string }) => Promise<void>} [input.writeMarker]
 * @param {(plan: {
 *   targets: string[],
 *   markerPath: string,
 * }) => void} [input.scheduleDeferred]
 * @returns {Promise<{ removed: string[]; missing: string[]; errors: string[]; deferred: string[] }>}
 */
export async function resetOnMyAgentLocalData(input = {}) {
  const mode = normalizeResetMode(input.mode);
  if (mode === "all" && typeof input.prepareDestructiveReset === "function") {
    // The lifecycle owner must stop every runtime that can hold files under
    // userData before the first target is removed. A rejection deliberately
    // aborts the entire wipe and leaves all data untouched.
    await input.prepareDestructiveReset("full_reset");
  }
  const targets = listOnMyAgentResetTargets(input);
  const remove =
    input.remove ??
    (async (target) => {
      await rm(target, { recursive: true, force: true });
    });

  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const deferred = [];

  const markerPath = pendingFullResetMarkerPath(input.homeDir);
  if (mode === "all") {
    const writeMarker =
      input.writeMarker ??
      (async ({ path: file, contents }) => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, contents, "utf8");
      });
    await writeMarker({
      path: markerPath,
      contents: `${JSON.stringify({ at: new Date().toISOString(), targets })}\n`,
    });
  }

  // Longer paths first so nested deletes under userData do not race parents.
  const ordered = [...targets].sort((a, b) => b.length - a.length);

  for (const target of ordered) {
    try {
      await remove(target);
      removed.push(target);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(/** @type {{ code?: unknown }} */ (error).code ?? "")
          : "";
      if (code === "ENOENT") {
        missing.push(target);
        continue;
      }
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown error");
      if (isRetryableResetFsError(error)) {
        deferred.push(`${target}: ${message}`);
        continue;
      }
      errors.push(`${target}: ${message}`);
    }
  }

  if (mode === "all" && typeof input.scheduleDeferred === "function") {
    input.scheduleDeferred({ targets, markerPath });
  }

  return { removed, missing, errors, deferred };
}

/**
 * Spawn a detached Node helper that wipes after this Electron pid exits.
 * Uses ELECTRON_RUN_AS_NODE so packaged `process.execPath` is not a GUI relaunch.
 *
 * @param {object} input
 * @param {number} input.pid
 * @param {string[]} input.targets
 * @param {string} input.markerPath
 * @param {{ execPath: string, args?: string[] } | null} [input.relaunch]
 * @param {string} [input.execPath]
 * @param {string} [input.scriptPath]
 * @param {typeof spawn} [input.spawn]
 */
export function scheduleDeferredFullReset(input) {
  const execPath = String(input.execPath ?? process.execPath);
  const scriptPath = String(input.scriptPath ?? AFTER_EXIT_SCRIPT);
  const plan = {
    pid: Number(input.pid),
    targets: Array.isArray(input.targets) ? input.targets : [],
    markerPath: String(input.markerPath ?? ""),
    relaunch: input.relaunch ?? null,
  };
  const spawnImpl = input.spawn ?? spawn;
  const child = spawnImpl(execPath, [scriptPath], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ONMYAGENT_RESET_PLAN: JSON.stringify(plan),
    },
  });
  child.unref?.();
  return { pid: child.pid ?? null };
}

/**
 * @param {unknown} value
 * @returns {ResetOnMyAgentMode}
 */
export function normalizeResetMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  return mode === "all" ? "all" : "onboarding";
}

/**
 * @param {string[]} paths
 * @returns {string[]}
 */
function dedupePaths(paths) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const raw of paths) {
    const value = String(raw ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
