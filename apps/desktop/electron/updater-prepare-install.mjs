import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ONMYAGENT_IMAGE = "OnMyAgent.exe";

export function raceTimeout(promise, ms) {
  const timeoutMs = Math.max(0, Number(ms) || 0);
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
    }),
  ]);
}

/**
 * Parse `tasklist /FO CSV /NH` rows and return numeric PIDs.
 * @param {string} stdout
 * @param {string} [imageName]
 */
export function parseTasklistCsvPids(stdout, imageName = ONMYAGENT_IMAGE) {
  const wanted = String(imageName).toLowerCase();
  const pids = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)","(\d+)"/);
    if (!match) continue;
    if (match[1].toLowerCase() !== wanted) continue;
    const pid = Number(match[2]);
    if (Number.isSafeInteger(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

export function excludeCurrentPid(pids, currentPid = process.pid) {
  const self = Number(currentPid);
  return (Array.isArray(pids) ? pids : []).filter((pid) => pid !== self);
}

/**
 * Close leftover packaged OnMyAgent.exe children (detached Task Supervisor)
 * so NSIS old-uninstaller is not blocked. Never targets the current pid.
 * @param {{
 *   platform?: NodeJS.Platform,
 *   currentPid?: number,
 *   imageName?: string,
 *   execFileFn?: typeof execFileAsync,
 * }} [options]
 */
export async function terminateOtherOnMyAgentProcesses(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { killed: [], skipped: true };
  const currentPid = Number(options.currentPid ?? process.pid);
  const imageName = options.imageName ?? ONMYAGENT_IMAGE;
  const execFileFn = options.execFileFn ?? execFileAsync;
  let stdout = "";
  try {
    const result = await execFileFn(
      "tasklist",
      ["/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV", "/NH"],
      { windowsHide: true },
    );
    stdout = String(result?.stdout ?? result ?? "");
  } catch {
    return { killed: [], skipped: false, error: "tasklist_failed" };
  }
  const others = excludeCurrentPid(parseTasklistCsvPids(stdout, imageName), currentPid);
  const killed = [];
  for (const pid of others) {
    try {
      await execFileFn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      killed.push(pid);
    } catch {
      // Process may have already exited.
    }
  }
  return { killed, skipped: false };
}
