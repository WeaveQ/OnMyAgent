import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  unwatchFile,
  watchFile,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const COMPUTER_USE_HELPER_APP_NAME = "OnMyAgent Computer Use.app";
const COMPUTER_USE_HELPER_EXECUTABLE = "ComputerUse";

/** Appshot native helper is macOS-only (Swift HandsFree). */
export function isComputerUseAppshotSupported(
  platform = process.platform,
) {
  return platform === "darwin";
}

/**
 * Normalize native Appshot filenames across platforms.
 * - macOS: strips Swift JoinedSequence / ArraySlice debug dumps
 * - Windows: strips reserved names and illegal path characters
 * - Linux: same safe basename rules
 */
export function sanitizeAppshotFileName(
  rawName,
  { platform = process.platform, now = Date.now() } = {},
) {
  const raw = typeof rawName === "string" ? rawName.trim() : "";
  const looksLikeSwiftDump =
    /JoinedSequence|ArraySlice|ContiguousArray|_base|_separator|Array</i.test(
      raw,
    );
  const base = path.basename(raw.replace(/\\/g, "/"));
  let candidate = base || raw;

  // Windows-illegal characters + control chars
  candidate = candidate.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-");
  candidate = candidate.replace(/\.+$/g, ""); // trailing dots invalid on Windows
  candidate = candidate.replace(/\s+/g, " ").trim();

  const reserved =
    platform === "win32" &&
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(candidate);

  const extMatch = candidate.match(/\.(jpe?g|png|webp)$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : ".jpg";
  const stem = extMatch
    ? candidate.slice(0, -extMatch[0].length)
    : candidate;

  const safeStem =
    stem &&
    stem.length <= 80 &&
    !looksLikeSwiftDump &&
    !reserved &&
    !/JoinedSequence|ArraySlice/i.test(stem)
      ? stem
      : null;

  if (safeStem && /^Appshot[-_\w. ()]+$/i.test(safeStem)) {
    return `${safeStem}${ext === ".jpeg" ? ".jpg" : ext}`;
  }

  const stamp = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  const stampText = [
    stamp.getFullYear(),
    pad(stamp.getMonth() + 1),
    pad(stamp.getDate()),
    "-",
    pad(stamp.getHours()),
    pad(stamp.getMinutes()),
    pad(stamp.getSeconds()),
  ].join("");
  return `Appshot-${stampText}.jpg`;
}

export function parseComputerUseStatus(stdout) {
  try {
    const parsed = JSON.parse(String(stdout ?? "").trim());
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.ok !== "boolean" ||
      typeof parsed.accessibility !== "boolean" ||
      typeof parsed.screenRecording !== "boolean"
    ) {
      return null;
    }
    return {
      ok: parsed.ok,
      accessibility: parsed.accessibility,
      screenRecording: parsed.screenRecording,
      ...(typeof parsed.helperVersion === "string"
        ? { helperVersion: parsed.helperVersion }
        : {}),
      ...(Number.isInteger(parsed.protocolVersion)
        ? { protocolVersion: parsed.protocolVersion }
        : {}),
      ...(typeof parsed.activity === "object" && parsed.activity !== null
        ? { activity: parsed.activity }
        : {}),
      ...(typeof parsed.skysight === "object" && parsed.skysight !== null
        ? { skysight: parsed.skysight }
        : {}),
      ...(typeof parsed.appAuthorizations === "object" &&
      parsed.appAuthorizations !== null &&
      Array.isArray(parsed.appAuthorizations.allowedBundleIdentifiers) &&
      parsed.appAuthorizations.allowedBundleIdentifiers.every(
        (identifier) => typeof identifier === "string",
      )
        ? { appAuthorizations: parsed.appAuthorizations }
        : {}),
    };
  } catch {
    return null;
  }
}

export function parseComputerUseActivity(value) {
  if (typeof value !== "object" || value === null) return null;
  if (
    value.phase !== "inactive" &&
    value.phase !== "ready" &&
    value.phase !== "running" &&
    value.phase !== "paused" &&
    value.phase !== "errored"
  ) {
    return null;
  }
  return {
    phase: value.phase,
    ...(typeof value.app === "string" ? { app: value.app } : {}),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
  };
}

export function createComputerUseDesktopHelpers(input) {
  const { app, shell, dialog, systemPreferences, dirname } = input;
  const spawnProcess = input.spawnProcess ?? spawn;
  const readFile = input.readFile ?? readFileSync;
  const resolveComputerUseExecutableOverride = input.resolveComputerUseExecutable;
  let skysightRecorder = null;
  let appshotMonitor = null;
  let watchedActivityFile = null;
  let watchedAppshotFile = null;

function computerUseHelperExecutablePath() {
  const appPath = computerUseHelperAppPath();
  const explicitBinary = process.env.ONMYAGENT_COMPUTER_USE_BINARY?.trim();
  const candidates = [
    explicitBinary,
    appPath
      ? path.join(appPath, "Contents", "MacOS", COMPUTER_USE_HELPER_EXECUTABLE)
      : null,
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function computerUseHelperAppPath() {
  const explicitApp = process.env.ONMYAGENT_COMPUTER_USE_APP?.trim();
  const candidates = [
    explicitApp,
    process.resourcesPath
      ? path.join(
          process.resourcesPath,
          "helpers",
          COMPUTER_USE_HELPER_APP_NAME,
        )
      : null,
    path.resolve(
      dirname,
      "..",
      "resources",
      "helpers",
      COMPUTER_USE_HELPER_APP_NAME,
    ),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function getComputerUseMcpCommand() {
  const helperExecutable = computerUseHelperExecutablePath();
  if (helperExecutable) return [helperExecutable, "mcp"];

  if (app.isPackaged) {
    throw new Error(
      "OnMyAgent Computer Use is missing from this OnMyAgent build.",
    );
  }

  if (process.env.ONMYAGENT_DEV_MODE === "1") {
    return [
      "node",
      path.resolve(
        dirname,
        "../../..",
        "packages/handsfree/bin/onmyagent-handsfree-computer-use.mjs",
      ),
      "mcp",
    ];
  }
  return ["npx", "-y", "@onmyagent/handsfree", "mcp"];
}

// ---------------------------------------------------------------------------
// Permission checks — spawn the binary with --check, read stdout, done.
// Fresh process = fresh TCC read = always accurate. No HTTP server needed.
// ---------------------------------------------------------------------------

function resolveComputerUseExecutable() {
  if (typeof resolveComputerUseExecutableOverride === "function") {
    return resolveComputerUseExecutableOverride();
  }
  // 1. Explicit env override.
  const explicit = process.env.ONMYAGENT_COMPUTER_USE_BINARY?.trim();
  if (explicit && existsSync(explicit)) return explicit;

  // 2. .app bundle (packaged builds + pnpm dev).
  const appPath = computerUseHelperAppPath();
  if (appPath) {
    const bin = path.join(
      appPath,
      "Contents",
      "MacOS",
      COMPUTER_USE_HELPER_EXECUTABLE,
    );
    if (existsSync(bin)) return bin;
  }

  // 3. Dev fallback — raw Swift build output.
  if (!app.isPackaged) {
    const swiftPkg = path.resolve(
      dirname,
      "../../..",
      "packages/handsfree/native/HandsFree",
    );
    const devCandidates = [
      path.join(swiftPkg, ".build", "release", "HandsFreeComputerUse"),
      path.join(
        swiftPkg,
        ".build",
        "arm64-apple-macosx",
        "release",
        "HandsFreeComputerUse",
      ),
      path.join(swiftPkg, ".build", "debug", "HandsFreeComputerUse"),
      path.join(
        swiftPkg,
        ".build",
        "arm64-apple-macosx",
        "debug",
        "HandsFreeComputerUse",
      ),
    ];
    for (const c of devCandidates) {
      if (existsSync(c)) return c;
    }
  }

  return null;
}

async function checkComputerUsePermissions() {
  // Spawn binary --check → read JSON from stdout → exit. Always fresh.
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    return {
      ok: false,
      accessibility: false,
      screenRecording: false,
      error: "Helper binary not found. Run pnpm dev to build it.",
    };
  }
  const status = await spawnCheckPermissions(bin);
  if (status.accessibility === true && status.screenRecording === true) {
    startAppshotMonitor(bin);
  }
  return {
    ...status,
    desktopVersion: app.getVersion(),
    ...(status.skysight
      ? {
          skysight: {
            ...status.skysight,
            recording:
              status.skysight.recording === true || isSkysightRecorderRunning(),
          },
        }
      : {}),
  };
}

function isSkysightRecorderRunning() {
  return skysightRecorder !== null && skysightRecorder.exitCode === null;
}

function startSkysightRecorder(bin) {
  if (isSkysightRecorderRunning()) return;
  const child = spawnProcess(bin, ["skysight", "record"], {
    stdio: "ignore",
  });
  skysightRecorder = child;
  child.on("error", (error) => {
    console.warn("[ComputerUse] Skysight recorder failed:", error.message);
  });
  child.on("exit", () => {
    if (skysightRecorder === child) skysightRecorder = null;
  });
}

function stopSkysightRecorder() {
  if (!isSkysightRecorderRunning()) {
    skysightRecorder = null;
    return;
  }
  skysightRecorder.kill("SIGTERM");
  skysightRecorder = null;
}

function runComputerUseCommand(bin, args) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const child = spawnProcess(bin, args, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 5_000,
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Computer Use helper exited with code ${code}.`));
    });
  });
}

function runComputerUseJSONCommand(bin, args) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawnProcess(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Computer Use helper exited with code ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error("Computer Use helper returned invalid JSON."));
      }
    });
  });
}

function appshotAttachmentPayload(result) {
  if (
    typeof result !== "object" || result === null || result.ok !== true ||
    typeof result.path !== "string" || typeof result.name !== "string" ||
    typeof result.mimeType !== "string"
  ) {
    throw new Error("Computer Use returned an invalid Appshot result.");
  }
  return {
    // Sanitize on every platform so a bad native name never reaches the UI.
    name: sanitizeAppshotFileName(result.name),
    mimeType: result.mimeType,
    data: readFile(result.path).toString("base64"),
    ...(typeof result.appName === "string" ? { appName: result.appName } : {}),
  };
}

function appshotUnsupportedError() {
  const platform = process.platform;
  if (platform === "win32") {
    return new Error(
      "Appshot is only available on macOS. Windows support is not available yet.",
    );
  }
  if (platform === "linux") {
    return new Error(
      "Appshot is only available on macOS. Linux support is not available yet.",
    );
  }
  return new Error("Appshot is not available on this platform.");
}

async function captureComputerUseAppshot() {
  // Native Appshot helper is Swift / Accessibility / Screen Recording — macOS only.
  if (!isComputerUseAppshotSupported()) {
    throw appshotUnsupportedError();
  }
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  }
  return appshotAttachmentPayload(
    await runComputerUseJSONCommand(bin, ["appshot", "capture"]),
  );
}

function startAppshotMonitor(bin) {
  if (!isComputerUseAppshotSupported()) return;
  if (appshotMonitor !== null && appshotMonitor.exitCode === null) return;
  const child = spawnProcess(bin, ["appshot", "monitor"], { stdio: "ignore" });
  appshotMonitor = child;
  child.on("error", (error) => {
    console.warn("[ComputerUse] Appshot monitor failed:", error.message);
  });
  child.on("exit", () => {
    if (appshotMonitor === child) appshotMonitor = null;
  });
}

function stopAppshotMonitor() {
  if (appshotMonitor !== null && appshotMonitor.exitCode === null) {
    appshotMonitor.kill("SIGTERM");
  }
  appshotMonitor = null;
}

async function setComputerUseSkysightEnabled(enabled) {
  if (typeof enabled !== "boolean") {
    throw new Error("Skysight enabled state must be a boolean.");
  }
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  }
  await runComputerUseCommand(bin, ["skysight", enabled ? "enable" : "disable"]);
  if (enabled) startSkysightRecorder(bin);
  else stopSkysightRecorder();
  return checkComputerUsePermissions();
}

async function setComputerUseSkysightPaused(paused) {
  if (typeof paused !== "boolean") {
    throw new Error("Skysight paused state must be a boolean.");
  }
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  }
  await runComputerUseCommand(bin, ["skysight", paused ? "pause" : "resume"]);
  return checkComputerUsePermissions();
}

async function updateComputerUseSkysightExclusion(operation, scope, value) {
  if (operation !== "add" && operation !== "remove") {
    throw new Error("Skysight exclusion operation must be add or remove.");
  }
  if (scope !== "app" && scope !== "website" && scope !== "private_browsing") {
    throw new Error("Skysight exclusion scope is invalid.");
  }
  const normalizedValue = typeof value === "string" ? value.trim() : "";
  if (scope !== "private_browsing" && !normalizedValue) {
    throw new Error("Skysight app and website exclusions require a value.");
  }
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  }
  const command = ["skysight", "exclude", operation, scope];
  if (normalizedValue) command.push(normalizedValue);
  await runComputerUseCommand(bin, command);
  return checkComputerUsePermissions();
}

async function clearComputerUseSkysightData() {
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  }
  await runComputerUseCommand(bin, ["skysight", "clear"]);
  return { ok: true };
}

async function revokeComputerUseAppAuthorization(bundleIdentifier) {
  if (typeof bundleIdentifier !== "string" || !bundleIdentifier.trim()) {
    throw new Error("A Computer Use bundle identifier is required.");
  }
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  }
  await runComputerUseCommand(bin, [
    "authorization",
    "revoke",
    bundleIdentifier.trim(),
  ]);
  return checkComputerUsePermissions();
}

async function clearComputerUseAppAuthorizations() {
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  }
  await runComputerUseCommand(bin, ["authorization", "clear"]);
  return checkComputerUsePermissions();
}

async function restoreComputerUseServices() {
  const bin = resolveComputerUseExecutable();
  if (!bin) return;
  const status = await spawnCheckPermissions(bin);
  if (status.skysight?.enabled === true) startSkysightRecorder(bin);
  if (status.accessibility === true && status.screenRecording === true) {
    startAppshotMonitor(bin);
  }
}

function disposeComputerUseServices() {
  stopSkysightRecorder();
  stopAppshotMonitor();
  if (watchedActivityFile) {
    unwatchFile(watchedActivityFile);
    watchedActivityFile = null;
  }
  if (watchedAppshotFile) {
    unwatchFile(watchedAppshotFile);
    watchedAppshotFile = null;
  }
}

function watchComputerUseAppshots(onAppshot) {
  if (!isComputerUseAppshotSupported()) {
    return () => {};
  }
  if (watchedAppshotFile) unwatchFile(watchedAppshotFile);
  const eventFile = path.join(
    os.homedir(),
    "Library", "Application Support", "OnMyAgent", "ComputerUse",
    "Appshots", "latest-event.json",
  );
  watchedAppshotFile = eventFile;
  watchFile(eventFile, { interval: 250 }, (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs || !existsSync(eventFile)) return;
    try {
      onAppshot(appshotAttachmentPayload(JSON.parse(readFile(eventFile, "utf8"))));
    } catch (error) {
      console.warn("[ComputerUse] Failed to deliver Appshot:", error.message);
    }
  });
  return () => {
    if (watchedAppshotFile === eventFile) watchedAppshotFile = null;
    unwatchFile(eventFile);
  };
}

function watchComputerUseActivity(onActivity) {
  if (watchedActivityFile) unwatchFile(watchedActivityFile);
  const activityFile = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "OnMyAgent",
    "ComputerUse",
    "activity.json",
  );
  watchedActivityFile = activityFile;
  watchFile(activityFile, { interval: 250 }, (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs || !existsSync(activityFile)) return;
    try {
      const activity = parseComputerUseActivity(
        JSON.parse(readFileSync(activityFile, "utf8")),
      );
      if (activity) onActivity(activity);
    } catch {
      // A writer may still be replacing the atomic state file; the next
      // modification delivers the complete snapshot.
    }
  });
  return () => {
    if (watchedActivityFile === activityFile) watchedActivityFile = null;
    unwatchFile(activityFile);
  };
}

// ─── System permissions (macOS only) ─────────────────────────────────────────
function checkSystemPermissions() {
  console.log("[checkSystemPermissions] Function called, platform:", process.platform);
  const platform = process.platform;

  if (platform !== "darwin") {
    return {
      platform: platform === "win32" ? "windows" : platform === "linux" ? "linux" : "unknown",
      permissions: {
        "full-disk-access": "granted",
        accessibility: "granted",
        automation: "granted",
        notifications: "granted",
      },
    };
  }

  const permissions = {
    "full-disk-access": "unknown",
    accessibility: "unknown",
    automation: "unknown",
    notifications: "unknown",
  };

  // Accessibility: systemPreferences.isTrustedAccessibilityClient(false)
  // - Pass false so we only READ status (NOT trigger the consent prompt).
  try {
    console.log("[checkSystemPermissions] Checking accessibility...");
    const isAccessible = systemPreferences.isTrustedAccessibilityClient(false);
    console.log("[checkSystemPermissions] Accessibility result:", isAccessible);
    permissions.accessibility = isAccessible === true ? "granted" : "denied";
  } catch (err) {
    console.error("[checkSystemPermissions] Accessibility check failed:", err);
    permissions.accessibility = "unknown";
  }

  // Full Disk Access: probe a TCC-protected directory via readdirSync.
  //
  // IMPORTANT: existsSync/stat/accessSync do NOT trigger macOS TCC checks.
  // Only fs operations that call open() (readdirSync, readFileSync, etc.)
  // trigger the Full Disk Access TCC check. So we MUST attempt to read the
  // contents of a protected directory to detect whether FDA is granted.
  try {
    console.log("[checkSystemPermissions] Checking Full Disk Access...");
    const protectedDirs = [
      path.join(os.homedir(), "Library", "Mail"),
      path.join(os.homedir(), "Library", "Messages"),
      path.join(os.homedir(), "Library", "Safari"),
    ];

    let fdaStatus = "denied"; // default: not granted

    for (const dir of protectedDirs) {
      console.log(`[FDA] Trying: ${dir}`);
      try {
        // readdirSync calls open() which triggers TCC check
        const entries = readdirSync(dir);
        console.log(`[FDA] ✓ Can read ${dir} (${entries.length} entries)`);
        fdaStatus = "granted";
        break;
      } catch (err) {
        if (err.code === "ENOENT" || err.code === "ENOTDIR") {
          // Directory doesn't exist (e.g. user never opened Mail) — try next
          console.log(`[FDA] Path not found: ${dir} (${err.code})`);
          continue;
        }
        // EACCES / EPERM / any other error → FDA not granted
        console.log(`[FDA] Access denied for ${dir}: ${err.code}`);
        fdaStatus = "denied";
        break;
      }
    }

    console.log(`[FDA] Final status: ${fdaStatus}`);
    permissions["full-disk-access"] = fdaStatus;
  } catch (err) {
    console.error("[checkSystemPermissions] FDA check failed:", err);
    permissions["full-disk-access"] = "unknown";
  }

  // Automation: macOS does NOT expose an API for an app to query its own
  // Automation permission status. The naive approach of calling osascript
  // (`OSAScript`) to probe "System Events" was previously used, but it
  // executed AS the osascript binary — which is a first-party Apple tool
  // and therefore already has full Automation access for every target.
  // That made the check ALWAYS report "granted", even when OnMyAgent had
  // no Automation permissions and never even appeared in the System
  // Settings → Automation list. Mark as unknown and let the user verify
  // manually via the "Go to settings" button.
  permissions.automation = "unknown";

  // Notifications: macOS Notification permission status cannot be queried
  // reliably from the Electron main process (only the renderer has
  // `Notification.permission`). Mark as unknown and let the UI show a
  // "Go to settings" button that opens System Settings > Notifications.
  permissions.notifications = "unknown";

  return {
    platform: "macos",
    permissions,
  };
}

/**
 * macOS Privacy → Automation only lists processes that have already attempted
 * to send Apple Events to another app. Opening the Settings pane alone never
 * adds OnMyAgent. Probe Calendar / Reminders / Notes (not System Events —
 * osascript is a first-party tool already allowed to talk to System Events,
 * which made earlier "status" checks always look granted).
 *
 * On modern macOS the responsible parent (Electron / OnMyAgent) is usually
 * what appears in the Automation list when a child osascript is spawned.
 */
function triggerAutomationPermissionPrompt() {
  if (process.platform !== "darwin") return;
  // Targets match settings.permission_automation_desc copy.
  const probes = [
    'tell application "Calendar" to get name',
    'tell application "Reminders" to get name',
    'tell application "Notes" to get name',
  ];
  for (const source of probes) {
    try {
      const result = spawnSync(
        "osascript",
        ["-e", source],
        {
          encoding: "utf8",
          timeout: 12_000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      // -1743 / "not allowed" still registers the parent in Automation.
      if (result.error) {
        console.warn(
          `[Automation] probe failed (${source}):`,
          result.error.message,
        );
        continue;
      }
      const stderr = (result.stderr || "").trim();
      if (stderr) {
        console.log(`[Automation] probe response: ${stderr.slice(0, 200)}`);
      } else {
        console.log(`[Automation] probe ok: ${source}`);
      }
      // One successful registration attempt is enough to open Settings.
      break;
    } catch (error) {
      console.warn(
        `[Automation] probe threw:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function openSystemPermissionSettings(type) {
  if (process.platform !== "darwin") {
    return { success: true };
  }

  // For Full Disk Access, trigger a request first so the app appears in the list
  if (type === "full-disk-access") {
    try {
      // Attempt to read a protected directory to trigger macOS FDA dialog
      const protectedPaths = [
        path.join(os.homedir(), "Library", "Mail"),
        path.join(os.homedir(), "Library", "Messages"),
        path.join(os.homedir(), "Library", "Safari"),
      ];

      for (const protectedPath of protectedPaths) {
        if (existsSync(protectedPath)) {
          // Try to read the directory (will fail but triggers FDA request)
          try {
            readdirSync(protectedPath);
          } catch (e) {
            // Expected to fail - this triggers the FDA dialog
            console.log(`[FDA] Triggered request by accessing: ${protectedPath}`);
            break;
          }
        }
      }
    } catch (e) {
      console.warn(`[FDA] Failed to trigger request:`, e.message);
    }
  }

  // Accessibility: prompt via system API (false = read-only elsewhere).
  if (type === "accessibility") {
    try {
      systemPreferences.isTrustedAccessibilityClient(true);
    } catch (e) {
      console.warn(`[Accessibility] prompt failed:`, e.message);
    }
  }

  // Automation: must attempt Apple Events before Privacy_Automation shows us.
  if (type === "automation") {
    triggerAutomationPermissionPrompt();
  }

  const appName = app.getName();
  const isDevMode = process.defaultApp || app.isPackaged === false;
  const listName = isDevMode ? "Electron" : appName;

  const urlMap = {
    "full-disk-access": "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    automation: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
    notifications: "x-apple.systempreferences:com.apple.preference.notifications",
  };

  const url = urlMap[type];
  if (!url) {
    return { success: false, error: `Unknown permission type: ${type}` };
  }

  try {
    shell.openExternal(url);
    const listHint = isDevMode
      ? `开发模式提示：系统设置中请找 “Electron”，而不是 “${appName}”。若列表仍没有，请先点系统弹窗里的“好/允许”，再返回本页刷新；也可点左下角锁后用“+”手动添加 Electron。`
      : `若列表中没有 “${listName}”，请先处理系统弹出的授权对话框（允许控制日历/提醒/备忘录），再返回本页点刷新。仍没有时可解锁后用“+”手动添加 ${listName}。`;

    const hint =
      type === "full-disk-access" || type === "automation"
        ? listHint
        : type === "accessibility"
          ? listHint
          : null;

    return {
      success: true,
      hint,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function spawnCheckPermissions(bin) {
  return new Promise((resolve) => {
    let stdout = "";
    const child = spawnProcess(bin, ["--status"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () =>
      resolve({
        ok: false,
        accessibility: false,
        screenRecording: false,
        error: "Failed to run permission check.",
      }),
    );
    child.on("close", () => {
      const parsed = parseComputerUseStatus(stdout);
      if (parsed) {
        resolve(parsed);
      } else {
        resolve({
          ok: false,
          accessibility: false,
          screenRecording: false,
          error: "Permission check returned invalid output.",
        });
      }
    });
  });
}

async function openComputerUseSetupApp() {
  // Open the GUI. Use the .app bundle if available so macOS shows it as
  // a real app with its own dock icon and permission identity.
  const appPath = computerUseHelperAppPath();
  if (appPath) {
    const result = await shell.openPath(appPath);
    if (result) console.error("[ComputerUse] shell.openPath error:", result);
    return;
  }

  // Fallback: spawn the raw binary (opens the same GUI).
  const bin = resolveComputerUseExecutable();
  if (!bin)
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  const child = spawnProcess(bin, [], { detached: true, stdio: "ignore" });
  child.unref();
}


  return {
    getComputerUseMcpCommand,
    checkComputerUsePermissions,
    setComputerUseSkysightEnabled,
    setComputerUseSkysightPaused,
    updateComputerUseSkysightExclusion,
    clearComputerUseSkysightData,
    captureComputerUseAppshot,
    isComputerUseAppshotSupported,
    sanitizeAppshotFileName,
    revokeComputerUseAppAuthorization,
    clearComputerUseAppAuthorizations,
    restoreComputerUseServices,
    disposeComputerUseServices,
    watchComputerUseActivity,
    watchComputerUseAppshots,
    checkSystemPermissions,
    openSystemPermissionSettings,
    openComputerUseSetupApp,
  };
}
