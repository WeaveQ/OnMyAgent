/**
 * system domain IPC handlers for the Electron desktop bridge.
 * Factories receive services/helpers constructed in main.mjs.
 */
import {
  createVisualSnapshotPdf,
  exportVisualSnapshot,
} from "../visual-snapshot-export.mjs";
import {
  WORK_MEMORY_SEED_FILES,
  ensureWorkMemoryAwareness,
  resolveWorkMemoryAwarenessMainDir,
} from "../ensure-work-memory-awareness.mjs";
import {
  connectCompany,
  disconnectCompany,
  evaluateCompanyActionPolicy,
  fetchCompanyHealth,
  listCompanyCatalog,
  pullAndWriteCompanyConfig,
  readCompanySettings,
  writeCompanySettings,
} from "../company-client.mjs";

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "userAgentRegistryRead",
  "userAgentRegistryWrite",
  "prepareFreshRuntime",
  "appBuildInfo",
  "getUiControlBridgeInfo",
  "getComputerUseMcpCommand",
  "checkComputerUsePermissions",
  "setComputerUseMcpEnabled",
  "setComputerUseSkysightEnabled",
  "setComputerUseSkysightPaused",
  "updateComputerUseSkysightExclusion",
  "clearComputerUseSkysightData",
  "captureComputerUseAppshot",
  "revokeComputerUseAppAuthorization",
  "clearComputerUseAppAuthorizations",
  "openComputerUsePermissionSetup",
  "openComputerUsePermissionSettings",
  "checkSystemPermissions",
  "openSystemPermissionSettings",
  "getLaunchAtLogin",
  "setLaunchAtLogin",
  "getKeepSystemAwake",
  "setKeepSystemAwake",
  "setDockUnreadBadge",
  "setStatusItemVisible",
  "getStatusItemVisible",
  "getAgentReadySoundPath",
  "registerAppSnapshotHotkey",
  "unregisterAppSnapshotHotkey",
  "registerQuickCaptureHotkey",
  "unregisterQuickCaptureHotkey",
  "setQuickCaptureContext",
  "toggleQuickCapture",
  "setKeymapAcceleratorOverrides",
  "getDesktopBootstrapConfig",
  "debugDesktopBootstrapConfig",
  "setDesktopBootstrapConfig",
  "pickDirectory",
  "pickFile",
  "saveFile",
  "exportVisualSnapshot",
  "updaterEnvironment",
  "setWindowDecorations",
  "__openPath",
  "__revealItemInDir",
  "__fetch",
  "__fetchCancel",
  "__homeDir",
  "__joinPath",
  "__setZoomFactor",
  "__setNativeTheme",
  "__setApplicationMenuVisible",
  "checkSoftwareEnv",
  "installSoftwareEnv",
  "checkBrowserSkillStatus",
  "openBrowserSkillInstallPage",
  "openOpenCodeConfigDir",
  "repairOpenCodeEngineConfig",
  "workMemoryEnsureAwareness",
  "workMemoryReadFile",
  "workMemoryWriteFile",
  "workMemoryListFiles",
  "companySettingsRead",
  "companySettingsWrite",
  "companySettingsDisconnect",
  "companyConnect",
  "companySyncConfig",
  "companyCatalog",
  "companyHealth",
  "companyEvaluateAction",
]);

/**
 * @param {Record<string, any>} deps
 * @returns {Record<string, (event: any, args: any[]) => any>}
 */
export function createSystemDomainHandlers({
  userAgentRegistryPath,
  readFile,
  stat,
  writeFile,
  rename,
  mkdir,
  path,
  randomBytes,
  runtimeManager,
  app,
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
  setStatusItemVisible,
  getStatusItemVisible,
  getAgentReadySoundPath,
  registerAppSnapshotHotkey,
  unregisterAppSnapshotHotkey,
  registerQuickCaptureHotkey,
  unregisterQuickCaptureHotkey,
  setKeymapAcceleratorOverrides,
  onQuickCaptureHotkey,
  setQuickCaptureContext,
  toggleQuickCapture,
  getDesktopBootstrapConfig,
  debugDesktopBootstrapConfig,
  setDesktopBootstrapConfig,
  dialog,
  activeWindowFromEvent,
  shell,
  os,
  applyNativeTheme,
  setApplicationMenuVisible,
  BrowserWindow,
  getRealHomeDir,
  onAppSnapshotHotkey,
} = {}) {
  const maxRememberedFetchCancellations = 1_024;
  const fetchControllersById = new Map();
  const cancelledFetchRequestIds = new Map();
  const rememberEarlyFetchCancellation = (requestId) => {
    const previousTimer = cancelledFetchRequestIds.get(requestId);
    if (previousTimer) clearTimeout(previousTimer);
    const timer = setTimeout(() => {
      cancelledFetchRequestIds.delete(requestId);
    }, 30_000);
    timer.unref?.();
    cancelledFetchRequestIds.set(requestId, timer);
    while (cancelledFetchRequestIds.size > maxRememberedFetchCancellations) {
      const oldestRequestId = cancelledFetchRequestIds.keys().next().value;
      if (typeof oldestRequestId !== "string") break;
      const oldestTimer = cancelledFetchRequestIds.get(oldestRequestId);
      if (oldestTimer) clearTimeout(oldestTimer);
      cancelledFetchRequestIds.delete(oldestRequestId);
    }
  };
  const consumeEarlyFetchCancellation = (requestId) => {
    const timer = cancelledFetchRequestIds.get(requestId);
    if (!timer) return false;
    clearTimeout(timer);
    cancelledFetchRequestIds.delete(requestId);
    return true;
  };
  return {
  userAgentRegistryRead: async (event, args) => {
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
  },

  userAgentRegistryWrite: async (event, args) => {
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
  },

  prepareFreshRuntime: async (event, args) => {
    return runtimeManager.prepareFreshRuntime();
  },

  appBuildInfo: async (event, args) => {
    return {
      version: app.getVersion(),
      gitSha: process.env.ONMYAGENT_GIT_SHA ?? null,
      buildEpoch: process.env.ONMYAGENT_BUILD_EPOCH ?? null,
      onmyagentDevMode: process.env.ONMYAGENT_DEV_MODE === "1",
    };
  },

  getUiControlBridgeInfo: async (event, args) => {
    try {
      const raw = await readFile(
        path.join(app.getPath("userData"), "onmyagent-ui-control.json"),
        "utf8",
      );
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  getComputerUseMcpCommand: async (event, args) => {
    return getComputerUseMcpCommand();
  },

  checkComputerUsePermissions: async (event, args) => {
    // Spawn --check → fresh TCC read → always accurate.
    return checkComputerUsePermissions();
  },

  setComputerUseMcpEnabled: async (event, args) => {
    return setComputerUseMcpEnabled(args[0]);
  },

  setComputerUseSkysightEnabled: async (event, args) => {
    return setComputerUseSkysightEnabled(args[0]);
  },

  setComputerUseSkysightPaused: async (event, args) => {
    return setComputerUseSkysightPaused(args[0]);
  },

  updateComputerUseSkysightExclusion: async (event, args) => {
    return updateComputerUseSkysightExclusion(args[0], args[1], args[2]);
  },

  clearComputerUseSkysightData: async (event, args) => {
    return clearComputerUseSkysightData();
  },

  captureComputerUseAppshot: async (event, args) => {
    return captureComputerUseAppshot();
  },

  revokeComputerUseAppAuthorization: async (event, args) => {
    return revokeComputerUseAppAuthorization(args[0]);
  },

  clearComputerUseAppAuthorizations: async (event, args) => {
    return clearComputerUseAppAuthorizations();
  },

  openComputerUsePermissionSetup: async (event, args) => {
    // Open the GUI app. Returns immediately — React shows "verify" CTA.
    await openComputerUseSetupApp();
    // Return a fresh check so the UI shows the current state.
    return checkComputerUsePermissions();
  },

  openComputerUsePermissionSettings: async (event, args) => {
    // Legacy: open the setup app (same as above).
    await openComputerUseSetupApp();
    return checkComputerUsePermissions();
  },

  checkSystemPermissions: async (event, args) => {
    const result = checkSystemPermissions();
    console.log("[checkSystemPermissions] result:", JSON.stringify(result.permissions, null, 2));
    return result;
  },

  openSystemPermissionSettings: async (event, args) => {
    const type = args[0];
    return await openSystemPermissionSettings(type);
  },

  getLaunchAtLogin: async () => getLaunchAtLogin(),
  setLaunchAtLogin: async (event, args) => setLaunchAtLogin(Boolean(args[0])),
  getKeepSystemAwake: async () => getKeepSystemAwake(),
  setKeepSystemAwake: async (event, args) => setKeepSystemAwake(Boolean(args[0])),
  setDockUnreadBadge: async (event, args) => setDockUnreadBadge(args[0]),
  setStatusItemVisible: async (event, args) =>
    setStatusItemVisible(Boolean(args[0])),
  getStatusItemVisible: async () => getStatusItemVisible(),
  getAgentReadySoundPath: async () => getAgentReadySoundPath(),
  registerAppSnapshotHotkey: async (event, args) =>
    registerAppSnapshotHotkey(args[0], () => {
      try {
        onAppSnapshotHotkey?.();
      } catch (error) {
        console.error("[registerAppSnapshotHotkey] callback failed", error);
      }
    }),
  unregisterAppSnapshotHotkey: async () => unregisterAppSnapshotHotkey(),
  registerQuickCaptureHotkey: async (event, args) =>
    registerQuickCaptureHotkey(args[0], () => {
      try {
        onQuickCaptureHotkey?.();
      } catch (error) {
        console.error("[registerQuickCaptureHotkey] callback failed", error);
      }
    }),
  unregisterQuickCaptureHotkey: async () => unregisterQuickCaptureHotkey(),
  setQuickCaptureContext: async (event, args) => {
    const next = args[0] ?? {};
    return setQuickCaptureContext?.(next) ?? { ok: true };
  },
  toggleQuickCapture: async () => {
    if (typeof toggleQuickCapture === "function") {
      return await toggleQuickCapture();
    }
    return { open: false, ok: false };
  },
  setKeymapAcceleratorOverrides: async (event, args) =>
    setKeymapAcceleratorOverrides(args[0] ?? {}),

  getDesktopBootstrapConfig: async (event, args) => {
    return getDesktopBootstrapConfig();
  },

  debugDesktopBootstrapConfig: async (event, args) => {
    return debugDesktopBootstrapConfig();
  },

  setDesktopBootstrapConfig: async (event, args) => {
    return setDesktopBootstrapConfig(args[0] ?? {});
  },

  pickDirectory: async (event, args) => {
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
  },

  pickFile: async (event, args) => {
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
  },

  saveFile: async (event, args) => {
    const options = args[0] ?? {};
    const result = await dialog.showSaveDialog(activeWindowFromEvent(event), {
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters,
    });
    return result.canceled ? null : (result.filePath ?? null);
  },

  exportVisualSnapshot: async (event, args) => exportVisualSnapshot(args[0], {
    sourceWindow: activeWindowFromEvent(event),
    dialog,
    writeFile,
    createPdf: (image, rect) => createVisualSnapshotPdf({ BrowserWindow, image, rect }),
  }),

  updaterEnvironment: async (event, args) => {
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
  },

  setWindowDecorations: async (event, args) => {
    return undefined;
  },

  __openPath: async (event, args) => {
    const target = String(args[0] ?? "").trim();
    if (!target) return "Path is required.";
    return shell.openPath(target);
  },

  openOpenCodeConfigDir: async () => {
    const {
      openOpencodeConfigDir,
    } = await import("../opencode-config-repair.mjs");
    /** @type {string[]} */
    const runtimeConfigDirs = [];
    const pushRuntime = (value) => {
      const trimmed = String(value ?? "").trim();
      if (trimmed && !runtimeConfigDirs.includes(trimmed)) {
        runtimeConfigDirs.push(trimmed);
      }
    };
    try {
      pushRuntime(runtimeManager?.getActiveOpencodeConfigDir?.());
    } catch {
      /* ignore */
    }
    try {
      pushRuntime(runtimeManager?.resolveLocalOpencodeConfigDir?.());
    } catch {
      /* ignore */
    }
    try {
      pushRuntime(runtimeManager?.onmyagentOpencodeConfigDir?.());
    } catch {
      /* ignore */
    }
    return openOpencodeConfigDir({
      userDataDir: app?.getPath?.("userData"),
      homeDir:
        typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir(),
      runtimeConfigDirs,
      shellOpenPath: (target) => shell.openPath(target),
    });
  },

  repairOpenCodeEngineConfig: async (event, args) => {
    const {
      repairOpencodeEngineConfigs,
    } = await import("../opencode-config-repair.mjs");
    const resetToEmpty = args?.[0]?.resetToEmpty === true;
    /** @type {string[]} */
    const runtimeConfigDirs = [];
    const pushRuntime = (value) => {
      const trimmed = String(value ?? "").trim();
      if (trimmed && !runtimeConfigDirs.includes(trimmed)) {
        runtimeConfigDirs.push(trimmed);
      }
    };
    try {
      pushRuntime(runtimeManager?.getActiveOpencodeConfigDir?.());
    } catch {
      /* ignore */
    }
    try {
      pushRuntime(runtimeManager?.resolveLocalOpencodeConfigDir?.());
    } catch {
      /* ignore */
    }
    try {
      pushRuntime(runtimeManager?.onmyagentOpencodeConfigDir?.());
    } catch {
      /* ignore */
    }
    return repairOpencodeEngineConfigs({
      userDataDir: app?.getPath?.("userData"),
      homeDir:
        typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir(),
      runtimeConfigDirs,
      resetToEmpty,
    });
  },

  __revealItemInDir: async (event, args) => {
    const target = String(args[0] ?? "").trim();
    if (!target) return { ok: false, reason: "empty_path" };
    const absolute = path.resolve(target);
    const pathExists = async (candidate) => {
      try {
        await stat(candidate);
        return true;
      } catch {
        return false;
      }
    };
    if (await pathExists(absolute)) {
      shell.showItemInFolder(absolute);
      return { ok: true, path: absolute };
    }
    // Relative / mistyped paths often point at a missing leaf; reveal parent when present.
    const parent = path.dirname(absolute);
    if (parent && parent !== absolute && (await pathExists(parent))) {
      shell.showItemInFolder(parent);
      return { ok: true, path: parent, reason: "revealed_parent" };
    }
    return { ok: false, reason: "not_found", path: absolute };
  },

  __fetch: async (event, args) => {
    const url = String(args[0] ?? "").trim();
    const init = args[1] ?? {};
    if (!url) throw new Error("URL is required.");
    const timeoutMs = Number(init.timeoutMs);
    const requestId = typeof init.requestId === "string" ? init.requestId.trim() : "";
    if (requestId && consumeEarlyFetchCancellation(requestId)) {
      throw new Error("Request cancelled.");
    }
    const controller = new AbortController();
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => controller.abort(new Error("Request timed out.")), timeoutMs)
      : null;
    if (requestId) {
      fetchControllersById.get(requestId)?.abort(new Error("Request replaced."));
      fetchControllersById.set(requestId, controller);
    }
    try {
      const response = await fetch(url, {
        method: typeof init.method === "string" ? init.method : undefined,
        headers:
          init.headers && typeof init.headers === "object"
            ? init.headers
            : undefined,
        body: typeof init.body === "string" ? init.body : undefined,
        signal: controller.signal,
      });
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Array.from(response.headers.entries()),
        body: await response.text(),
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      if (requestId && fetchControllersById.get(requestId) === controller) {
        fetchControllersById.delete(requestId);
      }
    }
  },

  __fetchCancel: async (event, args) => {
    const requestId = String(args[0] ?? "").trim();
    const controller = fetchControllersById.get(requestId);
    if (!controller) {
      if (requestId) rememberEarlyFetchCancellation(requestId);
      return { ok: false };
    }
    fetchControllersById.delete(requestId);
    controller.abort(new Error("Request cancelled."));
    return { ok: true };
  },

  __homeDir: async (event, args) => {
    return os.homedir();
  },

  /**
   * Ensure ~/.onmyagent/data/user/awareness/main exists with seed files
   * (style.md / AGENTS.md / USER.md / MEMORY.md + profile / pending).
   * Same path as cold-start install seed (idempotent).
   */
  workMemoryEnsureAwareness: async () => {
    const homeDir =
      typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir();
    return ensureWorkMemoryAwareness({
      homeDir,
      mkdir,
      stat,
      writeFile,
    });
  },

  workMemoryListFiles: async () => {
    const homeDir =
      typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir();
    // List always seeds missing files so UI never shows "not created" after install.
    const ensured = await ensureWorkMemoryAwareness({
      homeDir,
      mkdir,
      stat,
      writeFile,
    });
    const names = Object.keys(WORK_MEMORY_SEED_FILES);
    const files = [];
    for (const name of names) {
      const filePath = path.join(ensured.path, name);
      try {
        const st = await stat(filePath);
        files.push({
          name,
          size: st.size,
          mtimeMs: st.mtimeMs,
          exists: true,
        });
      } catch {
        files.push({ name, size: 0, mtimeMs: 0, exists: false });
      }
    }
    return { ok: true, path: ensured.path, files };
  },

  workMemoryReadFile: async (event, args) => {
    const name = String(args[0] ?? "").trim();
    if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
      return { ok: false, reason: "invalid_name" };
    }
    const homeDir =
      typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir();
    // Missing files get seed content so view/edit never hits a hard empty state.
    await ensureWorkMemoryAwareness({
      homeDir,
      mkdir,
      stat,
      writeFile,
    });
    const mainDir = resolveWorkMemoryAwarenessMainDir(homeDir);
    const filePath = path.join(mainDir, name);
    try {
      const content = await readFile(filePath, "utf8");
      const st = await stat(filePath);
      return {
        ok: true,
        path: filePath,
        content,
        size: st.size,
        mtimeMs: st.mtimeMs,
      };
    } catch {
      // Last resort: materialize this one seed and retry.
      const seed = WORK_MEMORY_SEED_FILES[name];
      if (typeof seed === "string") {
        try {
          await mkdir(mainDir, { recursive: true });
          await writeFile(filePath, seed, "utf8");
          const st = await stat(filePath);
          return {
            ok: true,
            path: filePath,
            content: seed,
            size: st.size,
            mtimeMs: st.mtimeMs,
          };
        } catch {
          // fall through
        }
      }
      return { ok: false, reason: "not_found", path: filePath };
    }
  },

  workMemoryWriteFile: async (event, args) => {
    const payload = args[0] ?? {};
    const name = String(payload.name ?? "").trim();
    const content = typeof payload.content === "string" ? payload.content : "";
    if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
      return { ok: false, reason: "invalid_name" };
    }
    const homeDir =
      typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir();
    const mainDir = resolveWorkMemoryAwarenessMainDir(homeDir);
    await mkdir(mainDir, { recursive: true });
    const filePath = path.join(mainDir, name);
    await writeFile(filePath, content, "utf8");
    const st = await stat(filePath);
    return { ok: true, path: filePath, size: st.size, mtimeMs: st.mtimeMs };
  },

  __joinPath: async (event, args) => {
    return path.join(...args.map((value) => String(value ?? "")));
  },

  __setZoomFactor: async (event, args) => {
    const factor = Number(args[0]);
    const window = activeWindowFromEvent(event);
    if (!window || !Number.isFinite(factor) || factor <= 0) {
      return false;
    }
    window.webContents.setZoomFactor(factor);
    return true;
  },

  __setNativeTheme: async (event, args) => {
    return applyNativeTheme(String(args[0]));
  },

  __setApplicationMenuVisible: async (event, args) => {
    return setApplicationMenuVisible(args[0]);
  },

  checkSoftwareEnv: async (event, args) => {
    return runtimeManager.softwareEnvironmentInfo();
  },

  checkBrowserSkillStatus: async (event, args) => {
    return checkBrowserSkillStatus();
  },

  openBrowserSkillInstallPage: async (event, args) => {
    const target = args[0] === "cli" || args[0] === "docs" ? args[0] : "extension";
    return openBrowserSkillInstallPage(target);
  },

  installSoftwareEnv: async (event, args) => {
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
  },

  /**
   * Durable company session store (SoT: company-client company-settings.json).
   * Renderer Company settings must use these instead of localStorage-only.
   */
  companySettingsRead: async () => {
    const homeDir =
      typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir();
    return readCompanySettings(homeDir);
  },

  companySettingsWrite: async (event, args) => {
    const homeDir =
      typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir();
    const patch = args[0] && typeof args[0] === "object" ? args[0] : {};
    return writeCompanySettings(homeDir, patch);
  },

  companySettingsDisconnect: async () => {
    const homeDir =
      typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir();
    return disconnectCompany(homeDir);
  },

  /**
   * Probe company health from main process (renderer must not fetch OMC — CORS).
   * args[0] = companyBaseUrl string
   */
  companyHealth: async (event, args) => {
    const baseUrl = String(args[0] ?? "").trim();
    return fetchCompanyHealth(baseUrl);
  },

  /** Policy check for org-gated actions (args[0] = actionId). */
  companyEvaluateAction: async (event, args) => {
    const homeDir =
      typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir();
    return evaluateCompanyActionPolicy(homeDir, String(args[0] ?? ""));
  },

  /**
   * Full connect: health + email OTP + pull OrgConfig mirror + session.
   * args[0] = { companyBaseUrl, email, code }
   */
  companyConnect: async (event, args) => {
    const homeDir =
      typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir();
    const input = args[0] && typeof args[0] === "object" ? args[0] : {};
    return connectCompany(homeDir, {
      companyBaseUrl: String(input.companyBaseUrl ?? ""),
      email: String(input.email ?? ""),
      code: String(input.code ?? ""),
    });
  },

  /** Re-pull OrgConfig when already logged in. */
  companySyncConfig: async () => {
    const homeDir =
      typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir();
    const settings = readCompanySettings(homeDir);
    if (!settings.companyBaseUrl || !settings.memberToken) {
      throw new Error("not connected to company");
    }
    const pulled = await pullAndWriteCompanyConfig(
      homeDir,
      settings.companyBaseUrl,
      settings.memberToken,
    );
    const next = writeCompanySettings(homeDir, {
      lastSyncedVersion: pulled.version,
      lastSyncedAt: new Date().toISOString(),
    });
    return { settings: next, pulled };
  },

  /** Catalog for 公司 tabs (skills + experts from mirror). */
  companyCatalog: async () => {
    const homeDir =
      typeof getRealHomeDir === "function" ? getRealHomeDir() : os.homedir();
    return listCompanyCatalog(homeDir);
  },

  };
}
