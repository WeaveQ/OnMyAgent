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
  parseJsonLikeObject,
  looksLikeIncompleteJson,
  readJsonLikeFile,
  readJsonFile,
  parseFirstJsonObject,
  writeJsonFileAtomic,
} from "./desktop-json.mjs";
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
import { createAllDesktopDomainHandlers } from "./desktop-handlers/index.mjs";
import { createDesktopPaths } from "./desktop-paths.mjs";
import { createDesktopWindowController } from "./desktop-window.mjs";
import { registerDesktopBrowserIpc } from "./desktop-ipc-browser.mjs";

// --- Global crash guards (main process) ---
// The desktop app makes HTTPS requests from several places (channel transports
// tunnel through undici's ProxyAgent when HTTPS_PROXY/ALL_PROXY is set, the
// Discord gateway patches `ws`, etc.). A flaky upstream proxy can kill a pooled
// TLS socket mid-handshake ("Client network socket disconnected before secure
// TLS connection was established") with no per-call listener attached, which
// otherwise surfaces as an Uncaught Exception and takes the whole app down.
// These handlers keep the app alive for transient network/TLS blips (log only),
// and only hard-exit for genuinely unexpected errors.
function isTransientNetworkError(error) {
  if (!error) return false;
  const message = String(error.message ?? "");
  const code = String(error.code ?? error.cause?.code ?? "");
  return (
    /client network socket disconnected|secure tls connection|socket hang up|econnreset|etimedout|enotfound|econnrefused|und_err|proxy/i.test(
      message
    ) ||
    /^(ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|UND_ERR)$/i.test(code)
  );
}

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  if (isTransientNetworkError(error)) {
    console.warn("[main] unhandledRejection (network, ignored):", error.message);
    return;
  }
  console.error("[main] unhandledRejection:", error?.stack ?? error);
});

process.on("uncaughtException", (error) => {
  try {
    if (isTransientNetworkError(error)) {
      console.warn("[main] uncaughtException (network, kept alive):", error?.message ?? error);
      return;
    }
    console.error("[main] uncaughtException:", error?.stack ?? error);
  } catch {
    // Never let the guard itself crash the process.
  }
  if (isTransientNetworkError(error)) return;
  // Non-transient: let the app terminate rather than run in a corrupted state.
  try {
    if (typeof app?.exit === "function") app.exit(1);
    else process.exit(1);
  } catch {
    process.exit(1);
  }
});

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
const {
  getRealHomeDir,
  claudeProjectsRoot,
  bundledSkillsRootPath,
  marketplaceRootPath,
  ensureOnMyAgentUserDataDirs,
  desktopBootstrapPath,
  userAgentRegistryPath,
  onmyagentUserSkillsRoot,
  legacyOnmyagentUserSkillsRoot,
  configHomePath,
  globalOpencodeRoot,
  resolveAppIconPath,
  isBundledSkillPath,
  ONMYAGENT_USER_SKILLS_DIR_SUBPATH,
  ONMYAGENT_LEGACY_USER_SKILLS_DIR_SUBPATH,
} = createDesktopPaths({ dirname: __dirname, isDevMode });

function workspaceStatePath() {
  return path.join(app.getPath("userData"), "onmyagent-workspaces.json");
}

function legacyElectronWorkspaceStatePath() {
  return path.join(app.getPath("userData"), "workspace-state.json");
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


/** Populated after browserController is created (menu/ui-control call at runtime). */
let desktopWindowController = null;

async function createMainWindow() {
  return desktopWindowController.createMainWindow();
}

function applyNativeTheme(mode) {
  return desktopWindowController.applyNativeTheme(mode);
}

function activeWindowFromEvent(event) {
  return desktopWindowController.activeWindowFromEvent(event);
}

function installMediaPermissionHandlers() {
  return desktopWindowController.installMediaPermissionHandlers();
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

desktopWindowController = createDesktopWindowController({
  getMainWindow: () => mainWindow,
  setMainWindow: (win) => {
    mainWindow = win;
  },
  app,
  nativeTheme,
  session,
  appName: APP_NAME,
  isDevMode,
  minWidth: MAIN_WINDOW_MIN_WIDTH,
  minHeight: MAIN_WINDOW_MIN_HEIGHT,
  appIconImage: APP_ICON_IMAGE,
  dirname: __dirname,
  applyApplicationMenuVisibility,
  browserController,
  flushPendingDeepLinks,
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
  // Curated skills (expert-manager, skill-creator, …) live under
  // resources/bundled-skills. Marketplace hub skills use
  // resources/marketplace/skills/skills/<packageName>.
  const bundledRoot = bundledSkillsRootPath();
  const candidates = [
    ...(bundledRoot ? [path.join(bundledRoot, safePackage)] : []),
    ...(marketplaceRoot
      ? [path.join(marketplaceRoot, "skills", "skills", safePackage)]
      : []),
    path.join(workspaceRoot, "apps/desktop/resources/bundled-skills", safePackage),
    path.join(workspaceRoot, "apps/desktop/resources/marketplace/skills/skills", safePackage),
    path.join(app.getAppPath(), "apps/desktop/resources/bundled-skills", safePackage),
    path.join(app.getAppPath(), "apps/desktop/resources/marketplace/skills/skills", safePackage),
    path.join(process.cwd(), "apps/desktop/resources/bundled-skills", safePackage),
    path.join(process.cwd(), "apps/desktop/resources/marketplace/skills/skills", safePackage),
  ];
  return { safePackage, candidates };
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

const desktopCommandHandlers = createAllDesktopDomainHandlers({
  // messaging
  weixinService,
  feishuService,
  telegramService,
  discordService,
  channelInfrastructureApi,
  probeAccessibleRoot,
  // local agents
  personalAgentRuntime,
  personalAgentNativeSessions,
  personalAgentHeartbeatScheduler,
  scanAgentManagementSkills,
  app,
  // agent management
  personalAgentLegacyHarness,
  agentManagementProviderAction,
  agentManagementFetchModels,
  agentManagementSkillAction,
  readAgentManagementProvidersSnapshot,
  // workspace
  readWorkspaceState,
  mutateWorkspaceState,
  normalizeLocalWorkspacePath,
  normalizeWorkspaceEntry,
  localWorkspaceId,
  normalizeWorkspacePathKey,
  ensureDefaultWorkspaceOpencodeConfig,
  writeWorkspaceOnMyAgentConfig,
  defaultWorkspaceOnMyAgentConfig,
  mkdir,
  path,
  stripOnMyAgentWorkspaceMount,
  parseOnMyAgentWorkspaceIdFromUrl,
  discoverOnMyAgentWorkspace,
  onmyagentWorkspaceDisplayName,
  onmyagentRemoteWorkspaceId,
  remoteWorkspaceId,
  readWorkspaceOnMyAgentConfig,
  exportWorkspaceConfig,
  importWorkspaceConfig,
  codeWorkspaceActions,
  codeTerminalManager,
  isDirectory,
  listCodeWorkspaceFiles,
  readCodeWorkspaceFile,
  // runtime
  runtimeManager,
  ensureRuntimeBootstrap,
  engineDoctor,
  readFile,
  rm,
  __dirname,
  workspaceStatePath,
  desktopBootstrapPath,
  // opencode
  listCommandNames,
  writeCommandFile,
  deleteCommandFile,
  readOpencodeConfig,
  writeOpencodeConfig,
  // skills
  ensureProjectSkillRoot,
  validateSkillName,
  pathExists,
  execResult,
  cp,
  writeFile,
  listLocalSkills,
  onmyagentUserSkillsRoot,
  validateExpertMarketplaceName,
  onmyagentMarketplaceRoot,
  listExpertPackages,
  listExpertRegistryRecords,
  builtinExpertPackageSource,
  existsSync,
  copyDirectoryRecursive,
  builtinSkillPackageSource,
  validateExpertPackageName,
  myExpertPackageFiles,
  findSkillFile,
  isBundledSkillPath,
  // system
  userAgentRegistryPath,
  stat,
  rename,
  randomBytes,
  getComputerUseMcpCommand,
  checkComputerUsePermissions,
  setComputerUseSkysightEnabled,
  setComputerUseSkysightPaused,
  updateComputerUseSkysightExclusion,
  clearComputerUseSkysightData,
  captureComputerUseAppshot,
  revokeComputerUseAppAuthorization,
  clearComputerUseAppAuthorizations,
  openComputerUseSetupApp,
  checkSystemPermissions,
  openSystemPermissionSettings,
  getDesktopBootstrapConfig,
  debugDesktopBootstrapConfig,
  setDesktopBootstrapConfig,
  dialog,
  activeWindowFromEvent,
  shell,
  os,
  applyNativeTheme,
  setApplicationMenuVisible,
});

async function dispatchDesktopCommand(event, command, ...args) {
  const handler = desktopCommandHandlers[command];
  if (!handler) {
    throw new Error(`Electron desktop bridge method is not implemented yet: ${command}`);
  }
  return handler(event, args);
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

registerDesktopBrowserIpc({ ipcMain, browserController });

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
