import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  domainDependencyIsAllowed,
  domainImportUsesPublicEntrypoint,
} from './domain-boundary-policy.mjs'

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

const domainShellRelativeRoot = 'apps/app/src/react-app/domains'
const shellDir = join(repoRoot, 'apps/app/src/react-app/shell')
const domainShellBaselinePath = join(
  repoRoot,
  'scripts/checks/baselines/domain-shell-depth.json',
)
const domainShellArgs = new Set(process.argv.slice(2))
const domainShellMode = domainShellArgs.has('--write-domain-shell-baseline')
  ? 'write'
  : domainShellArgs.has('--list-domain-shell')
    ? 'list'
    : 'enforce'
const domainShellFindings = []

const domainRoot = join(repoRoot, 'apps/app/src/react-app/domains')
const violations = []

for (const dir of packageDirs) {
  scanDirectory(join(repoRoot, dir), (filePath) => checkFile(filePath))
}

const shellDepthResult = evaluateShellDepth()
const domainShellResult = evaluateDomainShellDepth()

if (
  shellDepthMode === 'write' ||
  shellDepthMode === 'list' ||
  domainShellMode === 'write' ||
  domainShellMode === 'list'
) {
  process.exit(0)
}

if (violations.length) {
  console.error('Architecture boundary violations found:\n')
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} ${violation.message}`)
    console.error(`  import: ${violation.importPath}`)
  }
}

if (violations.length || shellDepthResult.failed || domainShellResult.failed) {
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
    checkDomainShellDepth(filePath, relativePath, item)
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
  if (!toDomain || toDomain === fromDomain) return

  const targetPath = resolveDomainTarget(filePath, item.importPath)
  const domainRelativePath = targetPath
    ? toPosix(relative(domainRoot, targetPath))
    : ''

  if (
    domainDependencyIsAllowed(fromDomain, toDomain) &&
    domainImportUsesPublicEntrypoint(domainRelativePath, toDomain)
  ) {
    return
  }

  violations.push({
    file: relativePath,
    line: item.line,
    importPath: item.importPath,
    message: domainDependencyIsAllowed(fromDomain, toDomain)
      ? `domain '${fromDomain}' must import domain '${toDomain}' through its public index.ts entrypoint`
      : `domain '${fromDomain}' must not depend on domain '${toDomain}'; use kernel/shared contracts or compose them in shell`,
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

function checkDomainShellDepth(filePath, relativePath, item) {
  if (!relativePath.startsWith(`${domainShellRelativeRoot}/`)) return
  const targetPath = resolveShellTarget(filePath, item.importPath)
  if (!targetPath) return
  const shellRelative = relative(shellDir, targetPath)
  if (shellRelative.startsWith('..') || shellRelative === '') return
  const segments = shellRelative.split(sep)
  // The barrel entry (`shell/index.ts`) has zero segments below shell/;
  // any deeper path (e.g. `shell/control/control-provider.ts`) is a deep import.
  if (segments.length === 0 || (segments.length === 1 && /^index\.[a-z]+$/i.test(segments[0]))) return
  const subPath = shellRelative.replace(/\\/g, '/').replace(/\.(ts|tsx|js|jsx|mjs|mts|cjs|cts)$/i, '')
  domainShellFindings.push({
    file: relativePath,
    line: item.line,
    importPath: item.importPath,
    subPath,
  })
}

function resolveShellTarget(filePath, importPath) {
  if (importPath.startsWith('@/react-app/shell/')) {
    const remainder = importPath.slice('@/react-app/shell/'.length)
    return resolveIndexFallback(join(shellDir, remainder))
  }
  if (!importPath.startsWith('.')) return null
  const resolved = resolveRelativeSource(filePath, importPath)
  if (!resolved) return null
  const relativeResolved = relative(shellDir, resolved)
  if (relativeResolved.startsWith('..') || relativeResolved === '') return null
  return resolved
}

function domainShellKey(finding) {
  return `${finding.file}::${finding.subPath}`
}

function readDomainShellBaseline() {
  if (!existsSync(domainShellBaselinePath)) return { entries: {} }
  const raw = JSON.parse(readFileSync(domainShellBaselinePath, 'utf8'))
  const entries =
    raw && typeof raw.entries === 'object' && !Array.isArray(raw.entries) ? raw.entries : {}
  return { entries }
}

function evaluateDomainShellDepth() {
  const counts = new Map()
  for (const finding of domainShellFindings) {
    const key = domainShellKey(finding)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  if (domainShellMode === 'list') {
    const sorted = [...domainShellFindings].sort((a, b) => {
      if (a.file !== b.file) return a.file < b.file ? -1 : 1
      return a.line - b.line
    })
    for (const finding of sorted) {
      console.log(
        `${finding.file}:${finding.line} deep-import 'shell/${finding.subPath}' (${finding.importPath})`,
      )
    }
    console.log(`\n${domainShellFindings.length} deep import(s)`)
    return { failed: false }
  }

  if (domainShellMode === 'write') {
    const sortedEntries = Object.fromEntries(
      [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    )
    const payload = {
      $schema: './domain-shell-depth.schema.json',
      description:
        'Frozen domain -> shell deep imports, keyed by domainFile::subPath with an occurrence count. Only shrink this list. Regenerate with `node scripts/checks/check-boundaries.mjs --write-domain-shell-baseline` only after refactoring domains to consume the shell barrel (`apps/app/src/react-app/shell/index.ts`).',
      generatedAt: new Date().toISOString(),
      entries: sortedEntries,
    }
    writeFileSync(domainShellBaselinePath, `${JSON.stringify(payload, null, 2)}\n`)
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
    console.log(
      `Wrote domain-shell-depth baseline with ${counts.size} key(s) / ${total} occurrence(s) -> ${relative(repoRoot, domainShellBaselinePath)}`,
    )
    return { failed: false }
  }

  const baseline = readDomainShellBaseline()
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
    console.error('New domain-shell-depth violations:\n')
    for (const overage of overages) {
      console.error(`- ${overage.key}`)
      console.error(`  now ${overage.count} occurrence(s), baseline allows ${overage.allowed}`)
      const examples = domainShellFindings
        .filter((finding) => domainShellKey(finding) === overage.key)
        .slice(0, 3)
      for (const example of examples) {
        console.error(
          `    ${example.file}:${example.line} ${example.importPath}`,
        )
      }
    }
    console.error(
      '\nDomain files may only import shell via its barrel (`../shell` / `@/react-app/shell`).',
    )
    console.error('Add the API you need to `apps/app/src/react-app/shell/index.ts`, or lift the')
    console.error('cross-cutting state into `kernel/` and consume it from there.')
  }

  if (stale.length > 0) {
    console.error('\nDomain-shell-depth baseline is stale:')
    for (const entry of stale) {
      console.error(`- ${entry.key}: baseline ${entry.allowed} -> now ${entry.count}`)
    }
    console.error('Run `node scripts/checks/check-boundaries.mjs --write-domain-shell-baseline` to shrink it.')
  }

  return { failed: true }
}
