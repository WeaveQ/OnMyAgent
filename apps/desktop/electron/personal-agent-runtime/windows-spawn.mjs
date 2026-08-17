import { closeSync, existsSync, openSync, readSync } from "node:fs";
import path from "node:path";

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

/**
 * Parse `#!/usr/bin/env node` / `#!/usr/bin/node` so Windows can spawn via the
 * interpreter. Unix kernels honor shebangs; CreateProcess does not.
 */
export function parseUnixShebangLine(line) {
  const text = String(line ?? "").replace(/^\uFEFF/, "").trim();
  if (!text.startsWith("#!")) return null;
  const parts = text.slice(2).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0];
  const firstBase = first.replace(/\\/g, "/").split("/").pop() || first;
  if (firstBase === "env") {
    let index = 1;
    if (parts[index] === "-S") index += 1;
    const interpreter = parts[index];
    if (!interpreter) return null;
    return { interpreter, extraArgs: parts.slice(index + 1) };
  }
  return { interpreter: firstBase, extraArgs: parts.slice(1) };
}

function defaultReadShebangLine(filePath) {
  let fd;
  try {
    fd = openSync(filePath, "r");
    const buf = Buffer.alloc(256);
    const n = readSync(fd, buf, 0, 256, 0);
    const line = buf.subarray(0, n).toString("utf8").split(/\r?\n/, 1)[0] ?? "";
    return line.startsWith("#!") ? line : "";
  } catch {
    return "";
  } finally {
    if (fd != null) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

export function readShebangLine(filePath, options = {}) {
  if (typeof options.readFileSync === "function") {
    try {
      const text = String(options.readFileSync(filePath, "utf8"));
      const line = text.split(/\r?\n/, 1)[0] ?? "";
      return line.startsWith("#!") ? line : "";
    } catch {
      return "";
    }
  }
  return defaultReadShebangLine(filePath);
}

export function resolveWindowsInterpreter(name, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return null;
  const raw = String(name ?? "").trim();
  if (!raw) return null;
  const env = options.env ?? process.env;
  const exists = typeof options.exists === "function" ? options.exists : existsSync;
  if ((/[\\/]/.test(raw) || /^[A-Za-z]:/.test(raw)) && exists(raw)) return raw;

  const basename = raw.replace(/\\/g, "/").split("/").pop() || raw;
  const dirs = String(env.PATH ?? env.Path ?? env.path ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const pathext = String(env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean);
  const names = [basename];
  if (!/\.[A-Za-z0-9]+$/.test(basename)) {
    for (const ext of pathext) {
      names.push(`${basename}${ext.startsWith(".") ? ext : `.${ext}`}`);
    }
  }
  for (const dir of dirs) {
    for (const file of names) {
      const candidate = path.win32.join(dir, file);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function isWindowsNativeBinary(command) {
  return /\.(exe|com)$/i.test(String(command ?? ""));
}

/**
 * WorkBuddy and other Electron-app CLIs ship extensionless `#!/usr/bin/env node`
 * scripts. Direct spawn is ENOENT; cmd.exe says "not a command". Run via node.
 */
export function resolveWindowsShebangSpawnSpec(command, args = [], options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return null;
  const script = String(command ?? "").trim();
  if (!script || isWindowsCmdShim(script, platform) || isWindowsNativeBinary(script)) return null;
  if (!/[\\/]/.test(script) && !/^[A-Za-z]:/.test(script)) return null;

  const parsed = parseUnixShebangLine(readShebangLine(script, options));
  if (!parsed) return null;

  const interpreter = resolveWindowsInterpreter(parsed.interpreter, options);
  const scriptArgs = [...parsed.extraArgs, script, ...(Array.isArray(args) ? args : [args])];
  if (!interpreter) {
    return {
      ...buildWindowsCmdSpawnSpec(parsed.interpreter, scriptArgs, options),
      shebang: true,
    };
  }
  return {
    command: interpreter,
    args: scriptArgs,
    windowsVerbatimArguments: false,
    shebang: true,
  };
}

export function resolveWindowsAwareSpawnSpec(command, args = [], options = {}) {
  const platform = options.platform ?? process.platform;
  const shebangSpec = resolveWindowsShebangSpawnSpec(command, args, { ...options, platform });
  if (shebangSpec) return shebangSpec;
  if (shouldUseWindowsCmdSpawn(command, platform)) {
    return buildWindowsCmdSpawnSpec(command, args, options);
  }
  return { command, args, windowsVerbatimArguments: false };
}
