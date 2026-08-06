/**
 * Managed desktop tool IPC handlers.
 * Factories receive services/helpers constructed in main.mjs.
 */

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "officeCliGetStatus",
  "officeCliInstallLatest",
  "officeCliUninstall",
  "larkCliGetStatus",
  "larkCliInstallLatest",
  "larkCliUninstall",
]);

function errorDetails(error, fallbackCode) {
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : fallbackCode;
  return {
    errorCode: code,
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

/**
 * @param {{
 *   getStatus: () => Promise<any>,
 *   checkForUpdates: (force: boolean) => Promise<any>,
 *   installLatest: () => Promise<any>,
 *   uninstall: () => Promise<any>,
 * }} manager
 * @param {string} fallbackCode
 */
function createPluginHandlers(manager, fallbackCode) {
  return {
    getStatus: async (_event, args) => {
      if (args?.[0]?.forceRefresh === true) {
        return manager.checkForUpdates(true);
      }
      return manager.getStatus();
    },
    installLatest: async () => manager.installLatest(),
    uninstall: async () => {
      try {
        return await manager.uninstall();
      } catch (error) {
        return {
          ...(await manager.getStatus()),
          state: "error",
          ...errorDetails(error, fallbackCode),
        };
      }
    },
  };
}

/**
 * @param {Record<string, any>} deps
 * @returns {Record<string, (event: any, args: any[]) => any>}
 */
export function createManagedToolsDomainHandlers({
  officeCliManager,
  larkCliManager,
} = {}) {
  if (!officeCliManager) {
    throw new Error("createManagedToolsDomainHandlers requires officeCliManager");
  }
  if (!larkCliManager) {
    throw new Error("createManagedToolsDomainHandlers requires larkCliManager");
  }

  const office = createPluginHandlers(officeCliManager, "officecli_error");
  const lark = createPluginHandlers(larkCliManager, "lark_cli_error");

  return {
    officeCliGetStatus: office.getStatus,
    officeCliInstallLatest: office.installLatest,
    officeCliUninstall: office.uninstall,
    larkCliGetStatus: lark.getStatus,
    larkCliInstallLatest: lark.installLatest,
    larkCliUninstall: lark.uninstall,
  };
}
