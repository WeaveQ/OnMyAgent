#!/usr/bin/env node
import { runCommand } from '../lib/run-command.mjs'

const args = process.argv.slice(2).filter((arg) => arg !== '--')
const group = args[0]
const target = args[1]
const rest = args.slice(2)

const checkTargets = new Map([
  ['types', { command: 'pnpm', args: ['check:types:all'] }],
  ['types:all', { command: 'pnpm', args: ['check:types:all'] }],
  ['app', { command: 'pnpm', args: ['exec', 'turbo', 'run', 'typecheck', '--filter', '@onmyagent/app'] }],
  ['desktop', { command: 'pnpm', args: ['exec', 'turbo', 'run', 'typecheck', '--filter', '@onmyagent/desktop'] }],
  ['server', { command: 'pnpm', args: ['exec', 'turbo', 'run', 'typecheck', '--filter', 'onmyagent-server'] }],
  ['orchestrator', { command: 'pnpm', args: ['exec', 'turbo', 'run', 'typecheck', '--filter', 'onmyagent-orchestrator'] }],
  ['i18n', { command: 'pnpm', args: ['check:i18n'] }],
  ['i18n:hardcoded', { command: 'pnpm', args: ['check:i18n:hardcoded'] }],
  ['i18n:cjk', { command: 'pnpm', args: ['check:i18n:cjk'] }],
  ['security', { command: 'pnpm', args: ['check:security'] }],
  ['boundaries', { command: 'pnpm', args: ['check:boundaries'] }],
  ['design', { command: 'node', args: ['scripts/design/extract-tokens.mjs'] }],
])

const testTargets = new Map([
  ['unit', { command: 'pnpm', args: ['test:unit'] }],
  ['api', { command: 'pnpm', args: ['test:api'] }],
  ['runtime', { command: 'pnpm', args: ['test:runtime'] }],
  ['desktop:agent-management-mcp', { command: 'node', args: ['--test', 'apps/desktop/electron/agent-management-mcp.test.mjs'] }],
  ['release-smoke', { command: 'pnpm', args: ['test:release-smoke'] }],
  ['ui', { command: 'pnpm', args: ['test:ui'] }],
  ['health', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'health'] }],
  ['sessions', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'sessions'] }],
  ['refactor', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'refactor'] }],
  ['events', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'events'] }],
  ['todos', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'todos'] }],
  ['permissions', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'permissions'] }],
  ['artifact-spreadsheet', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'artifact-spreadsheet'] }],
  ['assistant-selection-memory', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'assistant-selection-memory'] }],
  ['composer-state-store', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'composer-state-store'] }],
  ['conversation-model', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'conversation-model'] }],
  ['session-error-recovery', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-error-recovery'] }],
  ['session-scope', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-scope'] }],
  ['session-switch', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-switch'] }],
  ['fs-engine', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'fs-engine'] }],
  ['automation-model', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'automation-model'] }],
  ['extensions-store', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'extensions-store'] }],
  ['expert-marketplace-ui-contract', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'expert-marketplace-ui-contract'] }],
  ['infinite-canvas-model', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'infinite-canvas-model'] }],
  ['infinite-canvas-ui-contract', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'infinite-canvas-ui-contract'] }],
  ['infinite-canvas-ui-smoke', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'infinite-canvas-ui-smoke'] }],
  ['personal-local-agent-acp-ui-smoke', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'personal-local-agent-acp-ui-smoke'] }],
  ['personal-local-agent-codex-acp-tool-smoke', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'personal-local-agent-codex-acp-tool-smoke'] }],
  ['remote-diagnostics', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'remote-diagnostics'] }],
  ['open-target', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'open-target'] }],
  ['session-memory', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-memory'] }],
  ['session-activity-store', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-activity-store'] }],
  ['session-sync', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-sync'] }],
  ['session-draft-store', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-draft-store'] }],
  ['session-page-info-models', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-page-info-models'] }],
  ['session-page-conversation-model', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-page-conversation-model'] }],
  ['session-page-files-model', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-page-files-model'] }],
  ['session-page-model', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-page-model'] }],
  ['session-page-session-archive-model', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-page-session-archive-model'] }],
  ['session-page-view-model', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-page-view-model'] }],
  ['session-route-sidebar-model', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-route-sidebar-model'] }],
  ['session-route-agent-context', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-route-agent-context'] }],
  ['session-route-created-session-actions', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-route-created-session-actions'] }],
  ['session-route-control', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-route-control'] }],
  ['session-route-model-options', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-route-model-options'] }],
  ['session-route-sessions', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-route-sessions'] }],
  ['session-route-workspace-actions', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-route-workspace-actions'] }],
  ['session-scroll-store', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-scroll-store'] }],
  ['session-surface-model', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-surface-model'] }],
  ['session-transition-controller', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-transition-controller'] }],
  ['session-route-state', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-route-state'] }],
  ['session-route-storage', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-route-storage'] }],
  ['session-render-state', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-render-state'] }],
  ['session-process-summary', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-process-summary'] }],
  ['session-shared-pages-layout', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-shared-pages-layout'] }],
  ['session-shared-models', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-shared-models'] }],
  ['session-snapshot-error', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-snapshot-error'] }],
  ['settings-route-model', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'settings-route-model'] }],
  ['ui-state-store', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'ui-state-store'] }],
  ['session-route-composer', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'session-route-composer'] }],
  ['shared-skills-catalog', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-skills-catalog'] }],
  ['shared-status-toasts', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-status-toasts'] }],
  ['shared-provider-list', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-provider-list'] }],
  ['shared-modal-styles', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-modal-styles'] }],
  ['shared-onmyagent-server-store', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-onmyagent-server-store'] }],
  ['titlebar-hit-targets', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'titlebar-hit-targets'] }],
  ['shared-extension-state', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-extension-state'] }],
  ['shared-workspace-modal-types', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-workspace-modal-types'] }],
  ['shared-add-mcp-modal', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-add-mcp-modal'] }],
  ['shared-den-help-link', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-den-help-link'] }],
  ['shared-share-workspace-modal', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-share-workspace-modal'] }],
  ['shared-provider-auth-modal', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-provider-auth-modal'] }],
  ['shared-env-context', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-env-context'] }],
  ['shared-agent-prompt-suggestions', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-agent-prompt-suggestions'] }],
  ['shared-plugins-page', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-plugins-page'] }],
  ['shared-pending-agent-store', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-pending-agent-store'] }],
  ['shared-desktop-config-context', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-desktop-config-context'] }],
  ['shared-agent-session-state', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-agent-session-state'] }],
  ['shared-agent-registry-store', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-agent-registry-store'] }],
  ['shared-agent-registry-types', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-agent-registry-types'] }],
  ['shared-agent-registry-helpers', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-agent-registry-helpers'] }],
  ['shared-agent-default-registry', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'test:app', 'shared-agent-default-registry'] }],
  ['e2e', { command: 'pnpm', args: ['exec', 'turbo', 'run', 'test:e2e', '--filter', '@onmyagent/app'] }],
  ['version-gate', { command: 'pnpm', args: ['exec', 'turbo', 'run', 'test:version-gate', '--filter', '@onmyagent/app'] }],
  ['orchestrator', { command: 'pnpm', args: ['exec', 'turbo', 'run', 'test', '--filter', 'onmyagent-orchestrator'] }],
  ['orchestrator:cli-args', { command: 'pnpm', args: ['--dir', 'apps/orchestrator', 'exec', 'bun', 'test', 'tests/cli-args.test.ts'] }],
  ['orchestrator:cli-entry', { command: 'pnpm', args: ['--dir', 'apps/orchestrator', 'exec', 'bun', 'test', 'tests/cli-entry.test.ts'] }],
  ['orchestrator:runtime-auth', { command: 'pnpm', args: ['--dir', 'apps/orchestrator', 'exec', 'bun', 'test', 'tests/runtime-auth.test.ts'] }],
  ['orchestrator:runtime-health', { command: 'pnpm', args: ['--dir', 'apps/orchestrator', 'exec', 'bun', 'test', 'tests/runtime-health.test.ts'] }],
  ['orchestrator:runtime-sandbox', { command: 'pnpm', args: ['--dir', 'apps/orchestrator', 'exec', 'bun', 'test', 'tests/runtime-sandbox.test.ts'] }],
  ['orchestrator:runtime-services', { command: 'pnpm', args: ['--dir', 'apps/orchestrator', 'exec', 'bun', 'test', 'tests/runtime-services.test.ts'] }],
  ['orchestrator:runtime-config', { command: 'pnpm', args: ['--dir', 'apps/orchestrator', 'exec', 'bun', 'test', 'tests/data-dir.test.ts', 'tests/env-paths.test.ts', 'tests/sidecar-config.test.ts', 'tests/version-manifest.test.ts'] }],
  ['orchestrator:sandbox-mounts', { command: 'pnpm', args: ['--dir', 'apps/orchestrator', 'exec', 'bun', 'test', 'tests/sandbox-mounts.test.ts'] }],
  ['orchestrator:sidecar-config', { command: 'pnpm', args: ['--dir', 'apps/orchestrator', 'exec', 'bun', 'test', 'tests/sidecar-config.test.ts'] }],
  ['server:archive', { command: 'pnpm', args: ['--filter', 'onmyagent-server', 'test:archive'] }],
  ['server:automation', { command: 'pnpm', args: ['--filter', 'onmyagent-server', 'test:automation'] }],
  ['server:routes', { command: 'pnpm', args: ['--filter', 'onmyagent-server', 'test:routes'] }],
  ['server:workspace', { command: 'pnpm', args: ['--filter', 'onmyagent-server', 'test:workspace'] }],
])

const bumpTargets = new Map([
  ['patch', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'bump:patch'] }],
  ['minor', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'bump:minor'] }],
  ['major', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'bump:major'] }],
  ['set', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'bump:set', ...rest] }],
])

const websiteTargets = new Map([
  ['dev', { command: 'pnpm', args: ['--filter', '@onmyagent/website', 'dev'] }],
  ['build', { command: 'pnpm', args: ['--filter', '@onmyagent/website', 'build'] }],
  ['check', { command: 'pnpm', args: ['--filter', '@onmyagent/website', 'check'] }],
  ['preview', { command: 'pnpm', args: ['--filter', '@onmyagent/website', 'preview'] }],
])

const buildTargets = new Map([
  ['desktop', { command: 'pnpm', args: ['--filter', '@onmyagent/desktop', 'build'] }],
  ['app', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'build'] }],
  ['web', { command: 'pnpm', args: ['--filter', '@onmyagent/app', 'build'] }],
])

const groups = new Map([
  ['check', checkTargets],
  ['test', testTargets],
  ['bump', bumpTargets],
  ['version', bumpTargets],
  ['website', websiteTargets],
  ['build', buildTargets],
])

function printUsage() {
  console.log(`Usage: pnpm task GROUP TARGET

Groups:
  check    types|app|desktop|server|orchestrator|i18n|i18n:hardcoded|i18n:cjk|security|boundaries|design
  test     unit|api|runtime|release-smoke|ui|health|sessions|refactor|events|todos|permissions|automation-model|extensions-store|expert-marketplace-ui-contract|infinite-canvas-model|infinite-canvas-ui-contract|infinite-canvas-ui-smoke|personal-local-agent-acp-ui-smoke|personal-local-agent-codex-acp-tool-smoke|remote-diagnostics|open-target|session-sync|session-render-state|session-process-summary|assistant-selection-memory|session-shared-pages-layout|session-route-workspace-actions|shared-skills-catalog|shared-status-toasts|shared-provider-list|shared-modal-styles|shared-onmyagent-server-store|titlebar-hit-targets|shared-extension-state|shared-workspace-modal-types|shared-add-mcp-modal|shared-den-help-link|shared-share-workspace-modal|shared-provider-auth-modal|shared-env-context|shared-agent-prompt-suggestions|shared-plugins-page|orchestrator:cli-args|orchestrator:cli-entry|orchestrator:runtime-auth|orchestrator:runtime-health|orchestrator:runtime-sandbox|orchestrator:runtime-services|orchestrator:sidecar-config|e2e|version-gate|orchestrator|server:archive|server:automation|server:routes|server:workspace
  build    app|web|desktop
  bump     patch|minor|major|set
  website  dev|build|check|preview`)
}

if (!group || group === 'help' || group === '--help' || group === '-h') {
  printUsage()
  process.exit(0)
}

const targets = groups.get(group)
const commandConfig = targets?.get(target)

if (!targets || !commandConfig) {
  console.error(`Unknown task: ${[group, target].filter(Boolean).join(' ')}\n`)
  printUsage()
  process.exit(1)
}

const forwardedArgs = rest.length
  ? { ...commandConfig, args: [...commandConfig.args, ...rest] }
  : commandConfig

runCommand(forwardedArgs)
