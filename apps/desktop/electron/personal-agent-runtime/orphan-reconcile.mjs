import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAgentProcess, unregisterAgentProcess } from "./process-registry.mjs";
import { personalAgentRuntimeStateRoot } from "./runtime-state.mjs";
import { readSupervisorOwnedRunIds, shouldFinalizeOrphanRunLog } from "./supervisor-owned-runs.mjs";
import { buildFinalizedOrphanMeta, rewriteOrphanRunLogContent } from "./run-helpers.mjs";

/**
 * Finalize stale run logs and reclaim orphaned "running" records left by a
 * previous process session.
 *
 * @param {{
 *   runs: Map<string, any>,
 *   reconcileCutoffMs: number,
 *   userDataDir?: string,
 *   processTermination: {
 *     isAlive: (record: any) => boolean,
 *     terminate: (record: any) => Promise<{ terminated?: boolean } | undefined>,
 *   },
 * }} deps
 */
export function createOrphanReconcile({
  runs,
  reconcileCutoffMs,
  userDataDir,
  processTermination,
}) {
  // A log whose run_meta is still "running" but has no active runtime record
  // (in-memory runs Map) is an orphan produced by a previous process session
  // that died/restarted mid-run. Persist it as "failed" so the UI stops
  // reporting the misleading "本地 Agent 运行状态已丢失 / timeout" error and
  // future restores read a clean, finalized log.
  async function finalizeStaleRunLog(logPath, meta) {
    try {
      const content = await readFile(logPath, "utf8");
      const finalizedMeta = buildFinalizedOrphanMeta(meta);
      const rewritten = rewriteOrphanRunLogContent(content, finalizedMeta);
      if (!rewritten) return;
      await writeFile(logPath, rewritten.content, "utf8");
    } catch {
      // Best effort: never block run restore on a log write failure.
    }
  }

  // On startup, reconcile every persisted run log across all workspaces and
  // finalize any orphaned "running" runs (process is already gone) the previous
  // process session left behind.
  async function reconcileOrphanRuns() {
    const reconcileCutoff = reconcileCutoffMs;
    const supervisorOwnedRunIds = await readSupervisorOwnedRunIds(userDataDir);
    const root = personalAgentRuntimeStateRoot();
    const workspacesRoot = path.join(root, "personal-assistant", "workspaces");
    const workspaces = await readdir(workspacesRoot).catch(() => []);
    for (const workspace of workspaces) {
      const runsDir = path.join(workspacesRoot, workspace, "runs");
      const files = await readdir(runsDir).catch(() => []);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = path.join(runsDir, file);
        let meta = null;
        try {
          const firstLine = (await readFile(filePath, "utf8")).split(/\r?\n/).find((line) => line.trim());
          if (firstLine) meta = JSON.parse(firstLine);
        } catch {
          continue;
        }
        if (!meta || meta.type !== "run_meta" || meta.status !== "running") continue;
        const startedAt = Number(meta.startedAt ?? meta.at ?? 0);
        if (!shouldFinalizeOrphanRunLog({
          runId: meta.runId,
          inMemory: runs.has(meta.runId),
          startedAt,
          reconcileCutoffMs: reconcileCutoff,
          supervisorOwnedRunIds,
        })) continue;
        // Do NOT skip a running run merely because its pid is still alive — a
        // process can be hung (e.g. blocked on the network) yet never finish,
        // which is the phantom-lock bug. If we can identify the tree via the
        // registry, reap it (SIGTERM -> SIGKILL) only when its durable OS start
        // identity still matches. A bare legacy PID may have been reused, so it
        // is never signalled. Either way finalize the log so the UI lock is
        // released without risking an unrelated process.
        const registered = getAgentProcess(meta.runId);
        if (registered && processTermination.isAlive(registered) === true) {
          const termination = await processTermination.terminate({
            pid: registered.pid,
            pgid: registered.pgid,
            processStartToken: registered.processStartToken,
          });
          if (termination?.terminated !== false && processTermination.isAlive(registered) === false) {
            unregisterAgentProcess(meta.runId);
          }
        }
        await finalizeStaleRunLog(filePath, meta);
      }
    }
  }

  return { finalizeStaleRunLog, reconcileOrphanRuns };
}
