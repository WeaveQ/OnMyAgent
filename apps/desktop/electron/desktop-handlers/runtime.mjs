/**
 * runtime domain IPC handlers for the Electron desktop bridge.
 * Factories receive services/helpers constructed in main.mjs.
 */

import {
  normalizeResetMode,
  resetOnMyAgentLocalData,
} from "../reset-onmyagent-state.mjs";

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "engineStart",
  "runtimeBootstrap",
  "runtimeStatus",
  "engineStop",
  "engineRestart",
  "engineInfo",
  "engineDoctor",
  "engineInstall",
  "orchestratorStatus",
  "orchestratorWorkspaceActivate",
  "orchestratorInstanceDispose",
  "getOpenworkUiMcpCommand",
  "getOnMyAgentUiMcpCommand",
  "getOpenworkUiMcpEnvironment",
  "getOnMyAgentUiMcpEnvironment",
  "nukeOpenworkAndOpencodeConfigAndExit",
  "nukeOnMyAgentAndOpencodeConfigAndExit",
  "orchestratorStartDetached",
  "sandboxDoctor",
  "sandboxStop",
  "sandboxCleanupOpenworkContainers",
  "sandboxCleanupOnMyAgentContainers",
  "sandboxDebugProbe",
  "onmyagentServerInfo",
  "onmyagentServerRestart",
  "resetOpenworkState",
  "resetOnMyAgentState",
]);

/**
 * @param {Record<string, any>} deps
 * @returns {Record<string, (event: any, args: any[]) => any>}
 */
export function createRuntimeDomainHandlers({
  runtimeManager,
  ensureRuntimeBootstrap,
  engineDoctor,
  app,
  path,
  readFile,
  rm,
  __dirname,
  workspaceStatePath,
  desktopBootstrapPath,
  os,
} = {}) {
  /**
   * @param {unknown[]} args
   */
  async function resetOnMyAgentStateHandler(args) {
    const mode = normalizeResetMode(args?.[0]);
    const homeDir =
      typeof os?.homedir === "function" ? os.homedir() : undefined;
    const userDataDir =
      typeof app?.getPath === "function" ? app.getPath("userData") : "";
    const appDataDir =
      typeof app?.getPath === "function" ? app.getPath("appData") : "";
    const bootstrap =
      typeof desktopBootstrapPath === "function"
        ? desktopBootstrapPath()
        : desktopBootstrapPath;

    return resetOnMyAgentLocalData({
      mode,
      homeDir,
      userDataDir,
      appDataDir,
      desktopBootstrapPath: bootstrap,
      platform: process.platform,
      remove: async (target) => {
        // Prefer injected rm for tests; force recursive for dirs.
        if (typeof rm === "function") {
          await rm(target, { recursive: true, force: true });
          return;
        }
        const { rm: nodeRm } = await import("node:fs/promises");
        await nodeRm(target, { recursive: true, force: true });
      },
    });
  }

  return {
  engineStart: async (event, args) => {
    const projectDir = String(args[0] ?? "").trim();
    const options = args[1] ?? {};
    return runtimeManager.engineStart(projectDir, options);
  },

  runtimeBootstrap: async (event, args) => {
    return ensureRuntimeBootstrap();
  },

  runtimeStatus: async (event, args) => {
    return runtimeManager.runtimeStatus();
  },

  engineStop: async (event, args) => {
    return runtimeManager.engineStop();
  },

  engineRestart: async (event, args) => {
    return runtimeManager.engineRestart(args[0] ?? {});
  },

  engineInfo: async (event, args) => {
    return runtimeManager.engineInfo();
  },

  engineDoctor: async (event, args) => {
    return engineDoctor(args[0]);
  },

  engineInstall: async (event, args) => {
    return runtimeManager.engineInstall();
  },

  orchestratorStatus: async (event, args) => {
    return runtimeManager.orchestratorStatus();
  },

  orchestratorWorkspaceActivate: async (event, args) => {
    return runtimeManager.orchestratorWorkspaceActivate(args[0] ?? {});
  },

  orchestratorInstanceDispose: async (event, args) => {
    return runtimeManager.orchestratorInstanceDispose(
      String(args[0] ?? "").trim(),
    );
  },

  // shared: getOpenworkUiMcpCommand, getOnMyAgentUiMcpCommand
  getOpenworkUiMcpCommand: async (event, args) => {
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
  },
  getOnMyAgentUiMcpCommand: async (event, args) => {
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
  },

  // shared: getOpenworkUiMcpEnvironment, getOnMyAgentUiMcpEnvironment
  getOpenworkUiMcpEnvironment: async (event, args) => {
    return {
      ONMYAGENT_UI_CONTROL_DISCOVERY: path.join(
        app.getPath("userData"),
        "onmyagent-ui-control.json",
      ),
    };
  },
  getOnMyAgentUiMcpEnvironment: async (event, args) => {
    return {
      ONMYAGENT_UI_CONTROL_DISCOVERY: path.join(
        app.getPath("userData"),
        "onmyagent-ui-control.json",
      ),
    };
  },

  // shared: nukeOpenworkAndOpencodeConfigAndExit, nukeOnMyAgentAndOpencodeConfigAndExit
  nukeOpenworkAndOpencodeConfigAndExit: async (event, args) => {
    await rm(app.getPath("userData"), { recursive: true, force: true });
    app.exit(0);
    return undefined;
  },
  nukeOnMyAgentAndOpencodeConfigAndExit: async (event, args) => {
    await rm(app.getPath("userData"), { recursive: true, force: true });
    app.exit(0);
    return undefined;
  },

  orchestratorStartDetached: async (event, args) => {
    return runtimeManager.orchestratorStartDetached(args[0] ?? {});
  },

  sandboxDoctor: async (event, args) => {
    return runtimeManager.sandboxDoctor();
  },

  sandboxStop: async (event, args) => {
    return runtimeManager.sandboxStop(String(args[0] ?? "").trim());
  },

  // shared: sandboxCleanupOpenworkContainers, sandboxCleanupOnMyAgentContainers
  sandboxCleanupOpenworkContainers: async (event, args) => {
    return runtimeManager.sandboxCleanupOnMyAgentContainers();
  },
  sandboxCleanupOnMyAgentContainers: async (event, args) => {
    return runtimeManager.sandboxCleanupOnMyAgentContainers();
  },

  sandboxDebugProbe: async (event, args) => {
    return runtimeManager.sandboxDebugProbe();
  },

  onmyagentServerInfo: async (event, args) => {
    return runtimeManager.onmyagentServerInfo();
  },

  onmyagentServerRestart: async (event, args) => {
    return runtimeManager.onmyagentServerRestart(args[0] ?? {});
  },

  // shared: resetOpenworkState, resetOnMyAgentState
  // mode: "onboarding" (default) | "all" — see reset-onmyagent-state.mjs
  resetOpenworkState: async (event, args) => {
    return resetOnMyAgentStateHandler(args);
  },
  resetOnMyAgentState: async (event, args) => {
    return resetOnMyAgentStateHandler(args);
  },

  };
}
