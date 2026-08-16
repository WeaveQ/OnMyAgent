/**
 * Computer Use / Appshot domain IPC handlers.
 * Command names stay the same; group is `computerUse` in desktop-ipc-commands.
 */

export const HANDLER_COMMAND_NAMES = Object.freeze([
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
]);

/**
 * @param {Record<string, any>} deps
 * @returns {Record<string, (event: any, args: any[]) => any>}
 */
export function createComputerUseDomainHandlers({
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
} = {}) {
  return {
    getComputerUseMcpCommand: async () => {
      return getComputerUseMcpCommand();
    },

    checkComputerUsePermissions: async () => {
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

    clearComputerUseSkysightData: async () => {
      return clearComputerUseSkysightData();
    },

    captureComputerUseAppshot: async () => {
      return captureComputerUseAppshot();
    },

    revokeComputerUseAppAuthorization: async (event, args) => {
      return revokeComputerUseAppAuthorization(args[0]);
    },

    clearComputerUseAppAuthorizations: async () => {
      return clearComputerUseAppAuthorizations();
    },

    openComputerUsePermissionSetup: async () => {
      // Open the GUI app. Returns immediately — React shows "verify" CTA.
      await openComputerUseSetupApp();
      return checkComputerUsePermissions();
    },

    openComputerUsePermissionSettings: async () => {
      await openComputerUseSetupApp();
      return checkComputerUsePermissions();
    },
  };
}
