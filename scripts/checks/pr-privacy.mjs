#!/usr/bin/env node
/**
 * Gate: keep signing identities, certificate fingerprints, private keys, and
 * plaintext passwords out of the public tree and PR metadata.
 *
 * Rules are shape-based (Gitleaks / GitHub secret-scanning style). This file
 * must not list any real person, Team ID, or certificate fingerprint.
 *
 * Optional extra tokens (org-specific names) may be injected via
 * PRIVACY_EXTRA_TOKENS as a comma-separated list. Do not commit that list.
 *
 * Usage:
 *   node scripts/checks/pr-privacy.mjs --scan
 *   PR_TITLE=... PR_BODY=... PR_COMMITS=... node scripts/checks/pr-privacy.mjs --scan
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const DEVELOPER_ID_IDENTITY_RE =
  /Developer ID Application:\s+[^(\n]{2,80}\(\s*[A-Z0-9]{10}\s*\)/gi;

const FINGERPRINT_RE =
  /(?:SHA-?1|SHA-?256|fingerprint)\s*[:=]?\s*`?([0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})`?/gi;

const PRIVATE_KEY_RE =
  /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S-]{64,}?KEY(?: BLOCK)?-----/gi;

const CSC_NAME_ASSIGN_RE = /CSC_NAME\s*[:=]\s*([^\n#]+)/gi;

const PASSWORD_ASSIGN_RE =
  /\b(?:password|passwd)\s*[:=]\s*["']([^"'\n]{3,})["']/gi;

const SCAN_ROOTS = [
  "docs",
  "README.md",
  "README-zh.md",
  "CHANGELOG.md",
  "BUILD.md",
  "AGENTS.md",
  "DESIGN.md",
  "SECURITY.md",
  ".github",
];

const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-electron",
  "graphify-out",
]);

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".yml",
  ".yaml",
  ".mjs",
  ".js",
  ".cjs",
  ".ts",
  ".tsx",
  ".json",
  ".txt",
]);

export function extraTokensFromEnv(raw = process.env.PRIVACY_EXTRA_TOKENS) {
  return String(raw ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 4);
}

function snippetAround(source, index, length) {
  const start = Math.max(0, index - 16);
  const end = Math.min(source.length, index + length + 16);
  return source.slice(start, end).replace(/\s+/g, " ").trim();
}

function collectRegexHits(source, regex, rule) {
  const hits = [];
  regex.lastIndex = 0;
  for (const match of source.matchAll(regex)) {
    hits.push({
      rule,
      snippet: snippetAround(source, match.index ?? 0, match[0].length),
    });
  }
  return hits;
}

function looksLikeSecretRef(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "null") return true;
  if (trimmed.startsWith("$")) return true;
  if (/secrets\./i.test(trimmed)) return true;
  if (/process\.env/i.test(trimmed)) return true;
  if (/^['"]?\$\{\{/.test(trimmed)) return true;
  if (/^(\.{2,}|x{2,}|\*{2,}|<[^>]{1,40}>)$/i.test(trimmed)) return true;
  return false;
}

export function findCscNameLiterals(source) {
  const hits = [];
  CSC_NAME_ASSIGN_RE.lastIndex = 0;
  for (const match of source.matchAll(CSC_NAME_ASSIGN_RE)) {
    const raw = String(match[1] ?? "").trim().replace(/^['"]|['"]$/g, "");
    if (looksLikeSecretRef(raw)) continue;
    if (!/^[A-Za-z]/.test(raw)) continue;
    hits.push({
      rule: "csc-name-literal",
      snippet: snippetAround(source, match.index ?? 0, match[0].length),
    });
  }
  return hits;
}

export function findPasswordLiterals(source) {
  const hits = [];
  PASSWORD_ASSIGN_RE.lastIndex = 0;
  for (const match of source.matchAll(PASSWORD_ASSIGN_RE)) {
    const value = String(match[1] ?? "");
    if (looksLikeSecretRef(value)) continue;
    hits.push({
      rule: "password-literal",
      snippet: snippetAround(source, match.index ?? 0, match[0].length),
    });
  }
  return hits;
}

export function findPrivacyHits(source, { extraTokens = [] } = {}) {
  const text = typeof source === "string" ? source : "";
  if (!text) return [];
  const hits = [
    ...collectRegexHits(text, DEVELOPER_ID_IDENTITY_RE, "developer-id-identity"),
    ...collectRegexHits(text, FINGERPRINT_RE, "labeled-fingerprint"),
    ...collectRegexHits(text, PRIVATE_KEY_RE, "private-key"),
    ...findCscNameLiterals(text),
    ...findPasswordLiterals(text),
  ];
  const lowered = text.toLowerCase();
  for (const token of extraTokens) {
    const index = lowered.indexOf(token);
    if (index >= 0) {
      hits.push({
        rule: "extra-token",
        snippet: snippetAround(text, index, token.length),
      });
    }
  }
  return hits;
}

function shouldScanFile(rel) {
  const normalized = rel.split(sep).join("/");
  if (normalized.endsWith("pnpm-lock.yaml")) return false;
  if (normalized.includes("/locales/")) return false;
  if (normalized.includes("bundled-skills/")) return false;
  if (normalized.includes("/marketplace/")) return false;
  if (normalized.startsWith(".loop/")) return false;
  const ext = normalized.includes(".") ? `.${normalized.split(".").pop()}` : "";
  if (ext && !TEXT_EXTENSIONS.has(ext) && !normalized.endsWith("Dockerfile")) {
    return false;
  }
  return true;
}

function walkFiles(abs, acc) {
  if (!existsSync(abs)) return;
  const stat = statSync(abs);
  if (stat.isDirectory()) {
    const name = abs.split(sep).pop();
    if (SKIP_DIR_NAMES.has(name)) return;
    for (const entry of readdirSync(abs)) {
      walkFiles(join(abs, entry), acc);
    }
    return;
  }
  if (!stat.isFile()) return;
  const rel = relative(REPO_ROOT, abs);
  if (!shouldScanFile(rel)) return;
  acc.push(rel);
}

export function listPublicScanFiles(repoRoot = REPO_ROOT) {
  const files = [];
  for (const root of SCAN_ROOTS) {
    walkFiles(join(repoRoot, root), files);
  }
  files.sort();
  return files;
}

export function checkPrivacyText(input) {
  const extraTokens = extraTokensFromEnv(input.extraTokens);
  const failures = [];
  const title = (input.title ?? "").trim();
  const body = input.body ?? "";
  const commits = Array.isArray(input.commits)
    ? input.commits
    : typeof input.commits === "string"
      ? input.commits.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];

  if (title) {
    for (const hit of findPrivacyHits(title, { extraTokens })) {
      failures.push({ field: "title", ...hit });
    }
  }
  for (const hit of findPrivacyHits(body, { extraTokens })) {
    failures.push({ field: "body", ...hit });
  }
  for (const subject of commits) {
    for (const hit of findPrivacyHits(subject, { extraTokens })) {
      failures.push({ field: "commit", ...hit, snippet: subject });
    }
  }
  return { ok: failures.length === 0, failures };
}

export function scanPublicTree(repoRoot = REPO_ROOT, extraTokens) {
  const tokens = extraTokensFromEnv(extraTokens);
  const failures = [];
  for (const rel of listPublicScanFiles(repoRoot)) {
    const text = readFileSync(join(repoRoot, rel), "utf8");
    for (const hit of findPrivacyHits(text, { extraTokens: tokens })) {
      failures.push({ field: rel, ...hit });
    }
  }
  return { ok: failures.length === 0, failures };
}

function parseArgs(argv) {
  const out = {
    title: process.env.PR_TITLE,
    body: process.env.PR_BODY,
    commits: process.env.PR_COMMITS,
    scan: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scan") out.scan = true;
    else if (arg === "--title") out.title = argv[++i] ?? "";
    else if (arg === "--body") out.body = argv[++i] ?? "";
    else if (arg === "--commits") out.commits = argv[++i] ?? "";
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

function printFailures(label, failures) {
  console.error(`${label}: FAIL — public text must not include signing identities, fingerprints, private keys, or plaintext passwords.`);
  console.error("Put CSC_NAME / certificate material in Actions secrets or a private runbook.");
  for (const failure of failures) {
    console.error(`  - [${failure.field}] ${failure.rule}: ${failure.snippet}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/checks/pr-privacy.mjs [--scan] [--title T] [--body B] [--commits "s1\\ns2"]
Env: PR_TITLE, PR_BODY, PR_COMMITS, PRIVACY_EXTRA_TOKENS
`);
    process.exit(0);
  }

  const textResult = checkPrivacyText({
    title: args.title,
    body: args.body,
    commits: args.commits,
  });
  const treeResult = args.scan ? scanPublicTree() : { ok: true, failures: [] };
  const failures = [...textResult.failures, ...treeResult.failures];

  if (failures.length === 0) {
    console.log("pr-privacy: pass");
    process.exit(0);
  }
  printFailures("pr-privacy", failures);
  process.exit(1);
}

const isMain =
  process.argv[1] &&
  (import.meta.url === new URL(process.argv[1], "file:").href ||
    process.argv[1].endsWith("pr-privacy.mjs"));
if (isMain) {
  main();
}
