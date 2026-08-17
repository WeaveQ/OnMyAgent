/**
 * OpenCode / sidecar child-process lifecycle helpers.
 * Extracted from runtime.mjs so createRuntimeManager stays a composition root.
 */

import { spawn, spawnSync } from "node:child_process";

const DEFAULT_OUTPUT_LIMIT = 8000;

export function truncateOutput(value, limit = DEFAULT_OUTPUT_LIMIT) {
  const text = String(value ?? "");
  return text.length <= limit ? text : text.slice(text.length - limit);
}

export function appendOutput(state, key, chunk) {
  const next = `${state[key] ?? ""}${String(chunk ?? "")}`;
  state[key] = truncateOutput(next);
}

/**
 * Spawn a managed sidecar child, wiring stdout/stderr into `state`.
 */
export function spawnManagedChild(state, program, args, options = {}) {
  const child = spawn(program, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  state.child = child;
  state.childExited = false;
  state.lastStdout = null;
  state.lastStderr = null;

  child.stdout?.on("data", (chunk) => appendOutput(state, "lastStdout", chunk.toString()));
  child.stderr?.on("data", (chunk) => appendOutput(state, "lastStderr", chunk.toString()));
  child.on("exit", (code) => {
    state.childExited = true;
    if (code != null && code !== 0) {
      appendOutput(state, "lastStderr", `Process exited with code ${code}.\n`);
    }
    options.onExit?.(code);
  });
  child.on("error", (error) => {
    state.childExited = true;
    appendOutput(state, "lastStderr", `${error instanceof Error ? error.message : String(error)}\n`);
  });

  return child;
}

export function processMatchesSidecar(command, sidecarDirs = []) {
  const value = String(command ?? "");
  return sidecarDirs.some((dir) => value.includes(dir)) &&
    (
      value.includes("onmyagent-orchestrator") ||
      value.includes("onmyagent-server") ||
      /(?:^|[\\/\s"])opencode(?:\.exe)?"?\s+serve\b/i.test(value)
    );
}

/**
 * Parse `ps` text (POSIX) or Get-CimInstance JSON (Windows) into pid+command.
 */
export function parseProcessListRows(stdout, platform = process.platform) {
  const text = String(stdout ?? "");
  if (platform === "win32") {
    const trimmed = text.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
      return items
        .map((item) => ({
          pid: Number(item?.ProcessId ?? item?.processId ?? item?.pid),
          command: String(item?.CommandLine ?? item?.commandLine ?? item?.command ?? ""),
        }))
        .filter((row) => Number.isFinite(row.pid) && row.pid > 0);
    } catch {
      return [];
    }
  }

  const rows = [];
  for (const row of text.split(/\r?\n/)) {
    const match = row.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), command: match[2] ?? "" });
  }
  return rows;
}

function listSidecarProcessRows(platform = process.platform) {
  try {
    if (platform === "win32") {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
        ],
        { encoding: "utf8", windowsHide: true, timeout: 15_000 },
      );
      if (result.error) return [];
      return parseProcessListRows(result.stdout, "win32");
    }
    const result = spawnSync("ps", ["-Ao", "pid=,command="], { encoding: "utf8" });
    if (result.error) return [];
    return parseProcessListRows(result.stdout, "linux");
  } catch {
    return [];
  }
}

export function killProcessId(pid, signal = "SIGTERM") {
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return;
  try {
    process.kill(pid, signal);
  } catch {
    // Process already exited or is not ours.
  }
}

/**
 * Packaged-build safety net: terminate leftover product sidecars by process list.
 */
export async function cleanupPackagedSidecars(input = {}) {
  const {
    isPackaged = false,
    sidecarDirs = [],
    requestShutdown = async () => false,
  } = input;
  if (!isPackaged) return;

  await requestShutdown().catch(() => false);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const rows = listSidecarProcessRows();
  const pids = [];
  for (const { pid, command } of rows) {
    if (processMatchesSidecar(command, sidecarDirs)) pids.push(pid);
  }
  for (const pid of pids) killProcessId(pid, "SIGTERM");
  if (pids.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const pid of pids) killProcessId(pid, "SIGKILL");
  }
}

/**
 * Stop a managed child: optional graceful shutdown, then SIGTERM/SIGKILL.
 */
export async function stopChild(state, options = {}) {
  const child = state.child;
  state.child = null;
  state.childExited = true;
  if (!child || child.exitCode != null || child.killed) return;

  if (options.requestShutdown) {
    try {
      const shutdownRequested = await options.requestShutdown();
      if (shutdownRequested) {
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    } catch {
      // ignore
    }
  }

  if (child.exitCode == null && !child.killed) {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (child.exitCode == null && !child.killed) {
      child.kill("SIGKILL");
    }
  }
}

/**
 * Ensure projectDir has an opencode.json(c) so serve can start.
 */
export async function ensureOpencodeConfig(projectDir, { fileExists, mkdir, writeFile, pathJoin }) {
  const jsoncPath = pathJoin(projectDir, "opencode.jsonc");
  const jsonPath = pathJoin(projectDir, "opencode.json");
  if ((await fileExists(jsoncPath)) || (await fileExists(jsonPath))) return;
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    jsoncPath,
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)}\n`,
    "utf8",
  );
}

export function generateManagedCredentials(randomUUID) {
  return [
    randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
    randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
  ];
}
