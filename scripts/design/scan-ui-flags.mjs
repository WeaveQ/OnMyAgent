#!/usr/bin/env node
/**
 * UI flag scanners for DESIGN.md YAML `flags`.
 * Shrink-only vs scripts/checks/baselines/design-drift.json.
 *
 * §11 allowlists (do not flag):
 *   - SendButton, architecture-mismatch-gate rounded-full
 *   - avatars / status dots / radios / spinners / progress tracks
 *   - nested fields that strip their own ring because a parent owns focus-within
 *   - brand / artifact / avatar-swatch hex registries
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const APP_SRC = 'apps/app/src'

const HEX_ALLOW_FILES = new Set([
  'react-app/capabilities/account-avatar/account-avatar-prefs.ts',
  'react-app/domains/plugins/artifact-plugin-detail.tsx',
  'react-app/design-system/extension-card.tsx',
  'react-app/domains/local-agents/agent-management/agent-management-skill-model.ts',
])

const PILL_CTA_ALLOW_FILES = new Set([
  'components/ui/send-button.tsx',
  'react-app/shell/architecture-mismatch-gate.tsx',
])

const RING_ZERO_ALLOW_FILES = new Set([
  'components/ui/input-group.tsx',
  'components/ui/command.tsx',
  'react-app/domains/session/surface/composer/editor.tsx',
  'react-app/domains/local-agents/local-agent-draft-composer.tsx',
  'react-app/domains/session/surface/chrome/session-draft-workspace-accessory.tsx',
  'react-app/domains/agents/expert-creation-basic-tab.tsx',
  'react-app/domains/settings/pages/awareness-file-viewer-modal.tsx',
  'react-app/domains/messaging/automation-page-dialogs.tsx',
  'react-app/domains/local-agents/workspace-picker/workspace-footnote.tsx',
])

const SHADOW_ALLOW_RE =
  /\bshadow-none\b|session-workbuddy-scroll-to-bottom/

function iterFiles(rootDir, filter) {
  const out = []
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
      if (st.isDirectory()) stack.push(full)
      else if (filter(name, full)) out.push(full)
    }
  }
  return out
}

function relSrc(repoRoot, full) {
  return relative(join(repoRoot, APP_SRC), full).replaceAll('\\', '/')
}

function scanUiFlags(repoRoot) {
  const srcRoot = join(repoRoot, APP_SRC)
  const files = iterFiles(srcRoot, (name) => /\.(tsx|ts)$/.test(name))
  const hex = []
  const shadows = []
  const pillCtas = []
  const ringZero = []

  const hexClassRe = /className\s*=\s*(?:\{)?[`'"]([^`'"]*#[0-9A-Fa-f]{3,8}[^`'"]*)[`'"]/g
  const shadowRe = /(?:^|[\s"'`])(shadow-(?:sm|md|lg|xl|2xl|inner)(?:\/\d+)?)(?=[\s"'`]|$)/g
  const pillSizeRe = /size=["']pill-xs["']/g
  const buttonPillRe = /<Button\b[^>]*rounded-full|<Button\b[^>]*className=\{?[`'"][^`'"]*rounded-full/g
  const tallPillRe = /\b(?:h-9|h-10|size="icon-lg")\b[^"'`\n]*rounded-full|rounded-full[^"'`\n]*\b(?:h-9|h-10|size="icon-lg")\b/g
  const ringZeroRe = /focus-visible:ring-0/g

  for (const full of files) {
    const rel = relSrc(repoRoot, full)
    let src
    try {
      src = readFileSync(full, 'utf8')
    } catch {
      continue
    }

    if (!HEX_ALLOW_FILES.has(rel)) {
      hexClassRe.lastIndex = 0
      let m
      while ((m = hexClassRe.exec(src))) {
        hex.push({ file: rel, snippet: m[1].slice(0, 80) })
      }
    }

    shadowRe.lastIndex = 0
    let sm
    while ((sm = shadowRe.exec(src))) {
      const around = src.slice(Math.max(0, sm.index - 24), sm.index + sm[0].length + 8)
      if (SHADOW_ALLOW_RE.test(around)) continue
      shadows.push({ file: rel, snippet: sm[1] })
    }

    if (!PILL_CTA_ALLOW_FILES.has(rel)) {
      pillSizeRe.lastIndex = 0
      if (pillSizeRe.test(src)) {
        pillCtas.push({ file: rel, snippet: 'size="pill-xs"' })
      }
      buttonPillRe.lastIndex = 0
      if (buttonPillRe.test(src)) {
        pillCtas.push({ file: rel, snippet: 'Button rounded-full' })
      }
      tallPillRe.lastIndex = 0
      if (tallPillRe.test(src)) {
        pillCtas.push({ file: rel, snippet: 'h-9/h-10 rounded-full' })
      }
    }

    if (!RING_ZERO_ALLOW_FILES.has(rel)) {
      ringZeroRe.lastIndex = 0
      if (ringZeroRe.test(src)) {
        ringZero.push({ file: rel, snippet: 'focus-visible:ring-0' })
      }
    }
  }

  return { hex, shadows, pillCtas, ringZero }
}

export { scanUiFlags }
