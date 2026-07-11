import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import net from "node:net";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import {
  cp,
  mkdir,
  lstat,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink as fsSymlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  Menu,
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
import {
  createCodeWorkspaceActions,
  parseEditorTarget,
  resolveEditorCommand,
} from "./code-workspace-actions.mjs";
import { createEmbeddedBrowserPanel } from "./embedded-browser-panel.mjs";
import { createUiControlServer } from "./ui-control-server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NATIVE_DEEP_LINK_EVENT = "onmyagent:deep-link-native";
const NATIVE_MENU_OPEN_SETTINGS_EVENT = "onmyagent:native-menu:open-settings";
const NATIVE_MENU_TOGGLE_SIDEBAR_EVENT = "onmyagent:native-menu:toggle-sidebar";
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
const BROWSER_PLUGIN = "opencode-chrome-devtools";
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

const embeddedBrowserPanel = createEmbeddedBrowserPanel({
  app,
  WebContentsView,
  clipboard,
  shell,
  dirname: __dirname,
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

function onmyagentMarketplaceRoot(marketplace) {
  const safeMarketplace = validateExpertMarketplaceName(marketplace);
  return path.join(getRealHomeDir(), ".onmyagent", "marketplaces", safeMarketplace);
}

function validateExpertMarketplaceName(value) {
  const normalized = String(value ?? "").trim();
  if (normalized === "experts" || normalized === "my-experts") return normalized;
  throw new Error("Invalid expert marketplace");
}

function validateExpertPackageName(value) {
  const normalized = String(value ?? "").trim();
  if (
    !normalized ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized === "." ||
    normalized === ".."
  ) {
    throw new Error("Invalid expert package");
  }
  return normalized;
}

function validateBuiltinSkillPackageName(value) {
  const normalized = String(value ?? "").trim();
  if (
    !normalized ||
    !/^[A-Za-z0-9_-]+$/.test(normalized) ||
    normalized === "." ||
    normalized === ".."
  ) {
    throw new Error("Invalid built-in skill package");
  }
  return normalized;
}

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

function escapeMarkdownFrontmatterValue(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/"/g, '\\"').trim();
}

function localizedExpertValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    return String(value.zh ?? value.en ?? "").trim();
  }
  return "";
}

function localizedExpertList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => localizedExpertValue(item)).filter(Boolean);
}

function readTextIfExists(filePath) {
  if (!existsSync(filePath)) return "";
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readJsonIfExists(filePath) {
  const raw = readTextIfExists(filePath);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function titleFromMarkdown(readme, fallback) {
  return readme.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function descriptionFromMarkdown(readme) {
  return readme
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith(">"))
    .find((line) => !line.startsWith("```")) ?? "";
}

function frontmatterValue(markdown, key) {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  return frontmatter.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, "m"))?.[1]?.trim() ?? "";
}

function firstFileInDirectory(directoryPath, predicate) {
  if (!existsSync(directoryPath)) return null;
  try {
    return readdirSync(directoryPath)
      .filter((name) => predicate(name))
      .sort()[0] ?? null;
  } catch {
    return null;
  }
}

function resolvePackageAgentMarkdown(packagePath, manifest) {
  const declaredAgent = Array.isArray(manifest.agents)
    ? String(manifest.agents[0] ?? "").replace(/^\.\//, "")
    : "";
  if (declaredAgent) {
    const declaredPath = path.join(packagePath, declaredAgent);
    const declaredMarkdown = readTextIfExists(declaredPath);
    if (declaredMarkdown) return declaredMarkdown;
  }
  const agentsRoot = path.join(packagePath, "agents");
  const firstAgent = firstFileInDirectory(agentsRoot, (name) => name.endsWith(".md"));
  return firstAgent ? readTextIfExists(path.join(agentsRoot, firstAgent)) : "";
}

function imageMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

function resolvePackageAvatarDataUrl(packagePath, avatarPath) {
  const normalizedAvatarPath = String(avatarPath ?? "").replace(/^\.\//, "");
  const candidates = [];
  if (normalizedAvatarPath) candidates.push(path.join(packagePath, normalizedAvatarPath));
  const avatarsRoot = path.join(packagePath, "avatars");
  const firstAvatar = firstFileInDirectory(
    avatarsRoot,
    (name) => /\.(png|jpe?g|webp)$/i.test(name),
  );
  if (firstAvatar) candidates.push(path.join(avatarsRoot, firstAvatar));
  const avatarFile = candidates.find((candidate) => existsSync(candidate));
  if (!avatarFile) return null;
  try {
    const bytes = readFileSync(avatarFile);
    return `data:${imageMimeType(avatarFile)};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function expertPackageEntryFromDirectory(packagePath, packageName, marketplace) {
  const manifest = readJsonIfExists(path.join(packagePath, ".expert-plugin", "plugin.json"));
  const readme = readTextIfExists(path.join(packagePath, "README.md"));
  const agentMarkdown = resolvePackageAgentMarkdown(packagePath, manifest);
  const fallbackName = titleFromMarkdown(readme, titleFromMarkdown(agentMarkdown, packageName));
  const displayName =
    localizedExpertValue(manifest.profession) ||
    localizedExpertValue(manifest.displayName) ||
    fallbackName ||
    frontmatterValue(agentMarkdown, "name");
  const profession =
    localizedExpertValue(manifest.displayName) ||
    frontmatterValue(agentMarkdown, "profession") ||
    displayName;
  const description =
    localizedExpertValue(manifest.displayDescription) ||
    descriptionFromMarkdown(readme) ||
    frontmatterValue(agentMarkdown, "description") ||
    displayName;
  const manifestName = typeof manifest.name === "string" ? manifest.name.trim() : "";
  return {
    id: `${manifestName || packageName}:${packageName}`,
    packageName,
    source: marketplace === "my-experts" ? "mine" : "installed",
    packagePath,
    displayName,
    profession,
    description,
    categoryId: typeof manifest.categoryId === "string" && manifest.categoryId.trim()
      ? manifest.categoryId.trim()
      : "all",
    tags: localizedExpertList(manifest.tags).slice(0, 4),
    quickPrompts: localizedExpertList(manifest.quickPrompts).slice(0, 4),
    avatarUrl: resolvePackageAvatarDataUrl(packagePath, manifest.avatar),
    expertType: manifest.expertType === "team" ? "team" : "agent",
    leadAgentName:
      typeof manifest.agentName === "string" && manifest.agentName.trim()
        ? manifest.agentName.trim()
        : manifestName || packageName,
    systemPrompt: agentMarkdown || readme,
    version: typeof manifest.version === "string" && manifest.version.trim()
      ? manifest.version.trim()
      : null,
  };
}

function listExpertPackages(marketplace) {
  const safeMarketplace = validateExpertMarketplaceName(marketplace);
  const root = onmyagentMarketplaceRoot(safeMarketplace);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory() || entry.name.startsWith(".")) return false;
      return existsSync(path.join(root, entry.name, ".expert-plugin", "plugin.json"));
    })
    .map((entry) => {
      const packageName = validateExpertPackageName(entry.name);
      return expertPackageEntryFromDirectory(
        path.join(root, packageName),
        packageName,
        safeMarketplace,
      );
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-Hans-CN"));
}

function expertRegistryRecordFromPackageEntry(entry) {
  return {
    id: entry.id,
    name: entry.displayName,
    source: entry.source,
    packageName: entry.packageName,
    packagePath: entry.packagePath,
  };
}

function listExpertRegistryRecords(marketplace) {
  return listExpertPackages(marketplace).map(expertRegistryRecordFromPackageEntry);
}

function myExpertPackageFiles(input, packageName) {
  const name = String(input.name ?? packageName).trim() || packageName;
  const description = String(input.description ?? "").trim();
  const quote = String(input.quote ?? description).trim();
  const now = new Date().toISOString();
  const plugin = {
    name: packageName,
    version: "1.0.0",
    description,
    author: { name: "OnMyAgent", email: "" },
    agents: [`./agents/${packageName}.md`],
    expertType: "agent",
    agentName: packageName,
    displayName: { zh: name, en: name },
    profession: { zh: name, en: name },
    displayDescription: { zh: description || quote, en: description || quote },
    categoryId: "product-operations",
    categoryIds: ["product-operations"],
    tags: [],
    quickPrompts: [],
    createdAt: now,
  };
  const agentMarkdown = `---
name: ${packageName}
description: "${escapeMarkdownFrontmatterValue(description || quote)}"
displayName:
  zh: "${escapeMarkdownFrontmatterValue(name)}"
  en: "${escapeMarkdownFrontmatterValue(name)}"
profession:
  zh: "${escapeMarkdownFrontmatterValue(name)}"
  en: "${escapeMarkdownFrontmatterValue(name)}"
maxTurns: 50
---

# ${name}

${quote || description || "我是一个专业的智能体助手。"}

## 工作方式

${description || quote || "根据用户目标提供结构化、可执行的帮助。"}
`;
  const readme = `# ${name}

${description || quote || "由 OnMyAgent 创建的自定义专家。"}

## 类型

Agent 型（单个专家）

## 存储

该专家创建于 OnMyAgent，并保存在 \`~/.onmyagent/marketplaces/my-experts/${packageName}\`。
`;
  return { plugin, agentMarkdown, readme };
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

function skillAgentsFromPath(skill) {
  const raw = `${skill.path ?? ""}\n${skill.root ?? ""}\n${skill.name ?? ""}`.toLowerCase();
  const agents = [];
  if (raw.includes(".opencode") || raw.includes("opencode")) agents.push("opencode");
  if (raw.includes(".claude") || raw.includes("claude")) agents.push("claude");
  if (raw.includes("openclaw")) agents.push("openclaw");
  if (raw.includes("hermes")) agents.push("hermes");
  if (raw.includes("codex")) agents.push("codex");
  if (raw.includes(".gemini") || raw.includes("gemini")) agents.push("gemini");
  if (raw.includes(".onmyagent") || raw.includes("bundled-skills")) agents.push("onmyagent");
  return agents.length ? [...new Set(agents)] : ["unknown"];
}

const STUDIO_SWITCH_SKILL_AGENT_BY_COLUMN = {
  enabled_claude: "claude",
  enabled_codex: "codex",
  enabled_opencode: "opencode",
  enabled_hermes: "hermes",
  enabled_gemini: "gemini",
};

const STUDIO_SWITCH_SKILL_COLUMNS_BY_AGENT = {
  claude: "enabled_claude",
  codex: "enabled_codex",
  opencode: "enabled_opencode",
  hermes: "enabled_hermes",
  gemini: "enabled_gemini",
};

const AGENT_SKILL_SOURCES = [
  { agent: "opencode", label: "OpenCode", subpaths: [[".opencode", "skills"], [".opencode", "skill"]] },
  { agent: "claude", label: "Claude Code", subpaths: [[".claude", "skills"]] },
  { agent: "codex", label: "Codex", subpaths: [[".codex", "skills"]] },
  { agent: "gemini", label: "Gemini", subpaths: [[".gemini", "skills"]] },
  { agent: "hermes", label: "Hermes", subpaths: [[".hermes", "skills"]] },
  { agent: "openclaw", label: "OpenClaw", subpaths: [[".openclaw", "plugin-skills"], [".openclaw", "skills"]] },
  { agent: "onmyagent", label: "OnMyAgent", subpaths: [[".onmyagent", "skills"]] },
];

const STUDIO_SWITCH_MANAGED_SKILL_AGENTS = Object.keys(STUDIO_SWITCH_SKILL_COLUMNS_BY_AGENT);
const STUDIO_SKILL_SYNC_AGENTS = [...STUDIO_SWITCH_MANAGED_SKILL_AGENTS, "openclaw", "onmyagent"];
const CLAUDE_RUNTIME_BUILTIN_SKILL_NAMES = new Set(["init", "review", "security-review"]);
const AGENT_MANAGEMENT_PROVIDER_APPS = ["opencode", "codex", "claude", "openclaw", "hermes"];
const AGENT_MANAGEMENT_ADDITIVE_PROVIDER_APPS = new Set(["opencode", "openclaw", "hermes"]);

const AGENT_MANAGEMENT_PROVIDER_COLUMNS = [
  ["cost_multiplier", "TEXT NOT NULL DEFAULT '1.0'"],
  ["limit_daily_usd", "TEXT"],
  ["limit_monthly_usd", "TEXT"],
  ["provider_type", "TEXT"],
];

function studioSwitchDatabasePath() {
  return path.join(getRealHomeDir(), ".studio-switch", "studio-switch.db");
}

function studioSwitchSkillsRoot() {
  return path.join(getRealHomeDir(), ".studio-switch", "skills");
}

function agentManagementConfigPath(appType) {
  const home = getRealHomeDir();
  switch (appType) {
    case "claude":
      return path.join(home, ".claude", "settings.json");
    case "codex":
      return path.join(home, ".codex", "config.toml");
    case "opencode":
      return path.join(home, ".config", "opencode", "opencode.json");
    case "openclaw":
      return path.join(home, ".openclaw", "openclaw.json");
    case "hermes":
      return path.join(home, ".hermes", "config.yaml");
    default:
      return "";
  }
}

function ensureStudioSwitchProviderSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS providers (
    id TEXT NOT NULL,
    app_type TEXT NOT NULL,
    name TEXT NOT NULL,
    settings_config TEXT NOT NULL,
    website_url TEXT,
    category TEXT,
    created_at INTEGER,
    sort_index INTEGER,
    notes TEXT,
    icon TEXT,
    icon_color TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    is_current BOOLEAN NOT NULL DEFAULT 0,
    in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
    cost_multiplier TEXT NOT NULL DEFAULT '1.0',
    limit_daily_usd TEXT,
    limit_monthly_usd TEXT,
    provider_type TEXT,
    PRIMARY KEY (id, app_type)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS provider_endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id TEXT NOT NULL,
    app_type TEXT NOT NULL,
    url TEXT NOT NULL,
    added_at INTEGER,
    FOREIGN KEY (provider_id, app_type) REFERENCES providers(id, app_type) ON DELETE CASCADE
  )`);
  const columns = db.prepare("PRAGMA table_info(providers)").all().map((row) => String(row.name));
  const known = new Set(columns);
  for (const [column, definition] of AGENT_MANAGEMENT_PROVIDER_COLUMNS) {
    if (!known.has(column)) db.exec(`ALTER TABLE providers ADD COLUMN ${column} ${definition}`);
  }
}

function withStudioSwitchProviderDatabase(callback, options = {}) {
  const dbPath = studioSwitchDatabasePath();
  if (!options.readOnly) mkdirSyncIfNeeded(path.dirname(dbPath));
  if (options.readOnly && !existsSync(dbPath)) return callback(null);
  let db;
  try {
    db = options.readOnly ? new DatabaseSync(dbPath, { readOnly: true }) : new DatabaseSync(dbPath);
    if (!options.readOnly) ensureStudioSwitchProviderSchema(db);
    return callback(db);
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

function mkdirSyncIfNeeded(targetPath) {
  if (!existsSync(targetPath)) mkdirSync(targetPath, { recursive: true });
}

function parseStudioSwitchJsonColumn(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function normalizeAgentManagementProviderApp(appType) {
  const value = String(appType ?? "").trim().toLowerCase();
  if (!AGENT_MANAGEMENT_PROVIDER_APPS.includes(value)) throw new Error("Unsupported provider app");
  return value;
}

function sanitizeProviderKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function inferProviderIcon(name, appType) {
  const lower = `${name} ${appType}`.toLowerCase();
  if (lower.includes("claude") || lower.includes("anthropic")) return { icon: "anthropic", iconColor: "#D4915D" };
  if (lower.includes("openai") || lower.includes("codex") || lower.includes("gpt")) return { icon: "openai", iconColor: "#00A67E" };
  if (lower.includes("qwen") || lower.includes("bailian") || lower.includes("aliyun") || lower.includes("dashscope")) return { icon: "alibaba", iconColor: "#FF6A00" };
  if (lower.includes("ark") || lower.includes("volc") || lower.includes("doubao") || lower.includes("火山")) return { icon: "huoshan", iconColor: "#3370FF" };
  if (lower.includes("kimi") || lower.includes("moonshot")) return { icon: "moonshot", iconColor: "#6366F1" };
  if (lower.includes("deepseek")) return { icon: "deepseek", iconColor: "#1E88E5" };
  if (lower.includes("minimax")) return { icon: "minimax", iconColor: "#FF6B6B" };
  if (lower.includes("z.ai") || lower.includes("zai") || lower.includes("glm") || lower.includes("zhipu")) return { icon: "zhipu", iconColor: "#0F62FE" };
  if (lower.includes("google") || lower.includes("gemini")) return { icon: "google", iconColor: "#4285F4" };
  return { icon: appType, iconColor: null };
}

function studioSwitchProviderFromRow(row) {
  const settingsConfig = parseStudioSwitchJsonColumn(row.settings_config, {});
  const meta = parseStudioSwitchJsonColumn(row.meta, {});
  return {
    id: String(row.id),
    appType: String(row.app_type),
    name: String(row.name),
    settingsConfig,
    websiteUrl: row.website_url ?? null,
    category: row.category ?? null,
    createdAt: row.created_at ?? null,
    sortIndex: row.sort_index ?? null,
    notes: row.notes ?? null,
    icon: row.icon ?? null,
    iconColor: row.icon_color ?? null,
    meta,
    isCurrent: Boolean(row.is_current),
    inFailoverQueue: Boolean(row.in_failover_queue),
    costMultiplier: row.cost_multiplier ?? "1.0",
    limitDailyUsd: row.limit_daily_usd ?? null,
    limitMonthlyUsd: row.limit_monthly_usd ?? null,
    providerType: row.provider_type ?? meta.providerType ?? null,
    liveManaged: meta.live_config_managed !== false,
    livePresent: false,
    models: extractAgentManagementProviderModels(String(row.app_type), settingsConfig),
  };
}

function readStudioSwitchProviders(appType = null) {
  return withStudioSwitchProviderDatabase((db) => {
    if (!db) return [];
    const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'providers'").get();
    if (!hasTable) return [];
    const args = [];
    let sql = `SELECT id, app_type, name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue, cost_multiplier, limit_daily_usd, limit_monthly_usd, provider_type
      FROM providers`;
    if (appType) {
      sql += " WHERE app_type = ?";
      args.push(appType);
    } else {
      sql += ` WHERE app_type IN (${AGENT_MANAGEMENT_PROVIDER_APPS.map(() => "?").join(",")})`;
      args.push(...AGENT_MANAGEMENT_PROVIDER_APPS);
    }
    sql += " ORDER BY app_type, COALESCE(sort_index, 999999), created_at ASC, id ASC";
    return db.prepare(sql).all(...args).map(studioSwitchProviderFromRow);
  }, { readOnly: true });
}

function nextStudioSwitchProviderSortIndex(db, appType) {
  const row = db.prepare("SELECT MAX(sort_index) AS max_sort FROM providers WHERE app_type = ?").get(appType);
  const maxSort = Number(row?.max_sort);
  return Number.isFinite(maxSort) ? maxSort + 1 : 0;
}

function normalizeAgentManagementProviderPayload(appType, inputProvider = {}) {
  const simplified = inputProvider.simple && typeof inputProvider.simple === "object" ? inputProvider.simple : null;
  const name = String(inputProvider.name ?? simplified?.name ?? "").trim();
  const fallbackId = name || simplified?.model || "custom-provider";
  const id = sanitizeProviderKey(inputProvider.id ?? simplified?.id ?? fallbackId);
  if (!id) throw new Error("Provider id is required");
  const providerName = name || id;
  let settingsConfig = inputProvider.settingsConfig;
  if (typeof settingsConfig === "string") {
    settingsConfig = parseStudioSwitchJsonColumn(settingsConfig, null);
    if (!settingsConfig) throw new Error("settingsConfig JSON is invalid");
  }
  if (!settingsConfig || typeof settingsConfig !== "object" || Array.isArray(settingsConfig)) {
    settingsConfig = buildProviderSettingsConfig(appType, { ...simplified, id, name: providerName });
  } else if (simplified) {
    settingsConfig = mergeProviderSimpleFields(appType, settingsConfig, { ...simplified, id, name: providerName });
  }
  const inferred = inferProviderIcon(providerName, appType);
  const meta = inputProvider.meta && typeof inputProvider.meta === "object" ? inputProvider.meta : {};
  return {
    id,
    appType,
    name: providerName,
    settingsConfig,
    websiteUrl: typeof inputProvider.websiteUrl === "string" ? inputProvider.websiteUrl.trim() || null : null,
    category: typeof inputProvider.category === "string" && inputProvider.category.trim() ? inputProvider.category.trim() : "custom",
    createdAt: Number.isFinite(Number(inputProvider.createdAt)) ? Number(inputProvider.createdAt) : Date.now(),
    sortIndex: Number.isFinite(Number(inputProvider.sortIndex)) ? Number(inputProvider.sortIndex) : null,
    notes: typeof inputProvider.notes === "string" ? inputProvider.notes : null,
    icon: typeof inputProvider.icon === "string" && inputProvider.icon.trim() ? inputProvider.icon.trim() : inferred.icon,
    iconColor: typeof inputProvider.iconColor === "string" && inputProvider.iconColor.trim() ? inputProvider.iconColor.trim() : inferred.iconColor,
    meta: AGENT_MANAGEMENT_ADDITIVE_PROVIDER_APPS.has(appType) ? { ...meta, live_config_managed: inputProvider.liveManaged !== false } : meta,
    inFailoverQueue: Boolean(inputProvider.inFailoverQueue),
    costMultiplier: String(inputProvider.costMultiplier ?? meta.costMultiplier ?? "1.0"),
    limitDailyUsd: inputProvider.limitDailyUsd ?? null,
    limitMonthlyUsd: inputProvider.limitMonthlyUsd ?? null,
    providerType: inputProvider.providerType ?? meta.providerType ?? null,
  };
}

function mergeProviderSimpleFields(appType, settingsConfig, simple = {}) {
  if (!settingsConfig || typeof settingsConfig !== "object" || Array.isArray(settingsConfig)) return settingsConfig;
  if (!["claude", "codex"].includes(appType)) return settingsConfig;
  const base = structuredCloneJson(settingsConfig);
  const generated = buildProviderSettingsConfig(appType, simple);
  if (appType === "claude") {
    base.env = { ...(base.env && typeof base.env === "object" ? base.env : {}), ...(generated.env ?? {}) };
    return base;
  }
  if (appType === "codex") {
    const codexGenerated = /** @type {{ auth?: Record<string, unknown>, config?: string, modelCatalog?: unknown }} */ (generated);
    return {
      ...base,
      auth: codexGenerated.auth ?? base.auth ?? {},
      config: codexGenerated.config ?? base.config ?? "",
      ...(codexGenerated.modelCatalog ? { modelCatalog: codexGenerated.modelCatalog } : {}),
    };
  }
  return base;
}

function buildProviderSettingsConfig(appType, simple = {}) {
  const id = sanitizeProviderKey(simple.id ?? simple.name ?? "custom-provider");
  const name = String(simple.name ?? id).trim() || id;
  const baseUrl = String(simple.baseUrl ?? "").trim();
  const apiKey = String(simple.apiKey ?? "").trim();
  const modelList = String(simple.models ?? simple.model ?? "")
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
  const model = modelList[0] ?? "model";
  if (appType !== "codex" && !baseUrl) throw new Error("Base URL is required");
  if (!["codex", "claude"].includes(appType) && !modelList.length) throw new Error("At least one model is required");
  if (appType === "opencode") {
    return {
      npm: "@ai-sdk/openai-compatible",
      name,
      options: { baseURL: baseUrl, ...(apiKey ? { apiKey } : {}), timeout: 600000 },
      models: Object.fromEntries(modelList.map((item) => [item, { name: item }])),
    };
  }
  if (appType === "openclaw") {
    return {
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
      api: String(simple.api ?? "openai-completions"),
      models: modelList.map((item) => ({ id: item, name: item, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
    };
  }
  if (appType === "hermes") {
    return {
      name: id,
      base_url: baseUrl,
      ...(apiKey ? { api_key: apiKey } : {}),
      api_mode: String(simple.apiMode ?? "chat_completions"),
      model,
      models: modelList.map((item) => ({ id: item })),
      _cc_source: "studio",
    };
  }
  if (appType === "claude") {
    const haikuModel = String(simple.claudeHaikuModel ?? "").trim() || model;
    const sonnetModel = String(simple.claudeSonnetModel ?? "").trim() || model;
    const opusModel = String(simple.claudeOpusModel ?? "").trim() || sonnetModel || model;
    const fableModel = String(simple.claudeFableModel ?? "").trim() || opusModel || model;
    const haikuName = String(simple.claudeHaikuName ?? "").trim() || haikuModel;
    const sonnetName = String(simple.claudeSonnetName ?? "").trim() || sonnetModel;
    const opusName = String(simple.claudeOpusName ?? "").trim() || opusModel;
    const fableName = String(simple.claudeFableName ?? "").trim() || fableModel;
    return {
      env: {
        ANTHROPIC_BASE_URL: baseUrl,
        ...(apiKey ? { ANTHROPIC_AUTH_TOKEN: apiKey } : {}),
        ANTHROPIC_MODEL: model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuModel,
        ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: haikuName,
        ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetModel,
        ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: sonnetName,
        ANTHROPIC_DEFAULT_OPUS_MODEL: opusModel,
        ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: opusName,
        ANTHROPIC_DEFAULT_FABLE_MODEL: fableModel,
        ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: fableName,
      },
    };
  }
  if (appType === "codex") {
    const providerId = id.replace(/-/g, "_");
    const envKey = String(simple.envKey ?? "CODEX_API_KEY").trim() || "CODEX_API_KEY";
    const catalogModels = parseCodexCatalogModels(simple.codexCatalog);
    const defaultModel = catalogModels[0]?.model || model;
    return {
      auth: apiKey ? { [envKey]: apiKey } : {},
      config: `model = "${escapeTomlString(defaultModel)}"\nmodel_provider = "${escapeTomlString(providerId)}"\n\n[model_providers.${providerId}]\nname = "${escapeTomlString(name)}"\nbase_url = "${escapeTomlString(baseUrl)}"\nwire_api = "responses"\nenv_key = "${escapeTomlString(envKey)}"\n`,
      ...(catalogModels.length ? { modelCatalog: { models: catalogModels } } : {}),
    };
  }
  return {};
}

function parseCodexCatalogModels(value) {
  const seen = new Set();
  const rows = [];
  for (const line of String(value ?? "").split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("|").map((part) => part.trim());
    const displayName = parts.length > 1 ? parts[0] : "";
    const model = (parts.length > 1 ? parts[1] : parts[0]) ?? "";
    if (!model || seen.has(model)) continue;
    seen.add(model);
    const contextText = String(parts[2] ?? "").replace(/[^\d]/g, "");
    const contextWindow = contextText ? Number.parseInt(contextText, 10) : null;
    rows.push({
      model,
      ...(displayName ? { displayName } : {}),
      ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
    });
  }
  return rows;
}

const AGENT_MANAGEMENT_MODEL_FETCH_COMPAT_SUFFIXES = [
  "/api/claudecode",
  "/api/anthropic",
  "/apps/anthropic",
  "/api/coding",
  "/api/plan",
  "/claudecode",
  "/anthropic",
  "/step_plan",
  "/coding",
  "/claude",
  "/plan",
];

function agentManagementModelsEndpoints(baseUrl) {
  const raw = String(baseUrl ?? "").trim().replace(/\/+$/g, "");
  if (!raw) throw new Error("API Endpoint is required before fetching models");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("API Endpoint is invalid");
  }
  const candidates = [];
  const add = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  const pathname = parsed.pathname.replace(/\/+$/g, "");
  if (/\/models$/i.test(pathname)) {
    add(parsed.toString());
  } else if (agentManagementEndsWithVersionSegment(pathname)) {
    add(`${raw}/models`);
    if (!pathname.endsWith("/v1")) add(`${raw}/v1/models`);
  } else {
    add(`${raw}/v1/models`);
    add(`${raw}/models`);
  }
  const stripped = agentManagementStripCompatSuffix(raw);
  if (stripped) {
    add(`${stripped}/v1/models`);
    add(`${stripped}/models`);
  }
  return candidates;
}

function agentManagementEndsWithVersionSegment(pathname) {
  const last = String(pathname ?? "").split("/").filter(Boolean).at(-1) ?? "";
  return /^v\d+$/.test(last);
}

function agentManagementStripCompatSuffix(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return null;
  }
  const pathname = parsed.pathname.replace(/\/+$/g, "");
  for (const suffix of AGENT_MANAGEMENT_MODEL_FETCH_COMPAT_SUFFIXES) {
    const index = pathname.indexOf(suffix);
    if (index < 0) continue;
    const after = pathname.slice(index + suffix.length);
    if (after && !after.startsWith("/")) continue;
    const rootPath = pathname.slice(0, index).replace(/\/+$/g, "");
    return `${parsed.origin}${rootPath}`.replace(/\/+$/g, "");
  }
  return null;
}

function normalizeFetchedModel(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id ?? item.model ?? item.name ?? "").trim();
  if (!id) return null;
  const name = String(item.name ?? item.display_name ?? item.displayName ?? id).trim() || id;
  const contextWindow = item.contextWindow ?? item.context_window ?? item.max_context_length ?? item.maxContextLength ?? null;
  return { id, name, ...(contextWindow != null ? { contextWindow } : {}) };
}

async function agentManagementFetchModels(input = {}) {
  const endpoints = agentManagementModelsEndpoints(input.baseUrl);
  const apiKey = String(input.apiKey ?? "").trim();
  let lastError = "no candidates";
  for (const endpoint of endpoints) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }
    const text = await response.text();
    if (!response.ok) {
      lastError = `HTTP ${response.status}${text ? ` ${text.slice(0, 240)}` : ""}`;
      if (response.status === 404 || response.status === 405) continue;
      throw new Error(`Fetch models failed at ${endpoint}: ${lastError}`);
    }
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Fetch models failed at ${endpoint}: response is not valid JSON`);
    }
    const rawModels = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload)
          ? payload
          : [];
    const seen = new Set();
    const models = [];
    for (const rawModel of rawModels) {
      const model = normalizeFetchedModel(rawModel);
      if (!model || seen.has(model.id)) continue;
      seen.add(model.id);
      models.push(model);
    }
    return { ok: true, endpoint, models };
  }
  throw new Error(`Fetch models failed: all candidate endpoints failed (${endpoints.join(", ")}): ${lastError}`);
}

function escapeTomlString(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function extractAgentManagementProviderModels(appType, settingsConfig) {
  if (!settingsConfig || typeof settingsConfig !== "object") return [];
  if (appType === "opencode" && settingsConfig.models && typeof settingsConfig.models === "object") {
    return Object.entries(settingsConfig.models).map(([id, value]) => ({ id, name: String(value?.name ?? id) }));
  }
  if (appType === "openclaw" && Array.isArray(settingsConfig.models)) {
    return settingsConfig.models.map((model) => ({ id: String(model?.id ?? model?.name ?? "").trim(), name: String(model?.name ?? model?.id ?? "").trim() })).filter((model) => model.id);
  }
  if (appType === "hermes") {
    if (Array.isArray(settingsConfig.models)) return settingsConfig.models.map((model) => ({ id: String(model?.id ?? model?.model ?? model?.name ?? "").trim(), name: String(model?.name ?? model?.id ?? model?.model ?? "").trim() })).filter((model) => model.id);
    if (settingsConfig.models && typeof settingsConfig.models === "object") return Object.keys(settingsConfig.models).map((id) => ({ id, name: id }));
    if (typeof settingsConfig.model === "string" && settingsConfig.model.trim()) return [{ id: settingsConfig.model.trim(), name: settingsConfig.model.trim() }];
  }
  if (appType === "claude") {
    const env = settingsConfig.env && typeof settingsConfig.env === "object" ? settingsConfig.env : settingsConfig;
    return [
      env.ANTHROPIC_MODEL,
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
      env.ANTHROPIC_DEFAULT_SONNET_MODEL,
      env.ANTHROPIC_DEFAULT_OPUS_MODEL,
      env.ANTHROPIC_DEFAULT_FABLE_MODEL,
      env.model,
      settingsConfig.model,
    ].filter(Boolean).map((id) => ({ id: String(id), name: String(id) }));
  }
  if (appType === "codex") {
    const catalog = settingsConfig.modelCatalog && typeof settingsConfig.modelCatalog === "object" ? settingsConfig.modelCatalog : null;
    if (Array.isArray(catalog?.models) && catalog.models.length) {
      return catalog.models
        .map((item) => ({ id: String(item?.model ?? "").trim(), name: String(item?.displayName ?? item?.display_name ?? item?.model ?? "").trim() }))
        .filter((model) => model.id);
    }
    const config = String(settingsConfig.config ?? "");
    const model = config.match(/^\s*model\s*=\s*["']([^"']+)["']/m)?.[1];
    return model ? [{ id: model, name: model }] : [];
  }
  return [];
}

function saveStudioSwitchProvider(provider) {
  return withStudioSwitchProviderDatabase((db) => {
    const existing = db.prepare("SELECT is_current, in_failover_queue, created_at, sort_index FROM providers WHERE id = ? AND app_type = ?").get(provider.id, provider.appType);
    const createdAt = existing?.created_at ?? provider.createdAt ?? Date.now();
    const sortIndex = provider.sortIndex ?? existing?.sort_index ?? nextStudioSwitchProviderSortIndex(db, provider.appType);
    db.prepare(`INSERT INTO providers (id, app_type, name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue, cost_multiplier, limit_daily_usd, limit_monthly_usd, provider_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id, app_type) DO UPDATE SET
        name = excluded.name,
        settings_config = excluded.settings_config,
        website_url = excluded.website_url,
        category = excluded.category,
        created_at = excluded.created_at,
        sort_index = excluded.sort_index,
        notes = excluded.notes,
        icon = excluded.icon,
        icon_color = excluded.icon_color,
        meta = excluded.meta,
        in_failover_queue = excluded.in_failover_queue,
        cost_multiplier = excluded.cost_multiplier,
        limit_daily_usd = excluded.limit_daily_usd,
        limit_monthly_usd = excluded.limit_monthly_usd,
        provider_type = excluded.provider_type`).run(
      provider.id,
      provider.appType,
      provider.name,
      JSON.stringify(provider.settingsConfig ?? {}),
      provider.websiteUrl,
      provider.category,
      createdAt,
      sortIndex,
      provider.notes,
      provider.icon,
      provider.iconColor,
      JSON.stringify(provider.meta ?? {}),
      existing?.is_current ?? 0,
      provider.inFailoverQueue ? 1 : 0,
      provider.costMultiplier ?? "1.0",
      provider.limitDailyUsd,
      provider.limitMonthlyUsd,
      provider.providerType,
    );
    return { ...provider, createdAt, sortIndex };
  });
}

function setStudioSwitchCurrentProvider(appType, providerId) {
  return withStudioSwitchProviderDatabase((db) => {
    const existing = db.prepare("SELECT id FROM providers WHERE id = ? AND app_type = ?").get(providerId, appType);
    if (!existing) throw new Error(`Provider ${providerId} does not exist`);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE providers SET is_current = 0 WHERE app_type = ?").run(appType);
      db.prepare("UPDATE providers SET is_current = 1 WHERE id = ? AND app_type = ?").run(providerId, appType);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return true;
  });
}

function deleteStudioSwitchProvider(appType, providerId) {
  return withStudioSwitchProviderDatabase((db) => {
    db.prepare("DELETE FROM providers WHERE id = ? AND app_type = ?").run(providerId, appType);
    db.prepare("DELETE FROM provider_endpoints WHERE provider_id = ? AND app_type = ?").run(providerId, appType);
    return true;
  });
}

async function readAgentManagementJsonConfig(appType) {
  const configPath = agentManagementConfigPath(appType);
  return (await readJsonLikeFile(configPath)) ?? {};
}

async function writeOpenCodeProviderLive(provider) {
  const configPath = agentManagementConfigPath("opencode");
  const config = await readAgentManagementJsonConfig("opencode");
  const providerMap = config.provider && typeof config.provider === "object" ? config.provider : {};
  providerMap[provider.id] = provider.settingsConfig;
  config.provider = providerMap;
  await writeJsonFileAtomic(configPath, config);
}

async function removeOpenCodeProviderLive(providerId) {
  const configPath = agentManagementConfigPath("opencode");
  const config = await readAgentManagementJsonConfig("opencode");
  if (config.provider && typeof config.provider === "object") delete config.provider[providerId];
  if (typeof config.model === "string" && config.model.startsWith(`${providerId}/`)) delete config.model;
  if (typeof config.small_model === "string" && config.small_model.startsWith(`${providerId}/`)) delete config.small_model;
  await writeJsonFileAtomic(configPath, config);
}

async function writeOpenClawProviderLive(provider) {
  const configPath = agentManagementConfigPath("openclaw");
  const config = await readAgentManagementJsonConfig("openclaw");
  const models = config.models && typeof config.models === "object" ? config.models : {};
  const providers = models.providers && typeof models.providers === "object" ? models.providers : {};
  providers[provider.id] = provider.settingsConfig;
  models.providers = providers;
  config.models = models;
  await writeJsonFileAtomic(configPath, config);
}

async function removeOpenClawProviderLive(providerId) {
  const configPath = agentManagementConfigPath("openclaw");
  const config = await readAgentManagementJsonConfig("openclaw");
  if (config.models?.providers && typeof config.models.providers === "object") delete config.models.providers[providerId];
  await writeJsonFileAtomic(configPath, config);
}

async function writeClaudeProviderLive(provider) {
  await writeJsonFileAtomic(agentManagementConfigPath("claude"), sanitizeClaudeProviderSettings(provider.settingsConfig));
}

function sanitizeClaudeProviderSettings(settings) {
  const next = structuredCloneJson(settings && typeof settings === "object" ? settings : {});
  delete next.api_format;
  delete next.apiFormat;
  delete next.openrouter_compat_mode;
  delete next.openrouterCompatMode;
  return next;
}

function structuredCloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

async function writeCodexProviderLive(provider) {
  const home = getRealHomeDir();
  const codexDir = path.join(home, ".codex");
  await mkdir(codexDir, { recursive: true });
  const settings = provider.settingsConfig && typeof provider.settingsConfig === "object" ? provider.settingsConfig : {};
  await writeJsonFileAtomic(path.join(codexDir, "auth.json"), settings.auth && typeof settings.auth === "object" ? settings.auth : {});
  const current = await readFile(path.join(codexDir, "config.toml"), "utf8").catch(() => "");
  const nextConfig = mergeCodexProjectSections(String(settings.config ?? ""), current);
  await writeFile(path.join(codexDir, "config.toml"), nextConfig.endsWith("\n") ? nextConfig : `${nextConfig}\n`, "utf8");
}

function mergeCodexProjectSections(nextConfig, currentConfig) {
  const next = String(nextConfig ?? "").trimEnd();
  const current = String(currentConfig ?? "");
  if (/^\s*\[projects(?:\.|\])/.test(next)) return `${next}\n`;
  const projectIndex = current.search(/^\s*\[projects(?:\.|\])/m);
  if (projectIndex < 0) return `${next}\n`;
  const projectSections = current.slice(projectIndex).trimEnd();
  return `${next}\n\n${projectSections}\n`;
}

function yamlScalar(value) {
  if (value == null) return "''";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  if (/^[A-Za-z0-9_./:@+-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function hermesProviderToYaml(providerId, settingsConfig) {
  const settings = structuredCloneJson(settingsConfig && typeof settingsConfig === "object" ? settingsConfig : {});
  settings.name = providerId;
  if (settings.baseUrl && !settings.base_url) settings.base_url = settings.baseUrl;
  if (settings.apiKey && !settings.api_key) settings.api_key = settings.apiKey;
  delete settings.baseUrl;
  delete settings.apiKey;
  delete settings.provider_key;
  delete settings._cc_source;
  const models = extractAgentManagementProviderModels("hermes", settings);
  if (models[0]?.id) settings.model = settings.model || models[0].id;
  const lines = ["- name: " + yamlScalar(providerId)];
  for (const [key, value] of Object.entries(settings)) {
    if (key === "name" || key === "models") continue;
    if (value == null || value === "") continue;
    if (typeof value === "object") continue;
    lines.push(`  ${key}: ${yamlScalar(value)}`);
  }
  if (models.length) {
    lines.push("  models:");
    for (const model of models) {
      lines.push(`    ${yamlScalar(model.id)}: {}`);
    }
  }
  return lines.join("\n");
}

function findTopLevelYamlSection(raw, key) {
  const pattern = new RegExp(`^${key}:\\s*(?:#.*)?$`, "m");
  const match = pattern.exec(raw);
  if (!match) return null;
  const start = match.index;
  const afterStart = start + match[0].length;
  const tail = raw.slice(afterStart);
  const next = /\n[A-Za-z0-9_-]+:\s*/.exec(tail);
  const end = next ? afterStart + next.index + 1 : raw.length;
  return { start, end, bodyStart: afterStart };
}

function replaceTopLevelYamlSection(raw, key, sectionText) {
  const section = sectionText.endsWith("\n") ? sectionText : `${sectionText}\n`;
  const existing = findTopLevelYamlSection(raw, key);
  if (!existing) {
    const prefix = raw && !raw.endsWith("\n") ? `${raw}\n` : raw;
    return `${prefix}${section}`;
  }
  return `${raw.slice(0, existing.start)}${section}${raw.slice(existing.end)}`;
}

function parseHermesCustomProviderNames(raw) {
  const section = findTopLevelYamlSection(raw, "custom_providers");
  if (!section) return new Set();
  const body = raw.slice(section.bodyStart, section.end);
  const names = new Set();
  for (const match of body.matchAll(/^\s*-\s+name:\s*["']?([^"'\n]+)["']?\s*$/gm)) {
    const name = match[1]?.trim();
    if (name) names.add(name);
  }
  return names;
}

function updateHermesCustomProvidersRaw(raw, provider, remove = false) {
  const section = findTopLevelYamlSection(raw, "custom_providers");
  const body = section ? raw.slice(section.bodyStart, section.end) : "";
  const blocks = [];
  let current = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*-\s+name:\s*/.test(line)) {
      if (current.length) blocks.push(current.join("\n"));
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n"));
  const kept = blocks.filter((block) => {
    const name = block.match(/^\s*-\s+name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
    return name !== provider.id;
  });
  if (!remove) kept.push(hermesProviderToYaml(provider.id, provider.settingsConfig));
  const sectionText = kept.length ? `custom_providers:\n${kept.map((block) => block.trimEnd()).join("\n")}` : "custom_providers: []";
  return replaceTopLevelYamlSection(raw, "custom_providers", sectionText);
}

async function writeHermesProviderLive(provider) {
  const configPath = agentManagementConfigPath("hermes");
  const raw = await readFile(configPath, "utf8").catch(() => "");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, updateHermesCustomProvidersRaw(raw, provider, false), "utf8");
}

async function removeHermesProviderLive(providerId) {
  const configPath = agentManagementConfigPath("hermes");
  const raw = await readFile(configPath, "utf8").catch(() => "");
  await writeFile(configPath, updateHermesCustomProvidersRaw(raw, { id: providerId, settingsConfig: {} }, true), "utf8");
}

async function applyHermesProviderDefault(provider) {
  const configPath = agentManagementConfigPath("hermes");
  const raw = await readFile(configPath, "utf8").catch(() => "");
  const model = extractAgentManagementProviderModels("hermes", provider.settingsConfig)[0]?.id || provider.settingsConfig?.model || "";
  const sectionText = ["model:", model ? `  default: ${yamlScalar(model)}` : null, `  provider: ${yamlScalar(provider.id)}`, provider.settingsConfig?.base_url ? `  base_url: ${yamlScalar(provider.settingsConfig.base_url)}` : null].filter(Boolean).join("\n");
  await writeFile(configPath, replaceTopLevelYamlSection(raw, "model", sectionText), "utf8");
}

async function writeAgentManagementProviderLive(provider, options = {}) {
  if (provider.appType === "opencode") return writeOpenCodeProviderLive(provider);
  if (provider.appType === "openclaw") return writeOpenClawProviderLive(provider);
  if (provider.appType === "hermes") {
    await writeHermesProviderLive(provider);
    if (options.switchDefault) await applyHermesProviderDefault(provider);
    return;
  }
  if (provider.appType === "claude") return writeClaudeProviderLive(provider);
  if (provider.appType === "codex") return writeCodexProviderLive(provider);
  throw new Error("Unsupported live sync app");
}

async function removeAgentManagementProviderLive(appType, providerId) {
  if (appType === "opencode") return removeOpenCodeProviderLive(providerId);
  if (appType === "openclaw") return removeOpenClawProviderLive(providerId);
  if (appType === "hermes") return removeHermesProviderLive(providerId);
  return null;
}

async function readAgentManagementLiveProviderIds(appType) {
  if (appType === "opencode") {
    const config = await readAgentManagementJsonConfig("opencode");
    return new Set(Object.keys(config.provider && typeof config.provider === "object" ? config.provider : {}));
  }
  if (appType === "openclaw") {
    const config = await readAgentManagementJsonConfig("openclaw");
    return new Set(Object.keys(config.models?.providers && typeof config.models.providers === "object" ? config.models.providers : {}));
  }
  if (appType === "hermes") {
    const raw = await readFile(agentManagementConfigPath("hermes"), "utf8").catch(() => "");
    return parseHermesCustomProviderNames(raw);
  }
  return new Set();
}

async function readLiveProvidersForImport(appType) {
  if (appType === "opencode") {
    const config = await readAgentManagementJsonConfig("opencode");
    const providers = config.provider && typeof config.provider === "object" ? config.provider : {};
    return Object.entries(providers).map(([id, settingsConfig]) => ({
      id,
      name: settingsConfig?.name || id,
      settingsConfig,
      category: "custom",
      meta: { live_config_managed: true },
    }));
  }
  if (appType === "openclaw") {
    const config = await readAgentManagementJsonConfig("openclaw");
    const providers = config.models?.providers && typeof config.models.providers === "object" ? config.models.providers : {};
    return Object.entries(providers).map(([id, settingsConfig]) => ({
      id,
      name: extractAgentManagementProviderModels("openclaw", settingsConfig)[0]?.name || id,
      settingsConfig,
      category: "custom",
      meta: { live_config_managed: true },
    }));
  }
  if (appType === "claude") {
    const settingsConfig = await readAgentManagementJsonConfig("claude");
    if (!Object.keys(settingsConfig).length) return [];
    return [{ id: "default", name: "default", settingsConfig, category: "custom", meta: {} }];
  }
  if (appType === "codex") {
    const home = getRealHomeDir();
    const [auth, config] = await Promise.all([
      readJsonLikeFile(path.join(home, ".codex", "auth.json")),
      readFile(path.join(home, ".codex", "config.toml"), "utf8").catch(() => ""),
    ]);
    if (!auth && !config.trim()) return [];
    return [{ id: "default", name: "default", settingsConfig: { auth: auth ?? {}, config }, category: "custom", meta: {} }];
  }
  if (appType === "hermes") {
    const raw = await readFile(agentManagementConfigPath("hermes"), "utf8").catch(() => "");
    return parseHermesCustomProvidersForImport(raw);
  }
  return [];
}

function parseHermesCustomProvidersForImport(raw) {
  const section = findTopLevelYamlSection(raw, "custom_providers");
  if (!section) return [];
  const body = raw.slice(section.bodyStart, section.end);
  const blocks = [];
  let current = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*-\s+name:\s*/.test(line)) {
      if (current.length) blocks.push(current.join("\n"));
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks.map((block) => {
    const scalars = {};
    const modelIds = [];
    for (const line of block.split(/\r?\n/)) {
      const scalar = line.match(/^\s*(?:-\s+)?([A-Za-z0-9_]+):\s*["']?([^"'{}\n]+)["']?\s*$/);
      if (scalar) scalars[scalar[1]] = scalar[2].trim();
      const model = line.match(/^\s{4}([^:\n]+):\s*(?:\{\})?\s*$/);
      if (model) modelIds.push(model[1].replace(/^['"]|['"]$/g, "").trim());
    }
    const id = sanitizeProviderKey(scalars.name);
    if (!id) return null;
    const models = modelIds.length ? modelIds : scalars.model ? [scalars.model] : [];
    return {
      id,
      name: scalars.name || id,
      settingsConfig: {
        name: id,
        base_url: scalars.base_url || "",
        ...(scalars.api_key ? { api_key: scalars.api_key } : {}),
        api_mode: scalars.api_mode || "chat_completions",
        ...(scalars.model ? { model: scalars.model } : {}),
        models: models.map((modelId) => ({ id: modelId })),
        _cc_source: "custom_providers",
      },
      category: "custom",
      meta: { live_config_managed: true },
    };
  }).filter(Boolean);
}

async function readAgentManagementProvidersSnapshot() {
  const providers = readStudioSwitchProviders();
  const liveByApp = new Map();
  await Promise.all(AGENT_MANAGEMENT_PROVIDER_APPS.map(async (appType) => {
    liveByApp.set(appType, await readAgentManagementLiveProviderIds(appType).catch(() => new Set()));
  }));
  const byAgent = Object.fromEntries(AGENT_MANAGEMENT_PROVIDER_APPS.map((appType) => [appType, []]));
  for (const provider of providers) {
    const liveIds = liveByApp.get(provider.appType) ?? new Set();
    const enriched = {
      ...provider,
      livePresent: provider.isCurrent || liveIds.has(provider.id),
      configPath: agentManagementConfigPath(provider.appType),
    };
    if (byAgent[provider.appType]) byAgent[provider.appType].push(enriched);
  }
  return {
    databasePath: studioSwitchDatabasePath(),
    byAgent,
    total: providers.length,
  };
}

async function agentManagementProviderAction(input = {}) {
  const action = String(input?.action ?? "").trim();
  const appType = normalizeAgentManagementProviderApp(input?.appType ?? input?.agent);
  if (action === "importLive") {
    const liveProviders = await readLiveProvidersForImport(appType);
    const existingIds = new Set(readStudioSwitchProviders(appType).map((provider) => provider.id));
    let imported = 0;
    for (const rawProvider of liveProviders) {
      if (!rawProvider?.id || existingIds.has(rawProvider.id)) continue;
      const provider = normalizeAgentManagementProviderPayload(appType, rawProvider);
      provider.meta = { ...(provider.meta ?? {}), live_config_managed: true };
      saveStudioSwitchProvider(provider);
      imported += 1;
    }
    return { ok: true, action, appType, imported, providers: await readAgentManagementProvidersSnapshot() };
  }

  if (action === "save") {
    const provider = normalizeAgentManagementProviderPayload(appType, input?.provider ?? input);
    const saved = saveStudioSwitchProvider(provider);
    if (input?.syncLive !== false && AGENT_MANAGEMENT_ADDITIVE_PROVIDER_APPS.has(appType)) {
      await writeAgentManagementProviderLive(saved);
    }
    return { ok: true, action, appType, providerId: saved.id, providers: await readAgentManagementProvidersSnapshot() };
  }

  const providerId = sanitizeProviderKey(input?.providerId ?? input?.id ?? input?.provider?.id);
  if (!providerId) throw new Error("providerId is required");

  if (action === "syncLive") {
    const provider = readStudioSwitchProviders(appType).find((item) => item.id === providerId);
    if (!provider) throw new Error(`Provider ${providerId} does not exist`);
    await writeAgentManagementProviderLive(provider);
    return { ok: true, action, appType, providerId, providers: await readAgentManagementProvidersSnapshot() };
  }

  if (action === "switch") {
    const provider = readStudioSwitchProviders(appType).find((item) => item.id === providerId);
    if (!provider) throw new Error(`Provider ${providerId} does not exist`);
    if (AGENT_MANAGEMENT_ADDITIVE_PROVIDER_APPS.has(appType)) {
      await writeAgentManagementProviderLive(provider, { switchDefault: true });
      if (appType === "opencode") {
        const modelId = provider.models[0]?.id;
        if (modelId) {
          const configPath = agentManagementConfigPath("opencode");
          const config = await readAgentManagementJsonConfig("opencode");
          config.model = `${provider.id}/${modelId}`;
          await writeJsonFileAtomic(configPath, config);
        }
      }
    } else {
      setStudioSwitchCurrentProvider(appType, providerId);
      await writeAgentManagementProviderLive(provider);
    }
    return { ok: true, action, appType, providerId, providers: await readAgentManagementProvidersSnapshot() };
  }

  if (action === "delete") {
    if (AGENT_MANAGEMENT_ADDITIVE_PROVIDER_APPS.has(appType)) {
      await removeAgentManagementProviderLive(appType, providerId);
    } else {
      const provider = readStudioSwitchProviders(appType).find((item) => item.id === providerId);
      if (provider?.isCurrent) throw new Error("无法删除当前正在使用的供应商");
    }
    deleteStudioSwitchProvider(appType, providerId);
    return { ok: true, action, appType, providerId, providers: await readAgentManagementProvidersSnapshot() };
  }

  throw new Error("Unsupported provider action");
}

function unifiedAgentsSkillsRoot() {
  return path.join(getRealHomeDir(), ".agents", "skills");
}

function standardAgentSkillDir(agent) {
  const home = getRealHomeDir();
  switch (agent) {
    case "opencode":
      return path.join(home, ".config", "opencode", "skills");
    case "claude":
      return path.join(home, ".claude", "skills");
    case "codex":
      return path.join(home, ".codex", "skills");
    case "hermes":
      return path.join(home, ".hermes", "skills");
    case "openclaw":
      return path.join(home, ".openclaw", "skills");
    case "onmyagent":
      return onmyagentUserSkillsRoot();
    default:
      return "";
  }
}

function skillSourceKey(skillDir) {
  return path.basename(skillDir).toLowerCase();
}

function skillNameKey(name) {
  return String(name ?? "").trim().toLowerCase();
}

function uniqueAgentList(values) {
  const order = ["opencode", "codex", "claude", "openclaw", "hermes", "onmyagent", "unknown"];
  const set = new Set(values.filter(Boolean));
  return order.filter((agent) => set.has(agent));
}

function claudeProjectsRoot() {
  return path.join(getRealHomeDir(), ".claude", "projects");
}

function claudeProjectDirSlug(targetPath) {
  const resolved = path.resolve(String(targetPath ?? "") || getRealHomeDir());
  return resolved.replace(/[^A-Za-z0-9]/g, "-");
}

function parseClaudeSkillListingContent(content) {
  const descriptions = new Map();
  let currentName = null;
  let currentLines = [];
  const flush = () => {
    if (!currentName) return;
    const text = currentLines.join(" ").replace(/\s+/g, " ").trim();
    descriptions.set(currentName, text.length > 220 ? `${text.slice(0, 220)}...` : text);
  };
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+([A-Za-z0-9][A-Za-z0-9_.-]*):\s*(.*)$/);
    if (match) {
      flush();
      currentName = match[1];
      currentLines = [match[2] ?? ""];
    } else if (currentName && line.trim()) {
      currentLines.push(line.trim());
    }
  }
  flush();
  return descriptions;
}

async function walkClaudeProjectJsonlFiles(root, maxDepth = 3) {
  const files = [];
  async function walk(current, depth) {
    if (depth > maxDepth || !(await isDirectory(current))) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(child, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(child);
      }
    }
  }
  await walk(root, 0);
  return files;
}

function claudeSkillListingProjectScore(cwd, workspaceRoot) {
  const resolvedCwd = String(cwd ?? "").trim() ? path.resolve(String(cwd)) : "";
  const resolvedWorkspace = String(workspaceRoot ?? "").trim() ? path.resolve(String(workspaceRoot)) : "";
  const home = getRealHomeDir();
  if (resolvedWorkspace && resolvedCwd === resolvedWorkspace) return 4;
  if (resolvedWorkspace && resolvedCwd.startsWith(`${resolvedWorkspace}${path.sep}`)) return 3;
  if (resolvedCwd === home) return 2;
  if (resolvedCwd) return 1;
  return 0;
}

async function readClaudeRuntimeSkillListings(workspaceRoot) {
  const root = claudeProjectsRoot();
  if (!(await isDirectory(root))) return [];
  const workspaceSlug = claudeProjectDirSlug(workspaceRoot);
  const homeSlug = claudeProjectDirSlug(getRealHomeDir());
  const candidateRoots = [];
  for (const slug of [workspaceSlug, homeSlug]) {
    const candidate = path.join(root, slug);
    if (await isDirectory(candidate)) candidateRoots.push(candidate);
  }
  const scanRoots = candidateRoots.length ? candidateRoots : [root];
  const files = [];
  for (const scanRoot of scanRoots) {
    files.push(...(await walkClaudeProjectJsonlFiles(scanRoot)));
  }

  const listings = [];
  for (const filePath of [...new Set(files)]) {
    let raw = "";
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      if (!line.includes('"skill_listing"')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const attachment = entry?.attachment;
      if (attachment?.type !== "skill_listing") continue;
      const names = Array.isArray(attachment.names) ? attachment.names.filter(Boolean).map(String) : [];
      if (!names.length) continue;
      const timestamp = Date.parse(entry?.timestamp ?? "") || 0;
      listings.push({
        filePath,
        cwd: entry?.cwd ?? "",
        names,
        content: String(attachment.content ?? ""),
        timestamp,
        score: claudeSkillListingProjectScore(entry?.cwd, workspaceRoot),
      });
    }
  }
  listings.sort((a, b) => (b.score - a.score) || (b.timestamp - a.timestamp));
  return listings;
}

async function collectClaudeRuntimeSkills(workspaceRoot) {
  const out = new Map();
  const listings = await readClaudeRuntimeSkillListings(workspaceRoot);
  for (const listing of listings) {
    const descriptions = parseClaudeSkillListingContent(listing.content);
    for (const name of listing.names) {
      const key = `claude-runtime:${skillNameKey(name)}`;
      if (out.has(key)) continue;
      out.set(key, {
        name,
        path: listing.filePath,
        description: descriptions.get(name) || `Claude Code runtime skill: ${name}`,
        trigger: undefined,
        root: path.dirname(listing.filePath),
        readonly: true,
        displayNameZh: undefined,
        displayNameEn: name,
        descriptionZh: undefined,
        descriptionEn: undefined,
        agents: ["claude"],
        scopeLabel: "Claude Runtime",
        sources: [{
          agent: "claude",
          label: "Claude Code",
          scope: CLAUDE_RUNTIME_BUILTIN_SKILL_NAMES.has(name) ? "builtin-command" : "runtime-skill",
          root: path.dirname(listing.filePath),
          path: listing.filePath,
          managedByStudioSwitch: false,
          kind: CLAUDE_RUNTIME_BUILTIN_SKILL_NAMES.has(name) ? "slash-command" : "runtime-skill",
          pluginName: null,
        }],
        managedByStudioSwitch: false,
        studioSwitch: null,
        kind: CLAUDE_RUNTIME_BUILTIN_SKILL_NAMES.has(name) ? "slash-command" : "runtime-skill",
        pluginName: null,
        lastSeenAt: listing.timestamp || null,
      });
    }
  }
  return out;
}

function readStudioSwitchManagedSkills() {
  const dbPath = studioSwitchDatabasePath();
  if (!existsSync(dbPath)) return new Map();
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const hasSkillsTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'skills'").get();
    if (!hasSkillsTable) return new Map();
    const rows = db
      .prepare(
        `SELECT id, name, description, directory, repo_owner, repo_name, repo_branch, readme_url,
                enabled_claude, enabled_codex, enabled_opencode, enabled_hermes, installed_at, content_hash, updated_at
           FROM skills`,
      )
      .all();
    const out = new Map();
    for (const row of rows) {
      const directory = String(row.directory ?? "").trim();
      if (!directory) continue;
      const agents = [];
      for (const [column, agent] of Object.entries(STUDIO_SWITCH_SKILL_AGENT_BY_COLUMN)) {
        if (Boolean(row[column])) agents.push(agent);
      }
      out.set(directory.toLowerCase(), {
        id: row.id,
        name: row.name,
        description: row.description,
        directory,
        repoOwner: row.repo_owner,
        repoName: row.repo_name,
        repoBranch: row.repo_branch,
        readmeUrl: row.readme_url,
        agents,
        installedAt: row.installed_at,
        contentHash: row.content_hash,
        updatedAt: row.updated_at,
      });
    }
    return out;
  } catch (error) {
    console.warn("[agent-management] failed to read studio-switch skills db", error);
    return new Map();
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

async function collectAgentSkillRoots(projectDir) {
  const roots = [];
  const realHome = getRealHomeDir();
  const push = async (candidate) => {
    if (!candidate?.root || !(await isDirectory(candidate.root))) return;
    if (roots.some((root) => root.root === candidate.root && root.agent === candidate.agent && root.scope === candidate.scope)) return;
    roots.push(candidate);
  };

  const workspaceRoot = String(projectDir ?? "").trim() ? path.resolve(projectDir) : "";
  if (workspaceRoot) {
    let current = workspaceRoot;
    while (true) {
      if (current === realHome || path.dirname(current) === current) break;
      for (const source of AGENT_SKILL_SOURCES) {
        for (const subpath of source.subpaths) {
          await push({
            root: path.join(current, ...subpath),
            agent: source.agent,
            label: source.label,
            scope: "project",
          });
        }
      }
      if (await pathExists(path.join(current, ".git"))) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  for (const source of AGENT_SKILL_SOURCES) {
    for (const subpath of source.subpaths) {
      await push({
        root: path.join(realHome, ...subpath),
        agent: source.agent,
        label: source.label,
        scope: "global",
      });
    }
  }

  for (const source of AGENT_SKILL_SOURCES) {
    const root = standardAgentSkillDir(source.agent);
    if (root) {
      await push({ root, agent: source.agent, label: source.label, scope: "global" });
    }
  }

  await push({ root: studioSwitchSkillsRoot(), agent: "unknown", label: "Studio Switch", scope: "studio-switch" });
  await push({ root: unifiedAgentsSkillsRoot(), agent: "unknown", label: "Agent Skills", scope: "agents" });
  const bundledRoot = bundledSkillsRootPath();
  if (bundledRoot) {
    await push({ root: bundledRoot, agent: "onmyagent", label: "OnMyAgent", scope: "builtin" });
  }
  await push({ root: onmyagentUserSkillsRoot(), agent: "onmyagent", label: "OnMyAgent", scope: "onmyagent" });

  return roots;
}

async function copyDirectoryRecursive(source, destination) {
  await cp(source, destination, { recursive: true, force: true, errorOnExist: false, verbatimSymlinks: true });
}

async function removePathIfPresent(target) {
  await rm(target, { recursive: true, force: true });
}

function validateSkillDirectoryName(directory) {
  const value = String(directory ?? "").trim();
  if (!value || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
    throw new Error("Invalid skill directory");
  }
  return value;
}

function sanitizeManagedSkillName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function escapeSkillFrontmatterValue(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/"/g, "\\\"").trim();
}

function runtimeManagedSkillContent({ name, displayName, description, agent, kind, sourcePath }) {
  const title = displayName || name;
  const sourceKind = kind === "slash-command" ? "Slash Command" : kind === "plugin" ? "Plugin" : "Runtime Skill";
  const summary = description || `${sourceKind} imported from ${agent}.`;
  return `---
name: "${escapeSkillFrontmatterValue(title)}"
description: "${escapeSkillFrontmatterValue(summary)}"
---

# ${title}

This is a Studio-managed wrapper for a ${sourceKind} discovered from ${agent}.

## Source

- Agent: ${agent}
- Kind: ${sourceKind}
- Source path: ${sourcePath || "unknown"}

## Behavior

${summary}

## Notes

The original item was discovered from runtime metadata rather than a standalone SKILL.md directory. This wrapper makes it manageable through Studio/Studio Switch style skill syncing. If the original runtime item depends on built-in agent behavior, this wrapper documents and routes the intent but may not reproduce private built-in implementation details.
`;
}

function ensureStudioSwitchSkillSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    directory TEXT NOT NULL,
    repo_owner TEXT,
    repo_name TEXT,
    repo_branch TEXT DEFAULT 'main',
    readme_url TEXT,
    enabled_claude BOOLEAN NOT NULL DEFAULT 0,
    enabled_codex BOOLEAN NOT NULL DEFAULT 0,
    enabled_gemini BOOLEAN NOT NULL DEFAULT 0,
    enabled_opencode BOOLEAN NOT NULL DEFAULT 0,
    enabled_hermes BOOLEAN NOT NULL DEFAULT 0,
    installed_at INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`);
}

async function hashDirectoryForAgentManagement(dir) {
  const files = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const child = path.join(current, entry.name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(child)))) {
        await walk(child);
      } else if (entry.isFile()) {
        files.push(child);
      }
    }
  }
  await walk(dir);
  files.sort();
  const hash = createHash("sha256");
  for (const filePath of files) {
    const relative = path.relative(dir, filePath).replace(/\\/g, "/");
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function saveImportedStudioSwitchSkill({ directory, name, description, agent, contentHash }) {
  const dbPath = studioSwitchDatabasePath();
  await mkdir(path.dirname(dbPath), { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  const id = `studio:${directory}`;
  const columns = {
    claude: "enabled_claude",
    codex: "enabled_codex",
    opencode: "enabled_opencode",
    hermes: "enabled_hermes",
    gemini: "enabled_gemini",
  };
  let db;
  try {
    db = new DatabaseSync(dbPath);
    ensureStudioSwitchSkillSchema(db);
    const existing = db.prepare("SELECT id FROM skills WHERE lower(directory) = lower(?) LIMIT 1").get(directory);
    if (existing) {
      db.prepare("UPDATE skills SET name = ?, description = ?, content_hash = ?, updated_at = ? WHERE id = ?")
        .run(name, description || null, contentHash || null, now, existing.id);
      const column = columns[agent];
      if (column) db.prepare(`UPDATE skills SET ${column} = 1, updated_at = ? WHERE id = ?`).run(now, existing.id);
      return existing.id;
    }
    db.prepare(`INSERT INTO skills (
      id, name, description, directory, repo_owner, repo_name, repo_branch, readme_url,
      enabled_claude, enabled_codex, enabled_gemini, enabled_opencode, enabled_hermes,
      installed_at, content_hash, updated_at
    ) VALUES (?, ?, ?, ?, NULL, NULL, 'main', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        name,
        description || null,
        directory,
        agent === "claude" ? 1 : 0,
        agent === "codex" ? 1 : 0,
        agent === "gemini" ? 1 : 0,
        agent === "opencode" ? 1 : 0,
        agent === "hermes" ? 1 : 0,
        now,
        contentHash || null,
        now,
      );
    return id;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

async function isSymlink(target) {
  try {
    const metadata = await lstat(target);
    return metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

async function symlinkTargetStartsWith(linkPath, root) {
  if (!(await isSymlink(linkPath))) return false;
  try {
    const target = await readlink(linkPath);
    const resolved = path.isAbsolute(target) ? target : path.resolve(path.dirname(linkPath), target);
    const [realTarget, realRoot] = await Promise.all([
      realpath(resolved).catch(() => resolved),
      realpath(root).catch(() => root),
    ]);
    return realTarget === realRoot || realTarget.startsWith(`${realRoot}${path.sep}`);
  } catch {
    return false;
  }
}

async function agentManagementSkillAction(input = {}) {
  const action = String(input?.action ?? "").trim();
  const agent = String(input?.agent ?? "").trim();
  const directory = validateSkillDirectoryName(input?.directory);
  const displayName = String(input?.displayName ?? directory).trim() || directory;
  const description = String(input?.description ?? "").trim();
  const kind = String(input?.kind ?? "skill").trim();

  const requestedSource = String(input?.sourcePath ?? "").trim();
  const source = requestedSource || path.join(studioSwitchSkillsRoot(), directory);
  const fallbackSource = path.join(unifiedAgentsSkillsRoot(), directory);
  const sourceDir = (await isDirectory(source)) ? source : fallbackSource;

  if (action === "open") {
    const destinationRoot = standardAgentSkillDir(agent);
    const destination = destinationRoot ? path.join(destinationRoot, directory) : "";
    const target = destination && (await isDirectory(destination)) ? destination : sourceDir;
    if (await isDirectory(target)) return { ok: true, path: target, result: await shell.openPath(target) };
    try {
      const metadata = await stat(target);
      if (metadata.isFile()) {
        return { ok: true, path: target, result: await shell.showItemInFolder(target) };
      }
    } catch {
      // fall through
    }
    throw new Error("Skill directory not found");
  }

  if (action === "import") {
    const managedDirectory = sanitizeManagedSkillName(directory);
    if (!managedDirectory) throw new Error("Invalid skill directory");
    const destinationRoot = studioSwitchSkillsRoot();
    const destination = path.join(destinationRoot, managedDirectory);
    await mkdir(destinationRoot, { recursive: true });

    const hasSkillSource = (await isDirectory(sourceDir)) && (await pathExists(path.join(sourceDir, "SKILL.md")));
    if (hasSkillSource) {
      if (path.resolve(sourceDir) !== path.resolve(destination)) {
        await removePathIfPresent(destination);
        await copyDirectoryRecursive(sourceDir, destination);
      }
    } else {
      await removePathIfPresent(destination);
      await mkdir(destination, { recursive: true });
      await writeFile(path.join(destination, "SKILL.md"), runtimeManagedSkillContent({
        name: managedDirectory,
        displayName,
        description,
        agent,
        kind,
        sourcePath: requestedSource,
      }), "utf8");
      await writeFile(path.join(destination, "studio-source.json"), JSON.stringify({
        importedAt: new Date().toISOString(),
        sourceAgent: agent,
        sourceKind: kind,
        sourcePath: requestedSource || null,
        originalName: directory,
      }, null, 2), "utf8");
    }

    const contentHash = await hashDirectoryForAgentManagement(destination).catch(() => null);
    await saveImportedStudioSwitchSkill({
      directory: managedDirectory,
      name: displayName,
      description,
      agent,
      contentHash,
    });

    if (STUDIO_SKILL_SYNC_AGENTS.includes(agent)) {
      const targetRoot = standardAgentSkillDir(agent);
      const target = targetRoot ? path.join(targetRoot, managedDirectory) : "";
      if (target && path.resolve(target) !== path.resolve(destination)) {
        await mkdir(targetRoot, { recursive: true });
        await removePathIfPresent(target);
        try {
          await fsSymlink(destination, target, "dir");
        } catch {
          await copyDirectoryRecursive(destination, target);
        }
      }
    }

    return { ok: true, action, agent, directory: managedDirectory, path: destination };
  }

  if (!STUDIO_SKILL_SYNC_AGENTS.includes(agent)) {
    throw new Error("Unsupported skill agent");
  }

  const destinationRoot = standardAgentSkillDir(agent);
  const destination = path.join(destinationRoot, directory);

  if (action === "enable") {
    if (!(await isDirectory(sourceDir)) || !(await pathExists(path.join(sourceDir, "SKILL.md")))) {
      throw new Error("Skill source is missing SKILL.md");
    }
    await mkdir(destinationRoot, { recursive: true });
    await removePathIfPresent(destination);
    try {
      await fsSymlink(sourceDir, destination, "dir");
    } catch {
      await copyDirectoryRecursive(sourceDir, destination);
    }
    await setStudioSwitchSkillAgentEnabled(directory, agent, true);
    return { ok: true, action, agent, directory, path: destination };
  }

  if (action === "disable") {
    if (await isSymlink(destination)) {
      await removePathIfPresent(destination);
    } else if (await isDirectory(destination)) {
      const [realSource, realDestination] = await Promise.all([
        realpath(sourceDir).catch(() => path.resolve(sourceDir)),
        realpath(destination).catch(() => path.resolve(destination)),
      ]);
      if (realSource === realDestination) {
        throw new Error("未托管 Skill 位于当前应用目录，已拒绝直接删除；请先同步到 Studio Switch/Agents 源目录后再禁用。");
      }
      await removePathIfPresent(destination);
    }
    await setStudioSwitchSkillAgentEnabled(directory, agent, false);
    return { ok: true, action, agent, directory, path: destination };
  }

  throw new Error("Unsupported skill action");
}

async function setStudioSwitchSkillAgentEnabled(directory, agent, enabled) {
  const dbPath = studioSwitchDatabasePath();
  const column = STUDIO_SWITCH_SKILL_COLUMNS_BY_AGENT[agent];
  if (!column || !existsSync(dbPath)) return false;
  let db;
  try {
    db = new DatabaseSync(dbPath);
    const row = db.prepare("SELECT id FROM skills WHERE lower(directory) = lower(?) LIMIT 1").get(directory);
    if (!row) return false;
    db.prepare(`UPDATE skills SET ${column} = ?, updated_at = ? WHERE id = ?`).run(enabled ? 1 : 0, Math.floor(Date.now() / 1000), row.id);
    return true;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

async function findSkillDirsRecursive(root, maxDepth = 4) {
  const found = [];
  async function walk(current, depth) {
    if (depth > maxDepth || !(await isDirectory(current))) return;
    if (await pathExists(path.join(current, "SKILL.md"))) {
      found.push(current);
      return;
    }
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".system") continue;
      const child = path.join(current, entry.name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(child)))) {
        await walk(child, depth + 1);
      }
    }
  }
  await walk(root, 0);
  return found;
}

async function scanAgentManagementSkills(projectDir) {
  const LOCALE_KEYS = ["display_name_zh", "display_name_en", "description_zh", "description_en"];
  const studioSwitchManaged = readStudioSwitchManagedSkills();
  const claudeRuntimeSkills = await collectClaudeRuntimeSkills(projectDir);
  const skills = new Map();

  for (const source of await collectAgentSkillRoots(projectDir)) {
    for (const skillDir of await findSkillDirsRecursive(source.root)) {
      const directory = path.basename(skillDir);
      const key = skillSourceKey(skillDir);
      let raw = "";
      try {
        raw = await readFile(path.join(skillDir, "SKILL.md"), "utf8");
      } catch {
        raw = "";
      }
      const managed = studioSwitchManaged.get(key) ?? null;
      const localeMap = extractFrontmatterMap(raw, LOCALE_KEYS);
      const existing = skills.get(key) ?? {
        name: directory,
        path: skillDir,
        description: undefined,
        trigger: undefined,
        root: source.root,
        readonly: source.scope === "builtin",
        displayNameZh: undefined,
        displayNameEn: undefined,
        descriptionZh: undefined,
        descriptionEn: undefined,
        agents: [],
        scopeLabel: "本机",
        sources: [],
        managedByStudioSwitch: false,
        studioSwitch: null,
        kind: "skill",
        pluginName: null,
        lastSeenAt: null,
      };

      const sourceAgents = uniqueAgentList([...(managed?.agents ?? []), source.agent]);
      existing.name = managed?.directory || existing.name || directory;
      existing.description = existing.description || managed?.description || extractDescription(raw) || undefined;
      existing.trigger = existing.trigger || extractTrigger(raw) || undefined;
      existing.displayNameZh = existing.displayNameZh || localeMap.display_name_zh;
      existing.displayNameEn = existing.displayNameEn || localeMap.display_name_en || managed?.name;
      existing.descriptionZh = existing.descriptionZh || localeMap.description_zh;
      existing.descriptionEn = existing.descriptionEn || localeMap.description_en;
      existing.readonly = existing.readonly || source.scope === "builtin";
      existing.managedByStudioSwitch = existing.managedByStudioSwitch || Boolean(managed);
      existing.studioSwitch = existing.studioSwitch || managed;
      existing.agents = uniqueAgentList([...existing.agents, ...sourceAgents]);
      existing.sources.push({
        agent: source.agent,
        label: source.label,
        scope: source.scope,
        root: source.root,
        path: skillDir,
        managedByStudioSwitch: Boolean(managed),
        kind: "skill",
        pluginName: null,
      });
      skills.set(key, existing);
    }
  }

  for (const [key, runtimeSkill] of claudeRuntimeSkills) {
    const plainNameKey = skillNameKey(runtimeSkill.name);
    const existingKey = [...skills.keys()].find((candidate) => candidate === plainNameKey || candidate.endsWith(`:${plainNameKey}`));
    if (existingKey) {
      const existing = skills.get(existingKey);
      existing.description = existing.description || runtimeSkill.description;
      existing.readonly = existing.readonly || runtimeSkill.readonly;
      existing.agents = uniqueAgentList([...existing.agents, "claude"]);
      existing.sources.push(...runtimeSkill.sources);
      existing.lastSeenAt = existing.lastSeenAt || runtimeSkill.lastSeenAt;
      skills.set(existingKey, existing);
    } else {
      skills.set(key, runtimeSkill);
    }
  }

  for (const [key, managed] of studioSwitchManaged) {
    if (skills.has(key)) continue;
    skills.set(key, {
      name: managed.directory,
      path: path.join(studioSwitchSkillsRoot(), managed.directory),
      description: managed.description || undefined,
      trigger: undefined,
      root: studioSwitchSkillsRoot(),
      readonly: false,
      displayNameZh: undefined,
      displayNameEn: managed.name,
      descriptionZh: undefined,
      descriptionEn: undefined,
      agents: uniqueAgentList(managed.agents.length ? managed.agents : ["unknown"]),
      scopeLabel: "Studio Switch",
      sources: [{
        agent: "unknown",
        label: "Studio Switch",
        scope: "studio-switch-db",
        root: studioSwitchSkillsRoot(),
        path: path.join(studioSwitchSkillsRoot(), managed.directory),
        managedByStudioSwitch: true,
        kind: "skill",
        pluginName: null,
      }],
      managedByStudioSwitch: true,
      studioSwitch: managed,
      kind: "skill",
      pluginName: null,
      lastSeenAt: null,
    });
  }

  return [...skills.values()]
    .map((skill) => ({
      ...skill,
      agents: uniqueAgentList([
        ...(skill.agents.length ? skill.agents : skillAgentsFromPath(skill)),
        ...skill.sources.map((source) => source.agent),
      ]),
      scopeLabel: skill.managedByStudioSwitch ? "Studio Switch" : skill.kind === "runtime-skill" ? "Claude Runtime" : skill.kind === "slash-command" ? "Slash Command" : skillScopeLabel(skill, projectDir),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function skillScopeLabel(skill, workspaceRoot) {
  const root = String(skill.root ?? "");
  const skillPath = String(skill.path ?? "");
  const bundledRoot = bundledSkillsRootPath();
  if (bundledRoot && (root === bundledRoot || skillPath.startsWith(bundledRoot))) return "内置";
  if (root === onmyagentUserSkillsRoot() || skillPath.startsWith(onmyagentUserSkillsRoot())) return "OnMyAgent";
  if (workspaceRoot && skillPath.startsWith(path.resolve(workspaceRoot))) return "项目";
  return "本机";
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
    personalAgentRuntime.listAgents({ workspaceRoot, includeModels: true }),
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
      usage: usageByProvider.get(agent.provider) ?? personalAgentLegacyHarness.emptyAgentUsageSummary(),
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
    plugin: [BROWSER_PLUGIN],
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
  channelInfrastructureApi,
} = createDesktopPersonalRuntimeServices({
  app,
  runtimeManager,
  readWorkspaceState,
  claudeProjectsRoot,
});

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

async function handleDesktopInvoke(event, command, ...args) {
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
    // --- Channel Infrastructure API ---
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
      trafficLightPosition: { x: 4, y: 12 },
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
    if (isDevMode) {
      try {
        mainWindow?.webContents.openDevTools({ mode: "detach" });
      } catch (error) {
        console.warn("[main] openDevTools failed:", error?.message ?? error);
      }
    }
    flushPendingDeepLinks();
  });

  mainWindow.on("closed", () => {
    embeddedBrowserPanel.destroyBrowserView();
    embeddedBrowserPanel.setMainWindow(null);
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const local =
      url.startsWith("file://") ||
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("http://localhost");
    if (!local) {
      void embeddedBrowserPanel.openAllowedExternalUrl(url);
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

  embeddedBrowserPanel.setMainWindow(mainWindow);
  if (!embeddedBrowserPanel.hasActiveBrowserTab()) {
    embeddedBrowserPanel.createBrowserTab("about:blank", { select: true });
  }

  return mainWindow;
}

const DESKTOP_IPC_CHANNEL = "onmyagent:desktop";
const LEGACY_DESKTOP_IPC_CHANNEL = "open" + "work:desktop";
ipcMain.handle(DESKTOP_IPC_CHANNEL, handleDesktopInvoke);
ipcMain.handle(LEGACY_DESKTOP_IPC_CHANNEL, handleDesktopInvoke);
ipcMain.handle("onmyagent:shell:openExternal", async (_event, url) => {
  return embeddedBrowserPanel.openAllowedExternalUrl(url);
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

// ── Embedded browser IPC ────────────────────────────────────────────────
ipcMain.handle("onmyagent:browser:show", (_event, bounds) =>
  embeddedBrowserPanel.attachBrowserView(bounds),
);
ipcMain.handle("onmyagent:browser:hide", () =>
  embeddedBrowserPanel.hideBrowserView(),
);
ipcMain.handle("onmyagent:browser:navigate", (_event, url, options) =>
  embeddedBrowserPanel.navigate(url, options),
);
ipcMain.handle("onmyagent:browser:back", () => embeddedBrowserPanel.goBack());
ipcMain.handle("onmyagent:browser:forward", () =>
  embeddedBrowserPanel.goForward(),
);
ipcMain.handle("onmyagent:browser:reload", () =>
  embeddedBrowserPanel.reload(),
);
ipcMain.handle("onmyagent:browser:bounds", (_event, bounds) =>
  embeddedBrowserPanel.setBounds(bounds),
);
ipcMain.handle("onmyagent:browser:state", () =>
  embeddedBrowserPanel.browserStatePayload(),
);
ipcMain.handle("onmyagent:browser:createTab", (_event, url) => {
  const tab = embeddedBrowserPanel.createBrowserTab(url ?? "about:blank", {
    select: true,
  });
  return { tabId: tab.tabId };
});
ipcMain.handle("onmyagent:browser:closeTab", (_event, tabId) =>
  embeddedBrowserPanel.closeBrowserTab(tabId == null ? undefined : String(tabId)),
);
ipcMain.handle("onmyagent:browser:closeAllTabs", () =>
  embeddedBrowserPanel.closeAllBrowserTabs(),
);
ipcMain.handle("onmyagent:browser:selectTab", (_event, tabId) =>
  embeddedBrowserPanel.selectBrowserTab(String(tabId ?? "")).tabId,
);
ipcMain.handle("onmyagent:browser:reorderTabs", (_event, tabIds) =>
  embeddedBrowserPanel.reorderBrowserTabs(tabIds),
);
ipcMain.handle("onmyagent:browser:listTabs", () =>
  embeddedBrowserPanel.listBrowserTabs(),
);
ipcMain.handle("onmyagent:browser:tabContextMenu", (_event, tabId, point) =>
  embeddedBrowserPanel.showBrowserTabContextMenu(tabId, point),
);
ipcMain.handle("onmyagent:browser:destroy", () =>
  embeddedBrowserPanel.destroyBrowserView(),
);
ipcMain.on("onmyagent:menu-overlay:ready", (event) =>
  embeddedBrowserPanel.onMenuOverlayReady(event),
);
ipcMain.on("onmyagent:menu-overlay:choose", (event, payload) =>
  embeddedBrowserPanel.onMenuOverlayChoose(event, payload),
);
ipcMain.on("onmyagent:menu-overlay:close", (event, payload) =>
  embeddedBrowserPanel.onMenuOverlayClose(event, payload),
);
ipcMain.on("onmyagent:menu-overlay:dismiss", (event) =>
  embeddedBrowserPanel.onMenuOverlayDismiss(event),
);

registerMigrationIpc({ app, ipcMain });
const { ensureAutoUpdater } = registerUpdaterIpc({
  app,
  ipcMain,
  getMainWindow: () => mainWindow,
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
      uiControlBridge.stop(),
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
    installMediaPermissionHandlers();
    installApplicationMenu();

    await ensureOnMyAgentUserDataDirs();

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

    queueDeepLinks(forwardedDeepLinks(process.argv));
    const win = await createMainWindow();
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
