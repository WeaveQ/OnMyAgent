import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const COMPUTER_USE_HELPER_APP_NAME = "OnMyAgent Computer Use.app";
const COMPUTER_USE_HELPER_EXECUTABLE = "ComputerUse";

export function createComputerUseDesktopHelpers(input) {
  const { app, shell, dialog, systemPreferences, dirname } = input;

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
  return spawnCheckPermissions(bin);
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

  const appName = app.getName();
  const isDevMode = process.defaultApp || app.isPackaged === false;

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
    const fdaHint = isDevMode
      ? `开发模式提示：系统设置中应该找 "Electron"，而不是 "${appName}"。如果没有自动出现在列表中，请点击左下角的锁图标解锁，然后点击"+"按钮手动添加 Electron。`
      : `如果应用没有自动出现在列表中，请点击左下角的锁图标解锁，然后点击"+"按钮手动添加 ${appName}`;

    return {
      success: true,
      hint: type === "full-disk-access" ? fdaHint : null
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function spawnCheckPermissions(bin) {
  return new Promise((resolve) => {
    let stdout = "";
    const child = spawn(bin, ["--check"], {
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
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve({
          ok: parsed?.ok === true,
          accessibility: parsed?.accessibility === true,
          screenRecording: parsed?.screenRecording === true,
        });
      } catch {
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
  const child = spawn(bin, [], { detached: true, stdio: "ignore" });
  child.unref();
}


  return {
    getComputerUseMcpCommand,
    checkComputerUsePermissions,
    checkSystemPermissions,
    openSystemPermissionSettings,
    openComputerUseSetupApp,
  };
}
