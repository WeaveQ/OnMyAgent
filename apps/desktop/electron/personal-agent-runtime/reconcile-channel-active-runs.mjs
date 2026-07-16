/**
 * Reconcile channel active-run locks against the runtime's run snapshots.
 *
 * Each messaging channel (Telegram / Discord) persists a per-account
 * `<platform>/accounts/<accountId>.active-runs.json` lock file. A "running"
 * entry there blocks the conversation ("还在处理上一条消息") until the channel's
 * own poll loop (resumeActiveRuns -> pollActiveRun) clears it. That loop only
 * runs while the channel service is active, so when the desktop app restarts
 * mid-run the lock can be left behind forever even though the underlying run
 * already finished or was reaped by `reconcileOrphanRuns`.
 *
 * This module mirrors the channel poll loop's reclaim rules at runtime startup,
 * so a stale lock is always reclaimed regardless of whether the channel service
 * is currently running.
 */

import { readdir, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Backstop ceiling — mirror of agent-dispatch.mjs ACTIVE_RUN_MAX_AGE_MS. The
// runtime's own run timeout lives in the runtime process and is lost on
// restart; this guarantees an active-run lock is never stuck "running" forever.
const ACTIVE_RUN_MAX_AGE_MS = 6 * 60 * 60 * 1000 + 15 * 60 * 1000;

// Channel platforms that persist active-run locks under <userDataDir>/<platform>/accounts.
const CHANNEL_PLATFORMS = ["telegram", "discord"];

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value, mode = 0o600) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
  await rename(tmp, filePath);
}

/**
 * Decide whether a stale active-run record should be reclaimed.
 *
 * Reclaim when any of:
 *  - the record has no runId (corrupt / empty)
 *  - the run no longer resolves via getRun (previous process died/restarted and
 *    the log was finalized by reconcileOrphanRuns, so getRun returns null)
 *  - the run status is terminal (completed / failed / cancelled)
 *  - still "running" but started before this process's reconcile cutoff
 *    (orphan left behind by a previous session)
 *  - still "running" but older than ACTIVE_RUN_MAX_AGE_MS (timeout backstop)
 *
 * Anything else (a legitimately running current-session task) is preserved so
 * the channel's own resumeActiveRuns -> pollActiveRun loop can finish it.
 */
export function shouldReclaimActiveRun(record, snapshot, reconcileCutoffMs) {
  if (!record || !record.runId) return true;
  if (!snapshot) return true;
  const status = String(snapshot.status ?? "");
  if (status && status !== "running") return true;
  const startedAt = Number(record.startedAt ?? 0);
  if (startedAt && startedAt < reconcileCutoffMs) return true;
  if (startedAt && Date.now() - startedAt > ACTIVE_RUN_MAX_AGE_MS) return true;
  return false;
}

/**
 * Scan every channel platform's active-runs.json and reclaim stale locks.
 *
 * @param {object} opts
 * @param {string} opts.userDataDir  Electron userData directory
 * @param {(input: {runId: string, workspaceRoot?: string}) => object|null} opts.getRun
 *        Runtime status lookup (createPersonalAgentRuntime's `status`)
 * @param {number} opts.reconcileCutoffMs  Date.now() captured at runtime start
 * @returns {Promise<{scanned: number, reclaimed: number}>}
 */
export async function reconcileChannelActiveRuns({ userDataDir, getRun, reconcileCutoffMs }) {
  if (!userDataDir || typeof getRun !== "function") return { scanned: 0, reclaimed: 0 };
  let scanned = 0;
  let reclaimed = 0;
  for (const platform of CHANNEL_PLATFORMS) {
    const accountsDir = path.join(userDataDir, platform, "accounts");
    const files = await readdir(accountsDir).catch(() => []);
    for (const file of files) {
      if (!file.endsWith(".active-runs.json")) continue;
      const filePath = path.join(accountsDir, file);
      const all = (await readJsonFile(filePath, {})) ?? {};
      const runKeys = Object.keys(all);
      if (runKeys.length === 0) continue;
      let changed = false;
      for (const runKey of runKeys) {
        const record = all[runKey];
        if (!record) continue;
        scanned += 1;
        let snapshot = null;
        try {
          snapshot = getRun({ runId: record.runId, workspaceRoot: record.workspaceRoot });
        } catch {
          snapshot = null;
        }
        if (shouldReclaimActiveRun(record, snapshot, reconcileCutoffMs)) {
          delete all[runKey];
          changed = true;
          reclaimed += 1;
        }
      }
      if (changed) {
        await writeJsonFile(filePath, all).catch(() => undefined);
      }
    }
  }
  return { scanned, reclaimed };
}

export default reconcileChannelActiveRuns;
