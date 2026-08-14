const CMD_META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/g;

export function isWindowsCmdShim(command, platform = process.platform) {
  return platform === "win32" && /\.(cmd|bat)$/i.test(String(command ?? ""));
}

export function isNodeModulesCmdShim(command) {
  return /[\\/]node_modules[\\/]\.bin[\\/][^\\/]+\.(cmd|bat)$/i.test(String(command ?? ""));
}

export function escapeWindowsCmdCommand(command) {
  return String(command ?? "").replace(CMD_META_CHARACTERS, "^$1");
}

export function escapeWindowsCmdArgument(value, { doubleEscapeMetaCharacters = true } = {}) {
  let escaped = String(value ?? "");
  escaped = escaped.replace(/(?=(\\+?)?)\1"/g, "$1$1\\\"");
  escaped = escaped.replace(/(?=(\\+?)?)\1$/, "$1$1");
  escaped = `"${escaped}"`.replace(CMD_META_CHARACTERS, "^$1");
  if (doubleEscapeMetaCharacters) escaped = escaped.replace(CMD_META_CHARACTERS, "^$1");
  return escaped;
}

/**
 * @param {string} command
 * @param {unknown[]} [args]
 * @param {{ env?: NodeJS.ProcessEnv, doubleEscapeMetaCharacters?: boolean }} [options]
 */
export function buildWindowsCmdSpawnSpec(command, args = [], options = {}) {
  const env = options.env ?? process.env;
  const { doubleEscapeMetaCharacters } = options;
  const doubleEscape = doubleEscapeMetaCharacters ?? isNodeModulesCmdShim(command);
  const commandLine = [
    escapeWindowsCmdCommand(command),
    ...((Array.isArray(args) ? args : [args]).map((arg) => escapeWindowsCmdArgument(arg, { doubleEscapeMetaCharacters: doubleEscape }))),
  ].join(" ");
  return {
    command: env?.ComSpec || env?.COMSPEC || process.env.ComSpec || process.env.COMSPEC || "cmd.exe",
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

/**
 * Bare names (claude, cursor, pnpm) and *.cmd/*.bat paths EINVAL if spawned
 * without cmd.exe on Windows. Real .exe/.com paths stay direct.
 */
export function shouldUseWindowsCmdSpawn(command, platform = process.platform) {
  if (platform !== "win32") return false;
  if (isWindowsCmdShim(command, platform)) return true;
  const base = String(command ?? "").trim();
  if (!base) return false;
  if (!/[\\/]/.test(base) && !/\.(exe|com)$/i.test(base)) return true;
  return false;
}

export function resolveWindowsAwareSpawnSpec(command, args = [], options = {}) {
  const platform = options.platform ?? process.platform;
  if (shouldUseWindowsCmdSpawn(command, platform)) {
    return buildWindowsCmdSpawnSpec(command, args, options);
  }
  return { command, args, windowsVerbatimArguments: false };
}
