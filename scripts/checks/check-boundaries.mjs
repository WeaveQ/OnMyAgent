import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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
])

const domainRoot = join(repoRoot, 'apps/app/src/react-app/domains')
const violations = []

for (const dir of packageDirs) {
  scanDirectory(join(repoRoot, dir), (filePath) => checkFile(filePath))
}

if (violations.length) {
  console.error('Architecture boundary violations found:\n')
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} ${violation.message}`)
    console.error(`  import: ${violation.importPath}`)
  }
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
    const stats = statSync(path)
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
