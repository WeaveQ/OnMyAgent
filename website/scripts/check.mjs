import { access, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { constants as fsConstants } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = resolve(root, "public/index.html");
const distDir = resolve(root, "dist");
const html = await readFile(htmlPath, "utf8");

const required = [
  "<!DOCTYPE html>",
  'data-theme="dark"',
  'data-lang="en"',
  "function toggleTheme()",
  "Your free desktop entry",
  "OnMyAgent 是基于 OpenCode 的吗？",
  'href="/docs/"',
];

const forbidden = ["—", "–", "#39FF14", "57,255,20"];
const failures = [];

for (const value of required) {
  if (!html.includes(value)) failures.push(`missing required content: ${value}`);
}
for (const value of forbidden) {
  if (html.includes(value)) failures.push(`forbidden content found: ${value}`);
}
if (!/<html[\s\S]*<\/html>\s*$/i.test(html)) {
  failures.push("document does not end with closing html tag");
}
if (!/<script[\s\S]*toggleLang\(\)[\s\S]*<\/script>/i.test(html)) {
  failures.push("language/theme script block not found");
}

const config = await readFile(resolve(root, "docs/.vitepress/config.mjs"), "utf8");
if (!config.includes('base: "/docs/"') && !config.includes("base: '/docs/'")) {
  failures.push("vitepress base is not /docs/");
}
if (!config.includes('provider: "local"') && !config.includes("provider: 'local'")) {
  failures.push("local search not configured");
}
if (!config.includes("srcExclude") || !config.includes("plan")) {
  failures.push("plan/ not excluded via srcExclude");
}
for (const needle of [
  "/guide/sessions",
  "/platform/",
  "/scenarios/office-docs",
  "/install/macos",
  "/security",
  "/faq",
]) {
  if (!config.includes(needle)) {
    failures.push(`sidebar missing expected link: ${needle}`);
  }
}

async function exists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (await exists(distDir)) {
  if (!(await exists(resolve(distDir, "index.html")))) {
    failures.push("dist/index.html missing after build");
  }
  if (!(await exists(resolve(distDir, "docs/index.html")))) {
    failures.push("dist/docs/index.html missing after build");
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`checked ${htmlPath}`);
if (await exists(distDir)) console.log(`checked combined dist at ${distDir}`);
