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
  "larkCliGetConnectionStatus",
  "larkCliGetRecommendedScopesJson",
  "larkCliSubmitManualCredentials",
  "larkCliStartUserLogin",
  "larkCliCompleteUserLogin",
  "larkCliStartConfigInit",
  "larkCliCancelConfigInit",
  "larkCliDisconnect",
  "tencentDocsGetStatus",
  "tencentDocsStartConnect",
  "tencentDocsCompleteConnect",
  "tencentDocsCancelConnect",
  "tencentDocsDisconnect",
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
  larkCliAuth,
  tencentDocsConnector,
} = {}) {
  if (!officeCliManager) {
    throw new Error("createManagedToolsDomainHandlers requires officeCliManager");
  }
  if (!larkCliManager) {
    throw new Error("createManagedToolsDomainHandlers requires larkCliManager");
  }
  if (!larkCliAuth) {
    throw new Error("createManagedToolsDomainHandlers requires larkCliAuth");
  }
  if (!tencentDocsConnector) {
    throw new Error(
      "createManagedToolsDomainHandlers requires tencentDocsConnector",
    );
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

    larkCliGetConnectionStatus: async () => larkCliAuth.getConnectionStatus(),
    larkCliGetRecommendedScopesJson: async () => larkCliAuth.getRecommendedScopesJson(),
    larkCliSubmitManualCredentials: async (_event, args) => {
      const input = args?.[0] ?? {};
      return larkCliAuth.submitManualCredentials(input);
    },
    larkCliStartUserLogin: async () => larkCliAuth.startUserLogin(),
    larkCliCompleteUserLogin: async (_event, args) => {
      const sessionId = args?.[0]?.sessionId;
      return larkCliAuth.completeUserLogin(sessionId);
    },
    larkCliStartConfigInit: async () => larkCliAuth.startConfigInit(),
    larkCliCancelConfigInit: async () => larkCliAuth.cancelConfigInit(),
    larkCliDisconnect: async (_event, args) => {
      return larkCliAuth.disconnect(args?.[0] ?? {});
    },

    tencentDocsGetStatus: async () => tencentDocsConnector.getStatus(),
    tencentDocsStartConnect: async () => tencentDocsConnector.startConnect(),
    tencentDocsCompleteConnect: async (_event, args) => {
      const sessionId = args?.[0]?.sessionId;
      return tencentDocsConnector.completeConnect(sessionId);
    },
    tencentDocsCancelConnect: async () => tencentDocsConnector.cancelConnect(),
    tencentDocsDisconnect: async () => tencentDocsConnector.disconnect(),
  };
}
