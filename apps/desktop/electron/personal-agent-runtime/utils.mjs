import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveRealHomeDir } from "../real-home-policy.mjs";
import { resolveWindowsAwareSpawnSpec } from "./windows-spawn.mjs";
import { matchProcessStartToken, processGroupFromStartToken } from "./process-identity.mjs";

const jsonWriteQueues = new Map();

/**
 * Real user home for local agent CLIs (Grok/Codex/Claude/Pi auth lives here).
 * Desktop OpenCode isolation rewrites process.env.HOME to opencode-sandbox;
 * agent probe/run must not inherit that or they report 需登录 with valid auth.
 */
export function resolveAgentHostHome(env = process.env) {
  return resolveRealHomeDir({
    override: env.ONMYAGENT_REAL_HOME,
    home: [env.HOME, os.homedir()],
    userProfile: env.USERPROFILE,
    user: env.USER ?? env.LOGNAME,
    platform: process.platform,
  });
}

/** Env for spawning local agent CLIs / ACP probes with credential-visible HOME. */
export function agentHostProcessEnv(extra = {}, baseEnv = process.env) {
  const realHome = resolveAgentHostHome(baseEnv);
  /** @type {NodeJS.ProcessEnv} */
  const merged = Object.assign({}, baseEnv, extra);
  if (realHome) {
    merged.HOME = realHome;
    merged.USERPROFILE = realHome;
    merged.ONMYAGENT_REAL_HOME = realHome;
  }
  return merged;
}

export function createExecHelpers(options = {}) {
  const baseEnvironment = () => {
    const configured = typeof options.baseEnvironment === "function"
      ? options.baseEnvironment()
      : options.baseEnvironment;
    return configured && typeof configured === "object" ? configured : process.env;
  };
  const extraPathEntries = () => {
    if (typeof options.extraPathEntries === "function") return options.extraPathEntries();
    return Array.isArray(options.extraPathEntries) ? options.extraPathEntries : [];
  };
  function pathEntries() {
    const environment = baseEnvironment();
    const home = resolveAgentHostHome(environment);
    return [
      ...extraPathEntries(),
      environment.PATH ?? environment.Path ?? environment.path,
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
    const environment = baseEnvironment();
    const seen = new Set();
    const pathValue = pathEntries()
      .filter((entry) => {
        if (seen.has(entry)) return false;
        seen.add(entry);
        return true;
      })
      .join(path.delimiter);
    return agentHostProcessEnv(
      { PATH: pathValue, Path: pathValue, path: pathValue, ...extra },
      environment,
    );
  }

  function runCommandCapture(command, args, options = {}) {
    return new Promise((resolve) => {
      const explicitShell = Object.hasOwn(options, "shell") && options.shell !== undefined;
      const spawnEnv = options.env ?? processEnv();
      const spawnSpec = explicitShell
        ? { command, args, windowsVerbatimArguments: false }
        : resolveWindowsAwareSpawnSpec(command, args, { env: spawnEnv });
      const child = spawn(spawnSpec.command, spawnSpec.args, {
        cwd: options.cwd,
        env: spawnEnv,
        ...(explicitShell ? { shell: options.shell } : {}),
        windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timeoutMs = Number(options.timeoutMs ?? 0);
      let settled = false;
      let timedOut = false;
      let timeout = null;
      const settle = (result) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve(result);
      };
      if (timeoutMs > 0) {
        timeout = setTimeout(() => {
          timedOut = true;
          const timeoutText = `Command timed out after ${timeoutMs}ms`;
          // This ChildProcess is owned by the current in-memory call, so use
          // its handle directly. Persisted PID-only termination is separately
          // fenced by an OS process-start identity.
          const terminate = Promise.resolve().then(() => forceKillProcessTree(child));
          void terminate.catch(() => forceKillProcessTree(child)).finally(() => {
            settle({
              ok: false,
              status: 1,
              signal: child.signalCode ?? null,
              stdout,
              stderr: stderr ? `${stderr.trimEnd()}\n${timeoutText}` : timeoutText,
              timedOut: true,
            });
          });
        }, timeoutMs);
      }
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        if (timedOut) return;
        settle({ ok: false, status: 1, stdout, stderr: stderr || error.message });
      });
      child.on("close", (code, signal) => {
        if (timedOut) return;
        settle({
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
    const result = await runCommandCapture(baseEnvironment().SHELL || "/bin/zsh", ["-lc", script], { timeoutMs: 4000 });
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
    const candidates = process.platform === "win32"
      ? [name, ...(baseEnvironment().PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((ext) => `${name}${ext.toLowerCase()}`)]
      : [name];
    for (const entry of pathEntries()) {
      for (const candidateName of candidates) {
        const candidate = path.join(entry, candidateName);
        try {
          const info = await stat(candidate);
          if (info.isFile()) {
            // Windows npm installs often leave an extensionless POSIX shim
            // beside the real .cmd launcher. Node cannot spawn that shim on
            // Windows, so prefer a PATHEXT launcher when both exist.
            if (process.platform === "win32" && candidateName === name && candidates.length > 1) {
              continue;
            }
            return candidate;
          }
        } catch {
          // Continue probing fallback PATH entries.
        }
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
  const previous = jsonWriteQueues.get(targetPath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => writeJsonFileAtomic(targetPath, data));
  jsonWriteQueues.set(targetPath, current);
  try {
    await current;
  } finally {
    if (jsonWriteQueues.get(targetPath) === current) jsonWriteQueues.delete(targetPath);
  }
}

async function writeJsonFileAtomic(targetPath, data) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  // Atomic write: tmp+rename so a crash mid-serialize cannot leave a partial
  // JSON file on disk that would break the next boot's parse. The tmp
  // filename is randomized so concurrent writers targeting the same path
  // do not race on a shared `<target>.tmp` (the previous fixed suffix caused
  // spurious ENOENT during rename when two writes overlapped).
  //
  // Windows: antivirus/indexer locks can briefly reject rename-over-existing.
  // Same-process writers are serialized above; retry without deleting the last
  // known-good destination so a failed replacement cannot erase durable state.
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
      const killer = spawn(plan.command, plan.args, { windowsHide: true, stdio: "ignore" });
      killer.on("error", () => {});
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
          const killer = spawn(plan.command, plan.args, { windowsHide: true, stdio: "ignore" });
          killer.on("error", () => {});
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
 * @param {{ pid?: number | string; pgid?: number | string; processStartToken?: string; graceMs?: number }} [options]
 */
export async function terminateProcessTreeByPid({ pid, pgid, processStartToken, graceMs = 1_000 } = {}) {
  const nPid = Number(pid);
  if (!Number.isSafeInteger(nPid) || nPid <= 1 || nPid === process.pid) {
    return { terminated: false, reason: "invalid_pid" };
  }
  const expectedStartToken = String(processStartToken ?? "").trim();
  if (!expectedStartToken) return { terminated: false, reason: "process_identity_missing" };
  const requestedProcessGroup = Number(pgid);
  const nPgid = process.platform !== "win32" && Number.isSafeInteger(requestedProcessGroup) && requestedProcessGroup > 1
    ? requestedProcessGroup
    : null;
  const tokenProcessGroup = processGroupFromStartToken(expectedStartToken);
  if (process.platform !== "win32" && nPgid !== null && tokenProcessGroup !== nPgid) {
    return { terminated: false, reason: "process_group_identity_mismatch" };
  }
  const identityMatches = () => matchProcessStartToken({ pid: nPid, processStartToken: expectedStartToken }).matches;
  if (!identityMatches()) return { terminated: false, reason: "process_identity_mismatch" };
  if (process.platform === "win32") {
    // Force-kill the whole tree; soft /T without /F leaves hung children.
    const taskkill = await runTaskkill(nPid, true);
    return taskkill.ok
      ? { terminated: true, reason: null }
      : { terminated: false, reason: "taskkill_failed" };
  }
  const target = nPgid !== null ? -nPgid : nPid;
  const signalTarget = (signal) => {
    try {
      process.kill(target, signal);
      return true;
    } catch {
      // Never fall back from an authenticated process group to the numeric
      // PID. The group can disappear while that PID is immediately reused.
      return false;
    }
  };
  if (!identityMatches()) return { terminated: false, reason: "process_identity_changed" };
  const termSent = signalTarget("SIGTERM");
  if (!termSent && isProcessTreeAlive({ pid: nPid, pgid: nPgid })) {
    return { terminated: false, reason: "sigterm_failed" };
  }
  await new Promise((resolve) => setTimeout(resolve, graceMs));
  if (isProcessTreeAlive({ pid: nPid, pgid: nPgid })) {
    if (!identityMatches()) return { terminated: false, reason: "process_identity_changed" };
    if (!signalTarget("SIGKILL")) return { terminated: false, reason: "sigkill_failed" };
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (isProcessTreeAlive({ pid: nPid, pgid: nPgid })) {
      return { terminated: false, reason: "process_still_alive" };
    }
  }
  return { terminated: true, reason: null };
}

function runTaskkill(pid, force = false) {
  return new Promise((resolve) => {
    const plan = resolveProcessTreeKillPlan({ platform: "win32", pid, force });
    if (plan.kind !== "taskkill") {
      resolve({ ok: false, code: null });
      return;
    }
    try {
      const child = spawn(plan.command, plan.args, { stdio: "ignore", windowsHide: true });
      child.once("error", () => resolve({ ok: false, code: null }));
      child.once("exit", (code) => resolve({ ok: code === 0, code }));
    } catch {
      resolve({ ok: false, code: null });
    }
  });
}
