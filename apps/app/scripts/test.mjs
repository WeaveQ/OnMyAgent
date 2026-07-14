#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2).filter((arg) => arg !== '--')
const target = args[0] ?? 'ui'
const rest = args.slice(1)

const testTargets = new Map([
  ['health', ['node', ['scripts/health.mjs']]],
  ['mention-send', ['node', ['scripts/mention-send.mjs']]],
  ['sessions', ['node', ['scripts/sessions.mjs']]],
  ['events', ['node', ['scripts/events.mjs']]],
  ['todos', ['node', ['scripts/todos.mjs']]],
  ['permissions', ['node', ['scripts/permissions.mjs']]],
  ['automation-model', ['bun', ['test', 'scripts/automation-model.test.ts']]],
  ['extensions-store', ['bun', ['test', 'scripts/extensions-store.test.ts']]],
  ['expert-marketplace-ui-contract', ['bun', ['test', 'scripts/expert-marketplace-ui-contract.test.ts']]],
  ['browser-use-timeline', ['bun', ['test', 'scripts/browser-use-timeline.test.ts']]],
  ['infinite-canvas-model', ['bun', ['test', 'scripts/infinite-canvas-model.test.ts']]],
  ['infinite-canvas-ui-contract', ['bun', ['test', 'scripts/infinite-canvas-ui-contract.test.ts']]],
  ['infinite-canvas-ui-smoke', ['node', ['--experimental-websocket', 'scripts/infinite-canvas-ui-smoke.mjs']]],
  ['personal-local-agent-acp-ui-smoke', ['node', ['scripts/personal-local-agent-acp-ui-smoke.mjs']]],
  ['local-agent-workspace-picker-ui-smoke', ['node', ['scripts/local-agent-workspace-picker-ui-smoke.mjs']]],
  ['personal-local-agent-codex-acp-tool-smoke', ['node', ['scripts/personal-local-agent-codex-acp-tool-smoke.mjs']]],
  ['remote-diagnostics', ['bun', ['test', 'scripts/remote-workspace-diagnostics.test.ts']]],
  ['open-target', ['bun', ['test', 'scripts/open-target.test.ts']]],
  ['artifact-spreadsheet', ['bun', ['test', 'scripts/artifact-spreadsheet.test.ts']]],
  ['assistant-selection-memory', ['bun', ['test', 'scripts/assistant-selection-memory.test.ts']]],
  ['composer-state-store', ['bun', ['test', 'scripts/composer-state-store.test.ts']]],
  ['conversation-model', ['bun', ['test', 'scripts/conversation-model.test.ts']]],
  ['session-memory', ['bun', ['test', 'scripts/session-memory.test.ts']]],
  ['session-activity-store', ['bun', ['test', 'scripts/session-activity-store.test.ts']]],
  ['session-sync', ['bun', ['test', 'scripts/session-sync.test.ts']]],
  ['session-page-info-models', ['bun', ['test', 'scripts/session-page-info-models.test.ts']]],
  ['session-page-conversation-model', ['bun', ['test', 'scripts/session-page-conversation-model.test.ts']]],
  ['session-page-files-model', ['bun', ['test', 'scripts/session-page-files-model.test.ts']]],
  ['session-page-model', ['bun', ['test', 'scripts/session-page-model.test.ts']]],
  ['session-archive-page', ['bun', ['test', 'scripts/session-archive-page.test.ts']]],
  ['local-agent-constants', ['bun', ['test', 'scripts/local-agent-constants.test.ts']]],
  ['session-page-view-model', ['bun', ['test', 'scripts/session-page-view-model.test.ts']]],
  ['session-route-sidebar-model', ['bun', ['test', 'scripts/session-route-sidebar-model.test.ts']]],
  ['session-route-agent-context', ['bun', ['test', 'scripts/session-route-agent-context.test.ts']]],
  ['session-route-created-session-actions', ['bun', ['test', 'scripts/session-route-created-session-actions.test.ts']]],
  ['session-route-control', ['bun', ['test', 'scripts/session-route-control.test.ts']]],
  ['session-route-model-options', ['bun', ['test', 'scripts/session-route-model-options.test.ts']]],
  ['session-route-sessions', ['bun', ['test', 'scripts/session-route-sessions.test.ts']]],
  ['session-route-workspace-actions', ['bun', ['test', 'scripts/session-route-workspace-actions.test.ts']]],
  ['session-scroll-store', ['bun', ['test', 'scripts/session-scroll-store.test.ts']]],
  ['session-surface-model', ['bun', ['test', 'scripts/session-surface-model.test.ts']]],
  ['session-transition-controller', ['bun', ['test', 'scripts/session-transition-controller.test.ts']]],
  ['session-route-state', ['bun', ['test', 'scripts/session-route-state.test.ts']]],
  ['session-route-storage', ['bun', ['test', 'scripts/session-route-storage.test.ts']]],
  ['session-render-state', ['bun', ['test', 'scripts/session-render-state.test.ts']]],
  ['session-process-summary', ['bun', ['test', 'scripts/session-process-summary.test.ts']]],
  ['session-shared-pages-layout', ['bun', ['test', 'scripts/session-shared-pages-layout.test.ts']]],
  ['session-shared-models', ['bun', ['test', 'scripts/session-shared-models.test.ts']]],
  ['session-side-panel-toggle-contract', ['bun', ['test', 'scripts/session-side-panel-toggle-contract.test.ts']]],
  ['session-visual-files-contract', ['bun', ['test', 'scripts/session-visual-files-contract.test.ts']]],
  ['session-snapshot-error', ['bun', ['test', 'scripts/session-snapshot-error.test.ts']]],
  ['settings-route-model', ['bun', ['test', 'scripts/settings-route-model.test.ts']]],
  ['ui-state-store', ['bun', ['test', 'scripts/ui-state-store.test.ts']]],
  ['session-route-composer', ['bun', ['test', 'scripts/session-route-composer.test.ts']]],
  ['shared-skills-catalog', ['bun', ['test', 'scripts/shared-skills-catalog.test.ts']]],
  ['shared-status-toasts', ['bun', ['test', 'scripts/shared-status-toasts.test.ts']]],
  ['shared-provider-list', ['bun', ['test', 'scripts/shared-provider-list-query.test.ts']]],
  ['shared-modal-styles', ['bun', ['test', 'scripts/shared-modal-styles.test.ts']]],
  ['shared-onmyagent-server-store', ['bun', ['test', 'scripts/shared-onmyagent-server-store.test.ts']]],
  ['titlebar-hit-targets', ['bun', ['test', 'scripts/titlebar-hit-targets.test.ts']]],
  ['shared-extension-state', ['bun', ['test', 'scripts/shared-extension-state.test.ts']]],
  ['shared-workspace-modal-types', ['bun', ['test', 'scripts/shared-workspace-modal-types.test.ts']]],
  ['shared-add-mcp-modal', ['bun', ['test', 'scripts/shared-add-mcp-modal.test.ts']]],
  ['shared-den-help-link', ['bun', ['test', 'scripts/shared-den-help-link.test.ts']]],
  ['shared-share-workspace-modal', ['bun', ['test', 'scripts/shared-share-workspace-modal.test.ts']]],
  ['shared-provider-auth-modal', ['bun', ['test', 'scripts/shared-provider-auth-modal.test.ts']]],
  ['shared-env-context', ['bun', ['test', 'scripts/shared-env-context.test.ts']]],
  ['shared-agent-prompt-suggestions', ['bun', ['test', 'scripts/shared-agent-prompt-suggestions.test.ts']]],
  ['shared-plugins-page', ['bun', ['test', 'scripts/shared-plugins-page.test.ts']]],
  ['shared-pending-agent-store', ['bun', ['test', 'scripts/shared-pending-agent-store.test.ts']]],
  ['shared-desktop-config-context', ['bun', ['test', 'scripts/shared-desktop-config-context.test.tsx']]],
  ['shared-agent-session-state', ['bun', ['test', 'scripts/shared-agent-session-state.test.ts']]],
  ['shared-agent-registry-store', ['bun', ['test', 'scripts/shared-agent-registry-store.test.ts']]],
  ['shared-agent-registry-types', ['bun', ['test', 'scripts/shared-agent-registry-types.test.ts']]],
  ['shared-agent-registry-helpers', ['bun', ['test', 'scripts/shared-agent-registry-helpers.test.ts']]],
  ['shared-agent-default-registry', ['bun', ['test', 'scripts/shared-agent-default-registry.test.ts']]],
  ['dev-log', ['bun', ['scripts/dev-log.ts']]],
  ['session-error-recovery', ['bun', ['scripts/session-error-recovery.ts']]],
  ['session-draft-store', ['bun', ['test', 'scripts/session-draft-store.test.ts']]],
  ['session-scope', ['bun', ['scripts/session-scope.ts']]],
  ['session-switch', ['node', ['scripts/session-switch.mjs']]],
  ['fs-engine', ['node', ['scripts/fs-engine.mjs']]],
  ['local-file-path', ['node', ['scripts/local-file-path.mjs']]],
  ['browser-entry', ['node', ['scripts/browser-entry.mjs']]],
  ['version-gate', ['bun', ['test', 'scripts/version-gate.test.ts']]],
])

const composedTargets = new Map([
  ['refactor', ['typecheck', 'health', 'sessions']],
  ['e2e', ['local-file-path', 'raw:e2e', 'session-switch', 'fs-engine', 'browser-entry']],
  ['ui', ['version-gate', 'e2e']],
])

function printUsage() {
  console.log(`Usage: pnpm test:app [target]

Targets:
  health|mention-send|sessions|events|todos|permissions
  remote-diagnostics|open-target|expert-marketplace-ui-contract|infinite-canvas-model|infinite-canvas-ui-contract|infinite-canvas-ui-smoke|personal-local-agent-acp-ui-smoke|personal-local-agent-codex-acp-tool-smoke|artifact-spreadsheet|assistant-selection-memory|composer-state-store|conversation-model|session-memory|session-activity-store|session-sync|session-draft-store|session-page-info-models|session-page-conversation-model|session-page-files-model|session-page-model|session-page-session-archive-model|session-route-agent-context|session-route-created-session-actions|session-route-control|session-route-model-options|session-route-sessions|session-scroll-store|session-surface-model|session-transition-controller|session-route-state|session-route-storage|session-render-state|session-process-summary|session-shared-pages-layout|session-shared-models|session-side-panel-toggle-contract|settings-route-model|session-route-composer|shared-skills-catalog|shared-status-toasts|shared-provider-list|shared-modal-styles|shared-onmyagent-server-store|session-archive-pagination|session-archive-message-pagination|session-archive-command-palette|session-archive-keyboard|session-archive-grouping|session-archive-transcript-controls|session-archive-inline-rename|session-archive-ui-smoke|titlebar-hit-targets|shared-extension-state|shared-workspace-modal-types|shared-add-mcp-modal|shared-den-help-link|shared-share-workspace-modal|shared-provider-auth-modal|shared-env-context|shared-agent-prompt-suggestions|shared-plugins-page|shared-pending-agent-store|shared-desktop-config-context|shared-agent-session-state|shared-agent-registry-store|shared-agent-registry-types|shared-agent-registry-helpers|shared-agent-default-registry|dev-log
  session-error-recovery|session-scope|session-switch|fs-engine
  local-file-path|browser-entry|version-gate
  refactor|e2e|ui`)
}

if (target === 'help' || target === '--help' || target === '-h') {
  printUsage()
  process.exit(0)
}

runTarget(target)

function runTarget(name) {
  if (name === 'typecheck') {
    run('pnpm', ['typecheck'])
    return
  }

  if (name === 'raw:e2e') {
    run('node', ['scripts/e2e.mjs'])
    return
  }

  const composed = composedTargets.get(name)
  if (composed) {
    for (const child of composed) runTarget(child)
    return
  }

  const commandConfig = testTargets.get(name)
  if (!commandConfig) {
    console.error(`Unknown app test target: ${name}\n`)
    printUsage()
    process.exit(1)
  }

  const [command, args] = commandConfig
  run(command, [...args, ...rest])
}

function run(command, args) {
  const result = spawnSync(resolveCommand(command), args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })

  if (result.signal) process.kill(process.pid, result.signal)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function resolveCommand(command) {
  if (process.platform !== 'win32') return command
  if (command === 'pnpm') return 'pnpm.cmd'
  if (command === 'bun') return 'bun.cmd'
  return command
}
