#!/usr/bin/env node
/**
 * scripts/design/codemod/snap-icon-sizes.mjs
 *
 * Snap drifting Lucide `size={N}` values to the nearest DESIGN.md
 * `iconography.size.*` allowed value (12 / 14 / 16 / 20 / 24). Nearest
 * neighbour with a tie-break toward the smaller allowed value:
 *
 *   9,10,11    → 12   (xs)
 *   13         → 14   (sm)
 *   15,17      → 16   (base)
 *   18         → 20   (lg)
 *   23,25,26,27→ 24   (xl)
 *   28,30      → 24   (xl, clamped — no larger token exists)
 *
 * Preserves already-tokenized sizes (12/14/16/20/24) untouched. Only
 * rewrites `size={N}` inside files that import from `lucide-react` and
 * where the JSX element receiving the size is a lucide-imported symbol
 * (guards against false positives on local brand icons like
 * TelegramIcon or SlackIcon that live in the same file).
 *
 * Default = dry-run. Pass `--write` to apply.
 * `--only=<file substring>` restricts to matching paths.
 * `--report-json=<path>` writes a summary.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const APP_SRC = join(repoRoot, 'apps/app/src')

const argv = process.argv.slice(2)
const flags = {
  write: argv.includes('--write'),
  help: argv.includes('--help') || argv.includes('-h'),
}
const onlyArg = argv.find((a) => a.startsWith('--only='))
const only = onlyArg ? onlyArg.slice('--only='.length) : null
const reportArg = argv.find((a) => a.startsWith('--report-json='))
const reportJsonPath = reportArg ? reportArg.slice('--report-json='.length) : null

if (flags.help) {
  console.log(
    'Usage: node scripts/design/codemod/snap-icon-sizes.mjs [--write] [--only=<substr>] [--report-json=<path>]',
  )
  process.exit(0)
}

const ALLOWED = [12, 14, 16, 20, 24]

/** Nearest allowed size. Tie-breaks toward smaller value. */
function snap(px) {
  if (ALLOWED.includes(px)) return px
  let best = ALLOWED[0]
  let bestDist = Math.abs(px - best)
  for (const cand of ALLOWED) {
    const d = Math.abs(px - cand)
    if (d < bestDist || (d === bestDist && cand < best)) {
      best = cand
      bestDist = d
    }
  }
  return best
}

function collectFiles(root) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(full)
      else if (/\.tsx?$/.test(name)) out.push(full)
    }
  }
  return out
}

/**
 * Parse the top-of-file `import { X, Y } from "lucide-react"` groups
 * and return the set of imported symbols. Handles multi-line imports.
 */
function extractLucideSymbols(src) {
  const symbols = new Set()
  const re = /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g
  let m
  while ((m = re.exec(src))) {
    for (const raw of m[1].split(',')) {
      const clean = raw.trim().split(/\s+as\s+/)[0].trim()
      if (clean) symbols.add(clean)
    }
  }
  return symbols
}

/** Find the JSX opening tag identifier that owns a given `size={N}` occurrence. */
function ownerTagName(src, sizeIndex) {
  let i = sizeIndex - 1
  let depth = 0
  while (i >= 0) {
    const ch = src[i]
    if (ch === '>' && src[i - 1] !== '=') depth++
    if (ch === '<') {
      if (depth === 0) {
        const rest = src.slice(i + 1)
        const idMatch = rest.match(/^([A-Za-z_][\w.]*)/)
        return idMatch ? idMatch[1] : null
      }
      depth--
    }
    i--
  }
  return null
}

const summary = { scanned: 0, changed: 0, hits: [], perFile: {} }

for (const path of collectFiles(APP_SRC)) {
  if (only && !path.includes(only)) continue
  let src
  try {
    src = readFileSync(path, 'utf8')
  } catch {
    continue
  }
  if (!/from ['"]lucide-react['"]/.test(src)) continue
  summary.scanned++
  const lucideSymbols = extractLucideSymbols(src)
  const re = /\bsize=\{(\d+)\}/g
  let m
  const hits = []
  while ((m = re.exec(src))) {
    const px = Number(m[1])
    if (ALLOWED.includes(px)) continue
    const owner = ownerTagName(src, m.index)
    if (!owner || !lucideSymbols.has(owner)) continue
    const to = snap(px)
    hits.push({ index: m.index, from: m[0], toStr: `size={${to}}`, from_px: px, to_px: to, owner })
  }
  if (hits.length === 0) continue
  let next = src
  for (const hit of hits.slice().reverse()) {
    next = next.slice(0, hit.index) + hit.toStr + next.slice(hit.index + hit.from.length)
  }
  const rel = path.slice(repoRoot.length + 1)
  summary.perFile[rel] = hits.map((h) => ({ owner: h.owner, from: h.from_px, to: h.to_px }))
  summary.hits.push(...hits.map((h) => ({ file: rel, ...h })))
  if (flags.write) {
    writeFileSync(path, next, 'utf8')
    summary.changed++
  }
}

const mode = flags.write ? 'WRITE' : 'DRY-RUN'
console.log(`[${mode}] scanned=${summary.scanned} files-with-hits=${Object.keys(summary.perFile).length} total-hits=${summary.hits.length}`)
for (const [file, changes] of Object.entries(summary.perFile)) {
  console.log(`  ${file}`)
  for (const c of changes) console.log(`    size={${c.from}} → size={${c.to}}  (owner=${c.owner})`)
}
if (reportJsonPath) {
  writeFileSync(reportJsonPath, JSON.stringify(summary, null, 2))
}
