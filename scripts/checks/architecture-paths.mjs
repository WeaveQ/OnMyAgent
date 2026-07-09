#!/usr/bin/env node
/**
 * Ensures ARCHITECTURE.md-referenced top-level domain dirs exist.
 * Run: node scripts/checks/architecture-paths.mjs
 * Exit 1 if a required path is missing.
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const domains = join(root, "apps/app/src/react-app/domains");

const required = [
  "session",
  "settings",
  "workspace",
  "connections",
  "agents",
  "local-agents",
  "cloud",
  "shared",
  "shell-feedback",
  "plugins",
];

const missing = required.filter((name) => !existsSync(join(domains, name)));
if (missing.length) {
  console.error("[architecture-paths] missing domain dirs:", missing.join(", "));
  process.exit(1);
}
console.log("[architecture-paths] ok:", required.join(", "));
