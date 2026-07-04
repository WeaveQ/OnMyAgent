#!/usr/bin/env node
/**
 * check-forbidden-types.mjs
 *
 * AGENTS.md hard rule: `any` types, `as any`, and unchecked `as unknown as`
 * casts are forbidden in business source. This script keeps that rule
 * enforceable end-to-end:
 *
 *   - Scans real business source (excluding node_modules, dist, generated
 *     runtimes, third-party skills, tests, and `*.d.ts` shims).
 *   - Reports new occurrences as failures.
 *   - Freezes existing occurrences in
 *     `scripts/checks/baselines/forbidden-types.json` so they can be paid off
 *     incrementally without letting new violations sneak in.
 *
 * Usage:
 *   node scripts/checks/check-forbidden-types.mjs           # enforce
 *   node scripts/checks/check-forbidden-types.mjs --write   # regenerate baseline
 *   node scripts/checks/check-forbidden-types.mjs --list    # print all findings
 */

import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const baselinePath = join(repoRoot, 'scripts/checks/baselines/forbidden-types.json')

const scanRoots = [
  'apps/app/src',
  'apps/desktop/electron',
  'apps/orchestrator/src',
  'apps/server/src',
  'packages/handsfree/src',
  'packages/onmyagent-ui-mcp/src',
  'packages/types/src',
  'packages/ui/src',
]

const sourceExtensions = new Set(['.ts', '.tsx'])

// Skip directories that either hold generated output, third-party bundles,
// build helpers, or test scaffolding where narrow escapes are pragmatic.
const ignoredDirs = new Set([
  '.git',
  'dist',
  'dist-electron',
  'node_modules',
  'graphify-out',
  'resources',
  'script',
  'scripts',
])

// Individual paths that are intentionally allowed to keep escapes. Keep this
// list tiny and justified.
const fileAllowlist = new Set([
  // Justified bridge helpers where the cast is the single sanctioned point
  // for a Node<->Web type mismatch. Keep entries tiny and well-commented.
  'apps/server/src/core/node-web-stream.ts',
])

const patterns = [
  { id: 'as-any', regex: /\bas\s+any\b/g, label: '`as any` cast' },
  {
    id: 'colon-any',
    // Match `: any` type annotations but not `: any[]` fine-tuning cases where
    // we still want to catch them. Also skip JSDoc-style comments.
    regex: /(?<![/*])\bany\b/g,
    label: '`any` type reference',
    guard: (line) => /:\s*any\b|<\s*any\s*[,>]|Array<\s*any\s*>|Promise<\s*any\s*>|Record<[^>]*,\s*any\s*>|\(\s*[^)]*:\s*any\b/.test(
      line,
    ),
  },
  { id: 'as-unknown-as', regex: /\bas\s+unknown\s+as\b/g, label: '`as unknown as` double cast' },
]

const args = new Set(process.argv.slice(2))
const mode = args.has('--write') ? 'write' : args.has('--list') ? 'list' : 'enforce'

const findings = []
for (const root of scanRoots) {
  scanDirectory(join(repoRoot, root))
}
findings.sort(compareFindings)

if (mode === 'list') {
  for (const finding of findings) {
    console.log(`${finding.file}:${finding.line} ${finding.rule} :: ${finding.excerpt}`)
  }
  console.log(`\n${findings.length} finding(s)`)
  process.exit(0)
}

const currentCounts = countByKey(findings)

if (mode === 'write') {
  const sortedEntries = Object.fromEntries(
    [...currentCounts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  const payload = {
    $schema: './forbidden-types.schema.json',
    description:
      'Frozen occurrences of forbidden type escapes, keyed by file+rule+excerpt with a count of how many places currently match. Only shrink this list (delete entries, or lower counts). Never bump counts by hand. Regenerate with `node scripts/checks/check-forbidden-types.mjs --write` only after the workspace has genuinely stopped regressing.',
    generatedAt: new Date().toISOString(),
    entries: sortedEntries,
  }
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`)
  const total = [...currentCounts.values()].reduce((sum, count) => sum + count, 0)
  console.log(
    `Wrote baseline with ${currentCounts.size} key(s) / ${total} occurrence(s) -> ${relative(repoRoot, baselinePath)}`,
  )
  process.exit(0)
}

const baseline = readBaseline()
const baselineCounts = new Map(Object.entries(baseline.entries))

const overages = []
for (const [key, count] of currentCounts) {
  const allowed = baselineCounts.get(key) ?? 0
  if (count > allowed) overages.push({ key, count, allowed })
}
const stale = []
for (const [key, allowed] of baselineCounts) {
  const count = currentCounts.get(key) ?? 0
  if (count < allowed) stale.push({ key, count, allowed })
}

if (overages.length === 0 && stale.length === 0) {
  const total = [...currentCounts.values()].reduce((sum, count) => sum + count, 0)
  console.log(`Forbidden-type check passed (${total} occurrence(s) across ${currentCounts.size} baseline key(s)).`)
  process.exit(0)
}

if (overages.length > 0) {
  console.error('New forbidden-type violations found:\n')
  for (const overage of overages) {
    console.error(`- ${overage.key}`)
    console.error(`  now ${overage.count} occurrence(s), baseline allows ${overage.allowed}`)
    const examples = findings.filter((finding) => keyOf(finding) === overage.key).slice(0, 3)
    for (const example of examples) {
      console.error(`    ${example.file}:${example.line} ${example.excerpt}`)
    }
  }
  console.error(
    '\nAGENTS.md forbids `any`, `as any`, and `as unknown as` in business source.',
  )
  console.error('Fix the type instead of casting. If truly unavoidable, discuss before')
  console.error('adding to the allowlist in scripts/checks/check-forbidden-types.mjs.')
}

if (stale.length > 0) {
  console.error('\nBaseline entries have shrunk — please refresh:')
  for (const entry of stale) {
    console.error(`- ${entry.key}: baseline ${entry.allowed} -> now ${entry.count}`)
  }
  console.error(
    '\nRun `node scripts/checks/check-forbidden-types.mjs --write` to shrink the baseline.',
  )
}

process.exit(1)

function countByKey(items) {
  const counts = new Map()
  for (const item of items) {
    const key = keyOf(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function keyOf(finding) {
  return `${finding.file}::${finding.rule}::${finding.excerpt}`
}

function readBaseline() {
  if (!existsSync(baselinePath)) return { entries: {} }
  const raw = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const entries = raw && typeof raw.entries === 'object' && !Array.isArray(raw.entries) ? raw.entries : {}
  return { entries }
}

function scanDirectory(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue
    const path = join(dir, entry)
    const stats = lstatSync(path)
    if (stats.isSymbolicLink()) continue
    if (stats.isDirectory()) {
      scanDirectory(path)
      continue
    }
    if (!stats.isFile()) continue
    if (!sourceExtensions.has(extname(path))) continue
    if (path.endsWith('.d.ts')) continue
    if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) continue
    if (path.endsWith('.spec.ts') || path.endsWith('.spec.tsx')) continue
    const relativePath = toPosix(relative(repoRoot, path))
    if (fileAllowlist.has(relativePath)) continue
    scanFile(path, relativePath)
  }
}

function scanFile(absPath, relativePath) {
  const source = readFileSync(absPath, 'utf8')
  const lines = source.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const line = stripLineComment(rawLine)
    if (!line) continue
    for (const pattern of patterns) {
      // Reset lastIndex for global regex reuse across lines.
      pattern.regex.lastIndex = 0
      if (!pattern.regex.test(line)) continue
      if (pattern.guard && !pattern.guard(line)) continue
      findings.push({
        file: relativePath,
        line: index + 1,
        rule: pattern.id,
        label: pattern.label,
        excerpt: line.trim().slice(0, 200),
      })
    }
  }
}

function stripLineComment(line) {
  const commentIndex = findLineCommentIndex(line)
  const withoutLineComment = commentIndex >= 0 ? line.slice(0, commentIndex) : line
  const withoutBlockComment = withoutLineComment.replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '').trim()
  // JSDoc mid-block lines that start with `*` are comment continuations.
  if (/^\*/.test(withoutBlockComment)) return ''
  return withoutBlockComment
}

function findLineCommentIndex(line) {
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  for (let i = 0; i < line.length - 1; i += 1) {
    const ch = line[i]
    const next = line[i + 1]
    if (!inDouble && !inBacktick && ch === "'" && line[i - 1] !== '\\') inSingle = !inSingle
    else if (!inSingle && !inBacktick && ch === '"' && line[i - 1] !== '\\') inDouble = !inDouble
    else if (!inSingle && !inDouble && ch === '`' && line[i - 1] !== '\\') inBacktick = !inBacktick
    else if (!inSingle && !inDouble && !inBacktick && ch === '/' && next === '/') return i
  }
  return -1
}

function compareFindings(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1
  if (a.line !== b.line) return a.line - b.line
  if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1
  return 0
}

function toPosix(path) {
  return path.split(sep).join('/')
}
