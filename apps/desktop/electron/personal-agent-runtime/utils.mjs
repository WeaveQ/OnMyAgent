import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function createExecHelpers(options = {}) {
  const extraPathEntries = () => {
    if (typeof options.extraPathEntries === "function") return options.extraPathEntries();
    return Array.isArray(options.extraPathEntries) ? options.extraPathEntries : [];
  };
  function pathEntries() {
    const home = os.homedir();
    return [
      ...extraPathEntries(),
      process.env.PATH,
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      path.join(home, ".local", "bin"),
      path.join(home, ".opencode", "bin"),
      path.join(home, ".cargo", "bin"),
      path.join(home, ".bun", "bin"),
      path.join(home, ".volta", "bin"),
      path.join(home, "Library", "pnpm"),
    ]
      .flatMap((entry) => String(entry ?? "").split(path.delimiter))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function processEnv(extra = {}) {
    const seen = new Set();
    const pathValue = pathEntries()
      .filter((entry) => {
        if (seen.has(entry)) return false;
        seen.add(entry);
        return true;
      })
      .join(path.delimiter);
    return { ...process.env, PATH: pathValue, Path: pathValue, path: pathValue, ...extra };
  }

  function runCommandCapture(command, args, options = {}) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? processEnv(),
        shell: options.shell ?? false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timeoutMs = Number(options.timeoutMs ?? 0);
      const timeout = timeoutMs > 0 ? setTimeout(() => child.kill("SIGTERM"), timeoutMs) : null;
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        if (timeout) clearTimeout(timeout);
        resolve({ ok: false, status: 1, stdout, stderr: stderr || error.message });
      });
      child.on("close", (code, signal) => {
        if (timeout) clearTimeout(timeout);
        resolve({
          ok: code === 0,
          status: typeof code === "number" ? code : 1,
          signal: signal ?? null,
          stdout,
          stderr,
        });
      });
    });
  }

  async function resolveCommandFromLoginShell(names) {
    if (!names.length || process.platform === "win32") return new Map();
    const safeNames = names.filter((name) => /^[A-Za-z0-9._-]+$/.test(name));
    if (!safeNames.length) return new Map();
    const script = safeNames.map((name) => `printf '${name}='; command -v ${name} 2>/dev/null || true`).join("; ");
    const result = await runCommandCapture(process.env.SHELL || "/bin/zsh", ["-lc", script], { timeoutMs: 4000 });
    const out = new Map();
    for (const line of result.stdout.split("\n")) {
      const [name, ...rest] = line.split("=");
      const value = rest.join("=").trim();
      if (name && value) out.set(name.trim(), value);
    }
    return out;
  }

  async function resolveExecutable(command) {
    const name = String(command ?? "").trim();
    if (!name || name.includes("/") || name.includes("\\")) return name;
    const shellResolved = await resolveCommandFromLoginShell([name]);
    const resolvedPath = shellResolved.get(name);
    if (resolvedPath) return resolvedPath;
    for (const entry of pathEntries()) {
      const candidate = path.join(entry, name);
      try {
        const info = await stat(candidate);
        if (info.isFile()) return candidate;
      } catch {
        // Continue probing fallback PATH entries.
      }
    }
    return name;
  }

  return { pathEntries, processEnv, runCommandCapture, resolveCommandFromLoginShell, resolveExecutable };
}

export function parseJsonLikeObject(raw) {
  const text = String(raw ?? "").replace(/^\uFEFF/, "");
  try {
    return JSON.parse(text);
  } catch {
    const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
    const withoutLineComments = withoutBlockComments.replace(/(^|[^:])\/\/.*$/gm, "$1");
    const withoutTrailingCommas = withoutLineComments.replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(withoutTrailingCommas);
    } catch {
      return null;
    }
  }
}

export async function readJsonLikeFile(targetPath) {
  try {
    return parseJsonLikeObject(await readFile(targetPath, "utf8"));
  } catch {
    return null;
  }
}

export async function writeJsonFile(targetPath, data) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  // Atomic write: tmp+rename so a crash mid-serialize cannot leave a partial
  // JSON file on disk that would break the next boot's parse. The tmp
  // filename is randomized so concurrent writers targeting the same path
  // do not race on a shared `<target>.tmp` (the previous fixed suffix caused
  // spurious ENOENT during rename when two writes overlapped).
  //
  // Windows: concurrent rename-over-existing often throws EPERM/EACCES/EBUSY.
  // Retry with short backoff; if dest is locked, remove it then rename again.
  const suffix = randomBytes(6).toString("hex");
  const tmpPath = `${targetPath}.${suffix}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  const attempts = process.platform === "win32" ? 12 : 3;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await rename(tmpPath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      const code = error && typeof error === "object" ? error.code : undefined;
      const retryable =
        code === "EPERM" ||
        code === "EACCES" ||
        code === "EBUSY" ||
        code === "EEXIST" ||
        code === "ENOENT";
      if (!retryable || attempt === attempts - 1) break;
      if (process.platform === "win32" && (code === "EPERM" || code === "EACCES" || code === "EEXIST")) {
        try {
          await rm(targetPath, { force: true });
        } catch {
          /* dest may already be gone or still locked */
        }
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 8 * (attempt + 1)));
    }
  }
  try {
    await rm(tmpPath, { force: true });
  } catch {
    /* noop */
  }
  throw lastError;
}

export function uniqueModelOptions(options) {
  const seen = new Set();
  const output = [];
  for (const option of options) {
    const id = String(option?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push({ id, label: String(option?.label ?? id).trim() || id });
  }
  return output;
}

export function modelLookupKey(id) {
  return String(id ?? "").trim().toLowerCase().replace(/[\s_.]+/g, "-");
}

export function reconcileModelOptions(preferredOptions, discoveredOptions) {
  const discoveredByKey = new Map();
  for (const option of discoveredOptions) discoveredByKey.set(modelLookupKey(option.id), option);
  const reconciled = preferredOptions.map((option) => discoveredByKey.get(modelLookupKey(option.id)) ?? option);
  return uniqueModelOptions([...reconciled, ...discoveredOptions]);
}

export function stableKey(provider, workspaceRoot, agentId = "default") {
  const hash = createHash("sha256").update(`${provider}\n${workspaceRoot}\n${agentId}`).digest("hex").slice(0, 16);
  return `onmyagent-personal-${provider}-${hash}`;
}

export function runId() {
  return `${Date.now()}-${randomBytes(6).toString("hex")}`;
}

export function stringifyAgentCommand(execPath, args) {
  return [execPath, ...args].map((part) => (/[\s"']/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

export function appendRunEvent(events, event) {
  events.push({ ...event, at: Date.now() });
}

// --- Process-tree lifecycle primitives (shared by adapters + registry) ---
// Mirrors AionUi's `backend-launcher.ts` / `acp-generic.mjs` kill semantics:
// escalate SIGTERM -> grace -> SIGKILL, and target the whole process group
// (negative pid) so a detached child plus everything it forked is reaped.
//
// On Windows, bare `child.kill("SIGTERM")` only reaps the immediate child and
// leaves agent CLI grandchildren alive. Always go through terminateProcessTree
// / terminateProcessTreeByPid so win32 uses `taskkill /T /F`.

/**
 * Pure decision helper: how should we kill a process tree on this platform?
 * Unit tests assert this without spawning real processes.
 *
 * @param {{ platform?: string; pid?: number | string; force?: boolean }} [options]
 * @returns {{ kind: "taskkill"; command: string; args: string[] } | { kind: "posix-group"; signals: string[] } | { kind: "noop" }}
 */
export function resolveProcessTreeKillPlan({ platform = process.platform, pid, force = true } = {}) {
  const nPid = Number(pid);
  if (!nPid) return { kind: "noop" };
  if (platform === "win32") {
    const args = force
      ? ["/pid", String(nPid), "/T", "/F"]
      : ["/pid", String(nPid), "/T"];
    return { kind: "taskkill", command: "taskkill", args };
  }
  return { kind: "posix-group", signals: ["SIGTERM", "SIGKILL"] };
}

/**
 * Best-effort force kill of a ChildProcess tree (no grace). Used by waitForExit
 * timeout escalation and as a fallback when taskkill spawn fails.
 */
export function forceKillProcessTree(child, { platform = process.platform } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  const plan = resolveProcessTreeKillPlan({ platform, pid, force: true });
  if (plan.kind === "taskkill") {
    try {
      spawn(plan.command, plan.args, { windowsHide: true, stdio: "ignore" });
      return;
    } catch {
      // Fall through to direct kill.
    }
  }
  if (plan.kind === "posix-group" && pid) {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // Fall through to direct kill.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Already gone.
  }
}

export function isProcessAlive(pid) {
  const n = Number(pid);
  if (!n) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

// A registry record carries `pid` and optionally `pgid`. Prefer the process
// group (a detached child's pgid equals its pid on POSIX) and fall back to the
// bare pid. Either way we report "alive" only if at least one signal probe
// succeeds — a process that is merely hung waiting on the network still shows
// up here, which is exactly why callers must *kill* it rather than skip it.
export function isProcessTreeAlive(record) {
  const nPid = Number(record?.pid);
  const nPgid = Number(record?.pgid);
  if (nPgid > 1) {
    try {
      process.kill(-nPgid, 0);
      return true;
    } catch {
      // Fall through to a direct pid probe.
    }
  }
  return isProcessAlive(nPid);
}

/**
 * Wait for a child to exit. On timeout, force-kill the whole process tree
 * (taskkill /T /F on Windows; process-group SIGKILL on POSIX) so hung agent
 * grandchildren cannot linger.
 */
export function waitForExit(child, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      forceKillProcessTree(child);
      resolve();
    }, timeoutMs);
    timer.unref?.();
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Kill a live ChildProcess object and its descendants. Used by adapter cancel
// paths and ACP teardown.
export async function terminateProcessTree(child, { graceMs = 1_000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (process.platform === "win32") {
    if (pid) {
      const plan = resolveProcessTreeKillPlan({ platform: "win32", pid, force: true });
      if (plan.kind === "taskkill") {
        try {
          spawn(plan.command, plan.args, { windowsHide: true, stdio: "ignore" });
        } catch {
          forceKillProcessTree(child);
        }
      }
    }
    await waitForExit(child, graceMs + 2_000);
    return;
  }
  const killGroup = (signal) => {
    if (!pid) return child.kill(signal);
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // Already exited.
      }
    }
  };
  killGroup("SIGTERM");
  await Promise.race([
    waitForExit(child, graceMs),
    new Promise((resolve) => setTimeout(resolve, graceMs).unref?.()),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    killGroup("SIGKILL");
    await waitForExit(child, 2_000);
  }
}

// Kill a process tree addressed only by a persisted registry record
// ({ pid, pgid }). Used when we no longer hold the ChildProcess (startup /
// exit cleanup, reconcile) — there is no exit event to await, so we probe
// liveness manually after the grace window.
/**
 * @param {{ pid?: number | string; pgid?: number | string; graceMs?: number }} [options]
 */
export async function terminateProcessTreeByPid({ pid, pgid, graceMs = 1_000 } = {}) {
  const nPid = Number(pid);
  if (!nPid) return;
  if (process.platform === "win32") {
    // Force-kill the whole tree; soft /T without /F leaves hung children.
    await runTaskkill(nPid, true);
    return;
  }
  const target = Number(pgid) > 1 ? -Number(pgid) : -nPid;
  const signalTarget = (signal) => {
    try {
      process.kill(target, signal);
    } catch {
      try {
        process.kill(nPid, signal);
      } catch {
        // Already exited.
      }
    }
  };
  signalTarget("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, graceMs));
  if (isProcessTreeAlive({ pid: nPid, pgid: Number(pgid) > 1 ? Number(pgid) : null })) {
    signalTarget("SIGKILL");
  }
}

function runTaskkill(pid, force = false) {
  return new Promise((resolve) => {
    const plan = resolveProcessTreeKillPlan({ platform: "win32", pid, force });
    if (plan.kind !== "taskkill") {
      resolve();
      return;
    }
    try {
      const child = spawn(plan.command, plan.args, { stdio: "ignore", windowsHide: true });
      child.once("error", () => resolve());
      child.once("exit", () => resolve());
    } catch {
      resolve();
    }
  });
}
