const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const computerUseHelperAppName = "OnMyAgent Computer Use.app";

// Real packaged sidecars only. onmyagent-server runs in-process; chrome-devtools-mcp
// is not shipped as a sidecar binary in current builds.
const sidecarBases = [
  "opencode",
  "onmyagent-orchestrator",
];

function targetTriple(platformName, arch) {
  if (platformName === "darwin") {
    if (arch === "arm64") return "aarch64-apple-darwin";
    if (arch === "x64") return "x86_64-apple-darwin";
  }
  if (platformName === "linux") {
    if (arch === "arm64") return "aarch64-unknown-linux-gnu";
    if (arch === "x64") return "x86_64-unknown-linux-gnu";
  }
  if (platformName === "win32") {
    if (arch === "arm64") return "aarch64-pc-windows-msvc";
    if (arch === "x64") return "x86_64-pc-windows-msvc";
  }
  return null;
}

function resolveSidecarsDir(context) {
  if (context.electronPlatformName === "darwin") {
    const entries = fs.existsSync(context.appOutDir) ? fs.readdirSync(context.appOutDir) : [];
    const appName = entries.find((entry) => entry.endsWith(".app"));
    return appName ? path.join(context.appOutDir, appName, "Contents", "Resources", "sidecars") : null;
  }
  return path.join(context.appOutDir, "resources", "sidecars");
}

function resolveRuntimesDir(context) {
  if (context.electronPlatformName === "darwin") {
    const appPath = resolveMacAppPath(context);
    return appPath
      ? path.join(appPath, "Contents", "Resources", "runtimes")
      : null;
  }
  return path.join(context.appOutDir, "resources", "runtimes");
}

function resolveMacAppPath(context) {
  if (context.electronPlatformName !== "darwin") return null;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const direct = path.join(context.appOutDir, appName);
  if (fs.existsSync(direct)) return direct;

  const entries = fs.existsSync(context.appOutDir) ? fs.readdirSync(context.appOutDir) : [];
  const fallback = entries.find((entry) => entry.endsWith(".app"));
  return fallback ? path.join(context.appOutDir, fallback) : null;
}

function signComputerUseHelper(context) {
  const appPath = resolveMacAppPath(context);
  if (!appPath) return;

  const helperPath = path.join(appPath, "Contents", "Resources", "helpers", computerUseHelperAppName);
  if (!fs.existsSync(helperPath)) {
    throw new Error(`Missing Computer Use helper app at ${helperPath}`);
  }

  const identity = process.env.ONMYAGENT_COMPUTER_USE_CODESIGN_IDENTITY
    || process.env.CSC_NAME
    || process.env.APPLE_CODESIGN_IDENTITY
    || "-";
  const args = ["--force", "--deep", "--options", "runtime", "--sign", identity];
  if (identity !== "-") args.push("--timestamp");
  args.push(helperPath);

  const result = spawnSync("codesign", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`codesign failed for Computer Use helper app with status ${result.status}`);
  }
}

function findRcedit() {
  const cacheRoot = path.join(
    process.env.LOCALAPPDATA || "",
    "electron-builder",
    "Cache",
    "winCodeSign",
  );
  if (!cacheRoot || !fs.existsSync(cacheRoot)) return null;
  const preferred = process.arch === "ia32" ? "rcedit-ia32.exe" : "rcedit-x64.exe";
  const stack = [cacheRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === preferred) return full;
    }
  }
  return null;
}

/**
 * Stamp OnMyAgent icon + version metadata onto the Windows exe.
 * Safety net when electron-builder's rcedit step is skipped or fails.
 */
function brandWindowsExecutable(context) {
  if (context.electronPlatformName !== "win32") return;

  const productFilename = context.packager?.appInfo?.productFilename || "OnMyAgent";
  const version = context.packager?.appInfo?.version || "0.0.0";
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  if (!fs.existsSync(exePath)) {
    console.warn(`[afterPack] Windows exe not found for branding: ${exePath}`);
    return;
  }

  const projectDir = context.packager?.projectDir || path.resolve(__dirname, "..");
  const iconPath = path.join(projectDir, "resources", "icons", "icon.ico");
  if (!fs.existsSync(iconPath)) {
    console.warn(`[afterPack] Windows icon missing: ${iconPath}`);
    return;
  }

  const rcedit = findRcedit();
  if (!rcedit) {
    console.warn("[afterPack] rcedit not found in electron-builder cache; exe icon may stay Electron default");
    return;
  }

  const args = [
    exePath,
    "--set-icon",
    iconPath,
    "--set-version-string",
    "ProductName",
    "OnMyAgent",
    "--set-version-string",
    "FileDescription",
    "OnMyAgent — local control plane for your AI agents",
    "--set-version-string",
    "CompanyName",
    "OnMyAgent Contributors",
    "--set-version-string",
    "LegalCopyright",
    "Copyright OnMyAgent Contributors",
    "--set-version-string",
    "OriginalFilename",
    `${productFilename}.exe`,
    "--set-version-string",
    "InternalName",
    productFilename,
    "--set-file-version",
    version,
    "--set-product-version",
    version,
  ];

  const result = spawnSync(rcedit, args, { stdio: "inherit", windowsHide: true });
  if (result.error) {
    console.warn(`[afterPack] rcedit failed: ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    console.warn(`[afterPack] rcedit exited with status ${result.status}`);
    return;
  }
  console.log(`[afterPack] Branded Windows executable: ${exePath}`);
}

function copyExecutableTargetToAlias(sidecarsDir, targetName, aliasName) {
  const targetPath = path.join(sidecarsDir, targetName);
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing packaged sidecar for target: ${targetName}`);
  }

  const aliasPath = path.join(sidecarsDir, aliasName);
  fs.copyFileSync(targetPath, aliasPath);
  try {
    fs.chmodSync(aliasPath, 0o755);
  } catch {
    // Windows and some filesystems may ignore chmod.
  }
}

async function afterPack(context) {
  const triple = targetTriple(context.electronPlatformName, context.arch);
  if (!triple) return;

  const sidecarsDir = resolveSidecarsDir(context);
  if (!sidecarsDir || !fs.existsSync(sidecarsDir)) return;

  const isWindows = context.electronPlatformName === "win32";
  const executableSuffix = isWindows ? ".exe" : "";
  const keep = new Set();

  for (const base of sidecarBases) {
    const aliasName = `${base}${executableSuffix}`;
    const targetName = `${base}-${triple}${executableSuffix}`;
    copyExecutableTargetToAlias(sidecarsDir, targetName, aliasName);
    keep.add(aliasName);
    keep.add(targetName);
  }

  const versionsAlias = "versions.json";
  const versionsTarget = `versions.json-${triple}${executableSuffix}`;
  const versionsTargetPath = path.join(sidecarsDir, versionsTarget);
  if (!fs.existsSync(versionsTargetPath)) {
    throw new Error(`Missing packaged sidecar metadata for target: ${versionsTarget}`);
  }
  fs.copyFileSync(versionsTargetPath, path.join(sidecarsDir, versionsAlias));
  keep.add(versionsAlias);
  keep.add(versionsTarget);

  for (const entry of fs.readdirSync(sidecarsDir)) {
    if (!keep.has(entry)) {
      fs.rmSync(path.join(sidecarsDir, entry), { force: true, recursive: true });
    }
  }

  const runtimesDir = resolveRuntimesDir(context);
  const targetRuntimeDir = runtimesDir
    ? path.join(runtimesDir, triple)
    : null;
  if (!targetRuntimeDir || !fs.existsSync(targetRuntimeDir)) {
    throw new Error(`Missing packaged runtimes for target: ${triple}`);
  }
  for (const entry of fs.readdirSync(runtimesDir)) {
    if (entry !== triple) {
      fs.rmSync(path.join(runtimesDir, entry), {
        force: true,
        recursive: true,
      });
    }
  }

  signComputerUseHelper(context);
  brandWindowsExecutable(context);
}

module.exports = afterPack;
module.exports.default = afterPack;
