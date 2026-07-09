import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cjs', '.cts'])
const ignoredDirs = new Set(['.git', 'dist', 'node_modules', 'graphify-out'])
const packageDirs = [
  'apps/app',
  'apps/desktop',
  'apps/orchestrator',
  'apps/server',
  'packages/handsfree',
  'packages/onmyagent-ui-mcp',
  'packages/types',
  'packages/ui',
  'website',
]

const internalPackageNames = new Map(
  packageDirs
    .map((dir) => {
      const packageJsonPath = join(repoRoot, dir, 'package.json')
      if (!existsSync(packageJsonPath)) return null
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
      return [packageJson.name, dir]
    })
    .filter(Boolean),
)

const packageRules = [
  {
    fromDir: 'packages/types',
    forbiddenNames: [...internalPackageNames.keys()].filter((name) => name !== '@onmyagent/types'),
    message: 'packages/types must stay schema-only and cannot depend on app/server/UI packages',
  },
  {
    fromDir: 'packages/ui',
    forbiddenNames: [...internalPackageNames.keys()].filter((name) => name !== '@onmyagent/ui'),
    message: 'packages/ui must stay presentational and cannot depend on app/server packages',
  },
  {
    fromDir: 'apps/server',
    forbiddenNames: ['@onmyagent/app', '@onmyagent/desktop', '@onmyagent/ui'],
    message: 'server must not depend on renderer, desktop, or UI packages',
  },
  {
    fromDir: 'apps/desktop',
    forbiddenNames: ['@onmyagent/app'],
    message: 'desktop must talk to the renderer through IPC/preload contracts, not import app package code',
  },
]

const allowedDomainImports = new Set([
  // session <-> local-agents: PR #22 introduced domains/local-agents as a
  // sibling extract of session's local-agent code. Both pages still need
  // direct imports across the boundary until we agree whether to fold
  // local-agents back under session/ or promote a kernel/shared contract.
  "apps/app/src/react-app/domains/local-agents/local-agent-page-model.ts|../session/chat/personal-local-agent-scheduled-tasks",
  "apps/app/src/react-app/domains/local-agents/messages/chat-bubble.tsx|../../session/artifacts/open-target",
  "apps/app/src/react-app/domains/local-agents/messages/chat-bubble.tsx|../../session/surface/markdown",
  "apps/app/src/react-app/domains/local-agents/messages/message-utils.ts|../../session/artifacts/open-target",
  "apps/app/src/react-app/domains/local-agents/messages/timeline-messages.tsx|../../session/surface/markdown",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/hooks/use-acp-initial-message",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/hooks/use-acp-model-info",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/hooks/use-conversation-history-hydration",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/local-agent-draft-composer",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/local-agent-formatters",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/local-agent-management-panel",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/local-agent-page-model",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/local-agent-page-types",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/local-agent-repair-panel",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/messages/chat-bubble",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/workspace-picker/workspace-footnote",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/workspace-picker/recent-workspaces",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/messages/message-types",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/messages/message-utils",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/messages/timeline-messages",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/local-agent-status-rail",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx|../../local-agents/context-usage-indicator",
  // Extracted parts of personal-local-agent-page.tsx keep the same
  // session <-> local-agents imports as the page they were pulled from.
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page-helpers.ts|../../local-agents/local-agent-page-model",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-page-helpers.ts|../../local-agents/messages/message-types",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-active-runs.tsx|../../local-agents/local-agent-formatters",
  "apps/app/src/react-app/domains/session/chat/personal-local-agent-active-runs.tsx|../../local-agents/messages/timeline-messages",
  "apps/app/src/react-app/domains/session/components/shared-pages/agent-management-page.tsx|../../../local-agents/extension-list-panel",
  "apps/app/src/react-app/domains/session/components/shared-pages/agent-management-page.tsx|../../../local-agents/inline-agent-editor",
  "apps/app/src/react-app/domains/session/components/shared-pages/agent-management-page.tsx|../../../local-agents/agent-management-repair-dialog",
])

// Domain barrels the shell may import from with a shallow path (`../domains/<domain>`
// or `@/react-app/domains/<domain>`). Anything deeper counts as a shell-import-depth
// violation that must be listed in the shell-import-depth baseline (below) until it
// is refactored behind a barrel.
const shellRelativeRoot = 'apps/app/src/react-app/shell'
const shellDepthBaselinePath = join(
  repoRoot,
  'scripts/checks/baselines/shell-import-depth.json',
)
const shellDepthArgs = new Set(process.argv.slice(2))
const shellDepthMode = shellDepthArgs.has('--write-shell-depth-baseline')
  ? 'write'
  : shellDepthArgs.has('--list-shell-depth')
    ? 'list'
    : 'enforce'
const shellDepthFindings = []

const domainRoot = join(repoRoot, 'apps/app/src/react-app/domains')
const violations = []

for (const dir of packageDirs) {
  scanDirectory(join(repoRoot, dir), (filePath) => checkFile(filePath))
}

const shellDepthResult = evaluateShellDepth()

if (shellDepthMode === 'write' || shellDepthMode === 'list') {
  process.exit(0)
}

if (violations.length) {
  console.error('Architecture boundary violations found:\n')
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} ${violation.message}`)
    console.error(`  import: ${violation.importPath}`)
  }
}

if (violations.length || shellDepthResult.failed) {
  process.exit(1)
}

console.log('Architecture boundary checks passed')

function checkFile(filePath) {
  const relativePath = toPosix(relative(repoRoot, filePath))
  const source = readFileSync(filePath, 'utf8')
  const imports = extractImports(source)

  for (const item of imports) {
    checkPackageRules(relativePath, item)
    checkReactAppRules(filePath, relativePath, item)
    checkShellImportDepth(filePath, relativePath, item)
  }
}

function checkPackageRules(relativePath, item) {
  for (const rule of packageRules) {
    if (!relativePath.startsWith(`${rule.fromDir}/`)) continue
    if (!rule.forbiddenNames.includes(item.importPath)) continue
    violations.push({
      file: relativePath,
      line: item.line,
      importPath: item.importPath,
      message: rule.message,
    })
  }
}

function checkReactAppRules(filePath, relativePath, item) {
  if (relativePath.startsWith('apps/app/src/components/') && importedReactApp(filePath, item.importPath)) {
    violations.push({
      file: relativePath,
      line: item.line,
      importPath: item.importPath,
      message: 'src/components must stay presentational and must not import react-app code; pass data/actions as props or move the container into react-app',
    })
  }

  if (relativePath.startsWith('apps/app/src/app/lib/') && item.importPath.includes('react-app')) {
    violations.push({
      file: relativePath,
      line: item.line,
      importPath: item.importPath,
      message: 'src/app/lib is a framework bridge layer and must not import react-app code',
    })
  }

  if (!relativePath.startsWith('apps/app/src/react-app/domains/')) return

  const fromDomain = relativePath.split('/')[5]
  const toDomain = importedDomain(filePath, item.importPath)
  if (!toDomain || toDomain === fromDomain || toDomain === 'shared') return
  if (allowedDomainImports.has(`${relativePath}|${item.importPath}`)) return

  violations.push({
    file: relativePath,
    line: item.line,
    importPath: item.importPath,
    message: `domain '${fromDomain}' must not import domain '${toDomain}' directly; use kernel/shared contracts`,
  })
}

function checkShellImportDepth(filePath, relativePath, item) {
  if (!relativePath.startsWith(`${shellRelativeRoot}/`)) return
  const targetPath = resolveDomainTarget(filePath, item.importPath)
  if (!targetPath) return
  const domainRelative = relative(domainRoot, targetPath)
  if (domainRelative.startsWith('..') || domainRelative === '') return
  const segments = domainRelative.split(sep)
  if (segments.length <= 1) return
  const domainName = segments[0]
  const remainder = segments.slice(1).join('/')
  shellDepthFindings.push({
    file: relativePath,
    line: item.line,
    domain: domainName,
    importPath: item.importPath,
    subPath: remainder,
  })
}

function resolveDomainTarget(filePath, importPath) {
  if (importPath.startsWith('@/react-app/domains/')) {
    const parts = importPath.split('/')
    const domain = parts[3]
    const remainder = parts.slice(4).join('/')
    const base = join(domainRoot, domain, remainder)
    return resolveIndexFallback(base)
  }
  if (!importPath.startsWith('.')) return null
  const resolved = resolveRelativeSource(filePath, importPath)
  if (!resolved) return null
  const relativeResolved = relative(domainRoot, resolved)
  if (relativeResolved.startsWith('..') || relativeResolved === '') return null
  return resolved
}

function resolveIndexFallback(base) {
  const candidates = [
    ...[...sourceExtensions].map((extension) => `${base}${extension}`),
    ...[...sourceExtensions].map((extension) => join(base, `index${extension}`)),
    base,
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? base
}

function shellDepthKey(finding) {
  return `${finding.file}::${finding.domain}::${finding.subPath}`
}

function readShellDepthBaseline() {
  if (!existsSync(shellDepthBaselinePath)) return { entries: {} }
  const raw = JSON.parse(readFileSync(shellDepthBaselinePath, 'utf8'))
  const entries =
    raw && typeof raw.entries === 'object' && !Array.isArray(raw.entries) ? raw.entries : {}
  return { entries }
}

function evaluateShellDepth() {
  const counts = new Map()
  for (const finding of shellDepthFindings) {
    const key = shellDepthKey(finding)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  if (shellDepthMode === 'list') {
    const sorted = [...shellDepthFindings].sort((a, b) => {
      if (a.file !== b.file) return a.file < b.file ? -1 : 1
      return a.line - b.line
    })
    for (const finding of sorted) {
      console.log(
        `${finding.file}:${finding.line} deep-import '${finding.domain}/${finding.subPath}' (${finding.importPath})`,
      )
    }
    console.log(`\n${shellDepthFindings.length} deep import(s)`)
    process.exit(0)
  }

  if (shellDepthMode === 'write') {
    const sortedEntries = Object.fromEntries(
      [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    )
    const payload = {
      $schema: './shell-import-depth.schema.json',
      description:
        'Frozen shell -> domain deep imports, keyed by shellFile::domain::subPath with an occurrence count. Only shrink this list. Regenerate with `node scripts/checks/check-boundaries.mjs --write-shell-depth-baseline` only after refactoring shells to use domain barrels.',
      generatedAt: new Date().toISOString(),
      entries: sortedEntries,
    }
    writeFileSync(shellDepthBaselinePath, `${JSON.stringify(payload, null, 2)}\n`)
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
    console.log(
      `Wrote shell-import-depth baseline with ${counts.size} key(s) / ${total} occurrence(s) -> ${relative(repoRoot, shellDepthBaselinePath)}`,
    )
    return { failed: false }
  }

  const baseline = readShellDepthBaseline()
  const baselineCounts = new Map(Object.entries(baseline.entries))
  const overages = []
  for (const [key, count] of counts) {
    const allowed = baselineCounts.get(key) ?? 0
    if (count > allowed) overages.push({ key, count, allowed })
  }
  const stale = []
  for (const [key, allowed] of baselineCounts) {
    const count = counts.get(key) ?? 0
    if (count < allowed) stale.push({ key, count, allowed })
  }
  if (overages.length === 0 && stale.length === 0) return { failed: false, counts }

  if (overages.length > 0) {
    console.error('New shell-import-depth violations:\n')
    for (const overage of overages) {
      console.error(`- ${overage.key}`)
      console.error(`  now ${overage.count} occurrence(s), baseline allows ${overage.allowed}`)
      const examples = shellDepthFindings
        .filter((finding) => shellDepthKey(finding) === overage.key)
        .slice(0, 3)
      for (const example of examples) {
        console.error(
          `    ${example.file}:${example.line} ${example.importPath}`,
        )
      }
    }
    console.error(
      '\nShell files may only import a domain via its barrel (e.g. `../domains/<domain>`).',
    )
    console.error('Refactor the domain to expose the API it needs, or discuss before')
    console.error('adding an allowance. Use the shared/kernel layer for cross-cutting state.')
  }

  if (stale.length > 0) {
    console.error('\nShell-import-depth baseline is stale:')
    for (const entry of stale) {
      console.error(`- ${entry.key}: baseline ${entry.allowed} -> now ${entry.count}`)
    }
    console.error('Run `node scripts/checks/check-boundaries.mjs --write-shell-depth-baseline` to shrink it.')
  }

  return { failed: true }
}

function importedReactApp(filePath, importPath) {
  if (importPath.startsWith('@/react-app/')) return true

  if (!importPath.startsWith('.')) return false

  const resolved = resolveRelativeSource(filePath, importPath)
  if (!resolved) return false
  const relativeResolved = toPosix(relative(repoRoot, resolved))
  return relativeResolved.startsWith('apps/app/src/react-app/')
}

function importedDomain(filePath, importPath) {
  if (importPath.startsWith('@/react-app/domains/')) return importPath.split('/')[3]

  if (!importPath.startsWith('.')) return null

  const resolved = resolveRelativeSource(filePath, importPath)
  if (!resolved) return null
  const relativeResolved = relative(domainRoot, resolved)
  if (relativeResolved.startsWith('..') || relativeResolved === '') return null
  return relativeResolved.split(sep)[0]
}

function resolveRelativeSource(filePath, importPath) {
  const basePath = join(dirname(filePath), importPath)
  const candidates = [
    basePath,
    ...[...sourceExtensions].map((extension) => `${basePath}${extension}`),
    ...[...sourceExtensions].map((extension) => join(basePath, `index${extension}`)),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function extractImports(source) {
  const imports = []
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      imports.push({ importPath: match[1], line: lineNumberAt(source, match.index ?? 0) })
    }
  }

  return imports
}

function scanDirectory(dir, onFile) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue
    const path = join(dir, entry)
    const stats = lstatSync(path)
    if (stats.isSymbolicLink()) continue
    if (stats.isDirectory()) {
      scanDirectory(path, onFile)
      continue
    }
    if (stats.isFile() && sourceExtensions.has(extname(path))) onFile(path)
  }
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length
}

function toPosix(path) {
  return path.split(sep).join('/')
}
