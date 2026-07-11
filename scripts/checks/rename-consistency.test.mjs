import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "graphify-out",
  "dist",
  "out",
  "build",
  ".turbo",
]);
const ignoredFiles = new Set([
  "apps/app/public/openwork-logo-square.svg",
  "apps/app/public/openwork-logo.svg",
  "apps/app/public/openwork-mark.svg",
  ".agents/skills/documentation-audit/SKILL.md",
  "scripts/checks/rename-consistency.test.mjs",
]);
const textExtensions = new Set([
  ".cjs",
  ".cmd",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".lock",
  ".md",
  ".mjs",
  ".plist",
  ".sh",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const textFileNames = new Set(["LICENSE", ".gitignore", ".npmrc"]);
const forbiddenContentPatterns = [
  /different-ai\/openwork/i,
  /@openwork\//i,
  /\bOPENWORK\b/,
  /\bOpenWork\b/,
  /\bopen-work\b/i,
  /\bopenwork\b/i,
];
const forbiddenPathPatterns = [/openwork/i, /open-work/i];
const requiredContent = [
  ["package.json", '"name": "@weaveq/onmyagent"'],
  ["package.json", "@onmyagent/app"],
  ["apps/app/package.json", '"name": "@onmyagent/app"'],
  ["apps/desktop/package.json", '"name": "@onmyagent/desktop"'],
  ["apps/server/package.json", '"name": "onmyagent-server"'],
  ["apps/orchestrator/package.json", '"name": "onmyagent-orchestrator"'],
  ["packages/onmyagent-ui-mcp/package.json", '"name": "onmyagent-ui-mcp"'],
  ["packages/handsfree/package.json", '"name": "@onmyagent/handsfree"'],
];

function isTextFile(path) {
  if (textFileNames.has(path.split("/").pop())) return true;
  const index = path.lastIndexOf(".");
  return index >= 0 && textExtensions.has(path.slice(index));
}

function walk(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) continue;
    const path = join(directory, entry);
    const relativePath = relative(repoRoot, path).split("\\").join("/");
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      walk(path, files);
      continue;
    }
    files.push(relativePath);
  }
  return files;
}

const failures = [];
const files = walk(repoRoot);
for (const file of files) {
  if (ignoredFiles.has(file)) continue;
  for (const pattern of forbiddenPathPatterns) {
    if (pattern.test(file)) failures.push(`Forbidden old name in path: ${file}`);
  }
  if (!isTextFile(file)) continue;
  const content = readFileSync(join(repoRoot, file), "utf8");
  for (const pattern of forbiddenContentPatterns) {
    if (pattern.test(content)) failures.push(`Forbidden old name in ${file}: ${pattern}`);
  }
}

for (const [file, snippet] of requiredContent) {
  const content = readFileSync(join(repoRoot, file), "utf8");
  if (!content.includes(snippet)) failures.push(`Expected ${file} to include ${snippet}`);
}

if (failures.length > 0) {
  console.error("Rename consistency check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Rename consistency check passed across ${files.length} files.`);
