import { spawn } from "node:child_process";

import { resolveWindowsAwareSpawnSpec } from "./windows-spawn.mjs";

/**
 * Spawn a personal-agent CLI so Windows .cmd shims and bare names do not EINVAL.
 */
export function spawnAgentProcess(command, args, options = {}) {
  const spec = resolveWindowsAwareSpawnSpec(command, args, { env: options.env });
  return spawn(spec.command, spec.args, {
    ...options,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
  });
}
