#!/usr/bin/env node
/**
 * Dual-runtime process boundary gate (architecture P2).
 *
 * Enforces the Dual Runtime Boundary hard rules that can be checked statically:
 * 1. Renderer / app UI source must not import personal-agent-runtime internals
 *    (must go through desktop IPC only).
 * 2. Renderer must not speak Grok/ACP native protocols directly.
 * 3. Primary runtime services must not reuse Personal runtime kernel/store.
 * 4. Personal runtime must not write primary binding/archive stores.
 * 5. server must not import personal-agent-runtime.
 * 6. No production file may import both session-archive and conversation-store.
 * 7. Legacy pre-rename desktop IPC channel must not return.
 *
 * Usage:
 *   node scripts/checks/check-dual-runtime-boundary.mjs
 *   CIRCULAR_DEPS_ROOT=/path/to/fixture node ...   (tests override repo root)
 */

import { existsSync, readdirSync, readFileSync, lstatSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = process.env.DUAL_RUNTIME_ROOT
  ? process.env.DUAL_RUNTIME_ROOT
  : process.env.CIRCULAR_DEPS_ROOT
    ? process.env.CIRCULAR_DEPS_ROOT
    : dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs"]);
const ignoredDirs = new Set([
  ".git",
  ".turbo",
  "dist",
  "build",
  "out",
  "node_modules",
  "graphify-out",
  "coverage",
]);

/** @type {{ id: string, roots: string[], forbiddenImport: RegExp, message: string }[]} */
const rules = [
  {
    id: "renderer-no-personal-runtime",
    roots: ["apps/app/src"],
    // Import of personal-agent-runtime package path or relative path into electron kernel
    forbiddenImport:
      /from\s+["'][^"']*personal-agent-runtime[^"']*["']|import\s*\(\s*["'][^"']*personal-agent-runtime[^"']*["']\s*\)|require\s*\(\s*["'][^"']*personal-agent-runtime[^"']*["']\s*\)/,
    message:
      "Renderer/app must not import personal-agent-runtime (use desktop IPC / desktop.ts only)",
  },
  {
    id: "renderer-no-native-grok-acp",
    roots: ["apps/app/src"],
    forbiddenImport:
      /from\s+["'][^"']*(?:grok-acp|grok-runtime-adapter|grok-process-supervisor)[^"']*["']|import\s*\(\s*["'][^"']*(?:grok-acp|grok-runtime-adapter|grok-process-supervisor)[^"']*["']\s*\)/,
    message:
      "Renderer/app must consume the canonical server runtime API, never Grok/ACP native transports",
  },
  {
    id: "primary-no-personal-kernel",
    roots: [
      "apps/server/src/services/primary-runtime-composition.ts",
      "apps/server/src/services/grok-runtime-adapter.ts",
      "apps/server/src/services/grok-acp-transport.ts",
      "apps/server/src/services/grok-extension-client.ts",
      "apps/server/src/services/grok-extension-registry.ts",
      "apps/server/src/services/grok-process-supervisor.ts",
      "apps/server/src/services/grok-permission-bridge.ts",
      "apps/server/src/services/grok-event-normalizer.ts",
      "apps/server/src/services/grok-expert-profile-compiler.ts",
      "apps/server/src/services/grok-expert-profile-guard.ts",
      "apps/server/src/services/grok-attachment-staging.ts",
      "apps/server/src/services/grok-native-mcp-inventory.ts",
    ],
    forbiddenImport:
      /from\s+["'][^"']*personal-agent-runtime[^"']*["']|import\s*\(\s*["'][^"']*personal-agent-runtime[^"']*["']\s*\)|require\s*\(\s*["'][^"']*personal-agent-runtime[^"']*["']\s*\)/,
    message:
      "Primary runtime must own its registry/transport/store and cannot reuse the Personal runtime kernel",
  },
  {
    id: "personal-no-primary-store",
    roots: ["apps/desktop/electron/personal-agent-runtime"],
    forbiddenImport:
      /from\s+["'][^"']*(?:session-archive|runtime-session-bindings|primary-runtime)[^"']*["']|import\s*\(\s*["'][^"']*(?:session-archive|runtime-session-bindings|primary-runtime)[^"']*["']\s*\)|require\s*\(\s*["'][^"']*(?:session-archive|runtime-session-bindings|primary-runtime)[^"']*["']\s*\)/,
    message:
      "Personal runtime must not import primary session binding/archive stores (no cross-runtime writes)",
  },
  {
    id: "server-no-personal-runtime",
    roots: ["apps/server/src"],
    forbiddenImport:
      /from\s+["'][^"']*personal-agent-runtime[^"']*["']|import\s*\(\s*["'][^"']*personal-agent-runtime[^"']*["']\s*\)|require\s*\(\s*["'][^"']*personal-agent-runtime[^"']*["']\s*\)/,
    message:
      "Server / OpenCode archive must not import personal-agent-runtime (no second hot writer)",
  },
  {
    id: "no-legacy-desktop-ipc-channel",
    roots: ["apps/app/src", "apps/desktop/electron", "apps/desktop/preload.mjs"],
    forbiddenImport: new RegExp(`${"open"}work:desktop`),
    message:
      "Legacy pre-rename desktop IPC channel is removed; use the typed desktop command channel",
  },
];

const ARCHIVE_IMPORT =
  /from\s+["'][^"']*session-archive[^"']*["']|import\s*\(\s*["'][^"']*session-archive[^"']*["']\s*\)/;
const PERSONAL_STORE_IMPORT =
  /from\s+["'][^"']*conversation-store[^"']*["']|from\s+["'][^"']*personal-agent-runtime\/[^"']*conversation[^"']*["']/;

function collectFiles(roots) {
  const out = [];
  for (const root of roots) {
    const abs = join(repoRoot, root);
    if (!existsSync(abs)) continue;
    const st = lstatSync(abs);
    if (st.isFile()) {
      out.push(abs);
      continue;
    }
    walk(abs, out);
  }
  return out;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const p = join(dir, entry);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      walk(p, out);
      continue;
    }
    if (!st.isFile()) continue;
    if (!sourceExtensions.has(extname(p))) continue;
    // Skip tests
    const rel = relative(repoRoot, p).split(/[\\/]/).join("/");
    if (/\.(test|spec)\.[a-z]+$/.test(rel)) continue;
    if (/(^|\/)(__tests__|fixtures|__mocks__)(\/|$)/.test(rel)) continue;
    out.push(p);
  }
}

const violations = [];

for (const rule of rules) {
  for (const file of collectFiles(rule.roots)) {
    const source = readFileSync(file, "utf8");
    if (rule.forbiddenImport.test(source)) {
      violations.push({
        rule: rule.id,
        file: relative(repoRoot, file).split(/[\\/]/).join("/"),
        message: rule.message,
      });
    }
  }
}

for (const file of collectFiles([
  "apps/app/src",
  "apps/desktop/electron",
  "apps/server/src",
])) {
  const source = readFileSync(file, "utf8");
  if (ARCHIVE_IMPORT.test(source) && PERSONAL_STORE_IMPORT.test(source)) {
    violations.push({
      rule: "no-mixed-write-imports",
      file: relative(repoRoot, file).split(/[\\/]/).join("/"),
      message:
        "One file must not import both session-archive and Personal conversation-store (two hot writers)",
    });
  }
}

const XAI_LITERAL = /["'`]x\.ai\/[^"'`]+["'`]/;
const XAI_ALLOWED = new Set([
  "apps/server/src/services/grok-extension-registry.ts",
  "apps/server/src/services/grok-extension-client.ts",
]);
for (const file of collectFiles(["apps/server/src", "apps/app/src", "apps/desktop/electron"])) {
  const rel = relative(repoRoot, file).split(/[\\/]/).join("/");
  if (XAI_ALLOWED.has(rel)) continue;
  if (/(^|\/)(tests|test|fixtures)(\/|$)/.test(rel)) continue;
  const source = readFileSync(file, "utf8");
  if (XAI_LITERAL.test(source)) {
    violations.push({
      rule: "xai-literals-only-in-extension-registry",
      file: rel,
      message: "x.ai/* literals must live in grok-extension-registry/client or fixtures",
    });
  }
}

for (const file of collectFiles(["apps/server/src/services/grok-expert-profile-compiler.ts"])) {
  const source = readFileSync(file, "utf8");
  if (!/injectDefaultTools:\s*false/.test(source)) {
    violations.push({
      rule: "expert-no-default-tools",
      file: relative(repoRoot, file).split(/[\\/]/).join("/"),
      message: "Expert compiler must keep injectDefaultTools:false",
    });
  }
  if (!/toolConfig:\s*\{/.test(source)) {
    violations.push({
      rule: "expert-toolconfig-object",
      file: relative(repoRoot, file).split(/[\\/]/).join("/"),
      message: "Expert compiler must emit an object toolConfig",
    });
  }
}

if (violations.length === 0) {
  console.log(
    `Dual-runtime boundary check passed (${rules.length} rule(s), repo=${relative(process.cwd(), repoRoot) || "."}).`,
  );
  process.exit(0);
}

console.error(`\nDual-runtime boundary violations (${violations.length}):\n`);
for (const v of violations) {
  console.error(`  ✗ [${v.rule}] ${v.file}`);
  console.error(`      ${v.message}\n`);
}
console.error(
  "See docs/Architecture.md § Dual Runtime Boundary. Fix imports; do not widen the gate.",
);
process.exit(1);
