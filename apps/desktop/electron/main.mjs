import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  WebContentsView,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
  shell,
  systemPreferences,
} from "electron";
import { registerMigrationIpc } from "./migration.mjs";
import { createDesktopPersonalRuntimeServices, createRuntimeManager } from "./runtime.mjs";
import { cleanupRegisteredAgentProcesses } from "./personal-agent-runtime/process-registry.mjs";
import { channelEventBus, CHANNEL_EVENTS } from "./channels/index.mjs";
import { registerUpdaterIpc } from "./updater.mjs";
import {
  exportWorkspaceConfig,
  importWorkspaceConfig,
} from "./workspace-archive.mjs";
import {
  onmyagentWorkspaceDisplayName,
  selectOnMyAgentWorkspaceForConnection,
} from "./remote-workspace.mjs";
import {
  PERSONAL_LOCAL_AGENT_CAPABILITIES,
  isPersonalLocalAgentProvider,
} from "./personal-agent-runtime/provider-registry.mjs";
import { resolveArchitectureInfo as resolveDesktopArchitectureInfo } from "./architecture-info.mjs";
import { createApplicationMenuController } from "./application-menu.mjs";
import { createComputerUseDesktopHelpers } from "./computer-use-desktop.mjs";
import { configureDesktopStartupFlags } from "./startup-flags.mjs";
import { probeAccessibleRoot } from "./channel-runtime.mjs";
import { createCodeTerminalManager } from "./code-terminal-manager.mjs";
import {
  listCodeWorkspaceFiles,
  readCodeWorkspaceFile,
} from "./code-workspace-files.mjs";
import {
  agentManagementMcpSnapshot,
  deleteMcpServerAction,
  importMcpFromApps,
  toggleMcpServerApp,
  upsertMcpServer,
} from "./agent-management-mcp.mjs";
import { createAgentManagementProviders } from "./agent-management-providers.mjs";
import { createAgentManagementSkills } from "./agent-management-skills.mjs";
import { createExpertMarketplace } from "./expert-marketplace.mjs";
import {
  createCodeWorkspaceActions,
  parseEditorTarget,
  resolveEditorCommand,
} from "./code-workspace-actions.mjs";
import { createElectronBrowserController } from "./browser-runtime/electron-browser-controller.mjs";
import { createUiControlServer } from "./ui-control-server.mjs";
import { createDesktopCommandRouter } from "./desktop-command-router.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NATIVE_DEEP_LINK_EVENT = "onmyagent:deep-link-native";
const NATIVE_MENU_OPEN_SETTINGS_EVENT = "onmyagent:native-menu:open-settings";
const NATIVE_MENU_TOGGLE_SIDEBAR_EVENT = "onmyagent:native-menu:toggle-sidebar";
const COMPUTER_USE_ACTIVITY_EVENT = "onmyagent:computer-use:activity";
const COMPUTER_USE_APPSHOT_EVENT = "onmyagent:computer-use:appshot";
const TAURI_APP_IDENTIFIER = "com.differentai.onmyagent";
const DEV_APP_IDENTIFIER = "com.differentai.onmyagent.dev";
const DESKTOP_PROTOCOL_SCHEME = "onmyagent";
const isDevMode = process.env.ONMYAGENT_DEV_MODE === "1";
const APP_NAME = isDevMode ? "OnMyAgent - Dev" : "OnMyAgent";
const APP_IDENTIFIER = isDevMode ? DEV_APP_IDENTIFIER : TAURI_APP_IDENTIFIER;
const MAIN_WINDOW_MIN_WIDTH = 1120;
const MAIN_WINDOW_MIN_HEIGHT = 720;
const codeTerminalManager = createCodeTerminalManager();
const RELEASE_DOWNLOAD_BASE_URL =
  "https://github.com/WeaveQ/onmyagent/releases/latest/download";
const RELEASE_PAGE_URL =
  "https://github.com/WeaveQ/onmyagent/releases/latest";
const DOCS_PAGE_URL = "https://onmyagentlabs.com/docs";
const BUNDLED_SKILLS_RESOURCE_DIR = "bundled-skills";
const MARKETPLACE_RESOURCE_DIR = "marketplace";
let cachedBundledSkillsRootPath = undefined;
let cachedMarketplaceRootPath = undefined;
const ONMYAGENT_USER_SKILLS_DIR_SUBPATH = ".onmyagent/skills";
const ONMYAGENT_LEGACY_USER_SKILLS_DIR_SUBPATH = "onmyagent/skills";


/**
 * 获取真实家目录路径（不受 Electron dev 沙箱影响）
 *
 * 重要：Electron dev 模式（runtime.mjs #ensureDevModePaths）会把
 * process.env.HOME / XDG_CONFIG_HOME 等重定向到沙箱目录
 *  (~/Library/Application Support/com.differentai.onmyagent.dev/onmyagent-dev-data/home)
 * 这导致 os.homedir() 和 process.env.HOME 都返回沙箱路径。
 *
 * 因此我们用 platform 和 process.env.USER 直接构造真实家目录路径。
 */
function getRealHomeDir() {
  const user = process.env.USER || os.userInfo().username;
  if (user) {
    if (process.platform === "darwin") {
      return path.join("/Users", user);
    }
    if (process.platform === "linux") {
      // 先尝试 os.homedir()（如果不是沙箱路径），否则用 /home 兜底
      const home = os.homedir();
      if (home && !home.includes("Library/Application Support")) {
        return home;
      }
      return path.join("/home", user);
    }
    if (process.platform === "win32") {
      return process.env.USERPROFILE || path.join("C:", "Users", user);
    }
  }
  return os.homedir();
}

function claudeProjectsRoot() {
  return path.join(getRealHomeDir(), ".claude", "projects");
}

function bundledSkillsRootPath() {
  if (cachedBundledSkillsRootPath !== undefined) {
    return cachedBundledSkillsRootPath;
  }
  let bundledSkillsRoot = path.join(
    process.resourcesPath,
    BUNDLED_SKILLS_RESOURCE_DIR,
  );

  // Fallback for dev (`pnpm dev`): `process.resourcesPath` points to
  // `node_modules/electron/dist/...`, not our packaged resources. Look for
  // the directory generated by `electron-build.mjs` into the local repo.
  if (!existsSync(bundledSkillsRoot)) {
    const devFallback = path.resolve(
      __dirname,
      "..",
      "resources",
      BUNDLED_SKILLS_RESOURCE_DIR,
    );
    if (existsSync(devFallback)) {
      bundledSkillsRoot = devFallback;
    }
  }

  cachedBundledSkillsRootPath = existsSync(bundledSkillsRoot)
    ? bundledSkillsRoot
    : null;
  return cachedBundledSkillsRootPath;
}

function marketplaceRootPath() {
  if (cachedMarketplaceRootPath !== undefined) {
    return cachedMarketplaceRootPath;
  }
  let marketplaceRoot = path.join(process.resourcesPath, MARKETPLACE_RESOURCE_DIR);
  if (!existsSync(marketplaceRoot)) {
    const devFallback = path.resolve(__dirname, "..", "resources", MARKETPLACE_RESOURCE_DIR);
    if (existsSync(devFallback)) {
      marketplaceRoot = devFallback;
    }
  }
  cachedMarketplaceRootPath = existsSync(marketplaceRoot) ? marketplaceRoot : null;
  return cachedMarketplaceRootPath;
}

async function ensureOnMyAgentUserDataDirs() {
  await mkdir(path.join(getRealHomeDir(), ".onmyagent", "agents"), {
    recursive: true,
  });
  await mkdir(path.join(getRealHomeDir(), ONMYAGENT_USER_SKILLS_DIR_SUBPATH), {
    recursive: true,
  });
}

const computerUseDesktopHelpers = createComputerUseDesktopHelpers({
  app,
  shell,
  dialog,
  systemPreferences,
  dirname: __dirname,
});
const {
  getComputerUseMcpCommand,
  checkComputerUsePermissions,
  setComputerUseSkysightEnabled,
  setComputerUseSkysightPaused,
  updateComputerUseSkysightExclusion,
  clearComputerUseSkysightData,
  captureComputerUseAppshot,
  revokeComputerUseAppAuthorization,
  clearComputerUseAppAuthorizations,
  restoreComputerUseServices,
  disposeComputerUseServices,
  watchComputerUseActivity,
  watchComputerUseAppshots,
  checkSystemPermissions,
  openSystemPermissionSettings,
  openComputerUseSetupApp,
} = computerUseDesktopHelpers;

// Production Electron shares the same on-disk state folder as the Tauri shell
// so in-place migration is a no-op for almost every file. Dev mode uses the
// separate dev identifier so it can run beside the production app.
//
// Override via ONMYAGENT_ELECTRON_USERDATA so dogfooders can isolate their
// Electron install from the real Tauri app.
app.setName(APP_NAME);
app.setAppUserModelId(APP_IDENTIFIER);
if (app.isPackaged) {
  app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL_SCHEME);
}
const userDataOverride = process.env.ONMYAGENT_ELECTRON_USERDATA?.trim();
if (userDataOverride) {
  app.setPath("userData", userDataOverride);
} else {
  app.setPath("userData", path.join(app.getPath("appData"), APP_IDENTIFIER));
}

// Resolve and cache the app icon (reused for BrowserWindow + mac dock).
// Packaged builds ship icons via electron-builder config, but for local dev
// the Electron default icon is shown without this.
function resolveAppIconPath() {
  const candidates = [
    // Dev: match Tauri's separate dev icon so the dev app is visibly distinct.
    ...(isDevMode
      ? [
          path.resolve(__dirname, "../resources/icons/dev/icon.png"),
          path.resolve(__dirname, "../resources/icons/dev/128x128@2x.png"),
          path.resolve(__dirname, "../resources/icons/dev/icon-dev.icns"),
        ]
      : []),
    // Repo-relative path to the Electron resource icon set.
    path.resolve(__dirname, "../resources/icons/icon.png"),
    // Packaged: electron-builder copies extraResources but we fall back to this
    // if custom packaging ever exposes the icon here.
    path.join(process.resourcesPath ?? "", "icons", "icon.png"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

async function resolveArchitectureInfo() {
  return resolveDesktopArchitectureInfo({
    version: app.getVersion(),
    releaseDownloadBaseUrl: RELEASE_DOWNLOAD_BASE_URL,
    releasePageUrl: RELEASE_PAGE_URL,
  });
}

const APP_ICON_PATH = resolveAppIconPath();
const APP_ICON_IMAGE = APP_ICON_PATH
  ? nativeImage.createFromPath(APP_ICON_PATH)
  : null;

if (
  process.platform === "darwin" &&
  APP_ICON_IMAGE &&
  !APP_ICON_IMAGE.isEmpty() &&
  app.dock
) {
  app.dock.setIcon(APP_ICON_IMAGE);
}

await configureDesktopStartupFlags(app);
const DEFAULT_DEN_BASE_URL = "https://app.onmyagentlabs.com";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:4096";
const FORCE_DESKTOP_REQUIRE_SIGNIN = envFlagEnabled("ONMYAGENT_FORCE_SIGNIN");
const DEFAULT_DESKTOP_REQUIRE_SIGNIN = FORCE_DESKTOP_REQUIRE_SIGNIN;
function envFlagEnabled(name) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

const EMPTY_WORKSPACE_LIST = Object.freeze({
  selectedId: "",
  watchedId: null,
  activeId: null,
  workspaces: [],
});

const IDLE_ENGINE_INFO = Object.freeze({
  running: false,
  runtime: "direct",
  baseUrl: null,
  projectDir: null,
  hostname: null,
  port: null,
  opencodeUsername: null,
  opencodePassword: null,
  opencodeBinPath: null,
  opencodeBinSource: null,
  pid: null,
  lastStdout: null,
  lastStderr: null,
});

const IDLE_ONMYAGENT_SERVER_INFO = Object.freeze({
  running: false,
  remoteAccessEnabled: false,
  host: null,
  port: null,
  baseUrl: null,
  connectUrl: null,
  mdnsUrl: null,
  lanUrl: null,
  clientToken: null,
  ownerToken: null,
  hostToken: null,
  managedOpencodeBinPath: null,
  managedOpencodeBinSource: null,
  pid: null,
  lastStdout: null,
  lastStderr: null,
});

const IDLE_ROUTER_INFO = Object.freeze({
  running: false,
  version: null,
  workspacePath: null,
  opencodeUrl: null,
  healthPort: null,
  pid: null,
  lastStdout: null,
  lastStderr: null,
});

let mainWindow = null;
const pendingDeepLinks = [];

function isLocalRendererOrigin(origin) {
  const value = String(origin ?? "").trim();
  if (!value || value === "file://") return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === "file:" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function isMainWindowWebContents(webContents) {
  return Boolean(
    mainWindow && webContents && webContents.id === mainWindow.webContents.id,
  );
}

function shouldAllowMainWindowPermission(
  webContents,
  permission,
  origin,
  details = {},
) {
  if (!isMainWindowWebContents(webContents)) return false;
  if (!isLocalRendererOrigin(origin)) return false;
  if (permission !== "media" && permission !== "audioCapture") return true;
  const mediaType =
    typeof details.mediaType === "string" ? details.mediaType : "";
  if (mediaType && mediaType !== "audio") return false;
  const mediaTypes = Array.isArray(details.mediaTypes)
    ? details.mediaTypes
    : [];
  return (
    mediaTypes.length === 0 ||
    (mediaTypes.includes("audio") && !mediaTypes.includes("video"))
  );
}

function installMediaPermissionHandlers() {
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        shouldAllowMainWindowPermission(
          webContents,
          permission,
          details?.requestingUrl,
          details,
        ),
      );
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      shouldAllowMainWindowPermission(
        webContents,
        permission,
        requestingOrigin,
        details,
      ),
  );
}

const applicationMenuController = createApplicationMenuController({
  appName: APP_NAME,
  docsPageUrl: DOCS_PAGE_URL,
  Menu,
  BrowserWindow,
  shell,
  createMainWindow,
  openSettingsEvent: NATIVE_MENU_OPEN_SETTINGS_EVENT,
  toggleSidebarEvent: NATIVE_MENU_TOGGLE_SIDEBAR_EVENT,
});
const {
  installApplicationMenu,
  applyApplicationMenuVisibility,
  setApplicationMenuVisible,
} = applicationMenuController;

const browserController = createElectronBrowserController({
  WebContentsView,
  clipboard,
  openExternal: (url) => shell.openExternal(url),
  requestApproval: async (request) => {
    const action = request?.action ?? {};
    const detail = action.kind === "click"
      ? `Allow the browser to activate “${String(action.label || "this control").slice(0, 160)}”?`
      : action.kind === "upload"
        ? "Allow the browser to upload the selected file?"
        : "Allow the browser to download this file?";
    const result = await dialog.showMessageBox(mainWindow ?? undefined, {
      type: "warning",
      title: "Browser confirmation",
      message: "A browser action requires your confirmation.",
      detail,
      buttons: ["Cancel", "Allow"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return result.response === 1;
  },
});
const uiControlBridge = createUiControlServer({
  app,
  appName: APP_NAME,
  appIdentifier: APP_IDENTIFIER,
  createMainWindow,
});
function normalizePlatform(value) {
  if (value === "darwin" || value === "linux") return value;
  if (value === "win32") return "windows";
  return "linux";
}

function forwardedDeepLinks(argv) {
  return argv
    .slice(1)
    .map((entry) => entry.trim())
    .filter(
      (entry) =>
        entry.startsWith("onmyagent://") ||
        entry.startsWith("onmyagent-dev://") ||
        entry.startsWith("https://") ||
        entry.startsWith("http://"),
    );
}

function queueDeepLinks(urls) {
  const nextUrls = urls.filter(Boolean);
  if (nextUrls.length === 0) return;
  pendingDeepLinks.push(...nextUrls);
  if (mainWindow?.webContents) {
    mainWindow.webContents.send(NATIVE_DEEP_LINK_EVENT, nextUrls);
  }
}

function flushPendingDeepLinks() {
  if (!mainWindow?.webContents || pendingDeepLinks.length === 0) return;
  const urls = pendingDeepLinks.splice(0, pendingDeepLinks.length);
  mainWindow.webContents.send(NATIVE_DEEP_LINK_EVENT, urls);
}

function desktopBootstrapPath() {
  if (process.env.ONMYAGENT_DESKTOP_BOOTSTRAP_PATH?.trim()) {
    return process.env.ONMYAGENT_DESKTOP_BOOTSTRAP_PATH.trim();
  }
  return path.join(
    os.homedir(),
    ".config",
    "onmyagent",
    "desktop-bootstrap.json",
  );
}

function workspaceStatePath() {
  return path.join(app.getPath("userData"), "onmyagent-workspaces.json");
}

function userAgentRegistryPath() {
  return path.join(getRealHomeDir(), ".onmyagent", "agents", "registry.json");
}

function onmyagentUserSkillsRoot() {
  return path.join(getRealHomeDir(), ONMYAGENT_USER_SKILLS_DIR_SUBPATH);
}

function legacyOnmyagentUserSkillsRoot() {
  return path.join(getRealHomeDir(), ONMYAGENT_LEGACY_USER_SKILLS_DIR_SUBPATH);
}

const {
  onmyagentMarketplaceRoot,
  validateExpertMarketplaceName,
  validateExpertPackageName,
  validateBuiltinSkillPackageName,
  listExpertPackages,
  listExpertRegistryRecords,
  myExpertPackageFiles,
} = createExpertMarketplace({ getRealHomeDir });

const {
  agentManagementFetchModels,
  agentManagementProviderAction,
  readAgentManagementProvidersSnapshot,
} = createAgentManagementProviders({ getRealHomeDir });

const {
  agentManagementSkillAction,
  scanAgentManagementSkills,
  copyDirectoryRecursive,
} = createAgentManagementSkills({
  getRealHomeDir,
  onmyagentUserSkillsRoot,
  bundledSkillsRootPath,
  shell,
});




function builtinExpertPackageSource(packageName) {
  const safePackage = validateExpertPackageName(packageName);
  const workspaceRoot = path.resolve(__dirname, "../../..");
  const marketplaceRoot = marketplaceRootPath();
  const candidates = [
    ...(marketplaceRoot
      ? [path.join(marketplaceRoot, "experts", "plugins", safePackage)]
      : []),
    path.join(workspaceRoot, "apps/desktop/resources/marketplace/experts/plugins", safePackage),
    path.join(app.getAppPath(), "apps/desktop/resources/marketplace/experts/plugins", safePackage),
    path.join(process.cwd(), "apps/desktop/resources/marketplace/experts/plugins", safePackage),
  ];
  return { safePackage, candidates };
}

function builtinSkillPackageSource(packageName) {
  const safePackage = validateBuiltinSkillPackageName(packageName);
  const workspaceRoot = path.resolve(__dirname, "../../..");
  const marketplaceRoot = marketplaceRootPath();
  const candidates = [
    ...(marketplaceRoot
      ? [path.join(marketplaceRoot, "skills", "skills", safePackage)]
      : []),
    path.join(workspaceRoot, "apps/desktop/resources/marketplace/skills/skills", safePackage),
    path.join(app.getAppPath(), "apps/desktop/resources/marketplace/skills/skills", safePackage),
    path.join(process.cwd(), "apps/desktop/resources/marketplace/skills/skills", safePackage),
  ];
  return { safePackage, candidates };
}


function isBundledSkillPath(targetPath) {
  const bundledRoot = bundledSkillsRootPath();
  if (!bundledRoot) return false;
  const relativePath = path.relative(bundledRoot, targetPath);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

// Earlier Electron alpha builds copied Tauri's onmyagent-workspaces.json into an
// Electron-only workspace-state.json. Keep importing that file when the shared
// canonical file is missing, but write onmyagent-workspaces.json going forward so
// Tauri rollback and Electron both read the same desktop workspace state.
function legacyElectronWorkspaceStatePath() {
  return path.join(app.getPath("userData"), "workspace-state.json");
}

async function migrateLegacyElectronWorkspaceStateIfNeeded() {
  const current = workspaceStatePath();
  const legacy = legacyElectronWorkspaceStatePath();
  try {
    if (existsSync(current)) return false;
    if (!existsSync(legacy)) return false;
    await mkdir(path.dirname(current), { recursive: true });
    const raw = await readFile(legacy, "utf8");
    await writeFile(current, raw, "utf8");
    console.info(
      "[migration] copied workspace-state.json → onmyagent-workspaces.json",
    );
    return true;
  } catch (error) {
    console.warn(
      "[migration] legacy Electron workspace-state copy failed",
      error,
    );
    return false;
  }
}

function configHomePath() {
  if (process.env.XDG_CONFIG_HOME?.trim()) {
    return process.env.XDG_CONFIG_HOME.trim();
  }
  if (process.platform === "win32" && process.env.APPDATA?.trim()) {
    return process.env.APPDATA.trim();
  }
  return path.join(os.homedir(), ".config");
}

function globalOpencodeRoot() {
  return path.join(configHomePath(), "opencode");
}

function execResult(ok, stdout = "", stderr = "", status = ok ? 0 : 1) {
  return { ok, status, stdout, stderr };
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(targetPath) {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

function parseJsonLikeObject(raw) {
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

function looksLikeIncompleteJson(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return false;
  if (!/^[{\[]/.test(text)) return false;
  let inString = false;
  let escaped = false;
  const stack = [];
  for (const char of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") stack.pop();
  }
  return inString || stack.length > 0;
}

async function readJsonLikeFile(targetPath) {
  try {
    return parseJsonLikeObject(await readFile(targetPath, "utf8"));
  } catch {
    return null;
  }
}






// Overlay the skill list on top of getHostStatus() output so the session
// page's skill count matches what the management page shows for the same
// provider. Single source of truth: scanAgentManagementSkills. Do NOT split
// this into per-provider patches -- keep the parity in one place.
async function personalLocalAgentHostStatusWithManagementParity(input) {
  const [base, managed] = await Promise.all([
    personalAgentRuntime.getHostStatus(input),
    (async () => {
      const workspaceRoot = String(input?.workspaceRoot ?? "").trim();
      if (!workspaceRoot) return [];
      try {
        return await scanAgentManagementSkills(workspaceRoot);
      } catch (error) {
        console.warn("[personalLocalAgentHostStatus] scanAgentManagementSkills failed", error);
        return [];
      }
    })(),
  ]);
  const provider = String(input?.agent?.provider ?? input?.agent?.id ?? "").toLowerCase();
  const provKey = provider.includes("codex") ? "codex"
    : provider.includes("claude") ? "claude"
    : provider.includes("opencode") ? "opencode"
    : provider.includes("openclaw") ? "openclaw"
    : provider.includes("hermes") ? "hermes"
    : provider.includes("gemini") ? "gemini"
    : provider;
  const forProvider = managed.filter((skill) => Array.isArray(skill.agents) && skill.agents.includes(provKey));
  const rootCounts = new Map();
  const skills = forProvider.map((skill) => {
    const indexFile = skill.path ? path.join(skill.path, "SKILL.md") : `runtime:${skill.name}`;
    const source = skill.root || skill.path || "";
    rootCounts.set(source, (rootCounts.get(source) ?? 0) + 1);
    return {
      id: skill.path ? path.basename(skill.path) : skill.name,
      name: skill.displayNameEn || skill.displayNameZh || skill.name,
      indexFile,
      source,
      provenance: "workspace",
    };
  });
  const roots = [...rootCounts.entries()].map(([p, count]) => ({ path: p, exists: true, count }));
  return {
    ...base,
    skill: {
      skills,
      roots,
      error: base?.skill?.error ?? null,
    },
  };
}

async function agentManagementSnapshot(input = {}) {
  const workspaceRoot = String(input?.workspaceRoot ?? "").trim();
  if (!workspaceRoot) throw new Error("workspaceRoot is required");
  const [{ agents }, managedSkills, usageByProvider, providers, mcp] = await Promise.all([
    personalAgentRuntime.listAgents({ workspaceRoot, includeModels: true, includeDiscoverable: true }),
    scanAgentManagementSkills(workspaceRoot),
    personalAgentLegacyHarness.readPersonalAgentUsageSummary(workspaceRoot),
    readAgentManagementProvidersSnapshot(),
    agentManagementMcpSnapshot(),
  ]);
  const skillCounts = new Map();
  for (const skill of managedSkills) {
    for (const agent of skill.agents) {
      skillCounts.set(agent, (skillCounts.get(agent) ?? 0) + 1);
    }
  }
  return {
    generatedAt: Date.now(),
    workspaceRoot,
    agents: agents.map((agent) => ({
      ...agent,
      // Custom agents share the literal provider "custom", so we must NOT key
      // their lookup by provider (that would hit the empty pre-seeded "custom"
      // bucket and hide their real stats). Their run logs are keyed by agentId
      // == agent.id. Built-in providers are keyed by provider directly.
      usage: usageByProvider.get(agent.provider === "custom" ? agent.id : agent.provider) ?? personalAgentLegacyHarness.emptyAgentUsageSummary(),
      skillCount: skillCounts.get(agent.provider) ?? 0,
    })),
    skills: managedSkills,
    providers,
    mcp,
  };
}


async function readJsonFile(targetPath, fallback) {
  try {
    const raw = await readFile(targetPath, "utf8");
    try {
      return JSON.parse(raw);
    } catch (error) {
      const recovered = parseFirstJsonObject(raw);
      if (recovered.ok) {
        console.warn(
          `[json] recovered ${targetPath} from trailing invalid data`,
          error,
        );
        await writeJsonFileAtomic(targetPath, recovered.value);
        return recovered.value;
      }
      throw error;
    }
  } catch {
    return fallback;
  }
}

function parseFirstJsonObject(raw) {
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          return { ok: true, value: JSON.parse(raw.slice(start, index + 1)) };
        } catch {
          return { ok: false, value: null };
        }
      }
    }
  }

  return { ok: false, value: null };
}

async function writeJsonFileAtomic(outputPath, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  JSON.parse(content);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, outputPath);
}

function normalizeDesktopBootstrapConfig(input) {
  const baseUrl =
    typeof input?.baseUrl === "string" ? input.baseUrl.trim() : "";
  if (!baseUrl) {
    throw new Error("baseUrl is required");
  }

  const apiBaseUrl =
    typeof input?.apiBaseUrl === "string" && input.apiBaseUrl.trim().length > 0
      ? input.apiBaseUrl.trim()
      : null;

  return {
    baseUrl,
    apiBaseUrl,
    requireSignin:
      FORCE_DESKTOP_REQUIRE_SIGNIN || input?.requireSignin === true,
  };
}

async function getDesktopBootstrapConfig() {
  const configPath = desktopBootstrapPath();
  try {
    const raw = await readFile(configPath, "utf8");
    return normalizeDesktopBootstrapConfig(JSON.parse(raw));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("[desktop-bootstrap] falling back to defaults", {
        path: configPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      baseUrl: DEFAULT_DEN_BASE_URL,
      apiBaseUrl: null,
      requireSignin: DEFAULT_DESKTOP_REQUIRE_SIGNIN,
    };
  }
}

async function debugDesktopBootstrapConfig() {
  const configPath = desktopBootstrapPath();
  const result = {
    path: configPath,
    home: os.homedir(),
    envHome: process.env.HOME ?? null,
    envOverride: process.env.ONMYAGENT_DESKTOP_BOOTSTRAP_PATH ?? null,
    exists: existsSync(configPath),
    raw: null,
    parsed: null,
    normalized: null,
    error: null,
  };

  try {
    result.raw = await readFile(configPath, "utf8");
    result.parsed = JSON.parse(result.raw);
    result.normalized = normalizeDesktopBootstrapConfig(result.parsed);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

async function setDesktopBootstrapConfig(config) {
  const normalized = normalizeDesktopBootstrapConfig(config);
  const outputPath = desktopBootstrapPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  return normalized;
}

function sanitizeCommandName(raw) {
  const trimmed = String(raw ?? "")
    .trim()
    .replace(/^\/+/, "");
  if (!trimmed) return null;
  const safe = Array.from(trimmed)
    .filter((char) => /[A-Za-z0-9_-]/.test(char))
    .join("");
  return safe || null;
}

function escapeYamlScalar(value) {
  return JSON.stringify(String(value ?? ""));
}

function serializeCommandFrontmatter(command) {
  const template = String(command?.template ?? "").trim();
  if (!template) {
    throw new Error("command.template is required");
  }

  let output = "---\n";
  if (typeof command?.description === "string" && command.description.trim()) {
    output += `description: ${escapeYamlScalar(command.description.trim())}\n`;
  }
  if (typeof command?.agent === "string" && command.agent.trim()) {
    output += `agent: ${escapeYamlScalar(command.agent.trim())}\n`;
  }
  if (typeof command?.model === "string" && command.model.trim()) {
    output += `model: ${escapeYamlScalar(command.model.trim())}\n`;
  }
  if (command?.subtask === true) {
    output += "subtask: true\n";
  }
  output += `---\n\n${template}\n`;
  return output;
}

function validateSkillName(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
    throw new Error("skill name must be kebab-case");
  }
  return trimmed;
}

function defaultWorkspaceOnMyAgentConfig(workspacePath, preset = null) {
  return {
    version: 1,
    workspace: workspacePath
      ? {
          name: path.basename(workspacePath) || "Workspace",
          createdAt: Date.now(),
          preset: preset || null,
        }
      : null,
    authorizedRoots: workspacePath ? [workspacePath] : [],
    reload: null,
  };
}

async function workspaceOpencodeConfigPath(workspacePath) {
  const candidates = [
    path.join(workspacePath, "opencode.jsonc"),
    path.join(workspacePath, "opencode.json"),
    path.join(workspacePath, ".opencode", "opencode.jsonc"),
    path.join(workspacePath, ".opencode", "opencode.json"),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return candidates[0];
}

async function ensureDefaultWorkspaceOpencodeConfig(workspacePath) {
  const configPath = await workspaceOpencodeConfigPath(workspacePath);
  if (await pathExists(configPath)) return false;
  await writeJsonFileAtomic(configPath, {
    $schema: "https://opencode.ai/config.json",
    default_agent: "onmyagent",
  });
  return true;
}

async function normalizeLocalWorkspacePath(rawPath) {
  const trimmed = String(rawPath ?? "").trim();
  if (!trimmed) return "";
  const expanded =
    trimmed === "~"
      ? os.homedir()
      : trimmed.startsWith("~/") || trimmed.startsWith("~\\")
        ? path.join(os.homedir(), trimmed.slice(2))
        : trimmed;
  const resolved = path.resolve(expanded);
  return realpath(resolved).catch(() => resolved);
}

function normalizeWorkspacePathKey(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? path.resolve(trimmed).replace(/\\/g, "/").toLowerCase() : "";
}

function stableWorkspaceId(value) {
  return `ws_${createHash("sha256").update(String(value)).digest("hex").slice(0, 12)}`;
}

function localWorkspaceId(workspacePath) {
  return stableWorkspaceId(workspacePath);
}

function remoteWorkspaceId(baseUrl, directory) {
  const key = String(directory ?? "").trim()
    ? `remote::${baseUrl}::${String(directory).trim()}`
    : `remote::${baseUrl}`;
  return stableWorkspaceId(key);
}

function parseOnMyAgentWorkspaceIdFromUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const segments = url.pathname.split("/").filter(Boolean);
    const workspaceIndex = segments.indexOf("workspace");
    const legacyIndex = segments.indexOf("w");
    const mountIndex = workspaceIndex >= 0 ? workspaceIndex : legacyIndex;
    return mountIndex >= 0 && segments[mountIndex + 1]
      ? decodeURIComponent(segments[mountIndex + 1])
      : null;
  } catch {
    const match = raw.match(/\/(?:workspace|w)\/([^/?#]+)/);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
}

function stripOnMyAgentWorkspaceMount(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const segments = url.pathname.split("/").filter(Boolean);
    const workspaceIndex = segments.indexOf("workspace");
    const legacyIndex = segments.indexOf("w");
    const mountIndex = workspaceIndex >= 0 ? workspaceIndex : legacyIndex;
    if (mountIndex >= 0 && segments[mountIndex + 1]) {
      const prefix = segments.slice(0, mountIndex).join("/");
      url.pathname = prefix ? `/${prefix}` : "/";
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return (
      raw.replace(/\/(?:workspace|w)\/[^/?#]+.*$/, "").replace(/\/+$/, "") ||
      raw
    );
  }
}

function onmyagentRemoteWorkspaceId(hostUrl, workspaceId) {
  const remoteWorkspaceId =
    String(workspaceId ?? "").trim() ||
    parseOnMyAgentWorkspaceIdFromUrl(hostUrl);
  if (remoteWorkspaceId) return `rem_${remoteWorkspaceId}`;
  return `rem_${createHash("sha256").update(`onmyagent::${hostUrl}`).digest("hex").slice(0, 12)}`;
}

async function fetchOnMyAgentWorkspaceList(hostUrl, token, hostToken) {
  const url = `${String(hostUrl ?? "").replace(/\/+$/, "")}/workspaces`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const headers = new Headers();
  const bearerToken = String(token ?? "").trim();
  const hostAuthToken = String(hostToken ?? "").trim();
  if (bearerToken) headers.set("Authorization", `Bearer ${bearerToken}`);
  if (hostAuthToken) headers.set("X-OnMyAgent-Host-Token", hostAuthToken);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `OnMyAgent workspace discovery failed (${response.status} ${response.statusText || "HTTP error"})`,
      );
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverOnMyAgentWorkspace({
  hostUrl,
  token,
  hostToken,
  directory,
}) {
  const list = await fetchOnMyAgentWorkspaceList(hostUrl, token, hostToken);
  return selectOnMyAgentWorkspaceForConnection(list, directory);
}

async function readWorkspaceOnMyAgentConfig(workspacePath) {
  const onmyagentPath = path.join(workspacePath, ".opencode", "onmyagent.json");
  if (!(await pathExists(onmyagentPath))) {
    return defaultWorkspaceOnMyAgentConfig(workspacePath);
  }
  const raw = await readFile(onmyagentPath, "utf8");
  return JSON.parse(raw);
}

async function writeWorkspaceOnMyAgentConfig(workspacePath, config) {
  const onmyagentPath = path.join(workspacePath, ".opencode", "onmyagent.json");
  await mkdir(path.dirname(onmyagentPath), { recursive: true });
  await writeFile(onmyagentPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return execResult(true, `Wrote ${onmyagentPath}`);
}

async function readWorkspaceState() {
  const state = await readJsonFile(workspaceStatePath(), EMPTY_WORKSPACE_LIST);
  const selectedId =
    typeof state?.selectedId === "string"
      ? state.selectedId
      : typeof state?.selectedWorkspaceId === "string"
        ? state.selectedWorkspaceId
        : typeof state?.activeId === "string"
          ? state.activeId
          : "";
  const watchedId =
    typeof state?.watchedId === "string"
      ? state.watchedId
      : typeof state?.watchedWorkspaceId === "string"
        ? state.watchedWorkspaceId
        : null;
  const activeId = typeof state?.activeId === "string" ? state.activeId : null;
  const workspaces = Array.isArray(state?.workspaces) ? state.workspaces : [];
  let changed = false;
  const idMap = new Map();
  const migratedWorkspaces = workspaces.map((entry) => {
    const workspace =
      entry && typeof entry === "object"
        ? entry
        : normalizeWorkspaceEntry(entry ?? {});
    if (
      workspace.workspaceType !== "remote" ||
      workspace.remoteType !== "onmyagent"
    )
      return workspace;

    const remoteWorkspaceId =
      String(workspace.onmyagentWorkspaceId ?? "").trim() ||
      parseOnMyAgentWorkspaceIdFromUrl(workspace.onmyagentHostUrl) ||
      parseOnMyAgentWorkspaceIdFromUrl(workspace.baseUrl);
    if (!remoteWorkspaceId) return workspace;

    const hostUrl =
      stripOnMyAgentWorkspaceMount(workspace.onmyagentHostUrl) ||
      stripOnMyAgentWorkspaceMount(workspace.baseUrl);
    const nextId = onmyagentRemoteWorkspaceId(
      hostUrl ?? workspace.baseUrl,
      remoteWorkspaceId,
    );
    idMap.set(workspace.id, nextId);
    const nextWorkspace = {
      ...workspace,
      id: nextId,
      baseUrl: hostUrl,
      onmyagentWorkspaceId: remoteWorkspaceId,
      onmyagentHostUrl: hostUrl,
    };
    if (
      workspace.id !== nextWorkspace.id ||
      workspace.baseUrl !== nextWorkspace.baseUrl ||
      workspace.onmyagentWorkspaceId !== nextWorkspace.onmyagentWorkspaceId ||
      workspace.onmyagentHostUrl !== nextWorkspace.onmyagentHostUrl
    ) {
      changed = true;
    }
    return nextWorkspace;
  });
  // Older desktop state can contain multiple OnMyAgent remote entries that
  // normalize to the same `rem_<workspaceId>` after stripping worker mounts.
  // Collapse them here so React never receives duplicate workspace keys.
  const workspaceIndexById = new Map();
  const dedupedWorkspaces = [];
  for (const workspace of migratedWorkspaces) {
    const workspaceId = String(workspace?.id ?? "").trim();
    if (!workspaceId) {
      dedupedWorkspaces.push(workspace);
      continue;
    }
    const existingIndex = workspaceIndexById.get(workspaceId);
    if (existingIndex === undefined) {
      workspaceIndexById.set(workspaceId, dedupedWorkspaces.length);
      dedupedWorkspaces.push(workspace);
      continue;
    }
    // Keep the later entry: normal mutations replace-then-push refreshed
    // remote workspaces, and there is no persisted updatedAt to compare.
    dedupedWorkspaces[existingIndex] = workspace;
    changed = true;
  }

  const migratedSelectedId = idMap.get(selectedId) ?? selectedId;
  const migratedWatchedId = watchedId
    ? (idMap.get(watchedId) ?? watchedId)
    : null;
  const migratedActiveId = activeId ? (idMap.get(activeId) ?? activeId) : null;
  if (
    migratedSelectedId !== selectedId ||
    migratedWatchedId !== watchedId ||
    migratedActiveId !== activeId
  )
    changed = true;

  const nextState = {
    selectedId: migratedSelectedId,
    watchedId: migratedWatchedId,
    activeId: migratedActiveId,
    workspaces: dedupedWorkspaces,
  };

  if (changed) {
    return writeWorkspaceState(nextState);
  }
  return nextState;
}

async function writeWorkspaceState(nextState) {
  const outputPath = workspaceStatePath();
  const selectedId = String(nextState?.selectedId ?? nextState?.activeId ?? "");
  const watchedId =
    typeof nextState?.watchedId === "string" ? nextState.watchedId : "";
  const output = {
    ...nextState,
    // Tauri's Rust state uses selectedWorkspaceId/watchedWorkspaceId on disk
    // (with activeId as a legacy alias). Keep Electron's selectedId/watchedId
    // too so older Electron builds can still read the same file.
    selectedId,
    selectedWorkspaceId: selectedId,
    watchedId: watchedId || null,
    watchedWorkspaceId: watchedId,
    activeId: selectedId || null,
  };
  await writeJsonFileAtomic(outputPath, output);
  return output;
}

const runtimeManager = createRuntimeManager({
  app,
  desktopRoot: path.resolve(__dirname, ".."),
  runtimeEnvironment: () => browserController.browserEnvironment(),
  listLocalWorkspacePaths: async () =>
    (await readWorkspaceState()).workspaces
      .filter((entry) => entry?.workspaceType !== "remote")
      .map((entry) => String(entry?.path ?? "").trim())
      .filter(Boolean),
});

const {
  personalAgentLegacyHarness,
  personalAgentRuntime,
  personalAgentHeartbeatScheduler,
  personalAgentNativeSessions,
  weixinService,
  feishuService,
  telegramService,
  discordService,
  channelInfrastructureApi,
} = createDesktopPersonalRuntimeServices({
  app,
  runtimeManager,
  readWorkspaceState,
  claudeProjectsRoot,
});

// Push channel state / pairing changes from the main process to the renderer
// (parity: AionUi event-push for pluginStatusChanged / pairingRequested). The
// singleton event bus is shared by every channel service's dispatcher, so a
// single subscription here covers Telegram, Discord, Weixin and Feishu.
(function wireChannelStatusPush() {
  if (!channelEventBus) return;
  channelEventBus.subscribe(CHANNEL_EVENTS.CHANNEL_STATE_CHANGED, (event) => {
    mainWindow?.webContents?.send("onmyagent:channel:status", event?.payload ?? {});
  });
  channelEventBus.subscribe(CHANNEL_EVENTS.PAIRING_REQUESTED, (event) => {
    mainWindow?.webContents?.send("onmyagent:channel:pairing", event?.payload ?? {});
  });
  channelEventBus.subscribe(CHANNEL_EVENTS.USER_AUTHORIZED, (event) => {
    mainWindow?.webContents?.send("onmyagent:channel:user:authorized", event?.payload ?? {});
  });
})();

const codeWorkspaceActions = createCodeWorkspaceActions({
  runtimeManager,
  shell,
  isDirectory,
  personalAgentLegacyHarness,
});

let runtimeDisposedForQuit = false;
let runtimeBootstrapPromise = null;

async function disposeRuntimeBeforeQuit() {
  if (runtimeDisposedForQuit) return;
  runtimeDisposedForQuit = true;
  await Promise.all([
    personalAgentHeartbeatScheduler.close().catch(() => undefined),
    runtimeManager.dispose().catch(() => undefined),
    cleanupRegisteredAgentProcesses().catch(() => undefined),
  ]);
}

function assertOnMyAgentServerReady(info) {
  if (!info?.running) {
    throw new Error("OnMyAgent server did not stay running after startup.");
  }
  if (!info.baseUrl) {
    throw new Error("OnMyAgent server did not report a base URL after startup.");
  }
  if (!info.ownerToken && !info.clientToken) {
    throw new Error(
      "OnMyAgent server did not report an access token after startup.",
    );
  }
  return info;
}

async function bootRuntimeForSelectedWorkspace() {
  const list = await readWorkspaceState();
  const selectedId =
    list.selectedId || list.activeId || list.workspaces[0]?.id || "";
  const workspace = selectedId
    ? list.workspaces.find((entry) => entry?.id === selectedId)
    : list.workspaces[0];
  const workspaceRoot = String(workspace?.path ?? "").trim();
  if (!workspaceRoot || workspace?.workspaceType === "remote") {
    return { ok: true, skipped: true, reason: "no-local-workspace" };
  }

  const workspacePaths = [];
  for (const entry of list.workspaces) {
    if (entry?.workspaceType === "remote") continue;
    const workspacePath = String(entry?.path ?? "").trim();
    if (workspacePath && !workspacePaths.includes(workspacePath))
      workspacePaths.push(workspacePath);
  }
  if (!workspacePaths.includes(workspaceRoot))
    workspacePaths.unshift(workspaceRoot);

  let bootWorkspace = workspace;
  let bootWorkspaceRoot = workspaceRoot;
  let engine;
  try {
    engine = await runtimeManager.engineStart(workspaceRoot, {
      runtime: "direct",
      workspacePaths,
    });
  } catch (error) {
    const fallback = list.workspaces.find((entry) => {
      const candidatePath = String(entry?.path ?? "").trim();
      return (
        entry?.workspaceType !== "remote" &&
        candidatePath &&
        candidatePath !== workspaceRoot
      );
    });
    const fallbackRoot = String(fallback?.path ?? "").trim();
    if (!fallback || !fallbackRoot) throw error;
    console.warn(
      "[runtime] selected workspace failed during boot; trying fallback workspace",
      {
        selectedWorkspaceId: workspace?.id ?? null,
        fallbackWorkspaceId: fallback.id ?? null,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    const fallbackWorkspacePaths = [
      fallbackRoot,
      ...workspacePaths.filter(
        (entry) => entry !== fallbackRoot && entry !== workspaceRoot,
      ),
    ];
    engine = await runtimeManager.engineStart(fallbackRoot, {
      runtime: "direct",
      workspacePaths: fallbackWorkspacePaths,
    });
    bootWorkspace = fallback;
    bootWorkspaceRoot = fallbackRoot;
    await writeWorkspaceState({
      ...list,
      selectedId: String(fallback.id ?? ""),
      watchedId: String(fallback.id ?? ""),
    }).catch(() => undefined);
  }
  await runtimeManager
    .orchestratorWorkspaceActivate({
      workspacePath: bootWorkspaceRoot,
      name: bootWorkspace.name ?? bootWorkspace.displayName ?? null,
    })
    .catch(() => undefined);
  const onmyagentServer = assertOnMyAgentServerReady(
    await runtimeManager.onmyagentServerInfo(),
  );
  return {
    ok: true,
    skipped: false,
    engine,
    onmyagentServer,
    workspaceId: bootWorkspace.id ?? null,
  };
}

function ensureRuntimeBootstrap() {
  if (!runtimeBootstrapPromise) {
    runtimeBootstrapPromise = bootRuntimeForSelectedWorkspace().catch(
      (error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  return runtimeBootstrapPromise;
}

function normalizeWorkspaceEntry(input) {
  return {
    id: String(input.id),
    name: String(input.name ?? "Workspace"),
    path: String(input.path ?? ""),
    preset: String(input.preset ?? "starter"),
    workspaceType: input.workspaceType === "remote" ? "remote" : "local",
    remoteType: input.remoteType ?? null,
    baseUrl: input.baseUrl ?? null,
    directory: input.directory ?? null,
    displayName: input.displayName ?? null,
    onmyagentHostUrl: input.onmyagentHostUrl ?? null,
    onmyagentToken: input.onmyagentToken ?? null,
    onmyagentClientToken: input.onmyagentClientToken ?? null,
    onmyagentHostToken: input.onmyagentHostToken ?? null,
    onmyagentWorkspaceId: input.onmyagentWorkspaceId ?? null,
    onmyagentWorkspaceName: input.onmyagentWorkspaceName ?? null,
    sandboxBackend: input.sandboxBackend ?? null,
    sandboxRunId: input.sandboxRunId ?? null,
    sandboxContainerName: input.sandboxContainerName ?? null,
  };
}

async function mutateWorkspaceState(mutator) {
  const current = await readWorkspaceState();
  const next = await mutator({
    ...current,
    workspaces: [...current.workspaces],
  });
  return writeWorkspaceState(next);
}

function resolveOpencodeConfigPath(scope, projectDir) {
  let root;
  if (scope === "project") {
    if (!String(projectDir ?? "").trim()) {
      throw new Error("projectDir is required");
    }
    root = projectDir;
  } else if (scope === "global") {
    root = globalOpencodeRoot();
  } else {
    throw new Error("scope must be 'project' or 'global'");
  }

  const jsoncPath = path.join(root, "opencode.jsonc");
  const jsonPath = path.join(root, "opencode.json");
  return { jsoncPath, jsonPath };
}

async function readOpencodeConfig(scope, projectDir) {
  const { jsoncPath, jsonPath } = resolveOpencodeConfigPath(scope, projectDir);
  const chosenPath = (await pathExists(jsoncPath))
    ? jsoncPath
    : (await pathExists(jsonPath))
      ? jsonPath
      : jsoncPath;
  const exists = await pathExists(chosenPath);
  return {
    path: chosenPath,
    exists,
    content: exists ? await readFile(chosenPath, "utf8") : null,
  };
}

async function writeOpencodeConfig(scope, projectDir, content) {
  const { jsoncPath, jsonPath } = resolveOpencodeConfigPath(scope, projectDir);
  const targetPath = (await pathExists(jsoncPath))
    ? jsoncPath
    : (await pathExists(jsonPath))
      ? jsonPath
      : jsoncPath;
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
  return execResult(true, `Wrote ${targetPath}`);
}

function resolveCommandsDir(scope, projectDir) {
  if (scope === "workspace") {
    if (!String(projectDir ?? "").trim()) {
      throw new Error("projectDir is required");
    }
    return path.join(projectDir, ".opencode", "commands");
  }
  if (scope === "global") {
    return path.join(globalOpencodeRoot(), "commands");
  }
  throw new Error("scope must be 'workspace' or 'global'");
}

async function listCommandNames(scope, projectDir) {
  const commandsDir = resolveCommandsDir(scope, projectDir);
  if (!(await isDirectory(commandsDir))) {
    return [];
  }
  const entries = await readdir(commandsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.replace(/\.md$/, ""))
    .sort();
}

async function writeCommandFile(scope, projectDir, command) {
  const safeName = sanitizeCommandName(command?.name);
  if (!safeName) {
    throw new Error("command.name is required");
  }
  const commandsDir = resolveCommandsDir(scope, projectDir);
  await mkdir(commandsDir, { recursive: true });
  const filePath = path.join(commandsDir, `${safeName}.md`);
  await writeFile(
    filePath,
    serializeCommandFrontmatter({ ...command, name: safeName }),
    "utf8",
  );
  return execResult(true, `Wrote ${filePath}`);
}

async function deleteCommandFile(scope, projectDir, name) {
  const safeName = sanitizeCommandName(name);
  if (!safeName) {
    throw new Error("name is required");
  }
  const commandsDir = resolveCommandsDir(scope, projectDir);
  const filePath = path.join(commandsDir, `${safeName}.md`);
  if (await pathExists(filePath)) {
    await rm(filePath, { force: true });
  }
  return execResult(true, `Deleted ${filePath}`);
}

async function collectProjectSkillRoots(projectDir) {
  const roots = [];
  let current = path.resolve(projectDir);

  while (true) {
    const opencodeSkills = path.join(current, ".opencode", "skills");
    const legacySkills = path.join(current, ".opencode", "skill");
    const claudeSkills = path.join(current, ".claude", "skills");

    if (await isDirectory(opencodeSkills)) roots.push(opencodeSkills);
    if (await isDirectory(legacySkills)) roots.push(legacySkills);
    if (await isDirectory(claudeSkills)) roots.push(claudeSkills);

    if (await pathExists(path.join(current, ".git"))) {
      break;
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return roots;
}

async function collectGlobalSkillRoots() {
  const roots = [];
  const sandboxHome = os.homedir();
  const realHome = getRealHomeDir();
  const bundledRoot = bundledSkillsRootPath();

  const candidates = [
    onmyagentUserSkillsRoot(),
    legacyOnmyagentUserSkillsRoot(),
    path.join(sandboxHome, ".claude", "skills"),
    path.join(sandboxHome, ".agents", "skills"),
    path.join(sandboxHome, ".agent", "skills"),
    path.join(sandboxHome, ".codex", "skills"),
    path.join(sandboxHome, ".cursor", "skills"),
    path.join(sandboxHome, ".windsurf", "skills"),
    path.join(sandboxHome, ".onmyagent", "skills"),
    path.join(sandboxHome, "onmyagent", "skills"),
    path.join(globalOpencodeRoot(), "skills"),
  ];

  // 如果沙箱家目录和真实家目录不同，也添加真实家目录路径
  if (sandboxHome !== realHome) {
    candidates.push(
      path.join(realHome, ".config", "opencode", "skills"),
      path.join(realHome, ".claude", "skills"),
      path.join(realHome, ".agents", "skills"),
      path.join(realHome, ".agent", "skills"),
      path.join(realHome, ".codex", "skills"),
      path.join(realHome, ".cursor", "skills"),
      path.join(realHome, ".windsurf", "skills"),
      path.join(realHome, ".onmyagent", "skills"),
      path.join(realHome, "onmyagent", "skills"),
    );
  }

  if (bundledRoot) candidates.push(bundledRoot);

  for (const candidate of candidates) {
    const isDir = await isDirectory(candidate);
    if (isDir) {
      roots.push(candidate);
    }
  }

  console.log(`[DEBUG] collectGlobalSkillRoots: sandbox=${sandboxHome}, real=${realHome}, found ${roots.length} roots`);
  return roots;
}

async function collectSkillRoots(projectDir) {
  const roots = [
    ...(await collectProjectSkillRoots(projectDir)),
    ...(await collectGlobalSkillRoots()),
  ];
  return roots.filter((value, index) => roots.indexOf(value) === index);
}

async function findSkillDirsInRoot(root) {
  const found = [];
  if (!(await isDirectory(root))) return found;

  console.log(`[DEBUG] findSkillDirsInRoot - scanning: ${root}`);

  const entries = await readdir(root, { withFileTypes: true });
  console.log(`[DEBUG] findSkillDirsInRoot - found ${entries.length} entries in ${root}`);

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      if (!(await isDirectory(path.join(root, entry.name)))) continue;
    } else if (!entry.isDirectory()) {
      continue;
    }
    const direct = path.join(root, entry.name);
    if (await pathExists(path.join(direct, "SKILL.md"))) {
      found.push(direct);
      continue;
    }

    const nestedEntries = await readdir(direct, { withFileTypes: true }).catch(
      () => [],
    );
    for (const nested of nestedEntries) {
      if (nested.isSymbolicLink()) {
        if (!(await isDirectory(path.join(direct, nested.name)))) continue;
      } else if (!nested.isDirectory()) {
        continue;
      }
      const nestedDir = path.join(direct, nested.name);
      if (await pathExists(path.join(nestedDir, "SKILL.md"))) {
        found.push(nestedDir);
      }
    }
  }

  console.log(`[DEBUG] findSkillDirsInRoot - found ${found.length} skill dirs in ${root}`);
  return found;
}

function extractFrontmatterValue(raw, keys) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (!keys.includes(key)) continue;
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (value) return value;
  }
  return null;
}

function extractFrontmatterMap(raw, keys) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (!keys.includes(key)) continue;
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (value) out[key] = value;
  }
  return out;
}

function extractTrigger(raw) {
  return extractFrontmatterValue(raw, ["trigger", "when"]);
}

function extractDescription(raw) {
  const fm = extractFrontmatterMap(raw, ["description", "name"]);
  if (fm.description) {
    return fm.description.length > 180 ? `${fm.description.slice(0, 180)}...` : fm.description;
  }
  let inFrontmatter = false;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter || trimmed.startsWith("#")) continue;
    const cleaned = trimmed.replace(/`/g, "");
    return cleaned.length > 180 ? `${cleaned.slice(0, 180)}...` : cleaned;
  }
  return null;
}

async function listLocalSkills(projectDir) {
  if (!String(projectDir ?? "").trim()) {
    throw new Error("projectDir is required");
  }

  const LOCALE_KEYS = ["display_name_zh", "display_name_en", "description_zh", "description_en"];
  const seen = new Set();
  const out = [];
  for (const root of await collectSkillRoots(projectDir)) {
    for (const skillDir of await findSkillDirsInRoot(root)) {
      const name = path.basename(skillDir);
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      let raw = "";
      try {
        raw = await readFile(path.join(skillDir, "SKILL.md"), "utf8");
      } catch {
        raw = "";
      }
      const localeMap = extractFrontmatterMap(raw, LOCALE_KEYS);
      out.push({
        name,
        path: skillDir,
        description: extractDescription(raw) ?? undefined,
        trigger: extractTrigger(raw) ?? undefined,
        root,
        readonly: bundledSkillsRootPath() === root,
        displayNameZh: localeMap.display_name_zh,
        displayNameEn: localeMap.display_name_en,
        descriptionZh: localeMap.description_zh,
        descriptionEn: localeMap.description_en,
      });
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function findSkillFile(projectDir, name) {
  const safeName = validateSkillName(name);
  for (const root of await collectSkillRoots(projectDir)) {
    const direct = path.join(root, safeName, "SKILL.md");
    if (await pathExists(direct)) return direct;

    const entries = await readdir(root, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nested = path.join(root, entry.name, safeName, "SKILL.md");
      if (await pathExists(nested)) return nested;
    }
  }
  return null;
}

async function ensureProjectSkillRoot(projectDir) {
  await mkdir(onmyagentUserSkillsRoot(), { recursive: true });
  return onmyagentUserSkillsRoot();
}

function engineDoctor(options = {}) {
  return runtimeManager.engineDoctor(options);
}

function activeWindowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined;
}

function macosVibrancyForCurrentTheme() {
  // under-window: blur desktop behind the frame (WeChat-like translucent shell).
  // sidebar: slightly denser material for light mode so light chrome stays readable.
  return nativeTheme.shouldUseDarkColors ? "under-window" : "sidebar";
}

function applyNativeTheme(mode) {
  nativeTheme.themeSource = mode;

  if (process.platform !== "darwin") {
    return true;
  }

  mainWindow?.setVibrancy(macosVibrancyForCurrentTheme());
  mainWindow?.setBackgroundColor("#00000001");

  return true;
}

const LOCAL_AGENT_MENTION_IGNORE = new Set([
  "node_modules", ".git", ".turbo", ".next", ".cache", "dist", "build",
  ".venv", "venv", "__pycache__", ".pnpm-store", ".output", "out",
  ".DS_Store", ".idea", ".vscode",
]);
async function localAgentComposerListFiles(input = {}) {
  const root = String(input.workspaceRoot ?? "").trim();
  if (!root) return { files: [] };
  const query = String(input.query ?? "").toLowerCase();
  const limit = Math.max(1, Math.min(Number(input.limit ?? 200), 500));
  const files = [];
  async function walk(dir, depth) {
    if (files.length >= limit || depth > 6) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= limit) return;
      if (entry.name.startsWith(".") && entry.name !== ".env.example") {
        if (LOCAL_AGENT_MENTION_IGNORE.has(entry.name)) continue;
      }
      if (LOCAL_AGENT_MENTION_IGNORE.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (entry.isDirectory()) {
        if (!query || entry.name.toLowerCase().includes(query) || rel.toLowerCase().includes(query)) {
          files.push({ path: abs, relativePath: rel, name: entry.name, isDirectory: true });
        }
        await walk(abs, depth + 1);
      } else if (entry.isFile()) {
        if (!query || entry.name.toLowerCase().includes(query) || rel.toLowerCase().includes(query)) {
          files.push({ path: abs, relativePath: rel, name: entry.name, isDirectory: false });
        }
      }
    }
  }
  await walk(root, 0);
  files.sort((a, b) => {
    if (query) {
      const aScore = a.name.toLowerCase().startsWith(query) ? 0 : 1;
      const bScore = b.name.toLowerCase().startsWith(query) ? 0 : 1;
      if (aScore !== bScore) return aScore - bScore;
    }
    return a.relativePath.localeCompare(b.relativePath);
  });
  return { files: files.slice(0, limit) };
}

function localAgentAttachmentsDir(workspaceRoot) {
  const root = String(workspaceRoot ?? "").trim();
  const hash = createHash("sha1").update(root || "default").digest("hex").slice(0, 12);
  return path.join(app.getPath("userData"), "local-agent-attachments", hash);
}

async function localAgentComposerSaveAttachment(input = {}) {
  const root = String(input.workspaceRoot ?? "").trim();
  if (!root) throw new Error("workspaceRoot is required");
  const name = String(input.name ?? "attachment").replace(/[^\w.\-]+/g, "_") || "attachment";
  const dataUrl = String(input.dataUrl ?? "");
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("dataUrl must be base64 encoded");
  const buffer = Buffer.from(match[2], "base64");
  const dir = localAgentAttachmentsDir(root);
  await mkdir(dir, { recursive: true });
  const stamp = Date.now().toString(36) + randomBytes(3).toString("hex");
  const finalName = `${stamp}-${name}`;
  const absolute = path.join(dir, finalName);
  await writeFile(absolute, buffer);
  return { path: absolute, relativePath: absolute, name: finalName, size: buffer.length };
}

async function dispatchDesktopCommand(event, command, ...args) {
  switch (command) {
    case "workspaceBootstrap":
      return readWorkspaceState();
    case "personalLocalAgentsList": {
      const result = await personalAgentRuntime.listAgents(args[0] ?? {});
      const agents = Array.isArray(result?.agents) ? result.agents : [];
      return {
        ...result,
        agents: agents.filter((agent) => {
          if (String(agent?.provider ?? "") !== "custom") return true;
          return agent?.enabled !== false;
        }),
      };
    }
    case "personalLocalAgentMetadataList":
      return personalAgentRuntime.listAgentMetadata(args[0] ?? {});
    case "personalLocalAgentAcpAgentsList":
      return personalAgentRuntime.listAcpAgents(args[0] ?? {});
    case "personalLocalAgentAcpAgentsRefresh":
      return personalAgentRuntime.refreshAcpAgents(args[0] ?? {});
    case "personalLocalAgentAcpHealth":
      return personalAgentRuntime.acpHealth(args[0] ?? {});
    case "personalLocalAgentAcpSend":
      return personalAgentRuntime.acpSendMessage(args[0] ?? {});
    case "personalLocalAgentAcpCancel":
      return personalAgentRuntime.acpCancel(args[0] ?? {});
    case "personalLocalAgentAcpResolveApproval":
      return personalAgentRuntime.acpResolveApproval(args[0] ?? {});
    case "personalLocalAgentAcpConfigOptions":
      return personalAgentRuntime.acpConfigOptions(args[0] ?? {});
    case "personalLocalAgentSetAcpConfigOption":
      return personalAgentRuntime.setConfigOption(args[0] ?? {});
    case "personalLocalAgentCreateCustomAgent":
      return personalAgentRuntime.createCustomAgent(args[0] ?? {});
    case "personalLocalAgentDetectAvailableAgents":
      return personalAgentRuntime.detectAvailableLocalAgents(args[0] ?? {});
    case "personalLocalAgentUpdateCustomAgent":
      return personalAgentRuntime.updateCustomAgent(args[0] ?? {});
    case "personalLocalAgentDeleteCustomAgent":
      return personalAgentRuntime.deleteCustomAgent(args[0] ?? {});
    case "personalLocalAgentGetAgentOverrides":
      return personalAgentRuntime.getAgentOverrides(args[0] ?? {});
    case "personalLocalAgentSetAgentOverrides":
      return personalAgentRuntime.setAgentOverrides(args[0] ?? {});
    case "personalLocalAgentExtensionsList":
      return personalAgentRuntime.listExtensions();
    case "personalLocalAgentExtensionSetEnabled":
      return personalAgentRuntime.setExtensionEnabled(args[0] ?? {});
    case "personalLocalAgentAcpProcessesList":
      return personalAgentRuntime.listProcesses(args[0] ?? {});
    case "personalLocalAgentTestConnection":
      return personalAgentRuntime.testConnection(args[0] ?? {});
    case "personalLocalAgentTestCustomAgent":
      return personalAgentRuntime.testCustomAgent(args[0] ?? {});
    case "personalLocalAgentCheckProviderHealth":
      return personalAgentRuntime.checkProviderHealth(args[0] ?? {});
    case "personalLocalAgentCheckManagedAgentHealthById":
      return personalAgentRuntime.checkManagedAgentHealthById(args[0] ?? {});
    case "personalLocalAgentValidate":
      return personalAgentRuntime.validateAgent(args[0] ?? {});
    case "personalLocalAgentStart": {
      // Parity S4 (reverse relay): when Studio sends a message on a
      // conversation that is bound to an IM chat (source:"channel"), mirror
      // the user's prompt back to that chat. relayStudioMessage only acts on
      // conversations actually bound to a channel session, so studio-created
      // conversations are unaffected. IM-originated messages never pass
      // through this IPC handler (the channel service calls the runtime
      // in-process), so there is no echo risk.
      const result = await personalAgentRuntime.startMessage(args[0] ?? {});
      const relayConversationId = result?.conversationId ?? null;
      const relayPrompt = String(args[0]?.prompt ?? "").trim();
      if (relayConversationId && relayPrompt) {
        channelInfrastructureApi.relayStudioMessage(relayConversationId, relayPrompt);
      }
      return result;
    }
    case "personalLocalAgentStatus":
      return personalAgentRuntime.getRun(args[0]);
    case "personalLocalAgentRun": {
      // Same reverse-relay behavior as personalLocalAgentStart for Studio
      // clients that use the run (fire-and-poll) entry point directly.
      const result = await personalAgentRuntime.runMessage(args[0] ?? {});
      const relayConversationId = result?.conversationId ?? null;
      const relayPrompt = String(args[0]?.prompt ?? "").trim();
      if (relayConversationId && relayPrompt) {
        channelInfrastructureApi.relayStudioMessage(relayConversationId, relayPrompt);
      }
      return result;
    }
    case "personalLocalAgentCancel":
      return personalAgentRuntime.cancelRun(args[0]);
    case "personalLocalAgentResolveApproval":
      return personalAgentRuntime.resolveApproval(args[0] ?? {});
    case "personalLocalAgentResetConversation":
      return personalAgentRuntime.resetConversation(args[0] ?? {});
    case "personalLocalAgentConversationsList":
      return personalAgentRuntime.listConversations(args[0] ?? {});
    case "personalLocalAgentConversationGet":
      return personalAgentRuntime.getConversation(args[0] ?? {});
    case "personalLocalAgentConversationGetById":
      return personalAgentRuntime.getConversationById(args[0] ?? {});
    case "personalLocalAgentChannelConversationsList":
      return personalAgentRuntime.listChannelConversations(args[0] ?? {});
    case "personalLocalAgentConversationsListByProvider":
      return personalAgentRuntime.listConversationsByProvider(args[0] ?? {});
    case "personalLocalAgentConversationImportFromArchive":
      return personalAgentRuntime.importConversationFromArchive(args[0] ?? {});
    case "personalLocalAgentConversationCreate":
      return personalAgentRuntime.createConversation(args[0] ?? {});
    case "personalLocalAgentConversationStatus":
      return personalAgentRuntime.getConversationStatus(args[0] ?? {});
    case "personalLocalAgentConversationWarmup":
      return personalAgentRuntime.warmupConversation(args[0] ?? {});
    case "personalLocalAgentProviderSessionsList":
      return personalAgentRuntime.listProviderSessions(args[0] ?? {});
    case "personalLocalAgentProviderSessionLoad":
      return personalAgentRuntime.loadProviderSession(args[0] ?? {});
    case "personalLocalAgentProviderSessionClose":
      return personalAgentRuntime.closeProviderSession(args[0] ?? {});
    case "personalLocalAgentProviderSessionFork":
      return personalAgentRuntime.forkProviderSession(args[0] ?? {});
    case "personalLocalAgentConversationConfirmationsList":
      return personalAgentRuntime.listConversationConfirmations(args[0] ?? {});
    case "personalLocalAgentHostStatus":
      return personalLocalAgentHostStatusWithManagementParity(args[0] ?? {});
    case "personalLocalAgentConversationConfirmationConfirm":
      return personalAgentRuntime.confirmConversationConfirmation(args[0] ?? {});
    case "personalLocalAgentNativeSessionsList":
      return personalAgentNativeSessions.listNativeSessions(args[0] ?? {});
    case "personalLocalAgentConversationTranscript":
      return personalAgentNativeSessions.loadConversationTranscript(args[0] ?? {});
    case "personalLocalAgentHeartbeatsList":
      return personalAgentHeartbeatScheduler.list(args[0] ?? {});
    case "personalLocalAgentHeartbeatCreate":
      return personalAgentHeartbeatScheduler.create(args[0] ?? {});
    case "personalLocalAgentHeartbeatUpdate":
      return personalAgentHeartbeatScheduler.update(args[0] ?? {});
    case "personalLocalAgentHeartbeatDelete":
      return personalAgentHeartbeatScheduler.delete(args[0] ?? {});
    case "personalLocalAgentHeartbeatRunNow":
      return personalAgentHeartbeatScheduler.runNow(args[0] ?? {});
    case "personalLocalAgentHeartbeatRuns":
      return personalAgentHeartbeatScheduler.runs(args[0] ?? {});
    case "localAgentComposerListFiles":
      return localAgentComposerListFiles(args[0] ?? {});
    case "localAgentComposerSaveAttachment":
      return localAgentComposerSaveAttachment(args[0] ?? {});
    case "weixinLoginStart":
      return weixinService.loginStart(args[0] ?? {});
    case "weixinLoginPoll":
      return weixinService.loginPoll(args[0] ?? {});
    case "weixinSaveAccount":
      return weixinService.saveAccount(args[0] ?? {});
    case "weixinAccountStatus":
      return weixinService.accountStatus(args[0] ?? {});
    case "weixinStart":
      return weixinService.start(args[0] ?? {});
    case "weixinAutoStart":
      return weixinService.autoStart(args[0] ?? {});
    case "weixinStop":
      return weixinService.stop();
    case "weixinStatus":
      return weixinService.status();
    case "weixinSimulateInbound":
      return weixinService.simulateInbound(args[0] ?? {});
    case "weixinProbeAccessibleRoot":
      return probeAccessibleRoot(args[0] ?? {});
    case "feishuSaveAccount":
      return feishuService.saveAccount(args[0] ?? {});
    case "feishuAccountStatus":
      return feishuService.accountStatus(args[0] ?? {});
    case "feishuStart":
      return feishuService.start(args[0] ?? {});
    case "feishuAutoStart":
      return feishuService.autoStart(args[0] ?? {});
    case "feishuStop":
      return feishuService.stop();
    case "feishuStatus":
      return feishuService.status();
    case "feishuSimulateInbound":
      return feishuService.simulateInbound(args[0] ?? {});
    case "feishuProbeAccessibleRoot":
      return probeAccessibleRoot(args[0] ?? {});
    case "telegramSaveAccount":
      return telegramService.saveAccount(args[0] ?? {});
    case "telegramAccountStatus":
      return telegramService.accountStatus(args[0] ?? {});
    case "telegramStart":
      return telegramService.start(args[0] ?? {});
    case "telegramAutoStart":
      return telegramService.autoStart(args[0] ?? {});
    case "telegramStop":
      return telegramService.stop();
    case "telegramStatus":
      return telegramService.status();
    case "telegramSimulateInbound":
      return telegramService.simulateInbound(args[0] ?? {});
    case "discordSaveAccount":
      return discordService.saveAccount(args[0] ?? {});
    case "discordAccountStatus":
      return discordService.accountStatus(args[0] ?? {});
    case "discordStart":
      return discordService.start(args[0] ?? {});
    case "discordAutoStart":
      return discordService.autoStart(args[0] ?? {});
    case "discordStop":
      return discordService.stop();
    case "discordStatus":
      return discordService.status();
    case "discordSimulateInbound":
      return discordService.simulateInbound(args[0] ?? {});
    // --- Channel Infrastructure API ---
    case "channelTestPlugin":
      return channelInfrastructureApi.testChannelPlugin(args[0]?.pluginId, args[0] ?? {});
    case "channelGetPendingPairingRequests":
      return channelInfrastructureApi.getPendingPairingRequests();
    case "channelApprovePairing":
      return channelInfrastructureApi.approvePairing(args[0]?.code);
    case "channelDenyPairing":
      return channelInfrastructureApi.denyPairing(args[0]?.code);
    case "channelGetAuthorizedUsers":
      return channelInfrastructureApi.getAuthorizedUsers();
    case "channelIsUserAuthorized":
      return channelInfrastructureApi.isUserAuthorized(args[0]?.platformType, args[0]?.platformUserId);
    case "channelRevokeUserAuthorization":
      return channelInfrastructureApi.revokeUserAuthorization(args[0]?.platformType, args[0]?.platformUserId);
    case "channelGetOrCreateSession":
      return channelInfrastructureApi.getOrCreateSession(args[0] ?? {});
    case "channelGetSession":
      return channelInfrastructureApi.getSession(args[0]?.sessionId);
    case "channelGetSessionsByPlatform":
      return channelInfrastructureApi.getSessionsByPlatform(args[0]?.platformType);
    case "channelGetSessionsByUser":
      return channelInfrastructureApi.getSessionsByUser(args[0]?.platformType, args[0]?.platformUserId);
    case "channelCloseSession":
      return channelInfrastructureApi.closeSession(args[0]?.sessionId);
    case "channelUpdateSessionMetadata":
      return channelInfrastructureApi.updateSessionMetadata(args[0]?.sessionId, args[0]?.metadata);
    case "channelGetEventHistory":
      return channelInfrastructureApi.getChannelEventHistory(args[0]?.limit ?? 100, args[0]?.filterEvent);
    // --- End Channel Infrastructure API ---

    case "agentManagementSnapshot":
      return agentManagementSnapshot(args[0] ?? {});
    case "agentManagementProviderAction":
      return agentManagementProviderAction(args[0] ?? {});
    case "agentManagementFetchModels":
      return agentManagementFetchModels(args[0] ?? {});
    case "agentManagementSkillAction":
      return agentManagementSkillAction(args[0] ?? {});
    case "agentManagementMcpSnapshot":
      return agentManagementMcpSnapshot();
    case "agentManagementMcpAction": {
      const input = args[0] ?? {};
      const action = String(input.action ?? "").trim();
      if (action === "import") return importMcpFromApps(input);
      if (action === "save") return upsertMcpServer(input.server ?? input);
      if (action === "delete") return deleteMcpServerAction(input);
      if (action === "toggle") return toggleMcpServerApp(input);
      throw new Error(`Unsupported MCP action: ${action}`);
    }
    case "workspaceSetSelected":
      return mutateWorkspaceState((state) => {
        const workspaceId = typeof args[0] === "string" ? args[0] : "";
        state.selectedId = workspaceId;
        state.activeId = workspaceId || null;
        return state;
      });
    case "workspaceSetRuntimeActive":
      return mutateWorkspaceState((state) => {
        state.watchedId =
          typeof args[0] === "string" && args[0].trim() ? args[0] : null;
        return state;
      });
    case "workspaceCreate": {
      const input = args[0] ?? {};
      const rawFolderPath = String(input.folderPath ?? "").trim();
      if (!rawFolderPath) throw new Error("folderPath is required");
      const folderPath = await normalizeLocalWorkspacePath(rawFolderPath);
      await mkdir(folderPath, { recursive: true });
      const preset = String(input.preset ?? "starter");
      const workspace = normalizeWorkspaceEntry({
        id: localWorkspaceId(folderPath),
        name: String(input.name ?? (path.basename(folderPath) || "Workspace")),
        displayName: String(
          input.name ?? (path.basename(folderPath) || "Workspace"),
        ),
        path: folderPath,
        preset,
        workspaceType: "local",
      });
      await mkdir(path.join(folderPath, ".opencode"), { recursive: true });
      await ensureDefaultWorkspaceOpencodeConfig(folderPath);
      await writeWorkspaceOnMyAgentConfig(
        folderPath,
        defaultWorkspaceOnMyAgentConfig(folderPath, preset),
      );

      return mutateWorkspaceState((state) => {
        const workspacePathKey = normalizeWorkspacePathKey(workspace.path);
        state.workspaces = state.workspaces.filter(
          (entry) =>
            entry.id !== workspace.id &&
            normalizeWorkspacePathKey(entry.path) !== workspacePathKey,
        );
        state.workspaces.push(workspace);
        state.selectedId = workspace.id;
        state.activeId = workspace.id;
        state.watchedId = workspace.id;
        return state;
      });
    }
    case "workspaceCreateRemote": {
      const input = args[0] ?? {};
      const baseUrl = String(input.baseUrl ?? "").trim();
      if (!baseUrl) throw new Error("baseUrl is required");
      if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
        throw new Error("baseUrl must start with http:// or https://");
      }
      const remoteType =
        input.remoteType === "opencode" ? "opencode" : "onmyagent";
      const directory =
        typeof input.directory === "string" && input.directory.trim()
          ? input.directory.trim()
          : null;
      const rawOnMyAgentHostUrl =
        typeof input.onmyagentHostUrl === "string" &&
        input.onmyagentHostUrl.trim()
          ? input.onmyagentHostUrl.trim()
          : null;
      const onmyagentHostUrl =
        remoteType === "onmyagent"
          ? stripOnMyAgentWorkspaceMount(rawOnMyAgentHostUrl ?? baseUrl)
          : rawOnMyAgentHostUrl;
      const onmyagentWorkspaceId =
        typeof input.onmyagentWorkspaceId === "string" &&
        input.onmyagentWorkspaceId.trim()
          ? input.onmyagentWorkspaceId.trim()
          : remoteType === "onmyagent"
            ? parseOnMyAgentWorkspaceIdFromUrl(rawOnMyAgentHostUrl) ||
              parseOnMyAgentWorkspaceIdFromUrl(baseUrl)
            : null;
      let resolvedOnMyAgentWorkspaceId = onmyagentWorkspaceId;
      let resolvedOnMyAgentWorkspaceName = input.onmyagentWorkspaceName ?? null;
      if (remoteType === "onmyagent" && !resolvedOnMyAgentWorkspaceId) {
        const discovered = await discoverOnMyAgentWorkspace({
          hostUrl: onmyagentHostUrl ?? baseUrl,
          token: input.onmyagentToken,
          hostToken: input.onmyagentHostToken,
          directory,
        });
        if (!discovered?.id) {
          throw new Error(
            directory
              ? `OnMyAgent server has no workspace matching ${directory}.`
              : "OnMyAgent server returned no workspaces.",
          );
        }
        resolvedOnMyAgentWorkspaceId = String(discovered.id).trim();
        resolvedOnMyAgentWorkspaceName =
          onmyagentWorkspaceDisplayName(discovered);
      }
      const id =
        remoteType === "onmyagent"
          ? onmyagentRemoteWorkspaceId(
              onmyagentHostUrl ?? baseUrl,
              resolvedOnMyAgentWorkspaceId,
            )
          : remoteWorkspaceId(baseUrl, directory);
      const workspace = normalizeWorkspaceEntry({
        id,
        name: String(
          input.displayName ??
            resolvedOnMyAgentWorkspaceName ??
            "Remote workspace",
        ),
        displayName: input.displayName ?? null,
        path: directory ?? "",
        preset: "remote",
        workspaceType: "remote",
        remoteType,
        baseUrl:
          remoteType === "onmyagent" ? (onmyagentHostUrl ?? baseUrl) : baseUrl,
        directory,
        onmyagentHostUrl,
        onmyagentToken: input.onmyagentToken ?? null,
        onmyagentClientToken: input.onmyagentClientToken ?? null,
        onmyagentHostToken: input.onmyagentHostToken ?? null,
        onmyagentWorkspaceId: resolvedOnMyAgentWorkspaceId,
        onmyagentWorkspaceName: resolvedOnMyAgentWorkspaceName,
        sandboxBackend: input.sandboxBackend ?? null,
        sandboxRunId: input.sandboxRunId ?? null,
        sandboxContainerName: input.sandboxContainerName ?? null,
      });
      return mutateWorkspaceState((state) => {
        state.workspaces = state.workspaces.filter(
          (entry) => entry.id !== workspace.id,
        );
        state.workspaces.push(workspace);
        state.selectedId = workspace.id;
        state.activeId = workspace.id;
        return state;
      });
    }
    case "workspaceUpdateRemote": {
      const input = args[0] ?? {};
      const workspaceId = String(input.workspaceId ?? "").trim();
      if (!workspaceId) throw new Error("workspaceId is required");
      const { workspaceId: _workspaceId, ...patch } = input;
      return mutateWorkspaceState(async (state) => {
        const existing = state.workspaces.find(
          (entry) => entry.id === workspaceId,
        );
        if (!existing) return state;

        let nextWorkspace = { ...existing, ...patch };
        const nextRemoteType =
          nextWorkspace.remoteType === "opencode" ? "opencode" : "onmyagent";
        if (nextRemoteType === "onmyagent") {
          const rawHostUrl =
            typeof nextWorkspace.onmyagentHostUrl === "string" &&
            nextWorkspace.onmyagentHostUrl.trim()
              ? nextWorkspace.onmyagentHostUrl.trim()
              : null;
          const nextBaseUrl = String(nextWorkspace.baseUrl ?? "").trim();
          const hostUrl = stripOnMyAgentWorkspaceMount(
            rawHostUrl ?? nextBaseUrl,
          );
          const directory =
            typeof nextWorkspace.directory === "string" &&
            nextWorkspace.directory.trim()
              ? nextWorkspace.directory.trim()
              : null;
          const parsedWorkspaceId =
            parseOnMyAgentWorkspaceIdFromUrl(rawHostUrl) ||
            parseOnMyAgentWorkspaceIdFromUrl(nextBaseUrl);
          let remoteWorkspaceId =
            parsedWorkspaceId ||
            (typeof nextWorkspace.onmyagentWorkspaceId === "string" &&
            nextWorkspace.onmyagentWorkspaceId.trim()
              ? nextWorkspace.onmyagentWorkspaceId.trim()
              : null);
          let remoteWorkspaceName = nextWorkspace.onmyagentWorkspaceName ?? null;
          if (!remoteWorkspaceId) {
            const discovered = await discoverOnMyAgentWorkspace({
              hostUrl: hostUrl ?? nextBaseUrl,
              token: nextWorkspace.onmyagentToken,
              hostToken: nextWorkspace.onmyagentHostToken,
              directory,
            });
            if (!discovered?.id) {
              throw new Error(
                directory
                  ? `OnMyAgent server has no workspace matching ${directory}.`
                  : "OnMyAgent server returned no workspaces.",
              );
            }
            remoteWorkspaceId = String(discovered.id).trim();
            remoteWorkspaceName = onmyagentWorkspaceDisplayName(discovered);
          }
          const nextId = onmyagentRemoteWorkspaceId(
            hostUrl ?? nextBaseUrl,
            remoteWorkspaceId,
          );
          nextWorkspace = normalizeWorkspaceEntry({
            ...nextWorkspace,
            id: nextId,
            baseUrl: hostUrl ?? nextBaseUrl,
            onmyagentHostUrl: hostUrl,
            directory,
            remoteType: "onmyagent",
            onmyagentWorkspaceId: remoteWorkspaceId,
            onmyagentWorkspaceName: remoteWorkspaceName,
          });
          if (nextId !== workspaceId) {
            if (state.selectedId === workspaceId) state.selectedId = nextId;
            if (state.activeId === workspaceId) state.activeId = nextId;
            if (state.watchedId === workspaceId) state.watchedId = nextId;
          }
        }

        state.workspaces = state.workspaces.map((entry) =>
          entry.id === workspaceId ? nextWorkspace : entry,
        );
        return state;
      });
    }
    case "workspaceUpdateDisplayName": {
      const input = args[0] ?? {};
      const workspaceId = String(input.workspaceId ?? "").trim();
      if (!workspaceId) throw new Error("workspaceId is required");
      return mutateWorkspaceState((state) => {
        state.workspaces = state.workspaces.map((entry) =>
          entry.id === workspaceId
            ? { ...entry, displayName: input.displayName ?? null }
            : entry,
        );
        return state;
      });
    }
    case "workspaceForget": {
      const workspaceId = String(args[0] ?? "").trim();
      if (!workspaceId) throw new Error("workspaceId is required");
      return mutateWorkspaceState((state) => {
        state.workspaces = state.workspaces.filter(
          (entry) => entry.id !== workspaceId,
        );
        if (state.selectedId === workspaceId) state.selectedId = "";
        if (state.activeId === workspaceId) state.activeId = null;
        if (state.watchedId === workspaceId) state.watchedId = null;
        return state;
      });
    }
    case "workspaceAddAuthorizedRoot": {
      const input = args[0] ?? {};
      const workspacePath = String(input.workspacePath ?? "").trim();
      const authorizedRoot = String(
        input.folderPath ?? input.authorizedRoot ?? "",
      ).trim();
      if (!workspacePath || !authorizedRoot) {
        throw new Error("workspacePath and folderPath are required");
      }
      const config = await readWorkspaceOnMyAgentConfig(workspacePath);
      if (!Array.isArray(config.authorizedRoots)) {
        config.authorizedRoots = [];
      }
      if (!config.authorizedRoots.includes(authorizedRoot)) {
        config.authorizedRoots.push(authorizedRoot);
      }
      return writeWorkspaceOnMyAgentConfig(workspacePath, config);
    }
    case "workspaceOpenworkRead":
    case "workspaceOnMyAgentRead":
      return readWorkspaceOnMyAgentConfig(
        String(args[0]?.workspacePath ?? "").trim(),
      );
    case "workspaceOpenworkWrite":
    case "workspaceOnMyAgentWrite":
      return writeWorkspaceOnMyAgentConfig(
        String(args[0]?.workspacePath ?? "").trim(),
        args[0]?.config ?? defaultWorkspaceOnMyAgentConfig(""),
      );
    case "userAgentRegistryRead": {
      const targetPath = userAgentRegistryPath();
      try {
        const content = await readFile(targetPath, "utf8");
        const fileStat = await stat(targetPath);
        return {
          path: targetPath,
          content,
          bytes: Buffer.byteLength(content, "utf8"),
          updatedAt: fileStat.mtimeMs,
        };
      } catch {
        return null;
      }
    }
    case "userAgentRegistryWrite": {
      const content = String(args[0]?.content ?? "");
      JSON.parse(content);
      const targetPath = userAgentRegistryPath();
      await mkdir(path.dirname(targetPath), { recursive: true });
      const tempPath = `${targetPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
      await writeFile(tempPath, content, "utf8");
      await rename(tempPath, targetPath);
      const fileStat = await stat(targetPath);
      return {
        ok: true,
        path: targetPath,
        bytes: Buffer.byteLength(content, "utf8"),
        updatedAt: fileStat.mtimeMs,
      };
    }
    case "workspaceExportConfig": {
      const input = args[0] ?? {};
      const workspaceId = String(input.workspaceId ?? "").trim();
      const outputPath = String(input.outputPath ?? "").trim();
      if (!workspaceId) throw new Error("workspaceId is required");
      if (!outputPath) throw new Error("outputPath is required");
      const state = await readWorkspaceState();
      const workspace = state.workspaces.find(
        (entry) => entry.id === workspaceId,
      );
      if (!workspace) throw new Error("Unknown workspaceId");
      return exportWorkspaceConfig({ workspace, outputPath });
    }
    case "workspaceImportConfig": {
      const input = args[0] ?? {};
      const archivePath = String(input.archivePath ?? "").trim();
      const targetDirRaw = String(input.targetDir ?? "").trim();
      if (!archivePath) throw new Error("archivePath is required");
      if (!targetDirRaw) throw new Error("targetDir is required");
      const targetDir = await normalizeLocalWorkspacePath(targetDirRaw);
      const imported = await importWorkspaceConfig({
        archivePath,
        targetDir,
        name: input.name ?? null,
      });
      const workspace = normalizeWorkspaceEntry({
        id: localWorkspaceId(targetDir),
        name: imported.workspaceName,
        displayName: null,
        path: targetDir,
        preset: imported.preset,
        workspaceType: "local",
      });
      return mutateWorkspaceState((state) => {
        const workspacePathKey = normalizeWorkspacePathKey(workspace.path);
        state.workspaces = state.workspaces.filter(
          (entry) =>
            entry.id !== workspace.id &&
            normalizeWorkspacePathKey(entry.path) !== workspacePathKey,
        );
        state.workspaces.push(workspace);
        state.selectedId = workspace.id;
        state.activeId = workspace.id;
        state.watchedId = workspace.id;
        return state;
      });
    }
    case "opencodeCommandList":
      return listCommandNames(
        String(args[0]?.scope ?? "").trim(),
        String(args[0]?.projectDir ?? "").trim(),
      );
    case "opencodeCommandWrite":
      return writeCommandFile(
        String(args[0]?.scope ?? "").trim(),
        String(args[0]?.projectDir ?? "").trim(),
        args[0]?.command ?? {},
      );
    case "opencodeCommandDelete":
      return deleteCommandFile(
        String(args[0]?.scope ?? "").trim(),
        String(args[0]?.projectDir ?? "").trim(),
        String(args[0]?.name ?? "").trim(),
      );
    case "engineStart": {
      const projectDir = String(args[0] ?? "").trim();
      const options = args[1] ?? {};
      return runtimeManager.engineStart(projectDir, options);
    }
    case "prepareFreshRuntime":
      return runtimeManager.prepareFreshRuntime();
    case "runtimeBootstrap":
      return ensureRuntimeBootstrap();
    case "runtimeStatus":
      return runtimeManager.runtimeStatus();
    case "engineStop":
      return runtimeManager.engineStop();
    case "engineRestart":
      return runtimeManager.engineRestart(args[0] ?? {});
    case "engineInfo":
      return runtimeManager.engineInfo();
    case "engineDoctor":
      return engineDoctor(args[0]);
    case "engineInstall":
      return runtimeManager.engineInstall();
    case "orchestratorStatus": {
      return runtimeManager.orchestratorStatus();
    }
    case "orchestratorWorkspaceActivate": {
      return runtimeManager.orchestratorWorkspaceActivate(args[0] ?? {});
    }
    case "orchestratorInstanceDispose":
      return runtimeManager.orchestratorInstanceDispose(
        String(args[0] ?? "").trim(),
      );
    case "appBuildInfo":
      return {
        version: app.getVersion(),
        gitSha: process.env.ONMYAGENT_GIT_SHA ?? null,
        buildEpoch: process.env.ONMYAGENT_BUILD_EPOCH ?? null,
        onmyagentDevMode: process.env.ONMYAGENT_DEV_MODE === "1",
      };
    case "getUiControlBridgeInfo":
      try {
        const raw = await readFile(
          path.join(app.getPath("userData"), "onmyagent-ui-control.json"),
          "utf8",
        );
        return JSON.parse(raw);
      } catch {
        return null;
      }
    case "getOpenworkUiMcpCommand":
    case "getOnMyAgentUiMcpCommand": {
      if (process.env.ONMYAGENT_DEV_MODE === "1") {
        return [
          "node",
          path.resolve(
            __dirname,
            "../../..",
            "packages/onmyagent-ui-mcp/index.mjs",
          ),
        ];
      }
      return ["npx", "-y", "onmyagent-ui-mcp"];
    }
    case "getComputerUseMcpCommand": {
      return getComputerUseMcpCommand();
    }
    case "checkComputerUsePermissions": {
      // Spawn --check → fresh TCC read → always accurate.
      return checkComputerUsePermissions();
    }
    case "setComputerUseSkysightEnabled": {
      return setComputerUseSkysightEnabled(args[0]);
    }
    case "setComputerUseSkysightPaused": {
      return setComputerUseSkysightPaused(args[0]);
    }
    case "updateComputerUseSkysightExclusion": {
      return updateComputerUseSkysightExclusion(args[0], args[1], args[2]);
    }
    case "clearComputerUseSkysightData": {
      return clearComputerUseSkysightData();
    }
    case "captureComputerUseAppshot": {
      return captureComputerUseAppshot();
    }
    case "revokeComputerUseAppAuthorization": {
      return revokeComputerUseAppAuthorization(args[0]);
    }
    case "clearComputerUseAppAuthorizations": {
      return clearComputerUseAppAuthorizations();
    }
    case "openComputerUsePermissionSetup": {
      // Open the GUI app. Returns immediately — React shows "verify" CTA.
      await openComputerUseSetupApp();
      // Return a fresh check so the UI shows the current state.
      return checkComputerUsePermissions();
    }
    case "openComputerUsePermissionSettings": {
      // Legacy: open the setup app (same as above).
      await openComputerUseSetupApp();
      return checkComputerUsePermissions();
    }
    case "checkSystemPermissions": {
      const result = checkSystemPermissions();
      console.log("[checkSystemPermissions] result:", JSON.stringify(result.permissions, null, 2));
      return result;
    }
    case "openSystemPermissionSettings": {
      const type = args[0];
      const result = openSystemPermissionSettings(type);
      return result;
    }
    case "getOpenworkUiMcpEnvironment":
    case "getOnMyAgentUiMcpEnvironment": {
      return {
        ONMYAGENT_UI_CONTROL_DISCOVERY: path.join(
          app.getPath("userData"),
          "onmyagent-ui-control.json",
        ),
      };
    }
    case "getDesktopBootstrapConfig":
      return getDesktopBootstrapConfig();
    case "debugDesktopBootstrapConfig":
      return debugDesktopBootstrapConfig();
    case "setDesktopBootstrapConfig":
      return setDesktopBootstrapConfig(args[0] ?? {});
    case "nukeOpenworkAndOpencodeConfigAndExit":
    case "nukeOnMyAgentAndOpencodeConfigAndExit": {
      await rm(app.getPath("userData"), { recursive: true, force: true });
      app.exit(0);
      return undefined;
    }
    case "orchestratorStartDetached": {
      return runtimeManager.orchestratorStartDetached(args[0] ?? {});
    }
    case "sandboxDoctor":
      return runtimeManager.sandboxDoctor();
    case "sandboxStop":
      return runtimeManager.sandboxStop(String(args[0] ?? "").trim());
    case "sandboxCleanupOpenworkContainers":
    case "sandboxCleanupOnMyAgentContainers":
      return runtimeManager.sandboxCleanupOnMyAgentContainers();
    case "sandboxDebugProbe":
      return runtimeManager.sandboxDebugProbe();
    case "onmyagentServerInfo":
      return runtimeManager.onmyagentServerInfo();
    case "onmyagentServerRestart":
      return runtimeManager.onmyagentServerRestart(args[0] ?? {});
    case "pickDirectory": {
      const options = args[0] ?? {};
      /** @type {import("electron").OpenDialogOptions["properties"]} */
      const properties = options.multiple
        ? ["openDirectory", "createDirectory", "multiSelections"]
        : ["openDirectory", "createDirectory"];
      const result = await dialog.showOpenDialog(activeWindowFromEvent(event), {
        title: options.title,
        defaultPath: options.defaultPath,
        properties,
      });
      if (result.canceled) return null;
      return options.multiple
        ? result.filePaths
        : (result.filePaths[0] ?? null);
    }
    case "pickFile": {
      const options = args[0] ?? {};
      /** @type {import("electron").OpenDialogOptions["properties"]} */
      const properties = options.multiple
        ? ["openFile", "multiSelections"]
        : ["openFile"];
      const result = await dialog.showOpenDialog(activeWindowFromEvent(event), {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
        properties,
      });
      if (result.canceled) return null;
      return options.multiple
        ? result.filePaths
        : (result.filePaths[0] ?? null);
    }
    case "saveFile": {
      const options = args[0] ?? {};
      const result = await dialog.showSaveDialog(activeWindowFromEvent(event), {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
      });
      return result.canceled ? null : (result.filePath ?? null);
    }
    case "importSkill": {
      const projectDir = String(args[0] ?? "").trim();
      const sourceDir = String(args[1] ?? "").trim();
      const overwrite = args[2]?.overwrite === true;
      if (!projectDir || !sourceDir) {
        throw new Error("projectDir and sourceDir are required");
      }
      const skillRoot = await ensureProjectSkillRoot(projectDir);
      const name = validateSkillName(path.basename(sourceDir));
      const destination = path.join(skillRoot, name);
      if (await pathExists(destination)) {
        if (!overwrite) {
          return execResult(
            false,
            "",
            `Skill already exists at ${destination}`,
          );
        }
        await rm(destination, { recursive: true, force: true });
      }
      await cp(sourceDir, destination, { recursive: true });
      return execResult(true, `Imported skill to ${destination}`);
    }
    case "installSkillTemplate": {
      const projectDir = String(args[0] ?? "").trim();
      const name = validateSkillName(args[1]);
      const content = String(args[2] ?? "");
      const overwrite = args[3]?.overwrite === true;
      const skillRoot = await ensureProjectSkillRoot(projectDir);
      const destination = path.join(skillRoot, name);
      if (await pathExists(destination)) {
        if (!overwrite) {
          return execResult(
            false,
            "",
            `Skill already exists at ${destination}`,
          );
        }
        await rm(destination, { recursive: true, force: true });
      }
      await mkdir(destination, { recursive: true });
      await writeFile(path.join(destination, "SKILL.md"), content, "utf8");
      return execResult(true, `Installed skill to ${destination}`);
    }
    case "listLocalSkills":
      return listLocalSkills(String(args[0] ?? "").trim());
    case "onmyagentSkillsRoot":
      await mkdir(onmyagentUserSkillsRoot(), { recursive: true });
      return onmyagentUserSkillsRoot();
    case "onmyagentMarketplaceRoot": {
      const marketplace = validateExpertMarketplaceName(args[0]);
      const root = onmyagentMarketplaceRoot(marketplace);
      await mkdir(root, { recursive: true });
      return root;
    }
    case "listExpertPackages": {
      const marketplace = validateExpertMarketplaceName(args[0]);
      await mkdir(onmyagentMarketplaceRoot(marketplace), { recursive: true });
      return listExpertPackages(marketplace);
    }
    case "listExpertRegistryRecords": {
      const marketplace = validateExpertMarketplaceName(args[0]);
      await mkdir(onmyagentMarketplaceRoot(marketplace), { recursive: true });
      return listExpertRegistryRecords(marketplace);
    }
    case "installExpertPackage": {
      const input = args[0] ?? {};
      const source = String(input.source ?? "builtin").trim();
      if (source !== "builtin") throw new Error("Unsupported expert package source");
      const marketplace = validateExpertMarketplaceName(input.marketplace ?? "experts");
      const { safePackage, candidates } = builtinExpertPackageSource(input.packageName);
      const sourceDir = candidates.find((candidate) => existsSync(candidate));
      if (!sourceDir) {
        throw new Error(
          `Built-in expert package not found: ${safePackage}. Checked: ${candidates.join(", ")}`,
        );
      }
      const destinationRoot = onmyagentMarketplaceRoot(marketplace);
      const destination = path.join(destinationRoot, safePackage);
      await mkdir(destinationRoot, { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await copyDirectoryRecursive(sourceDir, destination);
      return { ok: true, path: destination, packageName: safePackage, marketplace };
    }
    case "installBuiltinSkillPackage": {
      const input = args[0] ?? {};
      const source = String(input.source ?? "builtin").trim();
      if (source !== "builtin") throw new Error("Unsupported skill package source");
      const { safePackage, candidates } = builtinSkillPackageSource(input.packageName);
      const safeSkillName = validateSkillName(input.skillName ?? safePackage);
      const sourceDir = candidates.find((candidate) => existsSync(candidate));
      if (!sourceDir) {
        throw new Error(
          `Built-in skill package not found: ${safePackage}. Checked: ${candidates.join(", ")}`,
        );
      }
      const destinationRoot = onmyagentUserSkillsRoot();
      const destination = path.join(destinationRoot, safeSkillName);
      await mkdir(destinationRoot, { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await cp(sourceDir, destination, { recursive: true });
      return { ok: true, path: destination, packageName: safePackage, skillName: safeSkillName };
    }
    case "writeMyExpertPackage": {
      const input = args[0] ?? {};
      const safePackage = validateExpertPackageName(input.packageName ?? input.id);
      const destinationRoot = onmyagentMarketplaceRoot("my-experts");
      const destination = path.join(destinationRoot, safePackage);
      const files = myExpertPackageFiles(input, safePackage);
      await rm(destination, { recursive: true, force: true });
      await mkdir(path.join(destination, ".expert-plugin"), { recursive: true });
      await mkdir(path.join(destination, "agents"), { recursive: true });
      await writeFile(
        path.join(destination, ".expert-plugin", "plugin.json"),
        `${JSON.stringify(files.plugin, null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        path.join(destination, "agents", `${safePackage}.md`),
        files.agentMarkdown,
        "utf8",
      );
      await writeFile(path.join(destination, "README.md"), files.readme, "utf8");
      return { ok: true, path: destination, packageName: safePackage, marketplace: "my-experts" };
    }
    case "readLocalSkill": {
      const projectDir = String(args[0] ?? "").trim();
      const skillPath = await findSkillFile(projectDir, args[1]);
      if (!skillPath) {
        throw new Error("Skill not found");
      }
      return { path: skillPath, content: await readFile(skillPath, "utf8") };
    }
    case "writeLocalSkill": {
      const projectDir = String(args[0] ?? "").trim();
      const skillPath = await findSkillFile(projectDir, args[1]);
      if (!skillPath) {
        return execResult(false, "", "Skill not found");
      }
      if (isBundledSkillPath(skillPath)) {
        return execResult(false, "", "Built-in skills are read-only");
      }
      const content = String(args[2] ?? "");
      const next = content.endsWith("\n") ? content : `${content}\n`;
      await writeFile(skillPath, next, "utf8");
      return execResult(
        true,
        `Saved skill ${path.basename(path.dirname(skillPath))}`,
      );
    }
    case "uninstallSkill": {
      const projectDir = String(args[0] ?? "").trim();
      const skillPath = await findSkillFile(projectDir, args[1]);
      if (!skillPath) {
        return execResult(
          false,
          "",
          "Skill not found in .opencode/skills or .claude/skills",
        );
      }
      if (isBundledSkillPath(skillPath)) {
        return execResult(false, "", "Built-in skills are read-only");
      }
      await rm(path.dirname(skillPath), { recursive: true, force: true });
      return execResult(true, `Removed skill ${args[1]}`);
    }
    case "updaterEnvironment": {
      const executablePath = app.isPackaged
        ? app.getPath("exe")
        : process.execPath;
      return {
        supported: true,
        reason: null,
        executablePath,
        appBundlePath:
          process.platform === "darwin"
            ? path.resolve(executablePath, "../../..")
            : path.dirname(executablePath),
      };
    }
    case "readOpencodeConfig":
      return readOpencodeConfig(
        String(args[0] ?? "").trim(),
        String(args[1] ?? "").trim(),
      );
    case "writeOpencodeConfig":
      return writeOpencodeConfig(
        String(args[0] ?? "").trim(),
        String(args[1] ?? "").trim(),
        String(args[2] ?? ""),
      );
    case "resetOpenworkState":
    case "resetOnMyAgentState": {
      await rm(workspaceStatePath(), { force: true });
      await rm(desktopBootstrapPath(), { force: true });
      return undefined;
    }
    case "resetOpencodeCache":
      return { removed: [], missing: [], errors: [] };
    case "opencodeMcpAuth":
      return runtimeManager.opencodeMcpAuth(
        String(args[0] ?? "").trim(),
        String(args[1] ?? "").trim(),
      );
    case "setWindowDecorations":
      return undefined;
    case "codeWorkspaceOpenTargets":
      return codeWorkspaceActions.codeWorkspaceOpenTargets();
    case "codeWorkspaceEnvironment":
      return codeWorkspaceActions.codeWorkspaceEnvironment(args[0]);
    case "codeWorkspaceOpen":
      return codeWorkspaceActions.openCodeWorkspace(args[0]);
    case "codeWorkspaceTerminalCreate": {
      const workspacePath = await codeWorkspaceActions.resolveCodeWorkspacePath(args[0]);
      if (!workspacePath || !(await isDirectory(workspacePath))) {
        throw new Error("Workspace path is not a directory.");
      }
      return codeTerminalManager.create({ workspacePath });
    }
    case "codeWorkspaceTerminalWrite":
      return codeTerminalManager.write(args[0]);
    case "codeWorkspaceTerminalResize":
      return codeTerminalManager.resize(args[0]);
    case "codeWorkspaceTerminalSnapshot":
      return codeTerminalManager.snapshot(args[0]);
    case "codeWorkspaceTerminalClose":
      return codeTerminalManager.close(args[0]);
    case "codeWorkspaceFilesList":
      return listCodeWorkspaceFiles(args[0]);
    case "codeWorkspaceFileRead":
      return readCodeWorkspaceFile(args[0]);
    case "codeWorkspaceGitSwitchBranch":
      return codeWorkspaceActions.codeWorkspaceGitSwitchBranch(args[0]);
    case "codeWorkspaceGitCommit":
      return codeWorkspaceActions.codeWorkspaceGitCommit(args[0]);
    case "codeWorkspaceGitPush":
      return codeWorkspaceActions.codeWorkspaceGitPush(args[0]);
    case "__openPath": {
      const target = String(args[0] ?? "").trim();
      if (!target) return "Path is required.";
      return shell.openPath(target);
    }
    case "__revealItemInDir": {
      const target = String(args[0] ?? "").trim();
      if (!target) return undefined;
      shell.showItemInFolder(target);
      return undefined;
    }
    case "__fetch": {
      const url = String(args[0] ?? "").trim();
      const init = args[1] ?? {};
      if (!url) throw new Error("URL is required.");
      const timeoutMs = Number(init.timeoutMs);
      const response = await fetch(url, {
        method: typeof init.method === "string" ? init.method : undefined,
        headers:
          init.headers && typeof init.headers === "object"
            ? init.headers
            : undefined,
        body: typeof init.body === "string" ? init.body : undefined,
        signal:
          Number.isFinite(timeoutMs) && timeoutMs > 0
            ? AbortSignal.timeout(timeoutMs)
            : undefined,
      });
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Array.from(response.headers.entries()),
        body: await response.text(),
      };
    }
    case "__homeDir":
      return os.homedir();
    case "__joinPath":
      return path.join(...args.map((value) => String(value ?? "")));
    case "__setZoomFactor": {
      const factor = Number(args[0]);
      const window = activeWindowFromEvent(event);
      if (!window || !Number.isFinite(factor) || factor <= 0) {
        return false;
      }
      window.webContents.setZoomFactor(factor);
      return true;
    }
    case "__setNativeTheme":
      return applyNativeTheme(String(args[0]));
    case "__setApplicationMenuVisible":
      return setApplicationMenuVisible(args[0]);
    case "checkSoftwareEnv": {
      return runtimeManager.softwareEnvironmentInfo();
    }
    case "installSoftwareEnv": {
      const tool = String(args[0] ?? "");
      const requestId = String(args[1] ?? "");
      if (tool === "opencode") {
        const sendProgress = (progress) => {
          if (event.sender.isDestroyed()) return;
          event.sender.send("onmyagent:software-env:progress", {
            requestId,
            tool,
            ...progress,
          });
        };
        try {
          const result = await runtimeManager.engineInstall(sendProgress);
          return {
            ok: result.ok,
            message: result.ok ? undefined : result.stderr,
            version: result.version ?? null,
            path: result.path ?? null,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          sendProgress({
            progress: 90,
            phase: "error",
            message,
          });
          return { ok: false, message };
        }
      }
      return {
        ok: false,
        message: `${tool} is bundled with OnMyAgent and cannot be installed separately.`,
      };
    }
    default:
      throw new Error(
        `Electron desktop bridge method is not implemented yet: ${command}`,
      );
  }
}

async function createMainWindow() {
  if (mainWindow) return mainWindow;

  const preloadPath = path.join(__dirname, "preload.mjs");
  const windowAppearanceOptions = {};
  if (process.platform === "darwin") {
    Object.assign(windowAppearanceOptions, {
      backgroundColor: "#00000001",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 6, y: 12 },
      vibrancy: macosVibrancyForCurrentTheme(),
      visualEffectState: "active",
    });
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    title: APP_NAME,
    show: false,
    ...windowAppearanceOptions,
    ...(APP_ICON_IMAGE && !APP_ICON_IMAGE.isEmpty()
      ? { icon: APP_ICON_IMAGE }
      : {}),
    webPreferences: {
      // The renderer owns session dispatch + event streams; keep it running
      // while hidden/minimized so background tasks are not interrupted.
      backgroundThrottling: false,
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMinimumSize(MAIN_WINDOW_MIN_WIDTH, MAIN_WINDOW_MIN_HEIGHT);
  applyApplicationMenuVisibility(mainWindow);

  if (isDevMode) {
    mainWindow.on("page-title-updated", (event) => {
      event.preventDefault();
      mainWindow?.setTitle(APP_NAME);
    });
    mainWindow.setTitle(APP_NAME);
  }

  mainWindow.once("ready-to-show", () => {
    if (isDevMode) {
      mainWindow?.setTitle(APP_NAME);
    }
    mainWindow?.show();
    if (isDevMode && process.env.ONMYAGENT_OPEN_DEVTOOLS === "1") {
      try {
        mainWindow?.webContents.openDevTools({ mode: "detach" });
      } catch (error) {
        console.warn("[main] openDevTools failed:", error?.message ?? error);
      }
    }
    flushPendingDeepLinks();
  });

  mainWindow.on("closed", () => {
    browserController.destroyBrowserView();
    browserController.setMainWindow(null);
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const local =
      url.startsWith("file://") ||
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("http://localhost");
    if (!local) {
      void browserController.openAllowedExternalUrl(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  const startUrl =
    process.env.ONMYAGENT_ELECTRON_START_URL?.trim() ||
    process.env.ELECTRON_START_URL?.trim();
  try {
    if (startUrl) {
      await mainWindow.loadURL(startUrl);
    } else {
      const packagedIndexPath = path.join(
        process.resourcesPath,
        "app-dist",
        "index.html",
      );
      const devIndexPath = path.resolve(__dirname, "../../app/dist/index.html");
      await mainWindow.loadFile(
        app.isPackaged ? packagedIndexPath : devIndexPath,
      );
    }
  } catch (error) {
    console.warn("[main-window] initial load failed", error);
    await mainWindow.loadURL("about:blank").catch(() => undefined);
  }

  browserController.setMainWindow(mainWindow);
  if (!browserController.hasActiveBrowserTab()) {
    browserController.createBrowserTab("about:blank", { select: true });
  }

  return mainWindow;
}

const handleDesktopInvoke = createDesktopCommandRouter(dispatchDesktopCommand);

const DESKTOP_IPC_CHANNEL = "onmyagent:desktop";
const LEGACY_DESKTOP_IPC_CHANNEL = "open" + "work:desktop";
ipcMain.handle(DESKTOP_IPC_CHANNEL, handleDesktopInvoke);
ipcMain.handle(LEGACY_DESKTOP_IPC_CHANNEL, handleDesktopInvoke);
ipcMain.handle("onmyagent:shell:openExternal", async (_event, url) => {
  return browserController.openAllowedExternalUrl(url);
});
ipcMain.handle("onmyagent:shell:relaunch", async () => {
  app.relaunch();
  app.exit(0);
});
ipcMain.handle("onmyagent:dev:openInEditor", async (_event, request) => {
  if (!isDevMode) {
    return { ok: false, reason: "open-in-editor is only available in development mode." };
  }

  const rawPath = typeof request === "string" ? request : request?.path;
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return { ok: false, reason: "A file path is required." };
  }

  const parsedTarget = parseEditorTarget(rawPath.trim(), request);
  const workspaceRoot = path.resolve(__dirname, "../../..");
  const targetPath = path.isAbsolute(parsedTarget.path)
    ? path.normalize(parsedTarget.path)
    : path.resolve(workspaceRoot, parsedTarget.path);
  const resolvedPath = existsSync(targetPath) ? realpathSync(targetPath) : path.normalize(targetPath);
  const editorCommand = resolveEditorCommand();
  const editorArgs = ["-g", `${resolvedPath}${parsedTarget.line ? `:${parsedTarget.line}${parsedTarget.column ? `:${parsedTarget.column}` : ""}` : ""}`];
  const fallbackCommand = editorCommand ?? "open";
  const fallbackArgs = editorCommand ? editorArgs : [resolvedPath];

  const child = spawn(fallbackCommand, fallbackArgs, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return {
    ok: true,
    path: resolvedPath,
    command: fallbackCommand,
    args: fallbackArgs,
  };
});
ipcMain.handle("onmyagent:system:architecture", async () =>
  resolveArchitectureInfo(),
);

// ── Session Browser IPC ─────────────────────────────────────────────────
ipcMain.handle("onmyagent:browser:show", (_event, bounds) =>
  browserController.attachBrowserView(bounds),
);
ipcMain.handle("onmyagent:browser:hide", () =>
  browserController.hideBrowserView(),
);
ipcMain.handle("onmyagent:browser:navigate", (_event, url, options) =>
  browserController.navigate(url, options),
);
ipcMain.handle("onmyagent:browser:back", () => browserController.goBack());
ipcMain.handle("onmyagent:browser:forward", () =>
  browserController.goForward(),
);
ipcMain.handle("onmyagent:browser:reload", () =>
  browserController.reload(),
);
ipcMain.handle("onmyagent:browser:bounds", (_event, bounds) =>
  browserController.setBounds(bounds),
);
ipcMain.handle("onmyagent:browser:state", () =>
  browserController.browserStatePayload(),
);
ipcMain.handle("onmyagent:browser:diagnostics", () =>
  browserController.diagnostics(),
);
ipcMain.handle("onmyagent:browser:createTab", (_event, url, options) => {
  const sessionId =
    options && typeof options === "object" && typeof options.sessionId === "string"
      ? options.sessionId
      : null;
  const tab = browserController.createBrowserTab(url ?? "about:blank", {
    select: true,
    sessionId,
  });
  return { tabId: tab.tabId, sessionId: tab.sessionId ?? sessionId };
});
ipcMain.handle("onmyagent:browser:closeTab", (_event, tabId) =>
  browserController.closeBrowserTab(tabId == null ? undefined : String(tabId)),
);
ipcMain.handle("onmyagent:browser:closeAllTabs", () =>
  browserController.closeAllBrowserTabs(),
);
ipcMain.handle("onmyagent:browser:selectTab", (_event, tabId) =>
  browserController.selectBrowserTab(String(tabId ?? "")).tabId,
);
ipcMain.handle("onmyagent:browser:reorderTabs", (_event, tabIds) =>
  browserController.reorderBrowserTabs(tabIds),
);
ipcMain.handle("onmyagent:browser:listTabs", () =>
  browserController.listBrowserTabs(),
);
ipcMain.handle("onmyagent:browser:tabContextMenu", (_event, tabId, point) =>
  browserController.showBrowserTabContextMenu(tabId, point),
);
ipcMain.handle("onmyagent:browser:destroy", () =>
  browserController.destroyBrowserView(),
);

registerMigrationIpc({ app, ipcMain });
const { ensureAutoUpdater } = registerUpdaterIpc({
  app,
  ipcMain,
  getMainWindow: () => mainWindow,
  Notification,
  shell,
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("before-quit", (event) => {
    if (runtimeDisposedForQuit) return;
    event.preventDefault();
    codeTerminalManager.dispose();
    void Promise.all([
      disposeRuntimeBeforeQuit(),
      browserController.close(),
      uiControlBridge.stop(),
      Promise.resolve(disposeComputerUseServices()),
    ]).finally(() => app.quit());
  });

  app.on("second-instance", async (_event, argv) => {
    const win = await createMainWindow();
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
    queueDeepLinks(forwardedDeepLinks(argv));
  });

  app.on("open-url", async (event, url) => {
    event.preventDefault();
    await createMainWindow();
    queueDeepLinks([url]);
  });

  app.whenReady().then(async () => {
    await browserController.startRpc({
      runtimeDir: path.join(app.getPath("userData"), "browser-runtime"),
    });
    installMediaPermissionHandlers();
    installApplicationMenu();

    await ensureOnMyAgentUserDataDirs();
    await restoreComputerUseServices().catch((error) => {
      console.warn("[ComputerUse] failed to restore services", error);
    });

    // Use Tauri's existing workspace state file as canonical so rollback and
    // Electron see the same workspace list. Import the short-lived
    // Electron-only filename only when the shared file is missing.
    await migrateLegacyElectronWorkspaceStateIfNeeded();
    await uiControlBridge.start().catch((error) => {
      console.warn("[ui-control] failed to start", error);
    });
    void weixinService.autoStart().catch((error) => {
      console.warn("[weixin] auto start failed", error);
    });
    void feishuService.autoStart().catch((error) => {
      console.warn("[feishu] auto start failed", error);
    });
    // Telegram & Discord were missing from the launch auto-start sequence —
    // only weixin/feishu were auto-started, so every app restart left the
    // Telegram poller dead until the user manually toggled it on in Studio
    // (messages then went unconsumed -> "又不理我了"). autoStart() is a no-op
    // when the config flag is false or no account is configured.
    void telegramService.autoStart().catch((error) => {
      console.warn("[telegram] auto start failed", error);
    });
    void discordService.autoStart().catch((error) => {
      console.warn("[discord] auto start failed", error);
    });

    queueDeepLinks(forwardedDeepLinks(process.argv));
    const win = await createMainWindow();
    watchComputerUseActivity((activity) => {
      if (!mainWindow?.isDestroyed()) {
        mainWindow.webContents.send(COMPUTER_USE_ACTIVITY_EVENT, activity);
      }
    });
    watchComputerUseAppshots((appshot) => {
      if (!mainWindow?.isDestroyed()) {
        mainWindow.webContents.send(COMPUTER_USE_APPSHOT_EVENT, appshot);
      }
    });
    win.webContents.on("did-finish-load", () => {
      flushPendingDeepLinks();
    });

    if (!runtimeBootstrapPromise) {
      runtimeBootstrapPromise = (async () => {
        await runtimeManager.prepareFreshRuntime().catch(() => undefined);
        return bootRuntimeForSelectedWorkspace();
      })().catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }

    // Initialize the packaged updater after the window is up so the user sees
    // a working app first. Renderer-owned checks pass the selected release
    // channel explicitly, avoiding stale stable-feed results for alpha users.
    void ensureAutoUpdater();
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
      return;
    }
    const win = await createMainWindow();
    win.show();
    win.focus();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
