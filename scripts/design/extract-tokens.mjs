#!/usr/bin/env node
/**
 * scripts/design/extract-tokens.mjs
 *
 * Diff DESIGN.md YAML front-matter tokens against the code-side sources:
 *   - apps/app/src/app/index.css       (semantic --dls-* / --ow-* variables)
 *   - apps/app/src/styles/colors.css   (Radix palette — referenced, not diffed)
 *   - apps/app/tailwind.config.ts      (theme.extend hooks — read via regex to
 *                                       avoid needing the TS pipeline)
 *
 * Default mode: report-only, exit 0.
 * --strict:     exit 1 on any drift.
 * --json:       emit the raw diff object as JSON, no human rendering.
 * --help:       usage.
 *
 * Intentionally regex-parsed (no yaml / typescript deps) — the YAML surface is
 * fixed by DESIGN.md's Stitch v-alpha shape. If the surface grows beyond the
 * current flat / one-level-nested shape, adopt a real parser.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const DESIGN_MD = join(repoRoot, 'DESIGN.md')
const APP_INDEX_CSS = join(repoRoot, 'apps/app/src/app/index.css')
const TAILWIND_CONFIG = join(repoRoot, 'apps/app/tailwind.config.ts')
const APP_SRC = join(repoRoot, 'apps/app/src')

const argv = process.argv.slice(2)
const flags = {
  strict: argv.includes('--strict'),
  json: argv.includes('--json'),
  help: argv.includes('--help') || argv.includes('-h'),
  includeExceptions: argv.includes('--include-exceptions'),
  baseline: parseFlagValue(argv, '--baseline'),
}

function parseFlagValue(args, name) {
  const eqIdx = args.findIndex((a) => a.startsWith(name + '='))
  if (eqIdx !== -1) return args[eqIdx].slice(name.length + 1)
  const idx = args.indexOf(name)
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1]
  return null
}

if (flags.help) {
  printHelp()
  process.exit(0)
}

function printHelp() {
  console.log(`Usage: node scripts/design/extract-tokens.mjs [flags]

Diff DESIGN.md YAML tokens against the code-side token sources.

Flags:
  --strict              Exit 1 on any drift (default: exit 0, report-only).
  --json                Emit raw diff object as JSON.
  --include-exceptions  Include intentional-exception tokens (brand palette,
                        raw Radix scale) in the missing-in-yaml bucket.
  --baseline <path>     Compare current drift against a JSON baseline;
                        --strict fails only on new signatures or growth,
                        never on drift already recorded in the baseline.
  --help, -h            Show this message.

Report categories:
  - matched            Tokens present in both DESIGN.md and code with equal values.
  - missing-in-code    Token declared in DESIGN.md YAML but not found in code.
  - missing-in-yaml    Token declared in code but not in DESIGN.md YAML
                       (intentional-exception categories filtered by default).
  - mismatched-value   Token in both but values differ.
  - iconography-drift  Icon size= usages on lucide-react imports that do not
                       resolve to a DESIGN.md iconography.size.* token.
  - z-layer-drift      --dls-z-* CSS variables that disagree with the
                       DESIGN.md z-layers block, or z-layers tokens with no
                       matching CSS variable declared yet.
  - state-timings      setTimeout() literals in TS/TSX that fall in the
                       200..1200 ms band but do not match a DESIGN.md
                       state-timings.* token.
  - notifications      toast.<severity>() call sites whose duration prop
                       diverges from the DESIGN.md notifications.* budget.
  - kbd                <kbd> render sites missing the § 5a chip anatomy
                       (border + text-xs).

DESIGN.md is authoritative. When drift is reported, default remediation is to
fix code, unless the contract itself is demonstrably outdated.`)
}

// ---------- YAML front-matter parser (scoped to DESIGN.md shape) ----------

function readFrontMatter(path) {
  const raw = readFileSync(path, 'utf8')
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) {
    throw new Error(`No YAML front matter found at ${path}`)
  }
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

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }
    const parent = stack[stack.length - 1].obj

    const listMatch = line.match(/^-\s+(.+)$/)
    if (listMatch) {
      const lastKey = getLastKey(parent)
      if (lastKey === null) continue
      if (!Array.isArray(parent[lastKey])) parent[lastKey] = []
      parent[lastKey].push(coerceScalar(listMatch[1]))
      continue
    }

    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    const key = kv[1]
    const rawValue = kv[2]
    if (rawValue === '') {
      const child = {}
      parent[key] = child
      stack.push({ indent, obj: child })
    } else if (rawValue.startsWith('{') && rawValue.endsWith('}')) {
      parent[key] = parseInlineMap(rawValue)
    } else {
      parent[key] = coerceScalar(rawValue)
    }
  }
  return root
}

function getLastKey(obj) {
  const keys = Object.keys(obj)
  return keys.length ? keys[keys.length - 1] : null
}

function coerceScalar(v) {
  const s = v.trim()
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1)
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+$/.test(s)) return Number(s)
  return s
}

function parseInlineMap(s) {
  const inner = s.slice(1, -1).trim()
  const out = {}
  for (const pair of splitInlineList(inner)) {
    const [k, ...rest] = pair.split(':')
    out[k.trim()] = coerceScalar(rest.join(':').trim())
  }
  return out
}

function splitInlineList(s) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of s) {
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      if (ch === '(' || ch === '[' || ch === '{') depth++
      if (ch === ')' || ch === ']' || ch === '}') depth--
      current += ch
    }
  }
  if (current.trim()) parts.push(current)
  return parts
}

// ---------- CSS custom-property parser ----------

function parseCssTokens(path) {
  const raw = readFileSync(path, 'utf8')
  const blocks = extractRuleBlocks(raw)
  const light = new Map()
  const dark = new Map()

  for (const block of blocks) {
    const target = classifyBlock(block.selector)
    if (target === null) continue
    const decls = extractDeclarations(block.body)
    const bucket = target === 'light' ? light : dark
    for (const [name, value] of decls) {
      if (!name.startsWith('--dls-') && !name.startsWith('--ow-')) continue
      bucket.set(name, value)
    }
  }
  // dark inherits from light for any variable it does not redeclare — the
  // CSS cascade already does this at runtime, so the diff should too.
  const darkResolved = new Map(light)
  for (const [name, value] of dark) darkResolved.set(name, value)

  return {
    light: resolveVars(light, light),
    dark: resolveVars(darkResolved, darkResolved),
  }
}

function resolveVars(scope, source) {
  const out = new Map()
  for (const [name, rawValue] of scope) {
    out.set(name, resolveVarValue(rawValue, source, new Set([name])))
  }
  return out
}

function resolveVarValue(value, source, seen) {
  const m = String(value).match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.*))?\)$/)
  if (!m) return value
  const ref = m[1]
  const fallback = m[2]
  if (seen.has(ref)) return value
  if (source.has(ref)) {
    return resolveVarValue(source.get(ref), source, new Set([...seen, ref]))
  }
  if (fallback) return fallback.trim()
  return value
}

function extractRuleBlocks(css) {
  const blocks = []
  let i = 0
  while (i < css.length) {
    const openIdx = css.indexOf('{', i)
    if (openIdx === -1) break
    const selector = css.slice(i, openIdx).trim()
    let depth = 1
    let j = openIdx + 1
    while (j < css.length && depth > 0) {
      const ch = css[j]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      j++
    }
    const body = css.slice(openIdx + 1, j - 1)
    blocks.push({ selector, body })
    i = j
  }
  return blocks
}

function classifyBlock(selector) {
  const clean = selector.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  if (!clean) return null
  if (/^:root(\s|$|,)/.test(clean) || /^\[data-theme="light"\]/.test(clean)) return 'light'
  if (
    /\.dark(\s|$|,)/.test(clean) ||
    /\[data-theme="dark"\]/.test(clean) ||
    /html\.dark/.test(clean) ||
    /prefers-color-scheme:\s*dark/.test(clean)
  ) return 'dark'
  return null
}

function extractDeclarations(body) {
  const out = []
  const cleaned = body.replace(/\/\*[\s\S]*?\*\//g, '')
  const decls = cleaned.split(';')
  for (const decl of decls) {
    const idx = decl.indexOf(':')
    if (idx === -1) continue
    const name = decl.slice(0, idx).trim()
    const value = decl.slice(idx + 1).trim()
    if (!name.startsWith('--')) continue
    out.push([name, value])
  }
  return out
}

// ---------- Tailwind config token extraction (regex, no TS eval) ----------

function parseTailwindTokens(path) {
  const raw = readFileSync(path, 'utf8')
  return {
    fontSize: extractRecord(raw, 'fontSize'),
    borderRadius: extractRecord(raw, 'borderRadius'),
  }
}

function extractRecord(source, key) {
  const rx = new RegExp(`${key}:\\s*{([^}]*)}`)
  const match = source.match(rx)
  if (!match) return {}
  const body = match[1]
  const out = {}
  const pairRe = /['"]?([\w-]+)['"]?\s*:\s*(?:['"]([^'"]+)['"]|(\d+))/g
  let m
  while ((m = pairRe.exec(body)) !== null) {
    out[m[1]] = m[2] ?? m[3]
  }
  return out
}

// ---------- Diff engine ----------

const INTENTIONAL_EXCEPTIONS = [
  /^--dls-brand-/,
  /^--dls-chat-/,
  /^--dls-status-/,
  /^--dls-scrollbar-/,
  /^--dls-online$/,
  /^--dls-hover$/,
  /^--dls-active$/,
  /^--dls-list-selected$/,
  /^--dls-shell-shadow$/,
  /^--dls-card-shadow$/,
  /^--dls-shell-dark$/,
  /^--dls-icon-/,
  /^--dls-decision-/,
  /^--dls-canvas$/,
  /^--dls-sidebar$/,
  /^--dls-leading-/,
  /^--dls-font-/,
  /^--ow-primary-rgb$/,
  /^--ow-primary-light$/,
  // Typography and radii are diffed in dedicated report categories.
  /^--dls-text-/,
  /^--dls-radius-/,
  // Aliases that resolve to a diffed token — filter to avoid dupe.
  /^--dls-accent(-hover|-rgb)?$/,
  /^--dls-signal$/,
  /^--dls-text-primary$/,
  /^--dls-text-secondary$/,
]

function isException(cssName) {
  return INTENTIONAL_EXCEPTIONS.some((rx) => rx.test(cssName))
}

function normalizeHex(v) {
  if (typeof v !== 'string') return v
  const m = v.trim().match(/^#([0-9a-fA-F]{3,6})$/)
  if (!m) return v.trim()
  const h = m[1].toUpperCase()
  return `#${h.length === 3 ? h.split('').map((c) => c + c).join('') : h}`
}

function flattenColors(colors) {
  const out = { light: {}, dark: {} }
  for (const theme of ['light', 'dark']) {
    const bucket = colors[theme] || {}
    for (const [k, v] of Object.entries(bucket)) {
      out[theme][`--dls-${k}`] = normalizeHex(v)
    }
  }
  return out
}

function pickCssValue(cssMap, candidateNames) {
  for (const name of candidateNames) {
    if (cssMap.has(name)) return { name, value: normalizeHex(cssMap.get(name)) }
  }
  return null
}

// Map DESIGN.md color-key to candidate CSS variable names in code.
const COLOR_NAME_ALIASES = {
  primary: ['--ow-primary', '--dls-accent', '--dls-decision-bg'],
  'primary-hover': ['--ow-primary-hover', '--dls-accent-hover', '--dls-decision-hover'],
  'primary-soft': ['--ow-primary-light', '--dls-decision-soft'],
  signal: ['--ow-signal', '--dls-signal'],
  ink: ['--ow-ink', '--dls-text-primary'],
  slate: ['--ow-slate', '--dls-text-secondary'],
  mist: ['--ow-mist', '--dls-border'],
  surface: ['--dls-surface'],
  'surface-muted': ['--dls-surface-muted'],
  background: ['--dls-background'],
  'app-bg': ['--dls-app-bg'],
  sidebar: ['--dls-sidebar'],
  'rail-bg': ['--dls-rail-bg'],
  'rail-active': ['--dls-rail-active'],
  'rail-hover': ['--dls-rail-hover'],
  border: ['--dls-border'],
  'border-strong': ['--dls-border-strong'],
  hover: ['--dls-hover'],
  active: ['--dls-active'],
  danger: ['--dls-status-danger'],
  warning: ['--dls-status-warning'],
  'success-fg': ['--dls-status-success-fg'],
  online: ['--dls-online'],
}

function diffColors(yaml, css) {
  const report = { matched: [], missingInCode: [], mismatched: [], missingInYaml: [] }
  const yamlColors = flattenColors(yaml.colors || {})

  for (const theme of ['light', 'dark']) {
    for (const [yamlKey, expectedRaw] of Object.entries(yaml.colors?.[theme] || {})) {
      const expected = normalizeHex(expectedRaw)
      const candidates = COLOR_NAME_ALIASES[yamlKey] || [`--dls-${yamlKey}`]
      const hit = pickCssValue(css[theme], candidates)
      if (!hit) {
        report.missingInCode.push({ theme, yamlKey, expected, tried: candidates })
        continue
      }
      if (hit.value === expected) {
        report.matched.push({ theme, yamlKey, cssName: hit.name, value: expected })
      } else {
        report.mismatched.push({
          theme,
          yamlKey,
          cssName: hit.name,
          expected,
          actual: hit.value,
        })
      }
    }
  }

  // missing-in-yaml
  const claimed = new Set()
  for (const list of [...report.matched, ...report.mismatched]) claimed.add(`${list.theme}:${list.cssName}`)
  for (const theme of ['light', 'dark']) {
    for (const name of css[theme].keys()) {
      if (claimed.has(`${theme}:${name}`)) continue
      if (!flags.includeExceptions && isException(name)) continue
      report.missingInYaml.push({ theme, cssName: name, value: css[theme].get(name) })
    }
  }
  return report
}

function diffTypography(yaml, css) {
  const report = { matched: [], missingInCode: [], mismatched: [] }
  const scale = yaml.typography?.scale || {}
  for (const [key, expected] of Object.entries(scale)) {
    const cssName = `--dls-text-${key}`
    const hit = css.light.get(cssName)
    if (hit === undefined) {
      report.missingInCode.push({ key, cssName, expected })
      continue
    }
    const asPx = String(hit).replace('px', '')
    if (Number(asPx) === Number(expected)) {
      report.matched.push({ key, cssName, value: expected })
    } else {
      report.mismatched.push({ key, cssName, expected, actual: hit })
    }
  }
  return report
}

function diffRadii(yaml, css) {
  const report = { matched: [], missingInCode: [], mismatched: [] }
  const scale = yaml.rounded || {}
  for (const [key, expected] of Object.entries(scale)) {
    const cssName = `--dls-radius-${key}`
    const hit = css.light.get(cssName)
    if (hit === undefined) {
      report.missingInCode.push({ key, cssName, expected })
      continue
    }
    const asPx = String(hit).replace('px', '')
    if (Number(asPx) === Number(expected)) {
      report.matched.push({ key, cssName, value: expected })
    } else {
      report.mismatched.push({ key, cssName, expected, actual: hit })
    }
  }
  return report
}

function diffIconography(yaml, iconScan) {
  const report = { matched: [], unknownSize: [], forbiddenLibrary: [] }
  const iconYaml = yaml.iconography
  if (!iconYaml || !iconYaml.size) return report
  const allowed = new Set(
    Object.values(iconYaml.size).map((v) => String(v).replace('px', '')),
  )
  const forbidden = new Set(
    Array.isArray(iconYaml.forbidden) ? iconYaml.forbidden : [],
  )
  for (const hit of iconScan.iconSizes) {
    if (!allowed.has(String(hit.size))) {
      report.unknownSize.push(hit)
    } else {
      report.matched.push(hit)
    }
  }
  for (const lib of iconScan.libraries) {
    if (forbidden.has(lib.name)) {
      report.forbiddenLibrary.push(lib)
    }
  }
  return report
}

function scanIconUsage(rootDir) {
  const result = { iconSizes: [], libraries: [] }
  if (!existsSync(rootDir)) return result
  const forbiddenLibs = ['@heroicons/react', 'phosphor-icons', '@radix-ui/react-icons']
  const stack = [rootDir]
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
      if (st.isDirectory()) {
        stack.push(full)
      } else if (/\.tsx?$/.test(name)) {
        let src
        try {
          src = readFileSync(full, 'utf8')
        } catch {
          continue
        }
        const rel = full.slice(rootDir.length + 1)
        // Track imports from known icon libraries.
        const importMatch = src.match(/from ['"]lucide-react['"]/)
        if (importMatch) {
          // Scan size={N} and size="N" occurrences in the same file.
          const sizeRegex = /\bsize=(?:\{(\d+)\}|['"](\d+)['"])/g
          let m
          while ((m = sizeRegex.exec(src))) {
            const val = m[1] || m[2]
            result.iconSizes.push({ file: rel, size: Number(val) })
          }
        }
        for (const lib of forbiddenLibs) {
          if (src.includes(`from '${lib}'`) || src.includes(`from "${lib}"`)) {
            result.libraries.push({ file: rel, name: lib })
          }
        }
      }
    }
  }
  return result
}

function diffZLayers(yaml, css) {
  const report = { matched: [], missingInCode: [], mismatched: [] }
  const zYaml = yaml['z-layers']
  if (!zYaml) return report
  for (const [key, expected] of Object.entries(zYaml)) {
    const cssName = `--dls-z-${key}`
    const scope = css.light || css.root || {}
    const hit = resolveVarValue(scope[cssName], scope) ?? (css.dark && css.dark[cssName])
    if (hit === undefined || hit === null) {
      report.missingInCode.push({ key, cssName, expected })
      continue
    }
    if (String(hit).trim() === String(expected).trim()) {
      report.matched.push({ key, cssName, value: expected })
    } else {
      report.mismatched.push({ key, cssName, expected, actual: hit })
    }
  }
  return report
}


// ---------- v4 extractors: state-timings, notifications, kbd ----------

/**
 * Scan for suspicious literal timings in TS/TSX under APP_SRC.
 * Reports numeric literals in `setTimeout(..., N)` and
 * `new Promise(r => setTimeout(r, N))` calls where N is inside the
 * plausible UX-timing band (150..1200) but not one of the tokenized
 * DESIGN.md `state-timings.*` values. Report-only.
 */
function scanStateTimings(rootDir) {
  const result = { candidates: [] }
  if (!existsSync(rootDir)) return result
  const stack = [rootDir]
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
      if (st.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!/\.tsx?$/.test(name)) continue
      let src
      try {
        src = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      const rel = full.slice(rootDir.length + 1)
      const re = /setTimeout\s*\([^,]+,\s*(\d+)\s*\)/g
      let m
      while ((m = re.exec(src))) {
        result.candidates.push({ file: rel, ms: Number(m[1]) })
      }
    }
  }
  return result
}

function diffStateTimings(yaml, scan) {
  const report = { matched: [], unknown: [] }
  const y = yaml['state-timings']
  if (!y) return report
  const allowed = new Set(
    Object.values(y)
      .filter((v) => typeof v === 'number')
      .map((v) => Number(v)),
  )
  for (const hit of scan.candidates) {
    if (hit.ms < 150 || hit.ms > 1200) continue
    if (allowed.has(hit.ms)) {
      report.matched.push(hit)
    } else {
      report.unknown.push(hit)
    }
  }
  return report
}

/**
 * Scan for direct sonner / toast() call sites and check whether they
 * carry a `duration:` prop matching the DESIGN.md `notifications.*`
 * durations. Report-only.
 */
function scanNotifications(rootDir) {
  const result = { candidates: [] }
  if (!existsSync(rootDir)) return result
  const stack = [rootDir]
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
      if (st.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!/\.tsx?$/.test(name)) continue
      let src
      try {
        src = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      const rel = full.slice(rootDir.length + 1)
      const callRe = /\btoast\.(info|success|warning|error)\s*\(([\s\S]{0,400}?)\)/g
      let m
      while ((m = callRe.exec(src))) {
        const severity = m[1]
        const argBlob = m[2]
        const durMatch = argBlob.match(/duration\s*:\s*(\d+)/)
        result.candidates.push({
          file: rel,
          severity,
          duration: durMatch ? Number(durMatch[1]) : null,
        })
      }
    }
  }
  return result
}

function diffNotifications(yaml, scan) {
  const report = { matched: [], mismatched: [] }
  const y = yaml.notifications
  if (!y) return report
  const map = {
    info: y['duration-info-ms'],
    success: y['duration-success-ms'],
    warning: y['duration-warn-ms'],
    error: y['duration-error'],
  }
  for (const hit of scan.candidates) {
    const expected = map[hit.severity]
    if (hit.duration === null) {
      if (expected === 'persistent' || typeof expected !== 'number') {
        report.matched.push({ ...hit, expected })
      } else {
        report.mismatched.push({ ...hit, expected })
      }
      continue
    }
    if (typeof expected === 'number' && hit.duration === expected) {
      report.matched.push({ ...hit, expected })
    } else {
      report.mismatched.push({ ...hit, expected })
    }
  }
  return report
}

/**
 * Scan for keyboard shortcut display sites and confirm they route
 * through a chip anatomy. Report-only.
 *
 * Heuristic: <kbd> elements or Tailwind class strings containing
 * `kbd` that are missing the documented chip classes (border + text-xs).
 */
function scanKbd(rootDir) {
  const result = { candidates: [] }
  if (!existsSync(rootDir)) return result
  const stack = [rootDir]
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
      if (st.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!/\.tsx?$/.test(name)) continue
      let src
      try {
        src = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      const rel = full.slice(rootDir.length + 1)
      const re = /<kbd\b([^>]{0,200})>/g
      let m
      while ((m = re.exec(src))) {
        const attrs = m[1] || ''
        const clsMatch = attrs.match(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/)
        const classes = clsMatch ? clsMatch[1] || clsMatch[2] || clsMatch[3] : ''
        result.candidates.push({ file: rel, classes })
      }
    }
  }
  return result
}

function diffKbd(scan) {
  const report = { matched: [], drift: [] }
  for (const hit of scan.candidates) {
    const cls = hit.classes || ''
    const hasBorder = /\bborder(-|\b)/.test(cls)
    const hasSize = /\btext-xs\b/.test(cls)
    if (hasBorder && hasSize) {
      report.matched.push(hit)
    } else {
      report.drift.push(hit)
    }
  }
  return report
}

// ---------- baseline support ----------

function loadBaseline(pathArg) {
  if (!pathArg) return null
  const absPath = pathArg.startsWith('/') ? pathArg : join(repoRoot, pathArg)
  if (!existsSync(absPath)) {
    throw new Error(`baseline file not found: ${pathArg}`)
  }
  try {
    return JSON.parse(readFileSync(absPath, 'utf8'))
  } catch (err) {
    throw new Error(`baseline JSON parse error at ${pathArg}: ${err.message}`)
  }
}

/**
 * Compare current drift signatures against baseline. Returns
 * { newSignatures, growth } where each entry describes a regression
 * that should fail --strict runs.
 */
function enforceBaseline(baseline, report) {
  const violations = { newSignatures: [], growth: [] }
  if (!baseline) return violations

  const buckets = {
    iconography: (report.iconography?.unknownSize || []).map(
      (h) => `${h.file}:size=${h.size}`,
    ),
    zLayers: (report.zLayers?.missingInCode || []).map((h) => `${h.key}`),
    stateTimings: (report.stateTimings?.unknown || []).map(
      (h) => `${h.file}:ms=${h.ms}`,
    ),
    notifications: (report.notifications?.mismatched || []).map(
      (h) => `${h.file}:${h.severity}:${h.duration ?? 'null'}`,
    ),
    kbd: (report.kbd?.drift || []).map((h) => `${h.file}:${h.classes || ''}`),
  }

  for (const [name, current] of Object.entries(buckets)) {
    const b = baseline[name]
    if (!b) {
      if (current.length > 0) {
        for (const sig of current) {
          violations.newSignatures.push({ bucket: name, signature: sig })
        }
      }
      continue
    }
    const allowed = new Set(b.signatures || [])
    const seen = new Map()
    for (const sig of current) {
      seen.set(sig, (seen.get(sig) || 0) + 1)
    }
    for (const [sig, count] of seen.entries()) {
      const allowedCount = allowed.has(sig) ? Number.MAX_SAFE_INTEGER : 0
      if (allowedCount === 0) {
        violations.newSignatures.push({ bucket: name, signature: sig })
      } else if (count > (b.count ?? Number.MAX_SAFE_INTEGER)) {
        violations.growth.push({ bucket: name, signature: sig, count })
      }
    }
    if (
      typeof b.count === 'number' &&
      current.length > b.count
    ) {
      violations.growth.push({
        bucket: name,
        signature: '__total__',
        count: current.length,
        allowed: b.count,
      })
    }
  }
  return violations
}
// ---------- Renderer ----------

function renderReport(report) {
  const lines = []
  const total = report.colors.matched.length + report.typography.matched.length + report.radii.matched.length + (report.iconography?.matched.length || 0) + (report.zLayers?.matched.length || 0)
  lines.push(`Design token drift report — DESIGN.md ↔ code`)
  lines.push('')
  lines.push(`✓ ${total} tokens matched (${report.colors.matched.length} colors, ${report.typography.matched.length} typography, ${report.radii.matched.length} radii, ${report.iconography?.matched.length || 0} iconography, ${report.zLayers?.matched.length || 0} z-layers, ${report.stateTimings?.matched.length || 0} state-timings, ${report.notifications?.matched.length || 0} notifications, ${report.kbd?.matched.length || 0} kbd)`)

  emit('missing in code', report.colors.missingInCode.map((x) => `[${x.theme}] ${x.yamlKey} (expected ${x.expected}) — tried: ${x.tried.join(', ')}`))
  emit('mismatched color values', report.colors.mismatched.map((x) => `[${x.theme}] ${x.yamlKey} via ${x.cssName}: DESIGN.md says ${x.expected}, code has ${x.actual}`))
  emit('missing in DESIGN.md YAML (colors)', report.colors.missingInYaml.map((x) => `[${x.theme}] ${x.cssName} = ${x.value}`))
  emit('typography missing in code', report.typography.missingInCode.map((x) => `text-${x.key} (expected ${x.expected}px)`))
  emit('typography mismatched', report.typography.mismatched.map((x) => `text-${x.key}: DESIGN.md ${x.expected}px, tailwind ${x.actual}`))
  emit('radii missing in code', report.radii.missingInCode.map((x) => `rounded-${x.key} (expected ${x.expected}px)`))
  emit('radii mismatched', report.radii.mismatched.map((x) => `rounded-${x.key}: DESIGN.md ${x.expected}px, tailwind ${x.actual}`))
  emit('iconography — unknown icon size', (report.iconography?.unknownSize || []).map((x) => `${x.file}: size=${x.size} does not match any iconography.size.* token`))
  emit('iconography — forbidden library import', (report.iconography?.forbiddenLibrary || []).map((x) => `${x.file}: imports forbidden icon library ${x.name}`))
  emit('z-layers missing in code (declare --dls-z-* in apps/app/src/app/index.css)', (report.zLayers?.missingInCode || []).map((x) => `${x.key} (expected ${x.expected}) — CSS var ${x.cssName} not found`))
  emit('z-layers mismatched', (report.zLayers?.mismatched || []).map((x) => `${x.key} via ${x.cssName}: DESIGN.md ${x.expected}, code ${x.actual}`))
  emit('state-timings — literal not in tokenized set', (report.stateTimings?.unknown || []).map((x) => `${x.file}: setTimeout(..., ${x.ms}) — not in state-timings.*`))
  emit('notifications — duration mismatched', (report.notifications?.mismatched || []).map((x) => `${x.file}: toast.${x.severity}(duration=${x.duration}) — expected ${x.expected}`))
  emit('kbd — chip missing border+text-xs anatomy', (report.kbd?.drift || []).map((x) => `${x.file}: <kbd className="${x.classes || ''}">`))

  lines.push('')
  lines.push(`DESIGN.md is authoritative. Fix code to match, unless the contract itself is outdated.`)
  return lines.join('\n')

  function emit(label, items) {
    if (items.length === 0) return
    lines.push('')
    lines.push(`⚠ ${label} (${items.length}):`)
    for (const item of items) lines.push(`  - ${item}`)
  }
}

function totalDrift(report) {
  return (
    report.colors.missingInCode.length +
    report.colors.mismatched.length +
    report.colors.missingInYaml.length +
    report.typography.missingInCode.length +
    report.typography.mismatched.length +
    report.radii.missingInCode.length +
    report.radii.mismatched.length +
    (report.iconography?.unknownSize.length || 0) +
    (report.iconography?.forbiddenLibrary.length || 0) +
    (report.zLayers?.missingInCode.length || 0) +
    (report.zLayers?.mismatched.length || 0) +
    (report.stateTimings?.unknown.length || 0) +
    (report.notifications?.mismatched.length || 0) +
    (report.kbd?.drift.length || 0)
  )
}

function renderBaselineViolations(violations, baselinePath) {
  const total = violations.newSignatures.length + violations.growth.length
  if (total === 0) {
    console.log('')
    console.log(`Baseline OK — no regressions vs ${baselinePath}.`)
    return
  }
  console.log('')
  console.log(`Baseline violations vs ${baselinePath} (${total}):`)
  for (const v of violations.newSignatures) {
    console.log(`  + [new]     ${v.bucket}: ${v.signature}`)
  }
  for (const v of violations.growth) {
    const suffix =
      typeof v.allowed === 'number' ? ` (${v.count} > ${v.allowed})` : ''
    console.log(`  + [growth]  ${v.bucket}: ${v.signature}${suffix}`)
  }
}

// ---------- main ----------

try {
  const yaml = parseFrontMatter(readFrontMatter(DESIGN_MD))
  const css = parseCssTokens(APP_INDEX_CSS)
  // tailwind config currently aliases through CSS vars, so the CSS is the
  // authoritative code-side source. parseTailwindTokens() is retained as a
  // helper for future use.

  const iconScan = scanIconUsage(APP_SRC)
  const stateTimingsScan = scanStateTimings(APP_SRC)
  const notificationsScan = scanNotifications(APP_SRC)
  const kbdScan = scanKbd(APP_SRC)
  const report = {
    colors: diffColors(yaml, css),
    typography: diffTypography(yaml, css),
    radii: diffRadii(yaml, css),
    iconography: diffIconography(yaml, iconScan),
    zLayers: diffZLayers(yaml, css),
    stateTimings: diffStateTimings(yaml, stateTimingsScan),
    notifications: diffNotifications(yaml, notificationsScan),
    kbd: diffKbd(kbdScan),
  }

  const baseline = loadBaseline(flags.baseline)
  const violations = enforceBaseline(baseline, report)

  if (flags.json) {
    console.log(JSON.stringify({ report, baseline: { path: flags.baseline, violations } }, null, 2))
  } else {
    console.log(renderReport(report))
    if (baseline) {
      renderBaselineViolations(violations, flags.baseline)
    }
  }

  const drift = totalDrift(report)
  if (flags.strict) {
    if (baseline) {
      const failCount = violations.newSignatures.length + violations.growth.length
      if (failCount > 0) {
        if (!flags.json) console.log(`\nStrict mode with baseline: exiting 1 (${failCount} baseline violations).`)
        process.exit(1)
      }
    } else if (drift > 0) {
      if (!flags.json) console.log(`\nStrict mode: exiting 1 (${drift} drift entries).`)
      process.exit(1)
    }
  }
  process.exit(0)
} catch (err) {
  console.error(`extract-tokens failed: ${err.message}`)
  if (process.env.DEBUG) console.error(err.stack)
  process.exit(2)
}
