/**
 * system domain IPC handlers for the Electron desktop bridge.
 * Factories receive services/helpers constructed in main.mjs.
 */

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "userAgentRegistryRead",
  "userAgentRegistryWrite",
  "prepareFreshRuntime",
  "appBuildInfo",
  "getUiControlBridgeInfo",
  "getComputerUseMcpCommand",
  "checkComputerUsePermissions",
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
  "getDesktopBootstrapConfig",
  "debugDesktopBootstrapConfig",
  "setDesktopBootstrapConfig",
  "pickDirectory",
  "pickFile",
  "saveFile",
  "updaterEnvironment",
  "setWindowDecorations",
  "__openPath",
  "__revealItemInDir",
  "__fetch",
  "__homeDir",
  "__joinPath",
  "__setZoomFactor",
  "__setNativeTheme",
  "__setApplicationMenuVisible",
  "checkSoftwareEnv",
  "installSoftwareEnv",
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
} = {}) {
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
    const result = openSystemPermissionSettings(type);
    return result;
  },

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
  },

  __homeDir: async (event, args) => {
    return os.homedir();
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

  };
}
