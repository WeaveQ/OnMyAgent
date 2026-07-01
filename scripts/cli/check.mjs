#!/usr/bin/env node
import { runCommand } from '../lib/run-command.mjs'

const args = process.argv.slice(2).filter((arg) => arg !== '--')
const target = args[0] ?? 'types'

function printUsage() {
  console.log(`Usage: pnpm check:types:all

Internal script targets:
  types    Typecheck types/ui/app/server/desktop/orchestrator in order`)
}

if (target === 'help' || target === '--help' || target === '-h') {
  printUsage()
  process.exit(0)
}

if (target !== 'types') {
  console.error(`Unknown check target: ${target}\n`)
  printUsage()
  process.exit(1)
}

runCommand({
  command: 'pnpm',
  args: [
    'exec',
    'turbo',
    'run',
    'typecheck',
    '--filter',
    '@onmyagent/types',
    '--filter',
    '@onmyagent/ui',
    '--filter',
    '@onmyagent/app',
    '--filter',
    'onmyagent-server',
    '--filter',
    '@onmyagent/desktop',
    '--filter',
    'onmyagent-orchestrator',
  ],
})
