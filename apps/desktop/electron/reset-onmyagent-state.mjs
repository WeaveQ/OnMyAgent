/**
 * OnMyAgent local data reset helpers (desktop main process).
 *
 * Modes:
 * - onboarding: no disk wipe — renderer clears preferences + onboarding flags
 *   so the app re-enters the welcome guide after relaunch (workspaces kept).
 * - all: full product wipe — Electron userData + ~/.onmyagent +
 *   ~/.studio-switch + legacy ~/.openwork + Application Support product dirs
 *
 * Never deletes shared CLI agent configs (~/.config/opencode, ~/.claude,
 * ~/.codex, ~/.openclaw, ~/.agents, …).
 */

import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** @typedef {"onboarding" | "all"} ResetOnMyAgentMode */

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
  targets.push(path.join(homeDir, ".openwork"));
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
 * @param {(target: string) => Promise<void>} [input.remove]
 * @returns {Promise<{ removed: string[]; missing: string[]; errors: string[] }>}
 */
export async function resetOnMyAgentLocalData(input = {}) {
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
      errors.push(`${target}: ${message}`);
    }
  }

  return { removed, missing, errors };
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
