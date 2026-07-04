#!/usr/bin/env node
/**
 * scripts/design/codemod/snap-spacing.mjs
 *
 * Scan Tailwind spacing utilities in the OnMyAgent app renderer and flag
 * orphan values that don't map to any DESIGN.md `spacing.scale.*` /
 * `spacing.micro-scale.*` step. Defaults to dry-run.
 *
 * Contract (DESIGN.md `spacing:`):
 *   macro (multiples of 4): 0 4 8 12 16 20 24 32 48 64 (Tailwind: 0 1 2 3 4 5 6 8 12 16)
 *   micro (multiples of 2): 2 6 10 14 18 22          (Tailwind: 0.5 1.5 2.5 3.5 4.5 5.5)
 *   button family sizes (h-*): 6 8 9 10 11 (24 32 36 40 44px)
 *
 * The codemod distinguishes three prefix classes:
 *   spacingPrefixes = p/px/py/pt/pb/pl/pr/m/mx/my/mt/mb/ml/mr/gap-* / space-*
 *     → snap against macro ∪ micro ∪ {0}
 *   sizingPrefixes  = size/w/h
 *     → snap against macro ∪ micro ∪ {0} ∪ button family (6 8 9 10 11)
 *
 * Values already in the allowed set are left alone. Prints top rewrite
 * candidates. `--write` applies. `--only=<substr>` narrows path. Only
 * touches .tsx/.jsx/.ts/.js under `apps/app/src/`.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, '..', '..', '..')
const SCAN_ROOT = join(REPO_ROOT, 'apps', 'app', 'src')

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const ONLY = args.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null
const REPORT_JSON = args.find((a) => a.startsWith('--report-json='))?.slice('--report-json='.length) ?? null

// px values are Tailwind numeric multipliers (base 4px). To convert to
// px, multiply by 4.
const MACRO = [0, 1, 2, 3, 4, 5, 6, 8, 12, 16]           // 0..64px in 4-step
const MICRO = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]              // .5-step whitelist
const BUTTON_HEIGHTS = [6, 7, 8, 9, 10, 11, 14]           // 24 28 32 36 40 44 56
const HERO_SCALE = [7, 10, 14, 20, 24]                    // 28 40 56 80 96 (padding)

const SPACING_ALLOWED = new Set([...MACRO, ...MICRO, ...HERO_SCALE, 9])
const SIZING_ALLOWED = new Set([...MACRO, ...MICRO, ...BUTTON_HEIGHTS])

const SPACING_PREFIXES = [
  'p', 'px', 'py', 'pt', 'pb', 'pl', 'pr',
  'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr',
  'gap', 'gap-x', 'gap-y',
  'space-x', 'space-y',
]
const SIZING_PREFIXES = ['size', 'w', 'h']

const ALL_PREFIXES = [...SIZING_PREFIXES, ...SPACING_PREFIXES]
const PREFIX_ALT = ALL_PREFIXES.map((p) => p.replace('-', '\\-')).join('|')
const RE = new RegExp(`(?<![A-Za-z0-9\\-])(?:(${PREFIX_ALT}))\\-(\\d+(?:\\.\\d+)?)(?![A-Za-z0-9./])`, 'g')

function allowedFor(prefix) {
  return SIZING_PREFIXES.includes(prefix) ? SIZING_ALLOWED : SPACING_ALLOWED
}

// Skip large layout widths/heights (Tailwind w-24 = 96px etc.).
// The spacing contract only covers row/chip/section rhythms up to
// section=64 (Tailwind 16). Widths >= 20 (80px) are considered layout
// containers, out of scope for this codemod.
function outOfScope(prefix, value) {
  if (SIZING_PREFIXES.includes(prefix) && value >= 20) return true
  return false
}

function nearestAllowed(value, allowed) {
  let best = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const cand of allowed) {
    const delta = Math.abs(cand - value)
    if (delta < bestDelta || (delta === bestDelta && cand < best)) {
      best = cand
      bestDelta = delta
    }
  }
  return best
}

function shouldSkipDir(name) {
  return name === 'node_modules' || name === 'dist' || name.startsWith('.')
}

function walk(root, acc = []) {
  for (const entry of readdirSync(root)) {
    if (shouldSkipDir(entry)) continue
    const p = join(root, entry)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, acc)
    else if (/\.(tsx?|jsx?)$/.test(entry) && !entry.endsWith('.d.ts')) acc.push(p)
  }
  return acc
}

const files = walk(SCAN_ROOT).filter((f) => (ONLY ? f.includes(ONLY) : true))
let totalScanned = 0
let totalFilesWithHits = 0
const perValue = new Map()
const perFile = new Map()
const rewrites = []

for (const file of files) {
  const original = readFileSync(file, 'utf8')
  totalScanned += 1
  let hits = 0
  const updated = original.replace(RE, (match, prefix, numStr) => {
    const value = Number(numStr)
    if (Number.isNaN(value)) return match
    if (outOfScope(prefix, value)) return match
    const allowed = allowedFor(prefix)
    if (allowed.has(value)) return match
    const snap = nearestAllowed(value, allowed)
    if (snap === null) return match
    hits += 1
    const key = `${prefix}-${numStr} → ${prefix}-${snap}`
    perValue.set(key, (perValue.get(key) ?? 0) + 1)
    perFile.set(file, (perFile.get(file) ?? 0) + 1)
    rewrites.push({ file, from: `${prefix}-${numStr}`, to: `${prefix}-${snap}` })
    return `${prefix}-${snap}`
  })
  if (hits > 0) {
    totalFilesWithHits += 1
    if (WRITE && updated !== original) writeFileSync(file, updated)
  }
}

const summary = {
  mode: WRITE ? 'write' : 'dry-run',
  scanRoot: SCAN_ROOT,
  filesScanned: totalScanned,
  filesWithHits: totalFilesWithHits,
  totalHits: rewrites.length,
  perValue: Object.fromEntries([...perValue.entries()].sort((a, b) => b[1] - a[1])),
  perFile: Object.fromEntries(
    [...perFile.entries()]
      .map(([k, v]) => [k.replace(REPO_ROOT + '/', ''), v])
      .sort((a, b) => b[1] - a[1])
  ),
}

console.log(`snap-spacing: ${summary.mode}`)
console.log(`  files scanned:   ${summary.filesScanned}`)
console.log(`  files with hits: ${summary.filesWithHits}`)
console.log(`  total hits:      ${summary.totalHits}`)
console.log('  top rewrites:')
for (const [k, v] of Object.entries(summary.perValue).slice(0, 25)) {
  console.log(`    ${v.toString().padStart(4)}  ${k}`)
}

if (REPORT_JSON) {
  writeFileSync(REPORT_JSON, JSON.stringify(summary, null, 2))
  console.log(`\nwrote ${REPORT_JSON}`)
}

if (!WRITE && summary.totalHits > 0) {
  console.log('\n(dry-run — pass --write to apply)')
}
