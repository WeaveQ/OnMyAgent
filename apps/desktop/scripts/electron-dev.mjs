import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearElectronDevHttpCaches,
  clearViteDepsCache,
  inspectViteDeps,
  resolveAppViteCacheDir,
  resolveAppViteDepsDir,
  resolveOnMyAgentUserDataDir,
  shouldForceViteOptimize,
} from "./vite-deps-integrity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "../..");
const electronSidecarDir = resolve(desktopRoot, "resources", "sidecars");
const electronRuntimeDir = resolve(desktopRoot, "resources", "runtimes");
const electronHelperDir = resolve(desktopRoot, "resources", "helpers");
const defaultDevDataDir = resolve(
  process.env.HOME ?? process.env.USERPROFILE ?? repoRoot,
  ".onmyagent",
  "onmyagent-orchestrator-dev",
);
const viteDepsDir = resolveAppViteDepsDir(repoRoot);
const viteCacheDir = resolveAppViteCacheDir(repoRoot);

const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const nodeCmd = process.execPath;
const portValue = Number.parseInt(process.env.PORT ?? "", 10);
const devPort = Number.isFinite(portValue) && portValue > 0 ? portValue : 5173;
const explicitStartUrl = process.env.ONMYAGENT_ELECTRON_START_URL?.trim() || "";
const startUrl = explicitStartUrl || `http://localhost:${devPort}`;
const viteProbeUrls = explicitStartUrl
  ? [explicitStartUrl]
  : [
      `http://127.0.0.1:${devPort}`,
      `http://[::1]:${devPort}`,
      `http://localhost:${devPort}`,
    ];

function needsShell(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

function run(command, args, options = {}) {
  return spawn(command, args, {
    stdio: ["ignore", "inherit", "inherit"],
    shell: needsShell(command),
    ...options,
  });
}

function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: needsShell(command),
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function fetchWithTimeout(url, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probeHost(host, port) {
  return new Promise((resolveCheck) => {
    const socket = net.createConnection({ host, port });
    const onDone = (ready) => {
      socket.removeAllListeners();
      socket.destroy();
      resolveCheck(ready);
    };
    socket.setTimeout(1200);
    socket.once("connect", () => onDone(true));
    socket.once("timeout", () => onDone(false));
    socket.once("error", () => onDone(false));
  });
}

async function looksLikeVite(url) {
  try {
    const response = await fetchWithTimeout(`${url}/@vite/client`);
    return response.ok;
  } catch {
    return false;
  }
}

async function looksLikeOnMyAgentApp(url) {
  if (!(await looksLikeVite(url))) return false;
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) return false;
    const body = await response.text();
    return body.includes("/src/index.react.tsx") || body.includes("<title>OnMyAgent</title>");
  } catch {
    return false;
  }
}

async function portIsOpenForVite(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    const port = Number.parseInt(parsed.port || (parsed.protocol === "https:" ? "443" : "80"), 10);
    if (!Number.isFinite(port)) return false;
    return probeHost(host, port);
  } catch {
    return false;
  }
}

async function waitForVite(url, timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const candidate of [url, ...viteProbeUrls].filter(Boolean)) {
      if (await looksLikeOnMyAgentApp(candidate)) {
        return candidate;
      }
    }
    for (const candidate of [url, ...viteProbeUrls].filter(Boolean)) {
      if (await portIsOpenForVite(candidate)) {
        console.warn(`[electron-dev] ${candidate} is already in use, but it is not the OnMyAgent app. Waiting for the OnMyAgent Vite server...`);
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`Timed out waiting for Vite dev server at ${viteProbeUrls.join(", ")}`);
}

function signalTree(child, signal) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // ignore
    }
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // ignore
    }
  }
}

function restoreTerminal() {
  try {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false);
    }
  } catch {
    // ignore
  }
}

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveWait) => {
    let settled = false;
    const finish = (clean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolveWait(clean);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

async function waitForChildren(children, timeoutMs) {
  const results = await Promise.all(children.map((child) => waitForExit(child, timeoutMs)));
  return results.every(Boolean);
}

let uiChild = null;
let electronChild = null;
let stopping = false;

async function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  restoreTerminal();

  const children = [electronChild, uiChild].filter(Boolean);
  for (const child of children) signalTree(child, "SIGINT");

  const stoppedCleanly = await waitForChildren(children, 2_000);
  if (!stoppedCleanly) {
    for (const child of children) signalTree(child, "SIGTERM");
    await waitForChildren(children, 1_000);
  }

  restoreTerminal();
  process.exit(exitCode);
}

process.once("SIGINT", () => void stopAll(130));
process.once("SIGTERM", () => void stopAll(143));

runSync(nodeCmd, [resolve(__dirname, "prepare-sidecar.mjs"), "--force", "--prefer-existing-opencode", "--outdir", electronSidecarDir], { cwd: desktopRoot });
runSync(nodeCmd, [resolve(__dirname, "prepare-runtimes.mjs"), "--outdir", electronRuntimeDir], { cwd: desktopRoot });
runSync(nodeCmd, [resolve(__dirname, "prepare-computer-use-helper.mjs"), "--force", "--outdir", electronHelperDir], { cwd: desktopRoot });
// Patch Electron.app Info.plist so the macOS menu bar and Dock show "OnMyAgent"
// instead of "Electron" during dev. The bundled Electron binary gets regenerated
// on `pnpm install`, so re-patching on every dev start is safe and cheap.
const devModeActive = (process.env.ONMYAGENT_DEV_MODE ?? "1") === "1";
runSync(nodeCmd, [resolve(__dirname, "patch-electron-name.mjs")], {
  cwd: desktopRoot,
  env: {
    ...process.env,
    ONMYAGENT_APP_NAME: process.env.ONMYAGENT_APP_NAME ?? (devModeActive ? "OnMyAgent - Dev" : "OnMyAgent"),
  },
});

// Shared packages must be built before Electron loads workspace deps from dist/.
console.log("[electron-dev] Building @onmyagent/types...");
runSync(pnpmCmd, ["--filter", "@onmyagent/types", "build"], { cwd: repoRoot });
// Build the server TS → JS so Electron can import it in-process
console.log("[electron-dev] Building onmyagent-server (tsc)...");
runSync(pnpmCmd, ["--filter", "onmyagent-server", "build"], { cwd: repoRoot });

// Stale Vite optimize-deps (missing chunk-*.js) blanks the Electron renderer.
// Detect and force a clean re-optimize before we attach the main window.
let depsInspection = inspectViteDeps(viteDepsDir);
let forceViteOptimize = shouldForceViteOptimize({
  inspection: depsInspection,
  forceEnv: process.env.ONMYAGENT_FORCE_VITE_OPTIMIZE,
});
if (!depsInspection.ok) {
  console.warn(
    `[electron-dev] Vite optimize-deps not ready (${depsInspection.reason ?? "unknown"}` +
      `; brokenImports=${depsInspection.brokenImports.length}` +
      `, optimizedMissing=${depsInspection.optimizedMissing.length}). Forcing re-optimize.`,
  );
}
if (forceViteOptimize) {
  const cleared = clearViteDepsCache(viteCacheDir);
  if (cleared.cleared) {
    console.log(`[electron-dev] Cleared Vite cache at ${cleared.path}`);
  }
}

// Drop Chromium HTTP/Code caches so the renderer cannot keep requesting deleted
// chunk files under the same ?v=<browserHash>.
const electronUserDataDir = resolveOnMyAgentUserDataDir({
  isDevMode: true,
  override: process.env.ONMYAGENT_ELECTRON_USERDATA,
});
const electronCacheClear = clearElectronDevHttpCaches(electronUserDataDir);
if (electronCacheClear.cleared.length > 0) {
  console.log(
    `[electron-dev] Cleared Electron cache dirs (${electronCacheClear.cleared.join(", ")}) under ${electronCacheClear.path}`,
  );
}

const initialProbeUrls = [startUrl, ...viteProbeUrls].filter(Boolean);
let viteReady = false;
let portBlockedByOtherApp = false;
for (const candidate of initialProbeUrls) {
  if (await looksLikeOnMyAgentApp(candidate)) {
    viteReady = true;
    break;
  }
}

if (!viteReady) {
  for (const candidate of initialProbeUrls) {
    if (await portIsOpenForVite(candidate)) {
      console.warn(`[electron-dev] ${candidate} is already in use, but it is not the OnMyAgent app.`);
      portBlockedByOtherApp = true;
      break;
    }
  }
}

if (!viteReady && portBlockedByOtherApp) {
  console.error(`[electron-dev] Refusing to load a non-OnMyAgent Vite app. Stop the process using port ${devPort}, or run with another PORT value.`);
  process.exit(1);
}

// If a Vite server is already up but its on-disk optimize-deps graph is broken,
// we cannot safely load Electron against it — force the operator to restart after
// we wiped the cache above. Prefer starting our own Vite with --force.
if (viteReady && forceViteOptimize) {
  console.warn(
    `[electron-dev] An OnMyAgent Vite server is already running on port ${devPort}, but optimize-deps needed a rebuild. ` +
      `Stop the existing Vite process and re-run desktop dev so it can start with a clean --force optimize.`,
  );
  // Re-inspect: if we cleared the cache under a live server, requests will 404 until restart.
  depsInspection = inspectViteDeps(viteDepsDir);
  if (!depsInspection.ok) {
    console.error(
      "[electron-dev] Refusing to launch Electron against a broken/missing optimize-deps graph. " +
        "Stop the process on the Vite port and run `pnpm dev -- desktop` again.",
    );
    process.exit(1);
  }
}

if (!viteReady) {
  // Run from apps/app so Vite cacheDir resolves to apps/app/node_modules/.vite
  // (same path inspectViteDeps / clearViteDepsCache use).
  // package.json "dev" uses Unix env assignment (FOO=1 cmd); Windows needs dev:windows.
  const appRoot = resolve(repoRoot, "apps/app");
  const appDevScript = process.platform === "win32" ? "dev:windows" : "dev";
  const viteArgs = forceViteOptimize
    ? ["exec", "vite", "--force"]
    : ["run", appDevScript];
  uiChild = run(pnpmCmd, viteArgs, {
    cwd: appRoot,
    env: {
      ...process.env,
      PORT: String(devPort),
      ONMYAGENT_DEV_MODE: process.env.ONMYAGENT_DEV_MODE ?? "1",
      ONMYAGENT_DATA_DIR: process.env.ONMYAGENT_DATA_DIR ?? defaultDevDataDir,
    },
  });
}

const resolvedStartUrl = await waitForVite(startUrl);

// Cold optimize-deps is async: HTML can be ready before .vite/deps exists.
// Poll until the graph is healthy, or until we only see "not ready yet" states.
async function waitForDepsIntegrity(timeoutMs = 60_000) {
  const startedAt = Date.now();
  let last = inspectViteDeps(viteDepsDir);
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fetchWithTimeout(resolvedStartUrl, 4000);
      await fetchWithTimeout(
        `${resolvedStartUrl.replace(/\/$/, "")}/src/index.react.tsx`,
        8000,
      );
    } catch {
      // best-effort warm-up while optimizer runs
    }
    last = inspectViteDeps(viteDepsDir);
    if (last.ok) return last;
    // Hard-broken graphs (missing chunk imports) should fail closed once stable.
    const hardBroken =
      last.reason === "broken_chunk_import" || last.reason === "optimized_entry_missing";
    if (hardBroken && Date.now() - startedAt > 8_000) {
      return last;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

depsInspection = await waitForDepsIntegrity(forceViteOptimize ? 60_000 : 20_000);
if (depsInspection.ok) {
  console.log(
    `[electron-dev] Vite optimize-deps ok (optimized=${depsInspection.optimizedCount}, browserHash=${depsInspection.browserHash ?? "n/a"})`,
  );
} else if (
  depsInspection.reason === "broken_chunk_import" ||
  depsInspection.reason === "optimized_entry_missing"
) {
  console.error(
    `[electron-dev] Vite optimize-deps still broken after startup (${depsInspection.reason}). ` +
      `brokenImports=${depsInspection.brokenImports.length} optimizedMissing=${depsInspection.optimizedMissing.length}`,
  );
  process.exit(1);
} else {
  // deps_dir_missing / optimized_empty / metadata_missing: first Electron paint
  // will finish discovery. Do not block launch — that was over-strict and aborted
  // healthy cold starts mid-optimize.
  console.warn(
    `[electron-dev] Vite optimize-deps still warming (${depsInspection.reason ?? "unknown"}); launching Electron anyway.`,
  );
}

const extraLaunchArgs = [
  process.env.ELECTRON_EXTRA_LAUNCH_ARGS?.trim() ?? "",
  // Prevent Chromium from reusing deleted Vite chunk modules across restarts.
  "--disable-http-cache",
]
  .filter(Boolean)
  .join(" ");

electronChild = run(pnpmCmd, ["exec", "electron", "./electron/main.mjs"], {
  cwd: desktopRoot,
  env: {
    ...process.env,
    ONMYAGENT_DEV_MODE: process.env.ONMYAGENT_DEV_MODE ?? "1",
    ONMYAGENT_DATA_DIR: process.env.ONMYAGENT_DATA_DIR ?? defaultDevDataDir,
    ONMYAGENT_ELECTRON_START_URL: resolvedStartUrl,
    ELECTRON_EXTRA_LAUNCH_ARGS: extraLaunchArgs,
  },
});

electronChild.on("exit", (code) => {
  if (stopping) return;
  void stopAll(code ?? 0);
});
