/**
 * Managed desktop tool IPC handlers.
 * Factories receive services/helpers constructed in main.mjs.
 */

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "officeCliGetStatus",
  "officeCliInstallLatest",
  "officeCliUninstall",
]);

function errorDetails(error) {
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "officecli_error";
  return {
    errorCode: code,
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

/**
 * @param {Record<string, any>} deps
 * @returns {Record<string, (event: any, args: any[]) => any>}
 */
export function createManagedToolsDomainHandlers({ officeCliManager } = {}) {
  if (!officeCliManager) {
    throw new Error("createManagedToolsDomainHandlers requires officeCliManager");
  }

  return {
    officeCliGetStatus: async (_event, args) => {
      if (args?.[0]?.forceRefresh === true) {
        return officeCliManager.checkForUpdates(true);
      }
      return officeCliManager.getStatus();
    },

    officeCliInstallLatest: async () => officeCliManager.installLatest(),

    officeCliUninstall: async () => {
      try {
        return await officeCliManager.uninstall();
      } catch (error) {
        return {
          ...(await officeCliManager.getStatus()),
          state: "error",
          ...errorDetails(error),
        };
      }
    },
  };
}
