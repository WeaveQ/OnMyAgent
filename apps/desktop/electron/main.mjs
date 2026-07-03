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
  selectOpenworkWorkspaceForConnection,
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
const MAIN_WINDOW_MIN_WIDTH = 1280;
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
  if (raw.includes(".onmyagent") || raw.includes("bundled-skills")) agents.push("onmyagent");
  return agents.length ? [...new Set(agents)] : ["unknown"];
}

const STUDIO_SWITCH_SKILL_AGENT_BY_COLUMN = {
  enabled_claude: "claude",
  enabled_codex: "codex",
  enabled_opencode: "opencode",
  enabled_hermes: "hermes",
};

const STUDIO_SWITCH_SKILL_COLUMNS_BY_AGENT = {
  claude: "enabled_claude",
  codex: "enabled_codex",
  opencode: "enabled_opencode",
  hermes: "enabled_hermes",
};

const AGENT_SKILL_SOURCES = [
  { agent: "opencode", label: "OpenCode", subpaths: [[".opencode", "skills"], [".opencode", "skill"]] },
  { agent: "claude", label: "Claude Code", subpaths: [[".claude", "skills"]] },
  { agent: "codex", label: "Codex", subpaths: [[".codex", "skills"]] },
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
  const workspaceRoot = String(input?.workspaceRoot ?? "").trim();
  const proxyPreferences = workspaceRoot ? await personalAgentLegacyHarness.readAgentManagementPreferences(workspaceRoot).catch(() => null) : null;
  const proxy = normalizeAgentManagementProxy(proxyPreferences?.proxy ?? {});
  const proxyTakeoverActive = proxy.enabled && Boolean(proxy.takeover?.[appType]) && ["claude", "codex"].includes(appType);
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
    } else if (input?.syncLive !== false && proxyTakeoverActive) {
      await startStudioAgentProxy(proxy);
      await applyStudioProxyTakeoverLive(proxy, appType, true);
    }
    return { ok: true, action, appType, providerId: saved.id, providers: await readAgentManagementProvidersSnapshot() };
  }

  const providerId = sanitizeProviderKey(input?.providerId ?? input?.id ?? input?.provider?.id);
  if (!providerId) throw new Error("providerId is required");

  if (action === "syncLive") {
    const provider = readStudioSwitchProviders(appType).find((item) => item.id === providerId);
    if (!provider) throw new Error(`Provider ${providerId} does not exist`);
    if (proxyTakeoverActive) {
      await startStudioAgentProxy(proxy);
      await applyStudioProxyTakeoverLive(proxy, appType, true);
    } else {
      await writeAgentManagementProviderLive(provider);
    }
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
      if (proxyTakeoverActive) {
        await startStudioAgentProxy(proxy);
        await applyStudioProxyTakeoverLive(proxy, appType, true);
      } else {
        await writeAgentManagementProviderLive(provider);
      }
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
    ) VALUES (?, ?, ?, ?, NULL, NULL, 'main', NULL, ?, ?, 0, ?, ?, ?, ?, ?)`)
      .run(
        id,
        name,
        description || null,
        directory,
        agent === "claude" ? 1 : 0,
        agent === "codex" ? 1 : 0,
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

function providerOptionsForAgent(agent) {
  const options = (agent.modelOptions ?? []).map((option) => ({
    id: option.id,
    label: option.label || option.id,
    source: option.label?.startsWith("Agent 管理") ? "workspace-preference" : "detected",
    active: option.id === (agent.model || agent.defaultModel),
  }));
  if (!options.length && (agent.model || agent.defaultModel)) {
    const id = agent.model || agent.defaultModel;
    options.push({ id, label: id, source: "configured", active: true });
  }
  return options;
}

const AGENT_MANAGEMENT_PROXY_AGENTS = ["opencode", "codex", "claude", "hermes", "openclaw"];
const STUDIO_SWITCH_PROXY_APPS = ["claude", "codex", "gemini"];
const STUDIO_AGENT_PROXY_TOKEN_PLACEHOLDER = "studio-agent-proxy";
const CLAUDE_TAKEOVER_MODELS = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
  fable: "claude-fable-5",
};
const studioAgentProxyState = {
  server: null,
  address: null,
  port: null,
  startedAt: null,
  lastError: null,
  totalRequests: 0,
  successRequests: 0,
  failedRequests: 0,
  activeTargets: {},
  failover: { claude: { lastChain: [], lastError: null }, codex: { lastChain: [], lastError: null } },
  circuitBreakers: new Map(),
  usage: { claude: 0, codex: 0 },
  recentRequests: [],
  recentRequestsMax: 50,
};

const STUDIO_PROXY_BREAKER_DEFAULTS = Object.freeze({
  failureThreshold: 4,
  successThreshold: 2,
  timeoutMs: 60_000,
  halfOpenMaxRequests: 1,
});

function studioProxyBreakerKey(appType, providerId) {
  return `${appType}:${providerId}`;
}

function studioProxyBreakerEnsure(appType, providerId) {
  const key = studioProxyBreakerKey(appType, providerId);
  let breaker = studioAgentProxyState.circuitBreakers.get(key);
  if (!breaker) {
    breaker = {
      key,
      appType,
      providerId,
      state: "closed",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      totalRequests: 0,
      failedRequests: 0,
      openedAt: null,
      halfOpenInflight: 0,
      lastEventAt: null,
    };
    studioAgentProxyState.circuitBreakers.set(key, breaker);
  }
  return breaker;
}

function studioProxyBreakerAllow(appType, providerId) {
  const breaker = studioProxyBreakerEnsure(appType, providerId);
  if (breaker.state === "closed") return { allowed: true, usedHalfOpenPermit: false };
  if (breaker.state === "open") {
    const elapsed = breaker.openedAt ? Date.now() - breaker.openedAt : Infinity;
    if (elapsed < STUDIO_PROXY_BREAKER_DEFAULTS.timeoutMs) {
      return { allowed: false, usedHalfOpenPermit: false };
    }
    breaker.state = "half_open";
    breaker.consecutiveSuccesses = 0;
    breaker.halfOpenInflight = 0;
    breaker.lastEventAt = Date.now();
    broadcastStudioProxyEvent("circuit-breaker", { providerId, appType, state: "half_open" });
  }
  if (breaker.state === "half_open") {
    if (breaker.halfOpenInflight >= STUDIO_PROXY_BREAKER_DEFAULTS.halfOpenMaxRequests) {
      return { allowed: false, usedHalfOpenPermit: false };
    }
    breaker.halfOpenInflight += 1;
    return { allowed: true, usedHalfOpenPermit: true };
  }
  return { allowed: true, usedHalfOpenPermit: false };
}

function studioProxyBreakerRecordSuccess(appType, providerId, usedHalfOpenPermit) {
  const breaker = studioProxyBreakerEnsure(appType, providerId);
  breaker.totalRequests += 1;
  breaker.consecutiveFailures = 0;
  breaker.lastEventAt = Date.now();
  if (breaker.state === "half_open") {
    if (usedHalfOpenPermit) breaker.halfOpenInflight = Math.max(0, breaker.halfOpenInflight - 1);
    breaker.consecutiveSuccesses += 1;
    if (breaker.consecutiveSuccesses >= STUDIO_PROXY_BREAKER_DEFAULTS.successThreshold) {
      breaker.state = "closed";
      breaker.openedAt = null;
      breaker.consecutiveSuccesses = 0;
      broadcastStudioProxyEvent("circuit-breaker", { providerId, appType, state: "closed" });
    }
  }
}

function studioProxyBreakerRecordFailure(appType, providerId, usedHalfOpenPermit) {
  const breaker = studioProxyBreakerEnsure(appType, providerId);
  breaker.totalRequests += 1;
  breaker.failedRequests += 1;
  breaker.consecutiveFailures += 1;
  breaker.lastEventAt = Date.now();
  if (breaker.state === "half_open") {
    if (usedHalfOpenPermit) breaker.halfOpenInflight = Math.max(0, breaker.halfOpenInflight - 1);
    breaker.state = "open";
    breaker.openedAt = Date.now();
    breaker.consecutiveSuccesses = 0;
    broadcastStudioProxyEvent("circuit-breaker", { providerId, appType, state: "open" });
    return;
  }
  if (breaker.consecutiveFailures >= STUDIO_PROXY_BREAKER_DEFAULTS.failureThreshold) {
    breaker.state = "open";
    breaker.openedAt = Date.now();
    broadcastStudioProxyEvent("circuit-breaker", { providerId, appType, state: "open" });
  }
}

function broadcastStudioProxyEvent(type, payload) {
  try {
    if (typeof mainWindow !== "undefined" && mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("agent-management:proxy-event", { type, payload, at: Date.now() });
    }
  } catch {}
}

function recordStudioProxyRequest(entry) {
  const stamped = { ...entry, at: Date.now() };
  const list = studioAgentProxyState.recentRequests;
  list.push(stamped);
  if (list.length > studioAgentProxyState.recentRequestsMax) list.splice(0, list.length - studioAgentProxyState.recentRequestsMax);
  studioProxyPersistRequest(stamped);
  broadcastStudioProxyEvent("request-recorded", stamped);
}

function selectAgentProvidersForFailover(appType) {
  const all = readStudioSwitchProviders(appType);
  const current = all.find((p) => p.isCurrent) ?? all[0] ?? null;
  if (!current) return [];
  const queueFlagged = all.filter((p) => p.inFailoverQueue && p.id !== current.id);
  const ordered = [current, ...queueFlagged];
  const filtered = [];
  for (const provider of ordered) {
    const allow = studioProxyBreakerAllow(appType, provider.id);
    if (allow.allowed) filtered.push({ provider, usedHalfOpenPermit: allow.usedHalfOpenPermit });
  }
  if (!filtered.length && current) {
    const breaker = studioProxyBreakerEnsure(appType, current.id);
    if (breaker.state !== "closed") {
      breaker.state = "half_open";
      breaker.halfOpenInflight = 1;
      breaker.openedAt = null;
      broadcastStudioProxyEvent("circuit-breaker", { providerId: current.id, appType, state: "half_open", forced: true });
      filtered.push({ provider: current, usedHalfOpenPermit: true });
    }
  }
  return filtered;
}

async function tryAgentProvidersWithFailover(appType, runOnce) {
  const candidates = selectAgentProvidersForFailover(appType);
  if (!candidates.length) {
    studioAgentProxyState.failover[appType] = { lastChain: [], lastError: "no-provider-available" };
    throw new Error(`No available ${appType} provider (all circuit breakers open)`);
  }
  const chain = [];
  let lastError = null;
  for (const { provider, usedHalfOpenPermit } of candidates) {
    try {
      const value = await runOnce(provider);
      studioProxyBreakerRecordSuccess(appType, provider.id, usedHalfOpenPermit);
      chain.push({ providerId: provider.id, providerName: provider.name, ok: true });
      studioAgentProxyState.failover[appType] = { lastChain: chain, lastError: null };
      if (chain.length > 1) broadcastStudioProxyEvent("failover-recovered", { appType, providerId: provider.id, attempts: chain.length });
      return { provider, value, chain };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const message = lastError.message;
      studioProxyBreakerRecordFailure(appType, provider.id, usedHalfOpenPermit);
      chain.push({ providerId: provider.id, providerName: provider.name, ok: false, error: message });
      broadcastStudioProxyEvent("failover-attempt", { appType, providerId: provider.id, error: message });
      continue;
    }
  }
  studioAgentProxyState.failover[appType] = { lastChain: chain, lastError: lastError?.message ?? "unknown" };
  throw lastError ?? new Error(`All ${appType} providers failed`);
}

function studioProxyUsageDbPath() {
  return path.join(getRealHomeDir(), ".onmyagent-studio", "agent-proxy-usage.sqlite");
}

function withStudioProxyUsageDatabase(callback, options = {}) {
  const dbPath = studioProxyUsageDbPath();
  if (!options.readOnly) mkdirSyncIfNeeded(path.dirname(dbPath));
  if (options.readOnly && !existsSync(dbPath)) return callback(null);
  let db;
  try {
    db = options.readOnly ? new DatabaseSync(dbPath, { readOnly: true }) : new DatabaseSync(dbPath);
    if (!options.readOnly) {
      db.exec(`CREATE TABLE IF NOT EXISTS proxy_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        app_type TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        provider_id TEXT,
        provider_name TEXT,
        model TEXT,
        ok INTEGER NOT NULL,
        status INTEGER,
        duration_ms INTEGER,
        failover_chain TEXT,
        error TEXT
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_proxy_requests_at ON proxy_requests(at DESC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_proxy_requests_app ON proxy_requests(app_type, at DESC)`);
      db.exec(`CREATE TABLE IF NOT EXISTS proxy_usage_daily (
        day TEXT NOT NULL,
        app_type TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        successes INTEGER NOT NULL DEFAULT 0,
        failures INTEGER NOT NULL DEFAULT 0,
        total_duration_ms INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, app_type, provider_id)
      )`);
    }
    return callback(db);
  } finally {
    try { db?.close(); } catch {}
  }
}

function studioProxyDayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function studioProxyPersistRequest(entry) {
  try {
    withStudioProxyUsageDatabase((db) => {
      if (!db) return;
      db.prepare(`INSERT INTO proxy_requests (at, app_type, endpoint, provider_id, provider_name, model, ok, status, duration_ms, failover_chain, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        Number(entry.at ?? Date.now()),
        String(entry.appType ?? ""),
        String(entry.endpoint ?? ""),
        entry.providerId ? String(entry.providerId) : null,
        entry.providerName ? String(entry.providerName) : null,
        entry.model ? String(entry.model) : null,
        entry.ok ? 1 : 0,
        Number.isFinite(Number(entry.status)) ? Number(entry.status) : null,
        Number.isFinite(Number(entry.durationMs)) ? Number(entry.durationMs) : null,
        entry.failoverChain ? JSON.stringify(entry.failoverChain) : null,
        entry.error ? String(entry.error) : null,
      );
      if (entry.providerId) {
        const day = studioProxyDayKey(entry.at ?? Date.now());
        const okFlag = entry.ok ? 1 : 0;
        const failFlag = entry.ok ? 0 : 1;
        const dur = Number.isFinite(Number(entry.durationMs)) ? Number(entry.durationMs) : 0;
        db.prepare(`INSERT INTO proxy_usage_daily (day, app_type, provider_id, requests, successes, failures, total_duration_ms)
          VALUES (?, ?, ?, 1, ?, ?, ?)
          ON CONFLICT(day, app_type, provider_id) DO UPDATE SET
            requests = requests + 1,
            successes = successes + ?,
            failures = failures + ?,
            total_duration_ms = total_duration_ms + ?`).run(
          day, String(entry.appType ?? ""), String(entry.providerId), okFlag, failFlag, dur, okFlag, failFlag, dur,
        );
      }
    });
  } catch (error) {
    console.warn("[studio-proxy] persist usage failed", error?.message ?? error);
  }
}

function studioProxyReadRecentRequests(limit = 50, appType = null) {
  return withStudioProxyUsageDatabase((db) => {
    if (!db) return [];
    if (appType) {
      return db.prepare(`SELECT * FROM proxy_requests WHERE app_type = ? ORDER BY at DESC LIMIT ?`).all(String(appType), Math.max(1, Math.min(500, Number(limit) || 50)));
    }
    return db.prepare(`SELECT * FROM proxy_requests ORDER BY at DESC LIMIT ?`).all(Math.max(1, Math.min(500, Number(limit) || 50)));
  }, { readOnly: true });
}

function studioProxyReadUsageDaily(days = 14) {
  return withStudioProxyUsageDatabase((db) => {
    if (!db) return [];
    return db.prepare(`SELECT day, app_type, provider_id, requests, successes, failures, total_duration_ms FROM proxy_usage_daily ORDER BY day DESC LIMIT ?`).all(Math.max(1, Math.min(120, Number(days) || 14) * 8));
  }, { readOnly: true });
}

function studioProxyFailoverSnapshot() {
  return {
    claude: studioAgentProxyState.failover.claude,
    codex: studioAgentProxyState.failover.codex,
    breakers: [...studioAgentProxyState.circuitBreakers.values()].map((b) => ({
      key: b.key,
      appType: b.appType,
      providerId: b.providerId,
      state: b.state,
      consecutiveFailures: b.consecutiveFailures,
      totalRequests: b.totalRequests,
      failedRequests: b.failedRequests,
      openedAt: b.openedAt,
      lastEventAt: b.lastEventAt,
    })),
    recentRequests: studioAgentProxyState.recentRequests.slice(-20),
  };
}

function defaultAgentManagementProxy() {
  return {
    enabled: false,
    address: "127.0.0.1",
    port: 15721,
    takeover: {},
    targets: {},
    updatedAt: null,
  };
}

function normalizeAgentManagementProxy(proxy = {}) {
  const fallback = defaultAgentManagementProxy();
  const port = Number(proxy.port);
  return {
    enabled: Boolean(proxy.enabled),
    address: typeof proxy.address === "string" && proxy.address.trim() ? proxy.address.trim() : fallback.address,
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback.port,
    takeover: proxy.takeover && typeof proxy.takeover === "object" ? proxy.takeover : {},
    targets: proxy.targets && typeof proxy.targets === "object" ? proxy.targets : {},
    updatedAt: typeof proxy.updatedAt === "number" ? proxy.updatedAt : null,
  };
}

function studioAgentProxyRunning() {
  return Boolean(studioAgentProxyState.server?.listening);
}

function proxyOriginFromConfig(proxy) {
  return `http://${proxy.address}:${proxy.port}`;
}

function appendProxyEndpoint(baseUrl, endpoint) {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/g, "");
  const pathAndQuery = String(endpoint ?? "/").startsWith("/") ? String(endpoint) : `/${endpoint}`;
  const [pathPart, queryPart] = pathAndQuery.split("?", 2);
  const normalizedPath = base.endsWith("/v1") && pathPart.startsWith("/v1/") ? pathPart.slice(3) : pathPart;
  return `${base}${normalizedPath}${queryPart ? `?${queryPart}` : ""}`;
}

function readRequestBodyBuffer(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function parseJsonBuffer(buffer, fallback = {}) {
  if (!buffer?.length) return fallback;
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return fallback;
  }
}

function writeProxyJson(response, statusCode, payload) {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type,x-api-key,anthropic-version,anthropic-beta",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  response.end(body);
}

function writeProxyText(response, statusCode, text) {
  const body = Buffer.from(String(text ?? ""), "utf8");
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": String(body.length),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type,x-api-key,anthropic-version,anthropic-beta",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  response.end(body);
}

function currentAgentManagementProvider(appType) {
  const providers = readStudioSwitchProviders(appType);
  return providers.find((provider) => provider.isCurrent) ?? providers[0] ?? null;
}

function claudeProviderEnv(provider) {
  const settings = provider?.settingsConfig && typeof provider.settingsConfig === "object" ? provider.settingsConfig : {};
  return settings.env && typeof settings.env === "object" ? settings.env : settings;
}

function claudeProviderApiFormat(provider) {
  const settings = provider?.settingsConfig && typeof provider.settingsConfig === "object" ? provider.settingsConfig : {};
  const meta = provider?.meta && typeof provider.meta === "object" ? provider.meta : {};
  const raw = meta.api_format ?? meta.apiFormat ?? settings.api_format ?? settings.apiFormat ?? settings.openrouter_compat_mode;
  if (raw === true) return "openai_chat";
  const value = String(raw ?? "anthropic").trim().toLowerCase();
  if (["openai_chat", "openai-responses", "openai_responses", "gemini_native"].includes(value)) {
    return value.replace("openai-responses", "openai_responses");
  }
  return "anthropic";
}

function mapClaudeProxyModel(body, provider) {
  const env = claudeProviderEnv(provider);
  const original = String(body?.model ?? "").trim();
  if (!original) return body;
  const lower = original.toLowerCase();
  const mapped = lower.includes("fable")
    ? env.ANTHROPIC_DEFAULT_FABLE_MODEL || env.ANTHROPIC_DEFAULT_OPUS_MODEL || env.ANTHROPIC_MODEL
    : lower.includes("haiku")
      ? env.ANTHROPIC_DEFAULT_HAIKU_MODEL || env.ANTHROPIC_MODEL
      : lower.includes("opus")
        ? env.ANTHROPIC_DEFAULT_OPUS_MODEL || env.ANTHROPIC_MODEL
        : lower.includes("sonnet")
          ? env.ANTHROPIC_DEFAULT_SONNET_MODEL || env.ANTHROPIC_MODEL
          : env.ANTHROPIC_MODEL;
  const nextModel = String(mapped || original).replace(/\[1m\]$/i, "").trim();
  return nextModel && nextModel !== original ? { ...body, model: nextModel } : body;
}

function extractProviderBearerToken(provider, appType) {
  const settings = provider?.settingsConfig && typeof provider.settingsConfig === "object" ? provider.settingsConfig : {};
  if (appType === "claude") {
    const env = claudeProviderEnv(provider);
    return env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || settings.apiKey || settings.api_key || "";
  }
  if (appType === "codex") {
    const auth = settings.auth && typeof settings.auth === "object" ? settings.auth : {};
    const envKey = extractTomlString(settings.config, "env_key") || "OPENAI_API_KEY";
    return auth[envKey] || auth.OPENAI_API_KEY || auth.CODEX_API_KEY || extractTomlString(settings.config, "experimental_bearer_token") || "";
  }
  return "";
}

function proxyForwardHeaders(requestHeaders, provider, appType, bodyLength) {
  /** @type {Record<string, string>} */
  const headers = {};
  for (const [key, value] of Object.entries(requestHeaders ?? {})) {
    const lower = key.toLowerCase();
    if (["host", "connection", "content-length", "accept-encoding"].includes(lower)) continue;
    if (["authorization", "x-api-key"].includes(lower)) continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  }
  headers["content-type"] = headers["content-type"] || "application/json";
  headers["content-length"] = String(bodyLength);
  const token = extractProviderBearerToken(provider, appType);
  if (appType === "claude") {
    const env = claudeProviderEnv(provider);
    if (env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) headers["x-api-key"] = String(env.ANTHROPIC_API_KEY);
    else if (token) headers.authorization = `Bearer ${token}`;
    headers["anthropic-version"] = headers["anthropic-version"] || "2023-06-01";
  } else if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

async function streamFetchResponseToNode(fetchResponse, nodeResponse) {
  const headers = {};
  fetchResponse.headers.forEach((value, key) => {
    if (["content-encoding", "transfer-encoding", "connection"].includes(key.toLowerCase())) return;
    headers[key] = value;
  });
  nodeResponse.writeHead(fetchResponse.status, headers);
  if (!fetchResponse.body) {
    nodeResponse.end();
    return;
  }
  for await (const chunk of fetchResponse.body) {
    nodeResponse.write(Buffer.from(chunk));
  }
  nodeResponse.end();
}

function anthropicContentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return String(part.text ?? "");
        if (part?.type === "tool_result") return typeof part.content === "string" ? part.content : JSON.stringify(part.content ?? "");
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function anthropicMessageToOpenAiChat(message) {
  const role = message?.role === "assistant" ? "assistant" : "user";
  const parts = Array.isArray(message?.content) ? message.content : [{ type: "text", text: String(message?.content ?? "") }];
  if (role === "user") {
    const out = [];
    let textBuf = [];
    for (const part of parts) {
      if (part?.type === "tool_result") {
        if (textBuf.length) {
          out.push({ role: "user", content: textBuf.join("\n") });
          textBuf = [];
        }
        out.push({
          role: "tool",
          tool_call_id: String(part.tool_use_id ?? part.tool_call_id ?? ""),
          content: typeof part.content === "string" ? part.content : JSON.stringify(part.content ?? ""),
        });
      } else if (part?.type === "text") {
        textBuf.push(String(part.text ?? ""));
      } else if (typeof part === "string") {
        textBuf.push(part);
      }
    }
    if (textBuf.length) out.push({ role: "user", content: textBuf.join("\n") });
    if (!out.length) out.push({ role: "user", content: "" });
    return out;
  }
  const textParts = [];
  const toolCalls = [];
  for (const part of parts) {
    if (part?.type === "tool_use") {
      toolCalls.push({
        id: String(part.id ?? `call_${toolCalls.length}`),
        type: "function",
        function: { name: String(part.name ?? ""), arguments: JSON.stringify(part.input ?? {}) },
      });
    } else if (part?.type === "text") {
      textParts.push(String(part.text ?? ""));
    } else if (typeof part === "string") {
      textParts.push(part);
    }
  }
  const msg = { role: "assistant", content: textParts.length ? textParts.join("\n") : null };
  if (toolCalls.length) msg.tool_calls = toolCalls;
  return [msg];
}

function anthropicToolsToOpenAiTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  const out = tools.map((tool) => ({
    type: "function",
    function: {
      name: String(tool?.name ?? ""),
      description: typeof tool?.description === "string" ? tool.description : undefined,
      parameters: tool?.input_schema && typeof tool.input_schema === "object" ? tool.input_schema : { type: "object", properties: {} },
    },
  })).filter((t) => t.function.name);
  return out.length ? out : undefined;
}

function anthropicToolChoiceToOpenAi(toolChoice) {
  if (!toolChoice || typeof toolChoice !== "object") return undefined;
  if (toolChoice.type === "any" || toolChoice.type === "auto") return "auto";
  if (toolChoice.type === "tool" && toolChoice.name) return { type: "function", function: { name: String(toolChoice.name) } };
  return undefined;
}

function stripBillingHeader(text) {
  if (typeof text !== "string") return "";
  return text.replace(/^x-anthropic-billing-header:[^\n]*\r?\n\r?\n/i, "");
}

function anthropicSystemToInstructions(system) {
  if (typeof system === "string") return stripBillingHeader(system);
  if (!Array.isArray(system)) return "";
  return system
    .map((part) => {
      if (typeof part === "string") return stripBillingHeader(part);
      if (part && typeof part === "object" && typeof part.text === "string") return stripBillingHeader(part.text);
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function anthropicToolsToResponsesTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  const out = tools
    .filter((tool) => tool?.type !== "BatchTool")
    .map((tool) => ({
      type: "function",
      name: String(tool?.name ?? ""),
      description: typeof tool?.description === "string" ? tool.description : undefined,
      parameters: tool?.input_schema && typeof tool.input_schema === "object" ? tool.input_schema : { type: "object", properties: {} },
    }))
    .filter((t) => t.name);
  return out.length ? out : undefined;
}

function anthropicToolChoiceToResponses(toolChoice) {
  if (!toolChoice) return undefined;
  if (typeof toolChoice === "string") return toolChoice;
  if (toolChoice.type === "any" || toolChoice.type === "auto") return "auto";
  if (toolChoice.type === "tool" && toolChoice.name) return { type: "function", name: String(toolChoice.name) };
  return undefined;
}

function anthropicMessagesToResponsesInput(messages) {
  const input = [];
  for (const msg of Array.isArray(messages) ? messages : []) {
    const role = msg?.role === "assistant" ? "assistant" : "user";
    const content = msg?.content;
    if (typeof content === "string") {
      input.push({ role, content: [{ type: role === "assistant" ? "output_text" : "input_text", text: content }] });
      continue;
    }
    if (!Array.isArray(content)) {
      input.push({ role });
      continue;
    }
    let buffer = [];
    const flushBuffer = () => {
      if (buffer.length) {
        input.push({ role, content: buffer });
        buffer = [];
      }
    };
    for (const block of content) {
      const t = block?.type;
      if (t === "text") {
        buffer.push({ type: role === "assistant" ? "output_text" : "input_text", text: String(block.text ?? "") });
      } else if (t === "image" && block.source) {
        const mediaType = String(block.source.media_type ?? "image/png");
        const data = String(block.source.data ?? "");
        buffer.push({ type: "input_image", image_url: `data:${mediaType};base64,${data}` });
      } else if (t === "tool_use") {
        flushBuffer();
        const args = block.input ?? {};
        input.push({ type: "function_call", call_id: String(block.id ?? ""), name: String(block.name ?? ""), arguments: typeof args === "string" ? args : JSON.stringify(args) });
      } else if (t === "tool_result") {
        flushBuffer();
        const callId = String(block.tool_use_id ?? "");
        let output;
        if (typeof block.content === "string") output = block.content;
        else if (block.content == null) output = "";
        else output = JSON.stringify(block.content);
        input.push({ type: "function_call_output", call_id: callId, output });
      }
    }
    flushBuffer();
  }
  return input;
}

function anthropicToOpenAiResponses(body) {
  const out = {};
  if (body?.model) out.model = String(body.model);
  const instructions = anthropicSystemToInstructions(body?.system);
  if (instructions) out.instructions = instructions;
  out.input = anthropicMessagesToResponsesInput(body?.messages);
  if (Number.isFinite(Number(body?.max_tokens))) out.max_output_tokens = Number(body.max_tokens);
  if (Number.isFinite(Number(body?.temperature))) out.temperature = Number(body.temperature);
  if (Number.isFinite(Number(body?.top_p))) out.top_p = Number(body.top_p);
  if (typeof body?.stream === "boolean") out.stream = body.stream;
  const tools = anthropicToolsToResponsesTools(body?.tools);
  if (tools) out.tools = tools;
  const toolChoice = anthropicToolChoiceToResponses(body?.tool_choice);
  if (toolChoice) out.tool_choice = toolChoice;
  return out;
}

function buildAnthropicUsageFromResponses(usage) {
  const u = usage && typeof usage === "object" ? usage : {};
  return {
    input_tokens: Number(u.input_tokens ?? u.prompt_tokens ?? 0),
    output_tokens: Number(u.output_tokens ?? u.completion_tokens ?? 0),
    ...(Number.isFinite(Number(u.cache_creation_input_tokens)) ? { cache_creation_input_tokens: Number(u.cache_creation_input_tokens) } : {}),
    ...(Number.isFinite(Number(u.cache_read_input_tokens)) ? { cache_read_input_tokens: Number(u.cache_read_input_tokens) } : {}),
  };
}

function mapResponsesStopReason(status, hasToolUse, incompleteReason) {
  if (hasToolUse) return "tool_use";
  if (incompleteReason === "max_output_tokens" || incompleteReason === "max_tokens") return "max_tokens";
  if (status === "incomplete") return "max_tokens";
  return "end_turn";
}

function openAiResponsesToAnthropic(body, requestBody) {
  const output = Array.isArray(body?.output) ? body.output : [];
  const content = [];
  let hasToolUse = false;
  for (const item of output) {
    const t = item?.type;
    if (t === "message") {
      const msgContent = Array.isArray(item.content) ? item.content : [];
      for (const block of msgContent) {
        const bt = block?.type;
        if (bt === "output_text" && block.text) content.push({ type: "text", text: String(block.text) });
        else if (bt === "refusal" && block.refusal) content.push({ type: "text", text: String(block.refusal) });
      }
    } else if (t === "function_call") {
      let parsed = {};
      try { parsed = item.arguments ? JSON.parse(item.arguments) : {}; } catch { parsed = { _raw: String(item.arguments ?? "") }; }
      content.push({ type: "tool_use", id: String(item.call_id ?? ""), name: String(item.name ?? ""), input: parsed });
      hasToolUse = true;
    } else if (t === "reasoning") {
      const summary = Array.isArray(item.summary) ? item.summary : [];
      const text = summary.filter((s) => s?.type === "summary_text").map((s) => String(s.text ?? "")).join("");
      if (text) content.push({ type: "thinking", thinking: text });
    }
  }
  const stopReason = mapResponsesStopReason(body?.status, hasToolUse, body?.incomplete_details?.reason);
  return {
    id: String(body?.id ?? `msg_${Date.now()}`),
    type: "message",
    role: "assistant",
    model: String(body?.model ?? requestBody?.model ?? ""),
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: buildAnthropicUsageFromResponses(body?.usage),
  };
}

async function streamOpenAiResponsesAsAnthropic(fetchResponse, nodeResponse, requestBody) {
  nodeResponse.writeHead(fetchResponse.status, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const writeEvent = (event, data) => {
    nodeResponse.write(`event: ${event}\n`);
    nodeResponse.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let messageStarted = false;
  let messageId = "";
  let model = String(requestBody?.model ?? "");
  let textBlockOpen = false;
  let textBlockIndex = -1;
  let nextBlockIndex = 0;
  const toolBlocks = new Map();
  let hasToolUse = false;
  let stopReason = "end_turn";
  let usagePrompt = 0;
  let usageCompletion = 0;

  const ensureMessageStart = () => {
    if (messageStarted) return;
    messageStarted = true;
    writeEvent("message_start", {
      type: "message_start",
      message: { id: messageId || `msg_${Date.now()}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usagePrompt, output_tokens: 0 } },
    });
  };

  const ensureTextBlock = () => {
    ensureMessageStart();
    if (!textBlockOpen) {
      textBlockIndex = nextBlockIndex++;
      textBlockOpen = true;
      writeEvent("content_block_start", { type: "content_block_start", index: textBlockIndex, content_block: { type: "text", text: "" } });
    }
  };

  const closeTextBlock = () => {
    if (textBlockOpen) {
      writeEvent("content_block_stop", { type: "content_block_stop", index: textBlockIndex });
      textBlockOpen = false;
    }
  };

  const ensureToolBlock = (itemId, callId, name) => {
    let block = toolBlocks.get(itemId);
    if (!block) {
      const idx = nextBlockIndex++;
      block = { index: idx, callId: callId || itemId, name: name || "", started: false };
      toolBlocks.set(itemId, block);
    }
    if (!block.started && (block.callId || block.name)) {
      ensureMessageStart();
      if (textBlockOpen) closeTextBlock();
      writeEvent("content_block_start", { type: "content_block_start", index: block.index, content_block: { type: "tool_use", id: block.callId, name: block.name, input: {} } });
      block.started = true;
    }
    return block;
  };

  const dispatchEvent = (eventName, dataStr) => {
    if (!dataStr) return;
    let data;
    try { data = JSON.parse(dataStr); } catch { return; }
    const evType = eventName || data?.type || "";
    const respObj = data?.response ?? data;
    if (evType === "response.created") {
      if (respObj?.id) messageId = String(respObj.id);
      if (respObj?.model) model = String(respObj.model);
      if (respObj?.usage?.input_tokens != null) usagePrompt = Number(respObj.usage.input_tokens);
      ensureMessageStart();
      return;
    }
    if (evType === "response.output_text.delta" || evType === "response.refusal.delta") {
      const delta = typeof data.delta === "string" ? data.delta : "";
      if (delta) {
        ensureTextBlock();
        writeEvent("content_block_delta", { type: "content_block_delta", index: textBlockIndex, delta: { type: "text_delta", text: delta } });
      }
      return;
    }
    if (evType === "response.output_item.added") {
      const item = data.item ?? {};
      if (item.type === "function_call") {
        hasToolUse = true;
        const itemId = String(item.id ?? data.item_id ?? item.call_id ?? "");
        ensureToolBlock(itemId, String(item.call_id ?? ""), String(item.name ?? ""));
      }
      return;
    }
    if (evType === "response.function_call_arguments.delta") {
      const itemId = String(data.item_id ?? "");
      const tb = toolBlocks.get(itemId);
      if (tb && typeof data.delta === "string" && data.delta) {
        if (!tb.started) ensureToolBlock(itemId, tb.callId, tb.name);
        writeEvent("content_block_delta", { type: "content_block_delta", index: tb.index, delta: { type: "input_json_delta", partial_json: data.delta } });
      }
      return;
    }
    if (evType === "response.output_item.done") {
      const item = data.item ?? {};
      if (item.type === "function_call") {
        const itemId = String(item.id ?? data.item_id ?? item.call_id ?? "");
        const tb = toolBlocks.get(itemId);
        if (tb && tb.started) {
          writeEvent("content_block_stop", { type: "content_block_stop", index: tb.index });
          tb.started = false;
        }
      }
      return;
    }
    if (evType === "response.completed") {
      if (respObj?.usage) {
        if (Number.isFinite(Number(respObj.usage.input_tokens))) usagePrompt = Number(respObj.usage.input_tokens);
        if (Number.isFinite(Number(respObj.usage.output_tokens))) usageCompletion = Number(respObj.usage.output_tokens);
      }
      stopReason = mapResponsesStopReason(respObj?.status, hasToolUse, respObj?.incomplete_details?.reason);
      return;
    }
    if (evType === "response.failed" || evType === "response.error") {
      stopReason = "end_turn";
    }
  };

  const consumeBlock = (raw) => {
    if (!raw) return;
    let eventName = "";
    let dataStr = "";
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
    }
    dispatchEvent(eventName, dataStr);
  };

  let buffer = "";
  if (fetchResponse.body) {
    for await (const chunk of fetchResponse.body) {
      buffer += Buffer.from(chunk).toString("utf8");
      while (buffer.includes("\n\n")) {
        const sep = buffer.indexOf("\n\n");
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        consumeBlock(block);
      }
    }
  }
  if (buffer.trim()) consumeBlock(buffer);

  for (const [, tb] of toolBlocks) {
    if (tb.started) writeEvent("content_block_stop", { type: "content_block_stop", index: tb.index });
  }
  closeTextBlock();
  ensureMessageStart();
  writeEvent("message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { input_tokens: usagePrompt, output_tokens: usageCompletion } });
  writeEvent("message_stop", { type: "message_stop" });
  nodeResponse.end();
}

function anthropicToOpenAiChat(body) {
  const messages = [];
  if (typeof body.system === "string" && body.system.trim()) messages.push({ role: "system", content: body.system });
  else if (Array.isArray(body.system)) {
    const systemText = anthropicContentToText(body.system);
    if (systemText) messages.push({ role: "system", content: systemText });
  }
  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    for (const expanded of anthropicMessageToOpenAiChat(message)) messages.push(expanded);
  }
  const tools = anthropicToolsToOpenAiTools(body.tools);
  const toolChoice = anthropicToolChoiceToOpenAi(body.tool_choice);
  return {
    model: body.model,
    messages,
    stream: Boolean(body.stream),
    ...(Number.isFinite(Number(body.max_tokens)) ? { max_tokens: Number(body.max_tokens) } : {}),
    ...(Number.isFinite(Number(body.temperature)) ? { temperature: Number(body.temperature) } : {}),
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
  };
}

function openAiChatToAnthropic(openAiBody, requestBody) {
  const choice = Array.isArray(openAiBody?.choices) ? openAiBody.choices[0] : null;
  const message = choice?.message ?? {};
  const content = [];
  const text = typeof message.content === "string" ? message.content : "";
  if (text) content.push({ type: "text", text });
  for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    let parsedArgs = {};
    try { parsedArgs = call?.function?.arguments ? JSON.parse(call.function.arguments) : {}; } catch { parsedArgs = { _raw: String(call?.function?.arguments ?? "") }; }
    content.push({ type: "tool_use", id: String(call.id ?? `call_${content.length}`), name: String(call?.function?.name ?? ""), input: parsedArgs });
  }
  let stopReason = "end_turn";
  if (choice?.finish_reason === "length") stopReason = "max_tokens";
  else if (choice?.finish_reason === "tool_calls" || (Array.isArray(message.tool_calls) && message.tool_calls.length)) stopReason = "tool_use";
  return {
    id: String(openAiBody?.id ?? `msg_${Date.now()}`),
    type: "message",
    role: "assistant",
    model: String(openAiBody?.model ?? requestBody?.model ?? ""),
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: Number(openAiBody?.usage?.prompt_tokens ?? 0),
      output_tokens: Number(openAiBody?.usage?.completion_tokens ?? 0),
    },
  };
}

async function streamOpenAiChatAsAnthropic(fetchResponse, nodeResponse, requestBody) {
  nodeResponse.writeHead(fetchResponse.status, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const messageId = `msg_${Date.now()}`;
  const writeEvent = (event, data) => {
    nodeResponse.write(`event: ${event}\n`);
    nodeResponse.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  writeEvent("message_start", { type: "message_start", message: { id: messageId, type: "message", role: "assistant", model: requestBody.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });

  let textBlockOpen = false;
  let textBlockIndex = -1;
  const toolBlocks = new Map();
  let nextBlockIndex = 0;
  let stopReason = "end_turn";
  let usagePromptTokens = 0;
  let usageCompletionTokens = 0;

  const ensureTextBlock = () => {
    if (!textBlockOpen) {
      textBlockIndex = nextBlockIndex;
      nextBlockIndex += 1;
      textBlockOpen = true;
      writeEvent("content_block_start", { type: "content_block_start", index: textBlockIndex, content_block: { type: "text", text: "" } });
    }
  };

  const closeTextBlock = () => {
    if (textBlockOpen) {
      writeEvent("content_block_stop", { type: "content_block_stop", index: textBlockIndex });
      textBlockOpen = false;
    }
  };

  const ensureToolBlock = (slot, callId, name) => {
    let block = toolBlocks.get(slot);
    if (!block) {
      const blockIndex = nextBlockIndex;
      nextBlockIndex += 1;
      block = { index: blockIndex, id: callId || `call_${slot}`, name: name || "", argsBuf: "", started: false };
      toolBlocks.set(slot, block);
    }
    if (!block.started && (block.id || block.name)) {
      writeEvent("content_block_start", { type: "content_block_start", index: block.index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      block.started = true;
    }
    return block;
  };

  let buffer = "";
  if (fetchResponse.body) {
    for await (const chunk of fetchResponse.body) {
      buffer += Buffer.from(chunk).toString("utf8");
      while (buffer.includes("\n\n")) {
        const splitIndex = buffer.indexOf("\n\n");
        const block = buffer.slice(0, splitIndex);
        buffer = buffer.slice(splitIndex + 2);
        for (const line of block.split(/\r?\n/)) {
          const data = line.startsWith("data:") ? line.slice(5).trim() : "";
          if (!data || data === "[DONE]") continue;
          const parsed = parseJsonLikeObject(data);
          if (!parsed) continue;
          const choice = parsed?.choices?.[0] ?? {};
          const delta = choice?.delta ?? {};
          const usage = parsed?.usage;
          if (usage) {
            if (Number.isFinite(Number(usage.prompt_tokens))) usagePromptTokens = Number(usage.prompt_tokens);
            if (Number.isFinite(Number(usage.completion_tokens))) usageCompletionTokens = Number(usage.completion_tokens);
          }
          if (typeof delta.content === "string" && delta.content) {
            ensureTextBlock();
            writeEvent("content_block_delta", { type: "content_block_delta", index: textBlockIndex, delta: { type: "text_delta", text: delta.content } });
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const call of delta.tool_calls) {
              const slot = Number.isFinite(Number(call?.index)) ? Number(call.index) : 0;
              if (textBlockOpen && !toolBlocks.has(slot)) closeTextBlock();
              const tb = ensureToolBlock(slot, call?.id ?? "", call?.function?.name ?? "");
              if (call?.id && !tb.id.startsWith("call_")) tb.id = String(call.id);
              if (call?.id && !tb.started) tb.id = String(call.id);
              if (call?.function?.name && !tb.name) {
                tb.name = String(call.function.name);
              }
              if (!tb.started && (tb.id || tb.name)) ensureToolBlock(slot, tb.id, tb.name);
              const argChunk = typeof call?.function?.arguments === "string" ? call.function.arguments : "";
              if (argChunk) {
                tb.argsBuf += argChunk;
                writeEvent("content_block_delta", { type: "content_block_delta", index: tb.index, delta: { type: "input_json_delta", partial_json: argChunk } });
              }
            }
          }
          if (choice.finish_reason === "length") stopReason = "max_tokens";
          else if (choice.finish_reason === "tool_calls" || (toolBlocks.size && choice.finish_reason)) stopReason = "tool_use";
        }
      }
    }
  }
  for (const [, tb] of toolBlocks) {
    if (tb.started) writeEvent("content_block_stop", { type: "content_block_stop", index: tb.index });
  }
  closeTextBlock();
  writeEvent("message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { input_tokens: usagePromptTokens, output_tokens: usageCompletionTokens } });
  writeEvent("message_stop", { type: "message_stop" });
  nodeResponse.end();
}

function extractTomlString(raw, key) {
  const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(raw ?? "").match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*[\"']([^\"']+)[\"']`, "m"))?.[1] ?? "";
}

function codexProviderConfig(provider) {
  const settings = provider?.settingsConfig && typeof provider.settingsConfig === "object" ? provider.settingsConfig : {};
  const config = String(settings.config ?? "");
  const baseUrl = extractTomlString(config, "base_url") || settings.base_url || settings.baseURL || "";
  const model = extractTomlString(config, "model") || provider?.models?.[0]?.id || "";
  return { settings, config, baseUrl, model };
}

function codexModelCatalogResponse(provider) {
  const settings = provider?.settingsConfig && typeof provider.settingsConfig === "object" ? provider.settingsConfig : {};
  const catalogModels = Array.isArray(settings.modelCatalog?.models) ? settings.modelCatalog.models : [];
  return {
    models: catalogModels.map((item) => ({
      id: String(item?.model ?? ""),
      name: String(item?.displayName ?? item?.model ?? ""),
      model: String(item?.model ?? ""),
      displayName: String(item?.displayName ?? item?.model ?? ""),
      contextWindow: Number(item?.contextWindow ?? item?.context_window ?? 0) || undefined,
    })).filter((item) => item.id),
  };
}

async function handleClaudeProxyRequest(request, response, endpoint) {
  const bodyBuffer = await readRequestBodyBuffer(request);
  const requestStartedAt = Date.now();
  let resolved;
  try {
    resolved = await tryAgentProvidersWithFailover("claude", async (provider) => {
      const requestBody = mapClaudeProxyModel(parseJsonBuffer(bodyBuffer), provider);
      const apiFormat = claudeProviderApiFormat(provider);
      const env = claudeProviderEnv(provider);
      const baseUrl = env.ANTHROPIC_BASE_URL || provider.settingsConfig?.base_url || provider.settingsConfig?.baseURL;
      if (!baseUrl) throw new Error(`Provider ${provider.name} missing ANTHROPIC_BASE_URL`);
      if (apiFormat === "openai_responses") {
        const upstreamBody = anthropicToOpenAiResponses(requestBody);
        const outbound = Buffer.from(JSON.stringify(upstreamBody), "utf8");
        const upstream = await fetch(appendProxyEndpoint(baseUrl, "/v1/responses"), {
          method: "POST",
          headers: proxyForwardHeaders(request.headers, provider, "claude", outbound.length),
          body: outbound,
        });
        if (!upstream.ok && upstream.status >= 500) {
          const txt = await upstream.text().catch(() => "");
          throw new Error(`Upstream ${upstream.status}: ${txt.slice(0, 200)}`);
        }
        return { provider, requestBody, upstream, mode: "openai_responses" };
      }
      if (apiFormat === "gemini_native") {
        throw new Error(`Provider ${provider.name} uses api_format=gemini_native; Studio proxy supports anthropic, openai_chat, openai_responses. Gemini Native conversion is not implemented yet.`);
      }
      if (apiFormat === "openai_chat") {
        const upstreamBody = anthropicToOpenAiChat(requestBody);
        const outbound = Buffer.from(JSON.stringify(upstreamBody), "utf8");
        const upstream = await fetch(appendProxyEndpoint(baseUrl, "/v1/chat/completions"), {
          method: "POST",
          headers: proxyForwardHeaders(request.headers, provider, "claude", outbound.length),
          body: outbound,
        });
        if (!upstream.ok && upstream.status >= 500) {
          const txt = await upstream.text().catch(() => "");
          throw new Error(`Upstream ${upstream.status}: ${txt.slice(0, 200)}`);
        }
        return { provider, requestBody, upstream, mode: "openai_chat" };
      }
      const outbound = Buffer.from(JSON.stringify(requestBody), "utf8");
      const upstream = await fetch(appendProxyEndpoint(baseUrl, endpoint), {
        method: request.method || "POST",
        headers: proxyForwardHeaders(request.headers, provider, "claude", outbound.length),
        body: outbound,
      });
      if (!upstream.ok && upstream.status >= 500) {
        const txt = await upstream.text().catch(() => "");
        throw new Error(`Upstream ${upstream.status}: ${txt.slice(0, 200)}`);
      }
      return { provider, requestBody, upstream, mode: "anthropic" };
    });
  } catch (error) {
    recordStudioProxyRequest({ appType: "claude", endpoint, ok: false, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - requestStartedAt });
    throw error;
  }
  const { provider, requestBody, upstream, mode } = resolved.value;
  if (mode === "openai_chat") {
    if (requestBody.stream) {
      await streamOpenAiChatAsAnthropic(upstream, response, requestBody);
    } else {
      const upstreamJson = parseJsonLikeObject(await upstream.text()) ?? {};
      writeProxyJson(response, upstream.status, openAiChatToAnthropic(upstreamJson, requestBody));
    }
  } else if (mode === "openai_responses") {
    if (requestBody.stream) {
      await streamOpenAiResponsesAsAnthropic(upstream, response, requestBody);
    } else {
      const upstreamJson = parseJsonLikeObject(await upstream.text()) ?? {};
      writeProxyJson(response, upstream.status, openAiResponsesToAnthropic(upstreamJson, requestBody));
    }
  } else {
    await streamFetchResponseToNode(upstream, response);
  }
  studioAgentProxyState.activeTargets.claude = { providerId: provider.id, providerName: provider.name, model: requestBody.model ?? null };
  recordStudioProxyRequest({ appType: "claude", endpoint, ok: true, providerId: provider.id, providerName: provider.name, model: requestBody.model ?? null, status: upstream.status, durationMs: Date.now() - requestStartedAt, failoverChain: resolved.chain });
}

async function handleCodexProxyRequest(request, response, endpoint) {
  const requestStartedAt = Date.now();
  if (request.method === "GET" && ["/models", "/v1/models"].includes(endpoint.split("?")[0])) {
    const provider = currentAgentManagementProvider("codex");
    if (!provider) throw new Error("No Codex provider configured");
    writeProxyJson(response, 200, codexModelCatalogResponse(provider));
    recordStudioProxyRequest({ appType: "codex", endpoint, ok: true, providerId: provider.id, providerName: provider.name, status: 200, durationMs: Date.now() - requestStartedAt });
    return;
  }
  const bodyBuffer = await readRequestBodyBuffer(request);
  let resolved;
  try {
    resolved = await tryAgentProvidersWithFailover("codex", async (provider) => {
      const { baseUrl, model } = codexProviderConfig(provider);
      if (!baseUrl) throw new Error(`Provider ${provider.name} missing base_url`);
      const body = parseJsonBuffer(bodyBuffer);
      if (model && !body.model) body.model = model;
      const outbound = Buffer.from(JSON.stringify(body), "utf8");
      const upstream = await fetch(appendProxyEndpoint(baseUrl, endpoint), {
        method: request.method || "POST",
        headers: proxyForwardHeaders(request.headers, provider, "codex", outbound.length),
        body: outbound,
      });
      if (!upstream.ok && upstream.status >= 500) {
        const txt = await upstream.text().catch(() => "");
        throw new Error(`Upstream ${upstream.status}: ${txt.slice(0, 200)}`);
      }
      return { provider, body, upstream, model };
    });
  } catch (error) {
    recordStudioProxyRequest({ appType: "codex", endpoint, ok: false, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - requestStartedAt });
    throw error;
  }
  const { provider, body, upstream, model } = resolved.value;
  await streamFetchResponseToNode(upstream, response);
  studioAgentProxyState.activeTargets.codex = { providerId: provider.id, providerName: provider.name, model: body.model ?? model ?? null };
  recordStudioProxyRequest({ appType: "codex", endpoint, ok: true, providerId: provider.id, providerName: provider.name, model: body.model ?? model ?? null, status: upstream.status, durationMs: Date.now() - requestStartedAt, failoverChain: resolved.chain });
}

async function handleStudioAgentProxyRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const endpoint = `${url.pathname}${url.search}`;
  studioAgentProxyState.totalRequests += 1;
  try {
    if (url.pathname === "/health") {
      writeProxyJson(response, 200, { status: "healthy", proxy: "studio-agent", timestamp: Date.now() });
    } else if (request.method === "OPTIONS") {
      writeProxyText(response, 204, "");
    } else if (url.pathname === "/status") {
      writeProxyJson(response, 200, studioAgentProxyStatusPayload());
    } else if (["/v1/messages", "/claude/v1/messages"].includes(url.pathname)) {
      await handleClaudeProxyRequest(request, response, url.pathname === "/claude/v1/messages" ? "/v1/messages" : endpoint);
    } else if (["/models", "/v1/models", "/responses", "/v1/responses", "/v1/v1/responses", "/codex/v1/responses", "/responses/compact", "/v1/responses/compact", "/v1/v1/responses/compact", "/codex/v1/responses/compact", "/chat/completions", "/v1/chat/completions", "/v1/v1/chat/completions", "/codex/v1/chat/completions"].includes(url.pathname)) {
      const normalized = url.pathname.replace(/^\/codex/, "").replace(/^\/v1\/v1\//, "/v1/");
      await handleCodexProxyRequest(request, response, `${normalized}${url.search}`);
    } else {
      writeProxyJson(response, 404, { error: { message: `Studio agent proxy route not found: ${url.pathname}` } });
    }
    studioAgentProxyState.successRequests += 1;
  } catch (error) {
    studioAgentProxyState.failedRequests += 1;
    studioAgentProxyState.lastError = error instanceof Error ? error.message : String(error);
    if (!response.headersSent) writeProxyJson(response, 502, { error: { message: studioAgentProxyState.lastError } });
    else response.end();
  }
}

function studioAgentProxyStatusPayload() {
  return {
    running: studioAgentProxyRunning(),
    address: studioAgentProxyState.address,
    port: studioAgentProxyState.port,
    startedAt: studioAgentProxyState.startedAt,
    totalRequests: studioAgentProxyState.totalRequests,
    successRequests: studioAgentProxyState.successRequests,
    failedRequests: studioAgentProxyState.failedRequests,
    lastError: studioAgentProxyState.lastError,
    activeTargets: studioAgentProxyState.activeTargets,
    supportedApps: ["claude", "codex"],
    failover: studioProxyFailoverSnapshot(),
  };
}

async function startStudioAgentProxy(proxy) {
  const normalized = normalizeAgentManagementProxy(proxy);
  if (studioAgentProxyRunning()) {
    if (studioAgentProxyState.address === normalized.address && studioAgentProxyState.port === normalized.port) return studioAgentProxyStatusPayload();
    await stopStudioAgentProxy();
  }
  const server = createServer((request, response) => {
    handleStudioAgentProxyRequest(request, response).catch((error) => {
      studioAgentProxyState.lastError = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) writeProxyJson(response, 500, { error: { message: studioAgentProxyState.lastError } });
      else response.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(normalized.port, normalized.address, () => {
      server.off("error", reject);
      resolve(undefined);
    });
  });
  studioAgentProxyState.server = server;
  studioAgentProxyState.address = normalized.address;
  studioAgentProxyState.port = normalized.port;
  studioAgentProxyState.startedAt = Date.now();
  studioAgentProxyState.lastError = null;
  return studioAgentProxyStatusPayload();
}

async function stopStudioAgentProxy() {
  const server = studioAgentProxyState.server;
  studioAgentProxyState.server = null;
  if (server?.listening) {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
  studioAgentProxyState.address = null;
  studioAgentProxyState.port = null;
  studioAgentProxyState.startedAt = null;
  return studioAgentProxyStatusPayload();
}

function buildClaudeTakeoverSettings(provider, proxyOrigin) {
  const env = claudeProviderEnv(provider);
  const modelFor = (role) => env[`ANTHROPIC_DEFAULT_${role.toUpperCase()}_MODEL`] || env.ANTHROPIC_MODEL || provider.models?.[0]?.id || "";
  const nameFor = (role) => env[`ANTHROPIC_DEFAULT_${role.toUpperCase()}_MODEL_NAME`] || modelFor(role);
  return {
    ...(provider.settingsConfig && typeof provider.settingsConfig === "object" ? provider.settingsConfig : {}),
    env: {
      ANTHROPIC_BASE_URL: proxyOrigin,
      ANTHROPIC_AUTH_TOKEN: STUDIO_AGENT_PROXY_TOKEN_PLACEHOLDER,
      ANTHROPIC_MODEL: CLAUDE_TAKEOVER_MODELS.sonnet,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: CLAUDE_TAKEOVER_MODELS.haiku,
      ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: nameFor("haiku"),
      ANTHROPIC_DEFAULT_SONNET_MODEL: CLAUDE_TAKEOVER_MODELS.sonnet,
      ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: nameFor("sonnet"),
      ANTHROPIC_DEFAULT_OPUS_MODEL: CLAUDE_TAKEOVER_MODELS.opus,
      ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: nameFor("opus"),
      ANTHROPIC_DEFAULT_FABLE_MODEL: CLAUDE_TAKEOVER_MODELS.fable,
      ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: nameFor("fable"),
    },
  };
}

async function writeClaudeProxyTakeoverLive(proxy) {
  const provider = currentAgentManagementProvider("claude");
  if (!provider) return false;
  await writeJsonFileAtomic(agentManagementConfigPath("claude"), sanitizeClaudeProviderSettings(buildClaudeTakeoverSettings(provider, proxyOriginFromConfig(proxy))));
  return true;
}

function buildCodexProxyTakeoverConfig(provider, proxy) {
  const models = codexModelCatalogResponse(provider).models;
  const defaultModel = models[0]?.id || codexProviderConfig(provider).model || "model";
  return `model = "${escapeTomlString(defaultModel)}"\nmodel_provider = "studio_proxy"\n\n[model_providers.studio_proxy]\nname = "Studio Agent Proxy"\nbase_url = "${escapeTomlString(`${proxyOriginFromConfig(proxy)}/v1`)}"\nwire_api = "responses"\nenv_key = "STUDIO_AGENT_PROXY_API_KEY"\n`;
}

async function writeCodexProxyTakeoverLive(proxy) {
  const provider = currentAgentManagementProvider("codex");
  if (!provider) return false;
  const home = getRealHomeDir();
  const codexDir = path.join(home, ".codex");
  await mkdir(codexDir, { recursive: true });
  await writeJsonFileAtomic(path.join(codexDir, "auth.json"), { STUDIO_AGENT_PROXY_API_KEY: STUDIO_AGENT_PROXY_TOKEN_PLACEHOLDER });
  const current = await readFile(path.join(codexDir, "config.toml"), "utf8").catch(() => "");
  await writeFile(path.join(codexDir, "config.toml"), mergeCodexProjectSections(buildCodexProxyTakeoverConfig(provider, proxy), current), "utf8");
  return true;
}

async function applyStudioProxyTakeoverLive(proxy, agent, enabled) {
  if (agent === "claude") {
    if (enabled) return writeClaudeProxyTakeoverLive(proxy);
    const provider = currentAgentManagementProvider("claude");
    if (provider) await writeClaudeProviderLive(provider);
    return Boolean(provider);
  }
  if (agent === "codex") {
    if (enabled) return writeCodexProxyTakeoverLive(proxy);
    const provider = currentAgentManagementProvider("codex");
    if (provider) await writeCodexProviderLive(provider);
    return Boolean(provider);
  }
  return false;
}

async function isTcpPortListening(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(600);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function readStudioSwitchProxyRows() {
  const dbPath = studioSwitchDatabasePath();
  if (!existsSync(dbPath)) return [];
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'proxy_config'").get();
    if (!hasTable) return [];
    return db.prepare(`SELECT app_type, proxy_enabled, listen_address, listen_port, enable_logging, enabled, auto_failover_enabled, updated_at
      FROM proxy_config
      ORDER BY app_type`).all();
  } catch {
    return [];
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

async function readAgentManagementProxyStatus(workspaceRoot) {
  const preferences = await personalAgentLegacyHarness.readAgentManagementPreferences(workspaceRoot);
  const proxy = normalizeAgentManagementProxy(preferences.proxy);
  const studioService = studioAgentProxyStatusPayload();
  const serviceReachable = studioAgentProxyRunning() || await isTcpPortListening(proxy.address, proxy.port).catch(() => false);
  const studioSwitchRows = readStudioSwitchProxyRows();
  const studioSwitchApps = Object.fromEntries(STUDIO_SWITCH_PROXY_APPS.map((app) => [app, false]));
  let studioSwitchAddress = proxy.address;
  let studioSwitchPort = proxy.port;
  let studioSwitchLogging = true;
  for (const row of studioSwitchRows) {
    const appType = String(row?.app_type ?? "").trim();
    if (STUDIO_SWITCH_PROXY_APPS.includes(appType)) studioSwitchApps[appType] = Boolean(row.enabled);
    if (typeof row?.listen_address === "string" && row.listen_address.trim()) studioSwitchAddress = row.listen_address.trim();
    const rowPort = Number(row?.listen_port);
    if (Number.isInteger(rowPort)) studioSwitchPort = rowPort;
    if (row?.enable_logging != null) studioSwitchLogging = Boolean(row.enable_logging);
  }
  const studioSwitchReachable = await isTcpPortListening(studioSwitchAddress, studioSwitchPort).catch(() => false);
  return {
    enabled: proxy.enabled,
    address: proxy.address,
    port: proxy.port,
    serviceReachable,
    takeover: Object.fromEntries(AGENT_MANAGEMENT_PROXY_AGENTS.map((agent) => [agent, Boolean(proxy.takeover?.[agent])])),
    targets: Object.fromEntries(AGENT_MANAGEMENT_PROXY_AGENTS.map((agent) => [agent, typeof proxy.targets?.[agent] === "string" ? proxy.targets[agent] : null])),
    updatedAt: proxy.updatedAt,
    studio: studioService,
    studioSwitch: {
      databasePath: studioSwitchDatabasePath(),
      address: studioSwitchAddress,
      port: studioSwitchPort,
      serviceReachable: studioSwitchReachable,
      enableLogging: studioSwitchLogging,
      takeover: studioSwitchApps,
    },
  };
}

const STUDIO_CD_PROFILE_ID = "00000000-0000-4000-8000-000000538710";
const STUDIO_CD_PROFILE_NAME = "OnMyAgent Studio";

function claudeDesktopPaths() {
  const home = getRealHomeDir();
  if (process.platform === "darwin") {
    const appSupport = path.join(home, "Library", "Application Support");
    const normalDir = path.join(appSupport, "Claude");
    const threepDir = path.join(appSupport, "Claude-3p");
    const configLibrary = path.join(threepDir, "configLibrary");
    return {
      supported: true,
      normalConfigPath: path.join(normalDir, "claude_desktop_config.json"),
      threepConfigPath: path.join(threepDir, "claude_desktop_config.json"),
      configLibraryPath: configLibrary,
      profilePath: path.join(configLibrary, `${STUDIO_CD_PROFILE_ID}.json`),
      metaPath: path.join(configLibrary, "_meta.json"),
    };
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const normalDir = path.join(localAppData, "Claude");
    const threepDir = path.join(localAppData, "Claude-3p");
    const configLibrary = path.join(threepDir, "configLibrary");
    return {
      supported: true,
      normalConfigPath: path.join(normalDir, "claude_desktop_config.json"),
      threepConfigPath: path.join(threepDir, "claude_desktop_config.json"),
      configLibraryPath: configLibrary,
      profilePath: path.join(configLibrary, `${STUDIO_CD_PROFILE_ID}.json`),
      metaPath: path.join(configLibrary, "_meta.json"),
    };
  }
  return { supported: false };
}

async function readJsonOrEmpty(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

async function writeDeploymentMode(filePath, mode) {
  const obj = await readJsonOrEmpty(filePath);
  obj.deploymentMode = mode;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

function buildStudioGatewayProfile(baseUrl, apiKey, modelSpecs) {
  const profile = {
    coworkEgressAllowedHosts: ["*"],
    disableDeploymentModeChooser: true,
    inferenceGatewayApiKey: apiKey,
    inferenceGatewayAuthScheme: "bearer",
    inferenceGatewayBaseUrl: baseUrl,
    inferenceProvider: "gateway",
  };
  if (Array.isArray(modelSpecs) && modelSpecs.length) {
    profile.inferenceModels = modelSpecs.map((spec) => {
      if (typeof spec === "string") return spec;
      const item = { name: String(spec?.name ?? "") };
      if (spec?.labelOverride) item.labelOverride = String(spec.labelOverride);
      if (spec?.supports1m) item.supports1m = true;
      return item;
    });
  }
  return profile;
}

async function writeStudioCdMeta(metaPath, profileId, profileName) {
  const obj = await readJsonOrEmpty(metaPath);
  let entries = Array.isArray(obj.entries) ? obj.entries.filter((e) => e?.id !== STUDIO_CD_PROFILE_ID) : [];
  if (profileId) {
    entries.push({ id: profileId, name: profileName });
    obj.appliedId = profileId;
  } else if (obj.appliedId === STUDIO_CD_PROFILE_ID) {
    const next = entries.find((e) => typeof e?.id === "string");
    if (next) obj.appliedId = next.id;
    else delete obj.appliedId;
  }
  obj.entries = entries;
  await mkdir(path.dirname(metaPath), { recursive: true });
  await writeFile(metaPath, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

async function applyStudioClaudeDesktopTakeover(baseUrl, apiKey, modelSpecs) {
  const paths = claudeDesktopPaths();
  if (!paths.supported) throw new Error("Claude Desktop takeover only supported on macOS/Windows");
  if (!baseUrl) throw new Error("baseUrl is required");
  if (!apiKey) throw new Error("apiKey is required");
  await writeDeploymentMode(paths.normalConfigPath, "3p");
  await writeDeploymentMode(paths.threepConfigPath, "3p");
  const profile = buildStudioGatewayProfile(baseUrl, apiKey, modelSpecs);
  await mkdir(paths.configLibraryPath, { recursive: true });
  await writeFile(paths.profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  await writeStudioCdMeta(paths.metaPath, STUDIO_CD_PROFILE_ID, STUDIO_CD_PROFILE_NAME);
  return { profileId: STUDIO_CD_PROFILE_ID, profilePath: paths.profilePath };
}

async function restoreStudioClaudeDesktopOfficial() {
  const paths = claudeDesktopPaths();
  if (!paths.supported) throw new Error("Claude Desktop takeover only supported on macOS/Windows");
  await writeDeploymentMode(paths.normalConfigPath, "1p");
  await writeDeploymentMode(paths.threepConfigPath, "1p");
  try { await unlink(paths.profilePath); } catch {}
  await writeStudioCdMeta(paths.metaPath, null, null);
  return { profilePath: paths.profilePath };
}

function studioClaudeDesktopGatewayToken() {
  const dir = path.join(getRealHomeDir(), ".onmyagent-studio");
  const tokenPath = path.join(dir, "claude-desktop-gateway-token");
  try {
    const existing = readFileSync(tokenPath, "utf8").trim();
    if (existing) return existing;
  } catch {}
  mkdirSyncIfNeeded(dir);
  const token = `studio-cd-${randomBytes(16).toString("hex")}`;
  writeFileSync(tokenPath, token, "utf8");
  return token;
}

function studioClaudeDesktopRoleSpecs() {
  return [
    { name: "claude-haiku-4-5", supports1m: true },
    { name: "claude-sonnet-4-6", supports1m: true },
    { name: "claude-opus-4-8", supports1m: true },
    { name: "claude-fable-5", supports1m: true },
  ];
}

function detectClaudeDesktopConfig() {
  const paths = claudeDesktopPaths();
  const supported = Boolean(paths.supported);
  const installed = supported && existsSync(paths.normalConfigPath);
  let normalDeploymentMode = null;
  let threepDeploymentMode = null;
  if (installed) {
    try { normalDeploymentMode = JSON.parse(readFileSync(paths.normalConfigPath, "utf8"))?.deploymentMode ?? null; } catch {}
    try { threepDeploymentMode = JSON.parse(readFileSync(paths.threepConfigPath, "utf8"))?.deploymentMode ?? null; } catch {}
  }
  let appliedId = null;
  let profileExists = false;
  if (supported && existsSync(paths.metaPath)) {
    try { appliedId = JSON.parse(readFileSync(paths.metaPath, "utf8"))?.appliedId ?? null; } catch {}
  }
  if (supported && existsSync(paths.profilePath)) profileExists = true;
  const studioApplied = appliedId === STUDIO_CD_PROFILE_ID && profileExists;
  return {
    installed,
    supported,
    configPath: paths.normalConfigPath ?? null,
    threepConfigPath: paths.threepConfigPath ?? null,
    profilePath: paths.profilePath ?? null,
    metaPath: paths.metaPath ?? null,
    normalDeploymentMode,
    threepDeploymentMode,
    profileExists,
    appliedId,
    studioApplied,
    studioProfileId: STUDIO_CD_PROFILE_ID,
    reason: !supported
      ? "Claude Desktop takeover only supported on macOS/Windows."
      : studioApplied
        ? "Studio gateway profile is currently active in Claude Desktop."
        : appliedId
          ? `Another profile (${appliedId}) is currently active; Studio takeover will replace it.`
          : "Claude Desktop is using its official profile; Studio takeover not applied.",
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
  const proxy = await readAgentManagementProxyStatus(workspaceRoot);
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
      providerOptions: providerOptionsForAgent(agent),
      usage: usageByProvider.get(agent.provider) ?? personalAgentLegacyHarness.emptyAgentUsageSummary(),
      skillCount: skillCounts.get(agent.provider) ?? 0,
    })),
    skills: managedSkills,
    proxy,
    providers,
    mcp,
    claudeDesktop: detectClaudeDesktopConfig(),
  };
}

async function agentManagementSetProxy(input = {}) {
  const workspaceRoot = String(input?.workspaceRoot ?? "").trim();
  const action = String(input?.action ?? "").trim();
  if (!workspaceRoot) throw new Error("workspaceRoot is required");
  const preferences = await personalAgentLegacyHarness.readAgentManagementPreferences(workspaceRoot);
  const proxy = normalizeAgentManagementProxy(preferences.proxy);
  if (action === "service") {
    proxy.enabled = Boolean(input?.enabled);
    const address = String(input?.address ?? proxy.address).trim();
    const port = Number(input?.port ?? proxy.port);
    if (address) proxy.address = address;
    if (Number.isInteger(port) && port >= 1 && port <= 65535) proxy.port = port;
    if (proxy.enabled) await startStudioAgentProxy(proxy);
    else await stopStudioAgentProxy();
    if (proxy.enabled) {
      for (const agent of ["claude", "codex"]) {
        if (proxy.takeover?.[agent]) await applyStudioProxyTakeoverLive(proxy, agent, true);
      }
    }
  } else if (action === "takeover") {
    const agent = String(input?.agent ?? "").trim();
    if (!AGENT_MANAGEMENT_PROXY_AGENTS.includes(agent)) throw new Error("Unsupported proxy agent");
    proxy.takeover = { ...(proxy.takeover ?? {}), [agent]: Boolean(input?.enabled) };
    if (proxy.enabled && ["claude", "codex"].includes(agent)) {
      await startStudioAgentProxy(proxy);
      await applyStudioProxyTakeoverLive(proxy, agent, Boolean(input?.enabled));
    }
  } else if (action === "target") {
    const agent = String(input?.agent ?? "").trim();
    const target = String(input?.target ?? "").trim();
    if (!AGENT_MANAGEMENT_PROXY_AGENTS.includes(agent)) throw new Error("Unsupported proxy agent");
    if (!target) throw new Error("target is required");
    proxy.enabled = true;
    proxy.targets = { ...(proxy.targets ?? {}), [agent]: target };
    proxy.takeover = { ...(proxy.takeover ?? {}), [agent]: true };
    if (["claude", "codex"].includes(agent)) {
      await startStudioAgentProxy(proxy);
      await applyStudioProxyTakeoverLive(proxy, agent, true);
    }
    preferences.selections = {
      ...(preferences.selections ?? {}),
      [agent]: { model: target, updatedAt: Date.now(), proxyManaged: true },
    };
  } else {
    throw new Error("Unsupported proxy action");
  }
  proxy.updatedAt = Date.now();
  preferences.proxy = proxy;
  const preferencePath = await personalAgentLegacyHarness.writeAgentManagementPreferences(workspaceRoot, preferences);
  return { ok: true, preferencePath, proxy: await readAgentManagementProxyStatus(workspaceRoot) };
}

async function agentManagementSetClaudeDesktop(input = {}) {
  const action = String(input?.action ?? "").trim();
  if (!claudeDesktopPaths().supported) throw new Error("Claude Desktop takeover only supported on macOS/Windows");
  if (action === "apply") {
    const proxyState = studioAgentProxyStatusPayload();
    if (!proxyState.running) throw new Error("Studio Agent Proxy must be running before applying Claude Desktop takeover");
    const baseUrl = `http://${proxyState.address}:${proxyState.port}`;
    const apiKey = studioClaudeDesktopGatewayToken();
    const result = await applyStudioClaudeDesktopTakeover(baseUrl, apiKey, studioClaudeDesktopRoleSpecs());
    broadcastStudioProxyEvent("claude-desktop-takeover", { applied: true, baseUrl, profileId: result.profileId });
    return { ok: true, applied: true, baseUrl, ...result, detect: detectClaudeDesktopConfig() };
  }
  if (action === "restore") {
    const result = await restoreStudioClaudeDesktopOfficial();
    broadcastStudioProxyEvent("claude-desktop-takeover", { applied: false });
    return { ok: true, applied: false, ...result, detect: detectClaudeDesktopConfig() };
  }
  if (action === "detect") {
    return { ok: true, detect: detectClaudeDesktopConfig() };
  }
  throw new Error(`Unsupported claudeDesktop action: ${action}`);
}

async function agentManagementSetProvider(input = {}) {
  const workspaceRoot = String(input?.workspaceRoot ?? "").trim();
  const provider = String(input?.provider ?? "").trim();
  const model = String(input?.model ?? "").trim();
  if (!workspaceRoot) throw new Error("workspaceRoot is required");
  if (!isPersonalLocalAgentProvider(provider) || provider === "custom") {
    throw new Error("Unsupported agent provider");
  }
  if (!model) throw new Error("model is required");
  const preferences = await personalAgentLegacyHarness.readAgentManagementPreferences(workspaceRoot);
  preferences.selections = {
    ...(preferences.selections ?? {}),
    [provider]: { model, updatedAt: Date.now() },
  };
  const preferencePath = await personalAgentLegacyHarness.writeAgentManagementPreferences(workspaceRoot, preferences);
  return { ok: true, preferencePath, provider, model };
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

function defaultWorkspaceOpenworkConfig(workspacePath, preset = null) {
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

function parseOpenworkWorkspaceIdFromUrl(input) {
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

function stripOpenworkWorkspaceMount(input) {
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
    parseOpenworkWorkspaceIdFromUrl(hostUrl);
  if (remoteWorkspaceId) return `rem_${remoteWorkspaceId}`;
  return `rem_${createHash("sha256").update(`onmyagent::${hostUrl}`).digest("hex").slice(0, 12)}`;
}

async function fetchOpenworkWorkspaceList(hostUrl, token, hostToken) {
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

async function discoverOpenworkWorkspace({
  hostUrl,
  token,
  hostToken,
  directory,
}) {
  const list = await fetchOpenworkWorkspaceList(hostUrl, token, hostToken);
  return selectOpenworkWorkspaceForConnection(list, directory);
}

async function readWorkspaceOpenworkConfig(workspacePath) {
  const onmyagentPath = path.join(workspacePath, ".opencode", "onmyagent.json");
  if (!(await pathExists(onmyagentPath))) {
    return defaultWorkspaceOpenworkConfig(workspacePath);
  }
  const raw = await readFile(onmyagentPath, "utf8");
  return JSON.parse(raw);
}

async function writeWorkspaceOpenworkConfig(workspacePath, config) {
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
      parseOpenworkWorkspaceIdFromUrl(workspace.onmyagentHostUrl) ||
      parseOpenworkWorkspaceIdFromUrl(workspace.baseUrl);
    if (!remoteWorkspaceId) return workspace;

    const hostUrl =
      stripOpenworkWorkspaceMount(workspace.onmyagentHostUrl) ||
      stripOpenworkWorkspaceMount(workspace.baseUrl);
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

function assertOpenworkServerReady(info) {
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
  const onmyagentServer = assertOpenworkServerReady(
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

async function handleDesktopInvoke(event, command, ...args) {
  switch (command) {
    case "workspaceBootstrap":
      return readWorkspaceState();
    case "personalLocalAgentsList":
      return personalAgentRuntime.listAgents(args[0] ?? {});
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
    case "personalLocalAgentAcpProcessesList":
      return personalAgentRuntime.listProcesses(args[0] ?? {});
    case "personalLocalAgentValidate":
      return personalAgentRuntime.validateAgent(args[0] ?? {});
    case "personalLocalAgentStart":
      return personalAgentRuntime.startMessage(args[0] ?? {});
    case "personalLocalAgentStatus":
      return personalAgentRuntime.getRun(args[0]);
    case "personalLocalAgentRun":
      return personalAgentRuntime.runMessage(args[0] ?? {});
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
    case "personalLocalAgentConversationCreate":
      return personalAgentRuntime.createConversation(args[0] ?? {});
    case "personalLocalAgentConversationStatus":
      return personalAgentRuntime.getConversationStatus(args[0] ?? {});
    case "personalLocalAgentConversationConfirmationsList":
      return personalAgentRuntime.listConversationConfirmations(args[0] ?? {});
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
    case "agentManagementSetProvider":
      return agentManagementSetProvider(args[0] ?? {});
    case "agentManagementSetProxy":
      return agentManagementSetProxy(args[0] ?? {});
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
    case "agentManagementSetClaudeDesktop":
      return agentManagementSetClaudeDesktop(args[0] ?? {});
    case "agentManagementProxyUsage":
      return {
        recentRequests: studioProxyReadRecentRequests(args[0]?.limit ?? 50, args[0]?.appType ?? null),
        usageDaily: studioProxyReadUsageDaily(args[0]?.days ?? 14),
        failover: studioProxyFailoverSnapshot(),
      };
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
      await writeWorkspaceOpenworkConfig(
        folderPath,
        defaultWorkspaceOpenworkConfig(folderPath, preset),
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
      const rawOpenworkHostUrl =
        typeof input.onmyagentHostUrl === "string" &&
        input.onmyagentHostUrl.trim()
          ? input.onmyagentHostUrl.trim()
          : null;
      const onmyagentHostUrl =
        remoteType === "onmyagent"
          ? stripOpenworkWorkspaceMount(rawOpenworkHostUrl ?? baseUrl)
          : rawOpenworkHostUrl;
      const onmyagentWorkspaceId =
        typeof input.onmyagentWorkspaceId === "string" &&
        input.onmyagentWorkspaceId.trim()
          ? input.onmyagentWorkspaceId.trim()
          : remoteType === "onmyagent"
            ? parseOpenworkWorkspaceIdFromUrl(rawOpenworkHostUrl) ||
              parseOpenworkWorkspaceIdFromUrl(baseUrl)
            : null;
      let resolvedOpenworkWorkspaceId = onmyagentWorkspaceId;
      let resolvedOpenworkWorkspaceName = input.onmyagentWorkspaceName ?? null;
      if (remoteType === "onmyagent" && !resolvedOpenworkWorkspaceId) {
        const discovered = await discoverOpenworkWorkspace({
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
        resolvedOpenworkWorkspaceId = String(discovered.id).trim();
        resolvedOpenworkWorkspaceName =
          onmyagentWorkspaceDisplayName(discovered);
      }
      const id =
        remoteType === "onmyagent"
          ? onmyagentRemoteWorkspaceId(
              onmyagentHostUrl ?? baseUrl,
              resolvedOpenworkWorkspaceId,
            )
          : remoteWorkspaceId(baseUrl, directory);
      const workspace = normalizeWorkspaceEntry({
        id,
        name: String(
          input.displayName ??
            resolvedOpenworkWorkspaceName ??
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
        onmyagentWorkspaceId: resolvedOpenworkWorkspaceId,
        onmyagentWorkspaceName: resolvedOpenworkWorkspaceName,
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
          const hostUrl = stripOpenworkWorkspaceMount(
            rawHostUrl ?? nextBaseUrl,
          );
          const directory =
            typeof nextWorkspace.directory === "string" &&
            nextWorkspace.directory.trim()
              ? nextWorkspace.directory.trim()
              : null;
          const parsedWorkspaceId =
            parseOpenworkWorkspaceIdFromUrl(rawHostUrl) ||
            parseOpenworkWorkspaceIdFromUrl(nextBaseUrl);
          let remoteWorkspaceId =
            parsedWorkspaceId ||
            (typeof nextWorkspace.onmyagentWorkspaceId === "string" &&
            nextWorkspace.onmyagentWorkspaceId.trim()
              ? nextWorkspace.onmyagentWorkspaceId.trim()
              : null);
          let remoteWorkspaceName = nextWorkspace.onmyagentWorkspaceName ?? null;
          if (!remoteWorkspaceId) {
            const discovered = await discoverOpenworkWorkspace({
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
      const config = await readWorkspaceOpenworkConfig(workspacePath);
      if (!Array.isArray(config.authorizedRoots)) {
        config.authorizedRoots = [];
      }
      if (!config.authorizedRoots.includes(authorizedRoot)) {
        config.authorizedRoots.push(authorizedRoot);
      }
      return writeWorkspaceOpenworkConfig(workspacePath, config);
    }
    case "workspaceOpenworkRead":
      return readWorkspaceOpenworkConfig(
        String(args[0]?.workspacePath ?? "").trim(),
      );
    case "workspaceOpenworkWrite":
      return writeWorkspaceOpenworkConfig(
        String(args[0]?.workspacePath ?? "").trim(),
        args[0]?.config ?? defaultWorkspaceOpenworkConfig(""),
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
    case "getOpenworkUiMcpCommand": {
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
    case "getOpenworkUiMcpEnvironment": {
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
    case "nukeOpenworkAndOpencodeConfigAndExit": {
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
      return runtimeManager.sandboxCleanupOpenworkContainers();
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
    case "resetOpenworkState": {
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
    width: 1180,
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
ipcMain.handle("onmyagent:browser:navigate", (_event, url) =>
  embeddedBrowserPanel.navigate(url),
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
