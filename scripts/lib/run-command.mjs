import { spawn } from 'node:child_process'

export function resolveCommand(command) {
  return process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command
}

export function runCommand(commandConfig, options = {}) {
  const command = resolveCommand(commandConfig.command)
  const child = spawn(command, commandConfig.args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdio: 'inherit',
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    process.exit(code ?? 0)
  })
}
