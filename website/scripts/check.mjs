import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const htmlPath = resolve('public/index.html')
const html = await readFile(htmlPath, 'utf8')

const required = [
  '<!DOCTYPE html>',
  'data-theme="dark"',
  'data-lang="en"',
  'function toggleTheme()',
  'Your free desktop entry',
  'OnMyAgent 是基于 OpenCode 的吗？',
]

const forbidden = ['—', '–', '#39FF14', '57,255,20']
const failures = []

for (const value of required) {
  if (!html.includes(value)) failures.push(`missing required content: ${value}`)
}

for (const value of forbidden) {
  if (html.includes(value)) failures.push(`forbidden content found: ${value}`)
}

if (!/<html[\s\S]*<\/html>\s*$/i.test(html)) failures.push('document does not end with closing html tag')
if (!/<script[\s\S]*toggleLang\(\)[\s\S]*<\/script>/i.test(html)) failures.push('language/theme script block not found')

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`checked ${htmlPath}`)
