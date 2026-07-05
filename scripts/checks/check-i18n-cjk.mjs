#!/usr/bin/env node
/**
 * check-i18n-cjk.mjs
 *
 * AGENTS.md 铁律：renderer 层新增用户可见文案必须走 i18n。此脚本冻结现存
 * CJK 硬编码字符串到 baseline，只允许缩减、禁止扩增。
 *
 *   - 扫描 apps/app/src（renderer + shell + kernel），跳过 locales/、tests、d.ts、
 *     注释块。
 *   - 命中包含 CJK 字符（\u4e00-\u9fff、\u3400-\u4dbf、\uff00-\uffef 半宽符号除外）
 *     的字符串字面量或 JSX 文本。
 *   - Baseline 位于 scripts/checks/baselines/i18n-cjk-hardcoded.json，仅允许下降。
 *
 * Usage:
 *   node scripts/checks/check-i18n-cjk.mjs           # enforce
 *   node scripts/checks/check-i18n-cjk.mjs --write   # regenerate baseline
 *   node scripts/checks/check-i18n-cjk.mjs --list    # print all findings
 */

import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const baselinePath = join(repoRoot, 'scripts/checks/baselines/i18n-cjk-hardcoded.json')

const scanRoots = ['apps/app/src']

const sourceExtensions = new Set(['.ts', '.tsx'])

const ignoredDirs = new Set([
  '.git',
  'dist',
  'dist-electron',
  'node_modules',
  'locales',
])

const fileAllowlist = new Set([
  // i18n 系统本身允许 CJK（locale metadata、language options 等）
  'apps/app/src/i18n/index.ts',
])

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

const args = new Set(process.argv.slice(2))
const mode = args.has('--write') ? 'write' : args.has('--list') ? 'list' : 'enforce'

const findings = []
for (const root of scanRoots) {
  scanDirectory(join(repoRoot, root))
}
findings.sort(compareFindings)

if (mode === 'list') {
  for (const finding of findings) {
    console.log(`${finding.file}:${finding.line} ${finding.excerpt}`)
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
    $schema: './i18n-cjk-hardcoded.schema.json',
    description:
      'Frozen CJK hard-coded string occurrences keyed by file+excerpt with a count. Only shrink (delete entries or lower counts); never bump counts by hand. Regenerate with `node scripts/checks/check-i18n-cjk.mjs --write` after genuine reduction.',
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
  console.log(`i18n CJK hard-coded check passed (${total} occurrence(s) across ${currentCounts.size} baseline key(s)).`)
  process.exit(0)
}

if (overages.length > 0) {
  console.error('New hard-coded CJK strings found (must go through i18n `t()`):\n')
  for (const overage of overages) {
    console.error(`- ${overage.key}`)
    console.error(`  now ${overage.count} occurrence(s), baseline allows ${overage.allowed}`)
    const examples = findings.filter((finding) => keyOf(finding) === overage.key).slice(0, 3)
    for (const example of examples) {
      console.error(`    ${example.file}:${example.line} ${example.excerpt}`)
    }
  }
  console.error(
    '\nAGENTS.md 硬性规定：renderer 层新增用户可见文案必须走 i18n；不要在源码里写死中文。',
  )
  console.error('把文案移到 apps/app/src/i18n/locales/{en,zh,zh-TW}/*.ts 并用 t(key) 引用。')
}

if (stale.length > 0) {
  console.error('\nBaseline entries have shrunk — please refresh:')
  for (const entry of stale) {
    console.error(`- ${entry.key}: baseline ${entry.allowed} -> now ${entry.count}`)
  }
  console.error(
    '\nRun `node scripts/checks/check-i18n-cjk.mjs --write` to shrink the baseline.',
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
  return `${finding.file}::${finding.excerpt}`
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
  let inBlockComment = false
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    // 跳过整行注释、JSDoc 块内的行
    let line = rawLine
    if (inBlockComment) {
      const endIdx = line.indexOf('*/')
      if (endIdx === -1) continue
      line = line.slice(endIdx + 2)
      inBlockComment = false
    }
    const openIdx = line.indexOf('/*')
    if (openIdx !== -1 && line.indexOf('*/', openIdx) === -1) {
      inBlockComment = true
      line = line.slice(0, openIdx)
    }
    // 单行注释
    const commentIdx = findLineCommentIndex(line)
    if (commentIdx >= 0) line = line.slice(0, commentIdx)
    // JSDoc 续行
    if (/^\s*\*/.test(line)) continue
    if (!CJK_RE.test(line)) continue
    findings.push({
      file: relativePath,
      line: index + 1,
      excerpt: line.trim().slice(0, 200),
    })
  }
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
  return 0
}

function toPosix(path) {
  return path.split(sep).join('/')
}
