import { spawn, spawnSync } from "node:child_process";

/**
 * Resolve a command name for the current platform.
 * On Windows, Node cannot spawn `pnpm`/`npm`/`npx` shims without `.cmd` + shell.
 */
export function resolveCommand(command) {
  if (process.platform !== "win32") return command;
  const base = String(command ?? "").trim();
  if (!base) return base;
  if (/\.(cmd|bat|exe)$/i.test(base)) return base;
  if (base === "pnpm" || base === "npm" || base === "npx" || base === "yarn") {
    return `${base}.cmd`;
  }
  return base;
}

function needsShell(command) {
  // Node on Windows cannot spawn .cmd/.bat without shell (EINVAL).
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

/**
 * Fire-and-forget spawn that exits the current process with the child code.
 * Used by CLI wrappers.
 */
export function runCommand(commandConfig, options = {}) {
  const command = resolveCommand(commandConfig.command);
  const child = spawn(command, commandConfig.args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdio: "inherit",
    shell: needsShell(command),
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

/**
 * Synchronous spawn with Windows-safe command resolution.
 * Returns the raw spawnSync result (does not exit the process).
 */
export function spawnCommandSync(command, args = [], options = {}) {
  const resolved = resolveCommand(command);
  return spawnSync(resolved, args, {
    ...options,
    shell: options.shell ?? needsShell(resolved),
  });
}
