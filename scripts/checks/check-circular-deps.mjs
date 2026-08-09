#!/usr/bin/env node
// Circular-dependency gate for the OnMyAgent monorepo.
//
// Why this exists:
//   docs/Architecture.md states "madge --circular should be 0 in app/server",
//   but that assertion was never wired into `pnpm check:boundaries`. To keep
//   the rule honest without adding a heavy (and network-fetched) devDependency,
//   this is a small, zero-dep Tarjan SCC over the same source tree the rest of
//   the boundary checks already walk. Existing cycles are frozen in a
//   shrink-only baseline; new cycles fail CI.
//
// Usage:
//   node scripts/checks/check-circular-deps.mjs                 # enforce
//   node scripts/checks/check-circular-deps.mjs --write         # refresh baseline
//   node scripts/checks/check-circular-deps.mjs --list          # print all cycles

import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cjs', '.cts']
const ignoredDirs = new Set([
  '.git',
  '.turbo',
  'dist',
  'build',
  'out',
  'node_modules',
  'graphify-out',
  'coverage',
])
// Only scan the shipped runtime surfaces. Tests can have cycles without
// affecting production architecture; they are excluded to match the
// Architecture.md wording ("app/server").
const scanRoots = [
  'apps/app/src',
  'apps/desktop/electron',
  'apps/desktop/preload.*',
  'apps/server/src',
  'apps/orchestrator/src',
  'packages/types/src',
  'packages/ui/src',
  'packages/artifact-runtime',
  'packages/onmyagent-ui-mcp',
]
const excludePathPatterns = [
  /(^|\/)(__tests__|test|tests|e2e|fixtures|fixture|__mocks__)(\/|$)/,
  /\.(test|spec)\.[a-z]+$/,
  /\.d\.ts$/,
]

const baselinePath = join(
  repoRoot,
  'scripts/checks/baselines/circular-deps.json',
)

const mode = process.argv.includes('--write')
  ? 'write'
  : process.argv.includes('--list')
    ? 'list'
    : 'enforce'

const importPatterns = [
  // ES: import ... from '...'  (capture group 1 is the specifier)
  /(?:^|[^A-Za-z0-9_$])import\s+(?:[^'";]+\s+from\s+)?["']([^"']+)["']/g,
  // Dynamic import('...')
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  // CJS require('...')
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  // ESM re-export
  /\bexport\s+[^'";]*\bfrom\s+["']([^"']+)["']/g,
]

// Strip block comments only. Line comments and string contents are left intact
// because import specifiers live inside string literals; we only need to
// neutralize `/* ... */` blocks that could span an import statement.
function stripComments(source) {
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    if (source[i] === '/' && source[i + 1] === '*') {
      out += '  '
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < n) {
        out += '  '
        i += 2
      }
      continue
    }
    if (source[i] === '/' && source[i + 1] === '/') {
      // Leave line comments intact; they can't span newlines and won't
      // confuse multiline import regexes.
      while (i < n && source[i] !== '\n') {
        out += source[i]
        i++
      }
      continue
    }
    out += source[i]
    i++
  }
  return out
}

const files = collectFiles()
if (files.length === 0) {
  console.error('circular-deps: no source files found under scan roots')
  process.exit(1)
}

const graph = buildGraph(files)
const sccs = tarjan(graph)
const cycles = sccs
  .map((component) =>
    // Skip trivial self-loops; record real cycles only.
    component.length > 1 ? component : null,
  )
  .filter(Boolean)
  .map((component) => normalizeCycle(component, graph))

// Deterministic ordering.
cycles.sort((a, b) => (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0))

if (mode === 'list') {
  if (cycles.length === 0) {
    console.log('No circular dependencies.')
  } else {
    for (const cycle of cycles) {
      console.log(`\n# ${cycle.signature}`)
      for (let i = 0; i < cycle.nodes.length; i++) {
        const next = cycle.nodes[(i + 1) % cycle.nodes.length]
        console.log(`  ${cycle.nodes[i]} -> ${next}`)
      }
    }
    console.log(`\n${cycles.length} circular group(s)`)
  }
  process.exit(0)
}

if (mode === 'write') {
  const payload = {
    $schema: './circular-deps.schema.json',
    description:
      'Frozen circular-dependency signatures (sorted, rooted at the lexicographically smallest file). Only shrink this list. Run `node scripts/checks/check-circular-deps.mjs --write` only after refactoring to break one of the listed cycles.',
    generatedAt: new Date().toISOString(),
    entries: cycles.map((cycle) => cycle.signature),
  }
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(
    `Wrote circular-deps baseline with ${cycles.length} cycle(s) -> ${relative(repoRoot, baselinePath)}`,
  )
  process.exit(0)
}

// enforce
const baseline = readBaseline()
const baselineSet = new Set(baseline.entries)
const currentSet = new Set(cycles.map((c) => c.signature))

const newCycles = cycles.filter((c) => !baselineSet.has(c.signature))
const staleCycles = baseline.entries.filter((sig) => !currentSet.has(sig))

if (newCycles.length === 0 && staleCycles.length === 0) {
  console.log(
    `Circular dependency check passed (${cycles.length} acknowledged cycle(s) in baseline).`,
  )
  process.exit(0)
}

if (newCycles.length > 0) {
  console.error(`\nNew circular dependencies detected (${newCycles.length}):\n`)
  for (const cycle of newCycles) {
    console.error(`  ✗ ${cycle.signature}`)
    for (let i = 0; i < cycle.nodes.length; i++) {
      const next = cycle.nodes[(i + 1) % cycle.nodes.length]
      console.error(`      ${cycle.nodes[i]}  →  ${next}`)
    }
    console.error('')
  }
  console.error(
    'Break the cycle (introduce a shared types/interface module, invert the\n' +
      'dependency, or move the shared helper to a neutral package) and re-run.\n' +
      'Existing cycles are tracked in scripts/checks/baselines/circular-deps.json\n' +
      'and shrink over time — do not grow the baseline.',
  )
}

if (staleCycles.length > 0) {
  console.error(`\nCircular-deps baseline is stale (${staleCycles.length} removed):`)
  for (const sig of staleCycles) console.error(`  ✓ ${sig}`)
  console.error(
    '\nRun `node scripts/checks/check-circular-deps.mjs --write` to shrink the baseline.',
  )
}

process.exit(1)

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function collectFiles() {
  const found = []
  for (const rootPattern of scanRoots) {
    const pattern = /[*?]/.test(rootPattern)
    if (pattern) {
      const dir = join(repoRoot, dirname(rootPattern))
      const base = rootPattern.split('/').pop()
      const matcher = new RegExp(
        '^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
      )
      if (existsSync(dir)) {
        for (const entry of readdirSync(dir)) {
          if (matcher.test(entry)) {
            const p = join(dir, entry)
            if (lstatSync(p).isFile() && !isExcluded(p)) found.push(p)
          }
        }
      }
      continue
    }
    const abs = join(repoRoot, rootPattern)
    if (!existsSync(abs)) continue
    walk(abs, found)
  }
  return found
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue
    const p = join(dir, entry)
    const stats = lstatSync(p)
    if (stats.isSymbolicLink()) continue
    if (stats.isDirectory()) {
      walk(p, out)
      continue
    }
    if (!stats.isFile()) continue
    if (!sourceExtensions.includes(extname(p))) continue
    if (isExcluded(p)) continue
    out.push(p)
  }
}

function isExcluded(absPath) {
  const rel = relative(repoRoot, absPath).split(/[\\/]/).join('/')
  return excludePathPatterns.some((re) => re.test(rel))
}

function buildGraph(fileList) {
  const byRel = new Map()
  const nodeIds = []
  for (const file of fileList) {
    const id = toPosix(relative(repoRoot, file))
    byRel.set(id, file)
    nodeIds.push(id)
  }
  const adj = new Map(nodeIds.map((id) => [id, []]))

  for (const id of nodeIds) {
    const source = readFileSync(byRel.get(id), 'utf8')
    const imports = extractImports(source)
    const deps = new Set()
    for (const spec of imports) {
      const resolved = resolveImportSpecifier(byRel.get(id), spec)
      if (!resolved) continue
      const targetId = toPosix(relative(repoRoot, resolved))
      if (targetId === id) continue
      if (!adj.has(targetId)) continue // outside scan set (node_modules, etc.)
      deps.add(targetId)
    }
    adj.set(id, [...deps])
  }
  return { nodes: nodeIds, adj }
}

function extractImports(source) {
  const stripped = stripComments(source)
  const specs = new Set()
  for (const pattern of importPatterns) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(stripped)) !== null) {
      const spec = match[1]
      if (spec.startsWith('#') || isBarePackage(spec)) continue
      specs.add(spec)
    }
  }
  return [...specs]
}

function isBarePackage(spec) {
  if (spec.startsWith('.') || spec.startsWith('/')) return false
  // Workspace aliases
  if (spec.startsWith('@/') || spec.startsWith('~@/')) return false
  // Everything else (react, @scope/pkg, node:fs) is a bare dependency.
  return true
}

function resolveImportSpecifier(fromFile, spec) {
  // Alias: @/...  (apps/app only)
  if (spec.startsWith('@/')) {
    const appSrc = join(repoRoot, 'apps/app/src')
    return resolveWithExtensions(join(appSrc, spec.slice(2)))
  }
  if (spec.startsWith('~@/')) {
    const appSrc = join(repoRoot, 'apps/app/src')
    return resolveWithExtensions(join(appSrc, spec.slice(3)))
  }
  if (spec.startsWith('/')) {
    return resolveWithExtensions(spec)
  }
  if (!spec.startsWith('.')) return null
  return resolveWithExtensions(resolve(dirname(fromFile), spec))
}

function resolveWithExtensions(base) {
  // If base already has a recognized extension, return as-is.
  if (sourceExtensions.includes(extname(base))) {
    return existsSync(base) ? base : null
  }
  for (const ext of sourceExtensions) {
    const p = base + ext
    if (existsSync(p)) return p
  }
  for (const ext of sourceExtensions) {
    const p = join(base, 'index' + ext)
    if (existsSync(p)) return p
  }
  return null
}

function toPosix(p) {
  return p.split(/[\\/]/).join('/')
}

// Tarjan's SCC — iterative to avoid recursion depth issues on big graphs.
function tarjan({ nodes, adj }) {
  let index = 0
  const idx = new Map()
  const low = new Map()
  const onStack = new Set()
  const stack = []
  const sccs = []

  for (const node of nodes) {
    if (idx.has(node)) continue
    const dfsStack = [{ node, i: 0 }]
    idx.set(node, index)
    low.set(node, index)
    index++
    stack.push(node)
    onStack.add(node)

    while (dfsStack.length > 0) {
      const top = dfsStack[dfsStack.length - 1]
      const neighbors = adj.get(top.node) ?? []
      if (top.i < neighbors.length) {
        const w = neighbors[top.i++]
        if (!idx.has(w)) {
          idx.set(w, index)
          low.set(w, index)
          index++
          stack.push(w)
          onStack.add(w)
          dfsStack.push({ node: w, i: 0 })
        } else if (onStack.has(w)) {
          low.set(top.node, Math.min(low.get(top.node), idx.get(w)))
        }
      } else {
        if (low.get(top.node) === idx.get(top.node)) {
          const component = []
          let popped
          do {
            popped = stack.pop()
            onStack.delete(popped)
            component.push(popped)
          } while (popped !== top.node)
          sccs.push(component)
        }
        dfsStack.pop()
        if (dfsStack.length > 0) {
          const parent = dfsStack[dfsStack.length - 1].node
          low.set(parent, Math.min(low.get(parent), low.get(top.node)))
        }
      }
    }
  }
  return sccs
}

function normalizeCycle(component, graphRef) {
  // Rotate so the lexicographically smallest node is first; preserve the
  // relative adjacency order by following graph edges around the SCC.
  const sorted = [...component].sort()
  const start = sorted[0]
  const set = new Set(component)
  const order = [start]
  let current = start
  while (order.length < component.length) {
    const neighbors = (graph.adj.get(current) ?? []).filter((n) => set.has(n))
    // Pick smallest neighbor in component that we haven't visited yet.
    const unvisited = neighbors
      .filter((n) => !order.includes(n))
      .sort()
    if (unvisited.length === 0) {
      // Defensive: fall back to set order if graph traversal can't complete.
      for (const n of sorted) if (!order.includes(n)) order.push(n)
      break
    }
    current = unvisited[0]
    order.push(current)
  }
  return {
    nodes: order,
    signature: order.join(' -> ') + ' -> ' + order[0],
  }
}

function readBaseline() {
  if (!existsSync(baselinePath)) return { entries: [] }
  const raw = JSON.parse(readFileSync(baselinePath, 'utf8'))
  if (!raw || !Array.isArray(raw.entries)) return { entries: [] }
  return { entries: raw.entries }
}
