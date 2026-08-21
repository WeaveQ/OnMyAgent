#!/usr/bin/env node
/**
 * Pull the `## X.Y.Z` bullets from the handbook changelog for GitHub Release notes.
 * Usage: node scripts/release/extract-changelog-section.mjs 0.5.25 [path]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const version = String(process.argv[2] ?? "")
  .trim()
  .replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  process.stderr.write("usage: extract-changelog-section.mjs X.Y.Z [changelog.md]\n");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const defaultPath = join(here, "../../website/docs/en/changelog.md");
const file = process.argv[3] ? String(process.argv[3]) : defaultPath;
const text = readFileSync(file, "utf8");
const heading = `## ${version}`;
const start = text.indexOf(`\n${heading}\n`);
const from = start >= 0 ? start + 1 : text.startsWith(`${heading}\n`) ? 0 : -1;
if (from < 0) process.exit(1);
const rest = text.slice(from + heading.length);
const next = rest.search(/\n## /);
const section = (next < 0 ? rest : rest.slice(0, next)).trim();
const bullets = section
  .split("\n")
  .map((line) => line.trimEnd())
  .filter((line) => line.startsWith("- "));
if (bullets.length === 0) process.exit(1);
process.stdout.write(`## What's new\n\n${bullets.join("\n")}\n`);
