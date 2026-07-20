import { spawn } from 'node:child_process'

export function resolveCommand(command) {
  return process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command
}

function needsShell(command) {
  // Node on Windows cannot spawn .cmd/.bat without shell (EINVAL).
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
}

export function runCommand(commandConfig, options = {}) {
  const command = resolveCommand(commandConfig.command)
  const child = spawn(command, commandConfig.args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdio: 'inherit',
    shell: needsShell(command),
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    process.exit(code ?? 0)
  })
}
