/**
 * opencode domain IPC handlers for the Electron desktop bridge.
 * Factories receive services/helpers constructed in main.mjs.
 */

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "opencodeCommandList",
  "opencodeCommandWrite",
  "opencodeCommandDelete",
  "readOpencodeConfig",
  "writeOpencodeConfig",
  "resetOpencodeCache",
  "opencodeMcpAuth",
]);

/**
 * @param {Record<string, any>} deps
 * @returns {Record<string, (event: any, args: any[]) => any>}
 */
export function createOpencodeDomainHandlers({
  listCommandNames,
  writeCommandFile,
  deleteCommandFile,
  readOpencodeConfig,
  writeOpencodeConfig,
  runtimeManager,
} = {}) {
  return {
  opencodeCommandList: async (event, args) => {
    return listCommandNames(
      String(args[0]?.scope ?? "").trim(),
      String(args[0]?.projectDir ?? "").trim(),
    );
  },

  opencodeCommandWrite: async (event, args) => {
    return writeCommandFile(
      String(args[0]?.scope ?? "").trim(),
      String(args[0]?.projectDir ?? "").trim(),
      args[0]?.command ?? {},
    );
  },

  opencodeCommandDelete: async (event, args) => {
    return deleteCommandFile(
      String(args[0]?.scope ?? "").trim(),
      String(args[0]?.projectDir ?? "").trim(),
      String(args[0]?.name ?? "").trim(),
    );
  },

  readOpencodeConfig: async (event, args) => {
    return readOpencodeConfig(
      String(args[0] ?? "").trim(),
      String(args[1] ?? "").trim(),
    );
  },

  writeOpencodeConfig: async (event, args) => {
    return writeOpencodeConfig(
      String(args[0] ?? "").trim(),
      String(args[1] ?? "").trim(),
      String(args[2] ?? ""),
    );
  },

  resetOpencodeCache: async (event, args) => {
    return { removed: [], missing: [], errors: [] };
  },

  opencodeMcpAuth: async (event, args) => {
    return runtimeManager.opencodeMcpAuth(
      String(args[0] ?? "").trim(),
      String(args[1] ?? "").trim(),
    );
  },

  };
}
