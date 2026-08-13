import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function validPid(value) {
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 1 ? pid : null;
}

function normalizedToken(prefix, value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? `${prefix}:${text}` : null;
}

/**
 * Read a stable OS-owned process start identity. A PID alone is not durable:
 * after a crash/restart the OS may assign it to an unrelated process.
 */
export function readProcessStartToken(pidValue, options = {}) {
  const pid = validPid(pidValue);
  if (!pid) return null;
  const platform = options.platform ?? process.platform;
  const readFile = options.readFileSync ?? readFileSync;
  const execFile = options.execFileSync ?? execFileSync;
  try {
    if (platform === "linux") {
      const stat = String(readFile(`/proc/${pid}/stat`, "utf8"));
      const close = stat.lastIndexOf(")");
      if (close < 0) return null;
      // Fields after comm begin at field 3 (state); starttime is field 22.
      const fields = stat.slice(close + 1).trim().split(/\s+/);
      const bootId = String(readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
      const processGroup = fields[2];
      const startTime = fields[19];
      if (!bootId || !processGroup || !startTime) return null;
      return normalizedToken("linux", `${bootId}:${startTime}|pgid:${processGroup}`);
    }
    if (platform === "darwin" || platform === "freebsd" || platform === "openbsd") {
      const bootSession = String(execFile("sysctl", ["-n", "kern.bootsessionuuid"], {
        encoding: "utf8",
        timeout: 2_000,
        env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
        stdio: ["ignore", "pipe", "ignore"],
      })).trim();
      if (!bootSession) return null;
      const output = String(execFile("ps", ["-o", "lstart=", "-o", "pgid=", "-p", String(pid)], {
        encoding: "utf8",
        timeout: 2_000,
        env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
        stdio: ["ignore", "pipe", "ignore"],
      })).trim();
      const match = output.match(/^(.*\S)\s+(\d+)$/);
      if (!match) return null;
      return normalizedToken("posix", `${bootSession}:${match[1]}|pgid:${match[2]}`);
    }
    if (platform === "win32") {
      const script = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`;
      for (const executable of ["powershell.exe", "pwsh.exe"]) {
        try {
          return normalizedToken("win", execFile(executable, ["-NoProfile", "-NonInteractive", "-Command", script], {
            encoding: "utf8",
            timeout: 3_000,
            windowsHide: true,
            stdio: ["ignore", "pipe", "ignore"],
          }));
        } catch {
          // Try the other supported PowerShell host.
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function matchProcessStartToken(record, options = {}) {
  const expected = String(record?.processStartToken ?? "").trim();
  if (!expected) return { matches: false, reason: "process_identity_missing", actual: null };
  const actual = readProcessStartToken(record?.pid, options);
  if (!actual) return { matches: false, reason: "process_identity_unavailable", actual: null };
  if (actual !== expected) return { matches: false, reason: "process_identity_mismatch", actual };
  return { matches: true, reason: null, actual };
}

export function processGroupFromStartToken(value) {
  const match = String(value ?? "").match(/\|pgid:(\d+)$/);
  const processGroup = Number(match?.[1]);
  return Number.isSafeInteger(processGroup) && processGroup > 1 ? processGroup : null;
}
