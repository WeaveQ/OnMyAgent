#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
APP_DIR="$ROOT/apps/app/src/react-app"
UI_DIR="$ROOT/apps/app/src/components"

count() {
  local pattern="$1"
  shift
  rg -n "$pattern" "$@" -g '*.tsx' -g '*.ts' --no-heading 2>/dev/null | wc -l | tr -d ' '
}

print_count() {
  local label="$1"
  local pattern="$2"
  printf '%s: %s\n' "$label" "$(count "$pattern" "$APP_DIR" "$UI_DIR")"
}

printf '%s\n' '--- UI primitive scan ---'
print_count 'raw button classes' '<button[^>]*className=\{?"[^"]*(rounded|px-|py-|h-|w-)'
print_count 'raw input classes' '<input[^>]*className=\{?"[^"]*(rounded|border|px-|py-|h-)'
print_count 'raw badge-like elements' '<(span|div)[^>]*className=\{?"[^"]*(rounded-full|rounded-md)[^"]*(px-|size-|text-xs)'
print_count 'raw spinner rings' 'animate-spin.*rounded-full|rounded-full.*animate-spin'
print_count 'raw ping indicators' 'animate-ping'
print_count 'arbitrary text px' 'text-\[[0-9]+px\]'
print_count 'raw Tailwind palette hits' '\b(bg|text|border|ring|from|via|to)-(slate|gray|zinc|neutral|stone|blue|red|green|amber)-'

printf '\n%s\n' '--- raw badge-like details ---'
rg -n '<(span|div)[^>]*className=\{?"[^"]*(rounded-full|rounded-md)[^"]*(px-|size-|text-xs)' "$APP_DIR" "$UI_DIR" -g '*.tsx' --no-heading 2>/dev/null || true

printf '\n%s\n' '--- motion primitive details ---'
rg -n 'animate-spin.*rounded-full|rounded-full.*animate-spin|animate-ping' "$APP_DIR" "$UI_DIR" -g '*.tsx' --no-heading 2>/dev/null || true
