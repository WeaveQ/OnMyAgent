#!/usr/bin/env node
import { runCommand } from '../lib/run-command.mjs'

const isWin = process.platform === 'win32'
const appDev = isWin ? 'dev:windows' : 'dev'
const desktopDev = isWin ? 'dev:windows' : 'dev'

const targets = new Map([
  ['desktop', { command: 'pnpm', args: ['--filter', '@onmyagent/desktop', desktopDev] }],
  ['electron', { command: 'pnpm', args: ['--filter', '@onmyagent/desktop', desktopDev] }],
  ['app', { command: 'pnpm', args: ['--filter', '@onmyagent/app', appDev] }],
  ['web', { command: 'pnpm', args: ['--filter', '@onmyagent/app', appDev] }],
  ['ui', { command: 'pnpm', args: ['--filter', '@onmyagent/app', appDev] }],
  ['server', { command: 'pnpm', args: ['--filter', 'onmyagent-server', 'dev'] }],
  ['api', { command: 'pnpm', args: ['--filter', 'onmyagent-server', 'dev'] }],
  ['orchestrator', { command: 'pnpm', args: ['--filter', 'onmyagent-orchestrator', 'dev'] }],
  ['runtime', { command: 'pnpm', args: ['--filter', 'onmyagent-orchestrator', 'dev'] }],
  ['headless', { command: 'bun', args: ['scripts/dev/headless-web.ts'] }],
  ['web-headless', { command: 'bun', args: ['scripts/dev/headless-web.ts'] }],
])

const helpFlags = new Set(['-h', '--help', 'help'])
const args = process.argv.slice(2).filter((arg) => arg !== '--')
const target = args[0] ?? 'desktop'

function printUsage() {
  console.log(`Usage: pnpm dev -- TARGET

Targets:
  desktop       Electron + UI + local runtime (default)
  app|web|ui    Vite renderer only
  server|api    Local HTTP API
  orchestrator  Runtime/orchestrator CLI
  headless      Web + server smoke mode

Legacy dev aliases were removed; use pnpm dev -- app/server/orchestrator/headless.`)
}

if (helpFlags.has(target)) {
  printUsage()
  process.exit(0)
}

const commandConfig = targets.get(target)

if (!commandConfig) {
  console.error(`Unknown dev target: ${target}\n`)
  printUsage()
  process.exit(1)
}

const env = {
  ...process.env,
  ONMYAGENT_DEV_MODE: '1',
}

runCommand(commandConfig, { env })
