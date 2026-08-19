/**
 * Detached helper: wait for the Electron pid to exit, then wipe reset targets.
 * Spawned with ELECTRON_RUN_AS_NODE=1 so process.execPath is a Node runtime.
 *
 * Env: ONMYAGENT_RESET_PLAN = JSON { pid, targets, markerPath, relaunch? }
 */
import { spawn } from "node:child_process";
import { rm, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_WAIT_MS = 30_000;
const POLL_MS = 200;

export function isPidAlive(pid, killFn = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    killFn(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   pid?: number,
 *   targets?: string[],
 *   markerPath?: string,
 *   relaunch?: { execPath?: string, args?: string[] } | null,
 * }} plan
 * @param {{
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   alive?: (pid: number) => boolean,
 *   remove?: (target: string) => Promise<void>,
 *   removeMarker?: (path: string) => Promise<void>,
 *   spawnRelaunch?: (execPath: string, args: string[]) => void,
 *   waitMs?: number,
 * }} [io]
 */
export async function runResetAfterExit(plan, io = {}) {
  const pid = Number(plan?.pid);
  const targets = Array.isArray(plan?.targets) ? plan.targets.filter(Boolean) : [];
  const markerPath = String(plan?.markerPath ?? "").trim();
  const now = io.now ?? Date.now;
  const sleep =
    io.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const alive = io.alive ?? ((id) => isPidAlive(id));
  const remove =
    io.remove ?? ((target) => rm(target, { recursive: true, force: true }));
  const removeMarker = io.removeMarker ?? ((file) => unlink(file));
  const deadline = now() + (io.waitMs ?? DEFAULT_WAIT_MS);

  while (alive(pid) && now() < deadline) {
    await sleep(POLL_MS);
  }

  for (const target of targets) {
    try {
      await remove(target);
    } catch {
      // best-effort: leftover files can be wiped on a later reset
    }
  }

  if (markerPath) {
    try {
      await removeMarker(markerPath);
    } catch {
      // ignore
    }
  }

  const relaunch = plan?.relaunch;
  const execPath = typeof relaunch?.execPath === "string" ? relaunch.execPath.trim() : "";
  if (execPath) {
    const args = Array.isArray(relaunch.args) ? relaunch.args : [];
    const spawnRelaunch =
      io.spawnRelaunch ??
      ((file, spawnArgs) => {
        const child = spawn(file, spawnArgs, {
          detached: true,
          stdio: "ignore",
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
        });
        child.unref();
      });
    spawnRelaunch(execPath, args);
  }
}

function parsePlan() {
  const raw = process.env.ONMYAGENT_RESET_PLAN ?? "";
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const plan = parsePlan();
  if (!plan) process.exit(0);
  await runResetAfterExit(plan);
  process.exit(0);
}
