#!/usr/bin/env node
// PreToolUse Bash hook: block git commit / gh pr create|edit if message contains CJK.
import { readFileSync } from 'node:fs'

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/

let input
try {
  input = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  process.exit(0)
}
const cmd = input?.tool_input?.command
if (typeof cmd !== 'string') process.exit(0)

const targets = [
  { re: /\bgit\s+commit\b/, name: 'git commit' },
  { re: /\bgh\s+pr\s+(create|edit)\b/, name: 'gh pr create/edit' },
]
const hit = targets.find((t) => t.re.test(cmd))
if (!hit) process.exit(0)

const candidates = []
for (const m of cmd.matchAll(
  /(?:-m|--message|-t|--title|-b|--body|--body-text)[= ]\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g,
)) {
  candidates.push(m[1] ?? m[2] ?? m[3] ?? '')
}
for (const m of cmd.matchAll(/(?:-F|--file|--body-file)[= ]\s*(\S+)/g)) {
  try {
    candidates.push(readFileSync(m[1], 'utf8'))
  } catch {}
}
for (const m of cmd.matchAll(/<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1/g)) {
  candidates.push(m[2])
}
candidates.push(cmd)

const bad = candidates.find((t) => CJK.test(t))
if (!bad) process.exit(0)

const sample =
  bad.match(/.{0,40}[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af].{0,40}/)?.[0] ??
  bad.slice(0, 80)

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `English-only policy: ${hit.name} contains CJK characters. Rewrite the message in English and retry.\nSample: ${sample}`,
    },
  }),
)
process.exit(0)
