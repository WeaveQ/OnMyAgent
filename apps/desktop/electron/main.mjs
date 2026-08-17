import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
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
  autoUpdater as nativeAutoUpdater,
  BrowserWindow,
  Menu,
  Notification,
  WebContentsView,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerMonitor,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { registerMigrationIpc } from "./migration.mjs";
import { createDesktopPersonalRuntimeServices, createRuntimeManager } from "./runtime.mjs";
import { cleanupRegisteredAgentProcesses } from "./personal-agent-runtime/process-registry.mjs";
import { createTaskSupervisorClient, createSafeRelaunchHandler } from "./task-supervisor/index.mjs";
import { createDesktopTaskLifecycle } from "./desktop-task-lifecycle.mjs";
import { channelEventBus, CHANNEL_EVENTS } from "./channels/index.mjs";
import { createChannelTaskCreateInputResolver, createDeferredMessagingTaskRouter, createTaskBackgroundRuntime, startTaskSupervisorBackground, subscribeTaskBackgroundEvents } from "./task-background-runtime.mjs";
import { registerUpdaterIpc, shouldBypassSafeQuitForUpdate } from "./updater.mjs";
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
import { createStatusItemLifecycle } from "./status-item.mjs";
import { createWindowsJumpListRuntime } from "./windows-jump-list.mjs";
import { createComputerUseDesktopHelpers } from "./computer-use-desktop.mjs";
import {
  getLaunchAtLogin,
  setLaunchAtLogin,
  getKeepSystemAwake,
  setKeepSystemAwake,
  setTaskCenterKeepSystemAwakeActive,
  setDockUnreadBadge,
  getAgentReadySoundPath,
  showDesktopNotification,
  registerAppSnapshotHotkey,
  unregisterAppSnapshotHotkey,
  registerQuickCaptureHotkey,
  unregisterQuickCaptureHotkey,
} from "./desktop-system-prefs.mjs";
import { createQuickCaptureWindowController } from "./quick-capture-window.mjs";
import { createBrowserSkillDesktopHelpers as createBskDesktopHelpers } from "./browser-skill-desktop.mjs";
import { applyLinuxDesktopEnvDefaults, configureDesktopStartupFlags } from "./startup-flags.mjs";
import { probeAccessibleRoot } from "./channel-runtime.mjs";
import { createCodeTerminalManager } from "./code-terminal-manager.mjs";
import {
  listCodeWorkspaceFiles,
  readCodeWorkspaceBinaryFile,
  readCodeWorkspaceFile,
} from "./code-workspace-files.mjs";
import { createAgentManagementProviders } from "./agent-management-providers.mjs";
import { createAgentManagementSkills } from "./agent-management-skills.mjs";
import { createExpertMarketplace } from "./expert-marketplace.mjs";
import {
  createCodeWorkspaceActions,
  openDevFileInEditor,
} from "./code-workspace-actions.mjs";
import { createElectronBrowserController } from "./browser-runtime/electron-browser-controller.mjs";
import { createUiControlServer } from "./ui-control-server.mjs";
import { createDesktopCommandRouter } from "./desktop-command-router.mjs";
import { createAllDesktopDomainHandlers } from "./desktop-handlers/index.mjs";
import { createDesktopPaths } from "./desktop-paths.mjs";
import { createDesktopWindowController } from "./desktop-window.mjs";
import { registerDesktopBrowserIpc } from "./desktop-ipc-browser.mjs";
import { createArtifactPreviewController } from "./artifact-preview-controller.mjs";
import { resolveExpertSessionRuntimeRoot } from "./expert-session-runtime-path.mjs";
import { createDesktopManagedConnectors } from "./desktop-managed-connectors.mjs";
import { registerDesktopArtifactPreviewIpc } from "./desktop-ipc-artifact-preview.mjs";
import { createSkillsScan } from "./skills-scan.mjs";
import {
  hasCompanySession,
  readCompanySettings,
  resolveCompanySkillsInstalledRoot,
} from "./company-client.mjs";
import { createOpencodeWorkspaceFiles } from "./opencode-workspace-files.mjs";
import {
  localWorkspaceId,
  normalizeWorkspacePathKey,
  onmyagentRemoteWorkspaceId,
  parseOnMyAgentWorkspaceIdFromUrl,
  remoteWorkspaceId,
  stableWorkspaceId,
  stripOnMyAgentWorkspaceMount,
  validateSkillName,
  escapeYamlScalar,
} from "./desktop-workspace-ids.mjs";
import {
  defaultWorkspaceOnMyAgentConfig,
  envFlagEnabled,
  execResult,
  forwardedDeepLinks,
  isNonFatalDesktopSpawnError,
  isTransientNetworkError,
  normalizeDesktopBootstrapConfig,
  normalizeWorkspaceEntry,
} from "./desktop-main-helpers.mjs";
import { runDesktopWhenReady } from "./desktop-cold-start.mjs";
import { createDesktopRuntimeBoot } from "./desktop-runtime-boot.mjs";
import { createDesktopWorkspaceStore } from "./desktop-workspace-state.mjs";

// --- Global crash guards (main process) ---
// The desktop app makes HTTPS requests from several places (channel transports
// tunnel through undici's ProxyAgent when HTTPS_PROXY/ALL_PROXY is set, the
// Discord gateway patches `ws`, etc.). A flaky upstream proxy can kill a pooled
// TLS socket mid-handshake ("Client network socket disconnected before secure
// TLS connection was established") with no per-call listener attached, which
// otherwise surfaces as an Uncaught Exception and takes the whole app down.
// These handlers keep the app alive for transient network/TLS blips (log only),
// and only hard-exit for genuinely unexpected errors.

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  if (isTransientNetworkError(error) || isNonFatalDesktopSpawnError(error)) {
    console.warn("[main] unhandledRejection (ignored):", error.message);
    return;
  }
  console.error("[main] unhandledRejection:", error?.stack ?? error);
});

process.on("uncaughtException", (error) => {
  try {
    if (isTransientNetworkError(error) || isNonFatalDesktopSpawnError(error)) {
      console.warn("[main] uncaughtException (kept alive):", error?.message ?? error);
      return;
    }
    console.error("[main] uncaughtException:", error?.stack ?? error);
  } catch {
    // Never let the guard itself crash the process.
  }
  if (isTransientNetworkError(error) || isNonFatalDesktopSpawnError(error)) return;
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
} = createDesktopPaths({ dirname: __dirname, isDevMode });

const computerUseDesktopHelpers = createComputerUseDesktopHelpers({
  app,
  shell,
  dialog,
  systemPreferences,
  desktopCapturer,
  screen,
  dirname: __dirname,
});
const {
  getComputerUseMcpCommand,
  checkComputerUsePermissions,
  setComputerUseMcpEnabled,
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

const { checkBrowserSkillStatus, openBrowserSkillInstallPage } = createBskDesktopHelpers({ shell });
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

applyLinuxDesktopEnvDefaults();
await configureDesktopStartupFlags(app);
const DEFAULT_DEN_BASE_URL = "https://app.onmyagentlabs.com";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:4096";
const FORCE_DESKTOP_REQUIRE_SIGNIN = envFlagEnabled("ONMYAGENT_FORCE_SIGNIN");
const DEFAULT_DESKTOP_REQUIRE_SIGNIN = FORCE_DESKTOP_REQUIRE_SIGNIN;

const EMPTY_WORKSPACE_LIST = Object.freeze({
  selectedId: "",
  watchedId: null,
  activeId: null,
  workspaces: [],
});

const {
  workspaceStatePath,
  migrateLegacyElectronWorkspaceStateIfNeeded,
  pathExists,
  isDirectory,
  getDesktopBootstrapConfig,
  debugDesktopBootstrapConfig,
  setDesktopBootstrapConfig,
  ensureDefaultWorkspaceOpencodeConfig,
  normalizeLocalWorkspacePath,
  discoverOnMyAgentWorkspace,
  readWorkspaceOnMyAgentConfig,
  writeWorkspaceOnMyAgentConfig,
  readWorkspaceState,
  writeWorkspaceState,
} = createDesktopWorkspaceStore({
  app,
  desktopBootstrapPath,
  forceRequireSignin: FORCE_DESKTOP_REQUIRE_SIGNIN,
  defaultDenBaseUrl: DEFAULT_DEN_BASE_URL,
  defaultRequireSignin: DEFAULT_DESKTOP_REQUIRE_SIGNIN,
  emptyWorkspaceList: EMPTY_WORKSPACE_LIST,
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

function applyNativeTheme(mode, overlay) {
  return desktopWindowController.applyNativeTheme(mode, overlay);
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
  setKeymapAcceleratorOverrides,
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

const listLocalWorkspacePaths = async () =>
  (await readWorkspaceState()).workspaces
    .filter((entry) => entry?.workspaceType !== "remote")
    .map((entry) => String(entry?.path ?? "").trim())
    .filter(Boolean);
const artifactPreviewController = createArtifactPreviewController({
  WebContentsView,
  listWorkspaceRoots: listLocalWorkspacePaths,
  listManagedRoots: () => [resolveExpertSessionRuntimeRoot(app.getPath("userData"))],
  openPath: (filePath) => shell.openPath(filePath),
  preloadPath: path.join(__dirname, "artifact-preview-preload.cjs"),
});

/** Last known labels for the quick-capture context strip (set from renderer). */
let quickCaptureContext = {
  workspaceLabel: "",
  modelLabel: "",
  selectedProviderID: "",
  selectedModelID: "",
  /** @type {"light" | "dark"} */
  theme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
  models: /** @type {Array<{ providerID: string; modelID: string; title: string; disabled?: boolean }>} */ (
    []
  ),
};

const quickCapture = createQuickCaptureWindowController({
  BrowserWindow,
  getMainWindow: () => mainWindow,
  createMainWindow,
  getCaptureContext: () => quickCaptureContext,
  preloadPath: path.join(__dirname, "quick-capture-preload.cjs"),
  htmlPath: path.join(__dirname, "../resources/quick-capture/index.html"),
});

const statusItem = createStatusItemLifecycle({
  app, Tray, Menu, nativeImage, createMainWindow,
  getMainWindow: () => mainWindow, quitApp: () => app.quit(),
  nativeAutoUpdater,
  openDesktopPermissions: () => openComputerUseSetupApp(),
  openQuickCapture: () => quickCapture.show(),
  appIconPath: APP_ICON_PATH, // trayTemplate / trayIcon sit beside brand icon
});
const windowsJumpList = createWindowsJumpListRuntime({ app, program: process.execPath, appIconPath: APP_ICON_PATH, statusItem, createMainWindow });
desktopWindowController = createDesktopWindowController({
  getMainWindow: () => mainWindow, setMainWindow: (win) => { mainWindow = win; },
  app, nativeTheme, session, appName: APP_NAME, isDevMode,
  minWidth: MAIN_WINDOW_MIN_WIDTH, minHeight: MAIN_WINDOW_MIN_HEIGHT,
  appIconImage: APP_ICON_IMAGE, dirname: __dirname,
  applyApplicationMenuVisibility, browserController, artifactPreviewController,
  flushPendingDeepLinks, shouldHideOnClose: () => statusItem.shouldHideOnClose(),
});

const uiControlBridge = createUiControlServer({
  app,
  appName: APP_NAME,
  appIdentifier: APP_IDENTIFIER,
  createMainWindow,
});
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
  agentManagementTestModel,
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


// In-process onmyagent-server (session-archive, etc.) must see the real user
// home even after OpenCode sandbox rewrites process.env.HOME.
if (!process.env.ONMYAGENT_REAL_HOME?.trim()) {
  process.env.ONMYAGENT_REAL_HOME = getRealHomeDir();
}

const runtimeManager = createRuntimeManager({
  app,
  desktopRoot: path.resolve(__dirname, ".."),
  runtimeEnvironment: () => browserController.browserEnvironment(),
  listLocalWorkspacePaths,
  homeDir: getRealHomeDir(),
});

const deferredMessagingTasks = createDeferredMessagingTaskRouter();

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
  channelInfrastructure,
} = createDesktopPersonalRuntimeServices({
  app,
  runtimeManager,
  readWorkspaceState,
  claudeProjectsRoot,
  taskMessageRouter: deferredMessagingTasks.route,
});

const taskOrchestrator = createTaskSupervisorClient({
  userDataDir: app.getPath("userData"),
});
const messagingTaskRuntimePromise = createTaskBackgroundRuntime({
  userDataDir: app.getPath("userData"),
  taskClient: taskOrchestrator,
  resolveCreateInput: createChannelTaskCreateInputResolver({ readWorkspaceState, personalAgentRuntime }),
  deliver: (input) => channelInfrastructure.deliverTaskMessage(input),
});
deferredMessagingTasks.setRuntimePromise(messagingTaskRuntimePromise);
const taskBackgroundEvents = subscribeTaskBackgroundEvents({
  taskClient: taskOrchestrator, runtimePromise: messagingTaskRuntimePromise,
  getMainWindow: () => mainWindow, Notification, setDockUnreadBadge,
  setKeepAwakeActive: setTaskCenterKeepSystemAwakeActive,
});

const {
  listCommandNames,
  writeCommandFile,
  deleteCommandFile,
  readOpencodeConfig,
  writeOpencodeConfig,
} = createOpencodeWorkspaceFiles({
  globalOpencodeRoot,
  pathExists,
  isDirectory,
});

const {
  listLocalSkills,
  listBuiltinSkillCatalog,
  ensureDefaultBuiltinSkillsOnce,
  findSkillFile,
  ensureProjectSkillRoot,
  invalidateGlobalSkillRootsCache,
} = createSkillsScan({
  getRealHomeDir,
  onmyagentUserSkillsRoot,
  legacyOnmyagentUserSkillsRoot,
  globalOpencodeRoot,
  bundledSkillsRootPath,
  companySkillsRoot: () => {
    try {
      const home = getRealHomeDir();
      const settings = readCompanySettings(home);
      if (!hasCompanySession(settings)) return null;
      return resolveCompanySkillsInstalledRoot(home);
    } catch {
      return null;
    }
  },
  packageSourceCandidates: (packageName) => {
    const { candidates } = builtinSkillPackageSource(packageName);
    return candidates;
  },
  refreshSkillLinks: () => runtimeManager.refreshSkillLinks(),
});

async function refreshRuntimeSkillLinks() {
  invalidateGlobalSkillRootsCache();
  return runtimeManager.refreshSkillLinks();
}

const {
  officeCliManager,
  larkCliManager,
  larkCliAuth,
  tencentDocsConnector,
  baiduDriveConnector,
  kdocsConnector,
  dingtalkConnector,
  wecomConnector,
  tencentMeetingConnector,
} = createDesktopManagedConnectors({
  getRealHomeDir,
  refreshSkillLinks: refreshRuntimeSkillLinks,
  getMainWindow: () => mainWindow,
  shell,
  runtimeManager,
  globalOpencodeRoot,
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

const desktopRuntimeBoot = createDesktopRuntimeBoot({
  readWorkspaceState,
  writeWorkspaceState,
  runtimeManager,
});
const {
  bootRuntimeForSelectedWorkspace,
  ensureRuntimeBootstrap,
  hasRuntimeBootstrap,
  setRuntimeBootstrap,
} = desktopRuntimeBoot;
let safeQuitPromise = null;
const desktopTaskLifecycle = createDesktopTaskLifecycle({
  taskOrchestrator,
  personalAgentRuntime,
  heartbeatScheduler: personalAgentHeartbeatScheduler,
  channelInfrastructure,
  runtimeManager,
  cleanupRegisteredProcesses: cleanupRegisteredAgentProcesses,
  getMessagingRuntime: () => messagingTaskRuntimePromise,
  unsubscribeTaskEvents: taskBackgroundEvents.unsubscribe,
});
const taskLifecycle = desktopTaskLifecycle.coordinator;
const disposeRuntimeBeforeQuit = desktopTaskLifecycle.disposeBeforeQuit;

const safeRelaunch = createSafeRelaunchHandler({
  pauseAllAndDrain: (reason) => disposeRuntimeBeforeQuit(reason),
  relaunch: () => app.relaunch(),
  exit: (code) => app.exit(code),
});

async function mutateWorkspaceState(mutator) {
  const current = await readWorkspaceState();
  const next = await mutator({
    ...current,
    workspaces: [...current.workspaces],
  });
  return writeWorkspaceState(next);
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
  taskOrchestrator,
  taskLifecycle,
  scanAgentManagementSkills,
  app,
  // agent management
  personalAgentLegacyHarness,
  agentManagementProviderAction,
  agentManagementFetchModels,
  agentManagementTestModel,
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
  readCodeWorkspaceBinaryFile,
  readCodeWorkspaceFile,
  // runtime
  runtimeManager,
  ensureRuntimeBootstrap,
  engineDoctor,
  readFile,
  realpath,
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
  listBuiltinSkillCatalog,
  ensureDefaultBuiltinSkills: ensureDefaultBuiltinSkillsOnce,
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
  refreshRuntimeSkillLinks,
  expertDeleteJournalPath: path.join(app.getPath("userData"), "expert-package-delete-operations.json"),
  officeCliManager,
  larkCliManager,
  larkCliAuth,
  tencentDocsConnector,
  baiduDriveConnector,
  kdocsConnector,
  dingtalkConnector,
  wecomConnector,
  tencentMeetingConnector,
  // system
  userAgentRegistryPath,
  getRealHomeDir,
  stat,
  rename,
  randomBytes,
  getComputerUseMcpCommand,
  checkComputerUsePermissions,
  setComputerUseMcpEnabled,
  setComputerUseSkysightEnabled,
  setComputerUseSkysightPaused,
  updateComputerUseSkysightExclusion,
  clearComputerUseSkysightData,
  captureComputerUseAppshot,
  revokeComputerUseAppAuthorization,
  clearComputerUseAppAuthorizations,
  openComputerUseSetupApp,
  checkBrowserSkillStatus,
  openBrowserSkillInstallPage,
  checkSystemPermissions,
  openSystemPermissionSettings,
  getLaunchAtLogin,
  setLaunchAtLogin,
  getKeepSystemAwake,
  setKeepSystemAwake,
  setDockUnreadBadge,
  setStatusItemVisible: (v) => statusItem.setVisible(v),
  getStatusItemVisible: () => ({ visible: statusItem.isVisible(), platform: process.platform }),
  getAgentReadySoundPath,
  showDesktopNotification,
  registerAppSnapshotHotkey,
  unregisterAppSnapshotHotkey,
  registerQuickCaptureHotkey,
  unregisterQuickCaptureHotkey,
  getDesktopBootstrapConfig,
  debugDesktopBootstrapConfig,
  setDesktopBootstrapConfig,
  dialog,
  activeWindowFromEvent,
  shell,
  os,
  applyNativeTheme,
  setApplicationMenuVisible,
  setKeymapAcceleratorOverrides: (overrides) => {
    const result =
      applicationMenuController.setKeymapAcceleratorOverrides(overrides);
    try {
      statusItem.setKeymapAcceleratorOverrides?.(overrides);
    } catch {
      // tray may not be installed yet
    }
    return result;
  },
  BrowserWindow,
  setQuickCaptureContext: (next) => {
    const models = Array.isArray(next?.models)
      ? next.models
          .map((entry) => ({
            providerID: String(entry?.providerID ?? "").trim(),
            modelID: String(entry?.modelID ?? "").trim(),
            title: String(entry?.title ?? entry?.modelID ?? "").trim(),
            disabled: entry?.disabled === true,
          }))
          .filter((entry) => entry.providerID && entry.modelID)
      : [];
    const themeRaw = String(next?.theme ?? "").trim();
    const theme =
      themeRaw === "light" || themeRaw === "dark"
        ? themeRaw
        : nativeTheme.shouldUseDarkColors
          ? "dark"
          : "light";
    quickCaptureContext = {
      workspaceLabel: String(next?.workspaceLabel ?? "").trim(),
      modelLabel: String(next?.modelLabel ?? "").trim(),
      selectedProviderID: String(next?.selectedProviderID ?? "").trim(),
      selectedModelID: String(next?.selectedModelID ?? "").trim(),
      theme,
      models,
    };
    // Keep an open panel in sync (theme / model list) without reopening.
    try {
      if (quickCapture?.isVisible?.()) {
        const win =
          typeof quickCapture.ensureWindow === "function"
            ? quickCapture.ensureWindow()
            : null;
        win?.webContents?.send?.("onmyagent:quick-capture:context", quickCaptureContext);
      }
    } catch {
      // ignore
    }
    return { ok: true, ...quickCaptureContext };
  },
  toggleQuickCapture: () => quickCapture.toggle(),
  onQuickCaptureHotkey: () => {
    void quickCapture.toggle();
  },
  onAppSnapshotHotkey: async () => {
    // Capture in main (desktopCapturer) and deliver payload so Composer attaches
    // even when the window is not focused (globalShortcut path).
    try {
      const payload = await captureComputerUseAppshot();
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        try {
          win.webContents.send(COMPUTER_USE_APPSHOT_EVENT, payload);
        } catch {
          // ignore
        }
      }
    } catch (error) {
      console.warn(
        "[app-snapshot-hotkey] capture failed",
        error instanceof Error ? error.message : error,
      );
    }
  },
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
ipcMain.handle(DESKTOP_IPC_CHANNEL, handleDesktopInvoke);
ipcMain.handle("quick-capture:get-context", async () => quickCaptureContext);
ipcMain.handle("quick-capture:submit", async (_event, payload) =>
  quickCapture.submit(payload ?? {}),
);
ipcMain.handle("quick-capture:close", async () => {
  quickCapture.hide();
  return { ok: true };
});
ipcMain.handle("onmyagent:shell:openExternal", async (_event, url) => {
  return browserController.openAllowedExternalUrl(url);
});
ipcMain.handle("onmyagent:shell:relaunch", async () => safeRelaunch("explicit_relaunch"));
ipcMain.handle("onmyagent:shell:quit", async () => {
  app.quit();
});
ipcMain.handle("onmyagent:dev:openInEditor", async (_event, request) => {
  if (!isDevMode) {
    return { ok: false, reason: "open-in-editor is only available in development mode." };
  }
  return openDevFileInEditor({
    request,
    workspaceRoot: path.resolve(__dirname, "../../.."),
    openPath: (target) => shell.openPath(target),
  });
});
ipcMain.handle("onmyagent:system:architecture", async () =>
  resolveArchitectureInfo(),
);

registerDesktopBrowserIpc({ ipcMain, browserController });
registerDesktopArtifactPreviewIpc({ ipcMain, artifactPreviewController });

registerMigrationIpc({ app, ipcMain });
const { ensureAutoUpdater } = registerUpdaterIpc({
  app,
  ipcMain,
  getMainWindow: () => mainWindow,
  Notification,
  shell,
});

if (!app.requestSingleInstanceLock()) {
  // Second launch on Windows looks like a "flash quit" to the user: this
  // process exits immediately while the existing instance is focused via
  // the second-instance handler below.
  console.info("[main] another OnMyAgent instance is already running; exiting this process");
  app.quit();
} else {
  app.on("before-quit", (event) => {
    statusItem.markQuitting();
    if (desktopTaskLifecycle.isDisposed() || shouldBypassSafeQuitForUpdate(disposeRuntimeBeforeQuit)) return;
    event.preventDefault();
    if (safeQuitPromise) return;
    safeQuitPromise = (async () => {
      // The durable owner must checkpoint and pause first. Do not partially
      // dispose the still-running desktop when that safety boundary fails.
      await disposeRuntimeBeforeQuit();
      codeTerminalManager.dispose();
      await Promise.all([
        browserController.close(),
        Promise.resolve(artifactPreviewController.destroy()),
        uiControlBridge.stop(),
        Promise.resolve(disposeComputerUseServices()),
      ]);
      statusItem.dispose();
      app.quit();
    })().catch((error) => {
      // Keep the window/app alive when the durable Supervisor could not pause;
      // restore normal window/tray behavior so the next explicit Quit retries.
      statusItem.cancelQuitting();
      console.error("[main] safe Task Supervisor shutdown failed:", error);
    }).finally(() => {
      safeQuitPromise = null;
    });
  });

  app.on("second-instance", async (_event, argv) => {
    const win = await createMainWindow();
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    // Windows focus is unreliable without a brief always-on-top bump.
    if (process.platform === "win32") {
      win.setAlwaysOnTop(true);
      win.show();
      win.focus();
      win.moveTop();
      setTimeout(() => {
        if (!win.isDestroyed()) win.setAlwaysOnTop(false);
      }, 200);
    } else {
      win.show();
      win.focus();
    }
    queueDeepLinks(forwardedDeepLinks(argv));
    void windowsJumpList.consumeArgv(argv);
  });

  app.on("open-url", async (event, url) => {
    event.preventDefault();
    await createMainWindow();
    queueDeepLinks([url]);
  });

  app.whenReady().then(async () => {
    // Cold-start order: open main window before deferred channel autoStart /
    // Computer Use restore. Runtime bootstrap does not double-call
    // prepareFreshRuntime (engineStart cleans once). See desktop-cold-start.mjs.
    await runDesktopWhenReady({
      startBrowserRpc: () =>
        browserController.startRpc({
          runtimeDir: path.join(app.getPath("userData"), "browser-runtime"),
        }),
      installMediaPermissionHandlers,
      installApplicationMenu,
      installStatusItem: () => windowsJumpList.install(),
      ensureUserDataDirs: () => ensureOnMyAgentUserDataDirs(),
      // Use Tauri's existing workspace state file as canonical so rollback and
      // Electron see the same workspace list. Import the short-lived
      // Electron-only filename only when the shared file is missing.
      migrateLegacyWorkspaceState: () => migrateLegacyElectronWorkspaceStateIfNeeded(),
      createMainWindow,
      restoreComputerUseServices: () => restoreComputerUseServices(),
      startUiControl: () => uiControlBridge.start(),
      startTaskSupervisor: async () => {
        await startTaskSupervisorBackground({ runtimeBootstrap: desktopRuntimeBoot.getRuntimeBootstrapPromise(),
          taskClient: taskOrchestrator, powerMonitor, refreshKeepAwake: taskBackgroundEvents.refreshKeepAwake });
      },
      // Channel autoStart is a no-op when disabled / no account. Deferred so it
      // does not block first paint (Telegram/Discord must still auto-start when
      // configured — previously missing from launch and left pollers dead).
      channelAutoStarts: [
        () => weixinService.autoStart(),
        () => feishuService.autoStart(),
        () => telegramService.autoStart(),
        () => discordService.autoStart(),
      ],
      queueDeepLinks: () => { queueDeepLinks(forwardedDeepLinks(process.argv)); void windowsJumpList.consumeArgv(process.argv); },
      watchComputerUseActivity,
      watchComputerUseAppshots,
      onComputerUseActivity: (activity) => {
        if (!mainWindow?.isDestroyed()) {
          mainWindow.webContents.send(COMPUTER_USE_ACTIVITY_EVENT, activity);
        }
      },
      onComputerUseAppshot: (appshot) => {
        if (!mainWindow?.isDestroyed()) {
          mainWindow.webContents.send(COMPUTER_USE_APPSHOT_EVENT, appshot);
        }
      },
      flushPendingDeepLinks,
      hasRuntimeBootstrap,
      setRuntimeBootstrap,
      bootRuntimeForSelectedWorkspace,
      // Packaged updater after the window path has started. Renderer-owned
      // checks pass the selected release channel explicitly.
      ensureAutoUpdater: () => {
        void ensureAutoUpdater();
      },
      onDeferredError: (error, label) => {
        console.warn(`[${label}] deferred start failed`, error);
      },
    });

    // Refresh the optional OfficeCLI release pointer after the first window is
    // ready. A cached pointer makes the marketplace card instant; this
    // background check makes a later OSS version visible as “Update” without
    // requiring a renderer reload or a manual command.
    void officeCliManager.checkForUpdates(false);
    void larkCliManager.checkForUpdates(false);
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
    if (statusItem.shouldQuitOnLastWindow()) app.quit();
  });
}
