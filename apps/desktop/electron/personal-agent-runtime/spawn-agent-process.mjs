import { spawn } from "node:child_process";

import { resolveWindowsAwareSpawnSpec } from "./windows-spawn.mjs";

/**
 * Spawn a personal-agent CLI so Windows .cmd shims and bare names do not EINVAL.
 */
export function spawnAgentProcess(command, args, options = {}) {
  const spec = resolveWindowsAwareSpawnSpec(command, args, { env: options.env });
  const child = spawn(spec.command, spec.args, {
    ...options,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
  });
  // Callers may attach their own handler; this default prevents Node from
  // turning a missing CLI (ENOENT / EINVAL) into an uncaughtException that
  // exits the desktop process.
  child.on("error", () => {});
  return child;
}
