#!/usr/bin/env node
/**
 * scripts/design/codemod/fix-tokens.mjs
 *
 * Auto-fix codemod for known-mechanical DESIGN.md drift. Three rules:
 *   - text-numeric   : Tailwind arbitrary text sizes `text-[Npx]` → nearest
 *                      typography.scale.* named token.
 *   - icon-numeric   : Lucide icon size={N} → iconography.size.* named token
 *                      (12→xs, 14→sm, 16→base, 20→lg, 24→xl).
 *   - hardcoded-hex  : `#RRGGBB` literals in tokenized files, when the hex
 *                      matches a DESIGN.md color exactly, → `hsl(var(--dls-*))`.
 *
 * Default = dry-run: print unified-diff-style previews and exit 0.
 * --write            Apply hunks in place.
 * --only=<rule>      Restrict to one rule family (comma-separated allowed).
 * --report-json=<p>  Write machine-readable summary JSON to <path>.
 * --help, -h         Show this message.
 *
 * The codemod reads DESIGN.md YAML front matter for its authoritative
 * mappings; it does not carry hardcoded token tables. The set of files
 * scanned is apps/app/src/**\/*.{ts,tsx,css}.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const DESIGN_MD = join(repoRoot, 'DESIGN.md')
const APP_SRC = join(repoRoot, 'apps/app/src')

const argv = process.argv.slice(2)
const flags = {
  write: argv.includes('--write'),
  help: argv.includes('--help') || argv.includes('-h'),
  only: parseValue(argv, '--only'),
  reportJson: parseValue(argv, '--report-json'),
}

function parseValue(args, name) {
  const eqIdx = args.findIndex((a) => a.startsWith(name + '='))
  if (eqIdx !== -1) return args[eqIdx].slice(name.length + 1)
  const idx = args.indexOf(name)
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1]
  return null
}

if (flags.help) {
  console.log(`Usage: node scripts/design/codemod/fix-tokens.mjs [flags]

Rewrite mechanical DESIGN.md drift to tokenized forms.

Flags:
  --write               Apply changes in place (default: dry-run preview).
  --only=<rule>         Restrict to one rule family. Comma-separated allowed:
                        text-numeric,icon-numeric,hardcoded-hex.
  --report-json=<path>  Write JSON summary of matches / rewrites.
  --help, -h            Show this message.

Rules:
  text-numeric    text-[Npx] → nearest typography.scale.* token.
  icon-numeric    <Icon size={N}/> → SIZES.<key> constant.
  hardcoded-hex   #RRGGBB in tokenized files → hsl(var(--dls-*)).

Default is dry-run: prints unified-diff previews. Review before --write.
Do not run --write inside a dirty tree; codemod hunks and manual edits
mix badly.`)
  process.exit(0)
}


// ---------- YAML reader (scoped to DESIGN.md shape) ----------

function readFrontMatter(path) {
  const raw = readFileSync(path, 'utf8')
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) throw new Error(`No YAML front matter at ${path}`)
  return match[1]
}

function parseFrontMatter(yaml) {
  const lines = yaml.split(/\r?\n/)
  const root = {}
  const stack = [{ indent: -1, obj: root }]
  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue
    const indent = rawLine.match(/^ */)[0].length
    const line = rawLine.slice(indent)
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const parent = stack[stack.length - 1].obj
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    const key = kv[1]
    const rawValue = kv[2]
    if (rawValue === '') {
      const child = {}
      parent[key] = child
      stack.push({ indent, obj: child })
    } else {
      parent[key] = coerce(rawValue)
    }
  }
  return root
}

function coerce(v) {
  const s = v.trim()
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1)
  if (/^-?\d+$/.test(s)) return Number(s)
  return s
}

// ---------- File walker ----------

function walkAppSrc() {
  const out = []
  const stack = [APP_SRC]
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
      else if (/\.(tsx?|css)$/.test(name)) out.push(full)
    }
  }
  return out
}


// ---------- Rule: text-numeric ----------

function buildTextSizeMap(yaml) {
  const scale = yaml.typography?.scale || {}
  const map = new Map()
  for (const [key, val] of Object.entries(scale)) {
    const px = Number(String(val).replace('px', ''))
    if (Number.isFinite(px)) map.set(px, `text-${key}`)
  }
  return map
}

function nearestTextClass(px, map) {
  if (map.has(px)) return map.get(px)
  let best = null
  let bestDiff = Infinity
  let bestPx = -Infinity
  for (const [candidate, cls] of map.entries()) {
    const diff = Math.abs(candidate - px)
    if (diff < bestDiff || (diff === bestDiff && candidate > bestPx)) {
      bestDiff = diff
      best = cls
      bestPx = candidate
    }
  }
  return best
}

function ruleTextNumeric(files, yaml) {
  const rewrites = []
  const map = buildTextSizeMap(yaml)
  if (map.size === 0) return rewrites
  for (const path of files) {
    if (!/\.tsx?$/.test(path)) continue
    let src
    try {
      src = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    const re = /text-\[(\d+)px\]/g
    let m
    const hits = []
    while ((m = re.exec(src))) {
      const px = Number(m[1])
      const replacement = nearestTextClass(px, map)
      if (!replacement) continue
      hits.push({ from: m[0], to: replacement, index: m.index, px })
    }
    if (hits.length === 0) continue
    let next = src
    for (const hit of hits.slice().reverse()) {
      next = next.slice(0, hit.index) + hit.to + next.slice(hit.index + hit.from.length)
    }
    rewrites.push({ path, rule: 'text-numeric', before: src, after: next, hits })
  }
  return rewrites
}

// ---------- Rule: icon-numeric ----------

const ICON_MAP = new Map([
  [12, 'xs'],
  [14, 'sm'],
  [16, 'base'],
  [20, 'lg'],
  [24, 'xl'],
])

function ruleIconNumeric(files, yaml) {
  const rewrites = []
  const iconYaml = yaml.iconography?.size || {}
  const px2key = new Map()
  for (const [key, val] of Object.entries(iconYaml)) {
    const px = Number(String(val).replace('px', ''))
    if (Number.isFinite(px)) px2key.set(px, key)
  }
  for (const [px, key] of ICON_MAP.entries()) {
    if (!px2key.has(px)) px2key.set(px, key)
  }
  for (const path of files) {
    if (!/\.tsx?$/.test(path)) continue
    let src
    try {
      src = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    if (!/from ['"]lucide-react['"]/.test(src)) continue
    const re = /\bsize=\{(\d+)\}/g
    let m
    const hits = []
    while ((m = re.exec(src))) {
      const px = Number(m[1])
      const key = px2key.get(px)
      if (!key) continue
      hits.push({ from: m[0], to: `size={ICON_SIZES.${key}}`, index: m.index, px })
    }
    if (hits.length === 0) continue
    let next = src
    for (const hit of hits.slice().reverse()) {
      next = next.slice(0, hit.index) + hit.to + next.slice(hit.index + hit.from.length)
    }
    rewrites.push({ path, rule: 'icon-numeric', before: src, after: next, hits })
  }
  return rewrites
}


// ---------- Rule: hardcoded-hex ----------

function buildHexMap(yaml) {
  const map = new Map()
  const themes = yaml.colors || {}
  for (const [themeName, tokens] of Object.entries(themes)) {
    if (typeof tokens !== 'object' || tokens === null) continue
    for (const [key, val] of Object.entries(tokens)) {
      if (typeof val !== 'string') continue
      if (!/^#[0-9a-fA-F]{6}$/.test(val)) continue
      const cssName = `--dls-${key}`
      const norm = val.toLowerCase()
      if (!map.has(norm)) map.set(norm, { cssName, sources: [] })
      map.get(norm).sources.push(`${themeName}.${key}`)
    }
  }
  return map
}

function ruleHardcodedHex(files, yaml) {
  const rewrites = []
  const hexMap = buildHexMap(yaml)
  if (hexMap.size === 0) return rewrites
  const EXCLUDE_PATH_RE = /(styles\/colors\.css|app\/index\.css)$/
  for (const path of files) {
    if (!/\.(tsx?|css)$/.test(path)) continue
    if (EXCLUDE_PATH_RE.test(path)) continue
    let src
    try {
      src = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    const re = /#([0-9a-fA-F]{6})\b/g
    let m
    const hits = []
    while ((m = re.exec(src))) {
      const hex = m[0].toLowerCase()
      const entry = hexMap.get(hex)
      if (!entry) continue
      if (path.endsWith('.css') && /^\s*--/.test(src.slice(Math.max(0, m.index - 40), m.index))) {
        continue
      }
      if (path.endsWith('.css')) {
        const preceding = src.slice(Math.max(0, m.index - 6), m.index)
        if (preceding.endsWith('\\[')) continue
        const lineStart = src.lastIndexOf('\n', m.index) + 1
        const lineHead = src.slice(lineStart, m.index)
        if (/^[^{]*\.[A-Za-z_][A-Za-z0-9_-]*\\?\[/.test(lineHead)) continue
      }
      hits.push({ from: m[0], to: `hsl(var(${entry.cssName}))`, index: m.index, hex })
    }
    if (hits.length === 0) continue
    let next = src
    for (const hit of hits.slice().reverse()) {
      next = next.slice(0, hit.index) + hit.to + next.slice(hit.index + hit.from.length)
    }
    rewrites.push({ path, rule: 'hardcoded-hex', before: src, after: next, hits })
  }
  return rewrites
}


// ---------- Diff preview ----------

function unifiedDiff(pathRel, before, after) {
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)
  const total = Math.max(beforeLines.length, afterLines.length)
  const changes = []
  for (let i = 0; i < total; i++) {
    if (beforeLines[i] !== afterLines[i]) {
      changes.push({
        line: i + 1,
        before: beforeLines[i] ?? '',
        after: afterLines[i] ?? '',
      })
    }
  }
  const out = [`--- ${pathRel}`, `+++ ${pathRel}`]
  for (const c of changes) {
    out.push(`@@ L${c.line} @@`)
    out.push(`- ${c.before}`)
    out.push(`+ ${c.after}`)
  }
  return out.join('\n')
}

// ---------- main ----------

const ALL_RULES = ['text-numeric', 'icon-numeric', 'hardcoded-hex']

function selectedRules() {
  if (!flags.only) return new Set(ALL_RULES)
  const asked = flags.only
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const bad = asked.filter((r) => !ALL_RULES.includes(r))
  if (bad.length > 0) {
    console.error(`Unknown rule(s): ${bad.join(', ')}`)
    console.error(`Valid rules: ${ALL_RULES.join(', ')}`)
    process.exit(2)
  }
  return new Set(asked)
}

try {
  const yaml = parseFrontMatter(readFrontMatter(DESIGN_MD))
  const files = walkAppSrc()
  const enabled = selectedRules()

  const results = { rules: {}, files: [] }
  const rewrites = []

  if (enabled.has('text-numeric')) {
    const r = ruleTextNumeric(files, yaml)
    results.rules['text-numeric'] = {
      candidates: r.reduce((a, b) => a + b.hits.length, 0),
      files: r.length,
    }
    rewrites.push(...r)
  }
  if (enabled.has('icon-numeric')) {
    const r = ruleIconNumeric(files, yaml)
    results.rules['icon-numeric'] = {
      candidates: r.reduce((a, b) => a + b.hits.length, 0),
      files: r.length,
    }
    rewrites.push(...r)
  }
  if (enabled.has('hardcoded-hex')) {
    const r = ruleHardcodedHex(files, yaml)
    results.rules['hardcoded-hex'] = {
      candidates: r.reduce((a, b) => a + b.hits.length, 0),
      files: r.length,
    }
    rewrites.push(...r)
  }

  const grouped = new Map()
  for (const rw of rewrites) {
    if (!grouped.has(rw.path)) grouped.set(rw.path, { before: rw.before, after: rw.before, rules: [] })
    grouped.get(rw.path).after = rw.after
    grouped.get(rw.path).rules.push(rw.rule)
  }

  const dryPreviews = []
  for (const [path, entry] of grouped.entries()) {
    const rel = relative(repoRoot, path)
    results.files.push({ path: rel, rules: [...new Set(entry.rules)] })
    dryPreviews.push(unifiedDiff(rel, entry.before, entry.after))
    if (flags.write) {
      writeFileSync(path, entry.after)
    }
  }

  if (flags.reportJson) {
    writeFileSync(flags.reportJson, JSON.stringify(results, null, 2))
  }

  const totalCandidates = Object.values(results.rules).reduce(
    (a, b) => a + (b?.candidates || 0),
    0,
  )

  if (!flags.write) {
    if (dryPreviews.length === 0) {
      console.log('No candidate hunks found.')
    } else {
      for (const p of dryPreviews) console.log(p + '\n')
      console.log(`\n[dry-run] ${totalCandidates} candidate hunks across ${grouped.size} file(s). Re-run with --write to apply.`)
    }
  } else {
    console.log(`Applied ${totalCandidates} hunks across ${grouped.size} file(s).`)
  }
  process.exit(0)
} catch (err) {
  console.error(`fix-tokens failed: ${err.message}`)
  if (process.env.DEBUG) console.error(err.stack)
  process.exit(2)
}
