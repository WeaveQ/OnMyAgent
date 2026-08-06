import { access, readFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { constants as fsConstants } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = resolve(root, "public/index.html");
const distDir = resolve(root, "dist");
const docsDir = resolve(root, "docs");
const imagesDir = resolve(docsDir, "public/images");
const html = await readFile(htmlPath, "utf8");

const required = [
  "<!DOCTYPE html>",
  'data-theme="dark"',
  'data-lang="en"',
  "function toggleTheme()",
  "Local-first AI workbench",
  "OnMyCompany",
  "OnMyBuddy",
  "必须登录或连接公司吗",
  'href="/docs/"',
  "https://github.com/WeaveQ/OnMyAgent",
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

async function collectMarkdown(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name === "plan" || ent.name === "public" || ent.name === ".vitepress") continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) await collectMarkdown(full, acc);
    else if (ent.isFile() && ent.name.endsWith(".md")) acc.push(full);
  }
  return acc;
}

/** Resolve relative markdown link targets the same way authors write them. */
function resolveDocLink(fromFile, target) {
  const pathOnly = target.split("#")[0];
  if (!pathOnly) return true;
  if (/^(https?:|mailto:|\/\/)/i.test(pathOnly) || pathOnly.startsWith("/")) {
    return true; // absolute site paths handled by VitePress base; not checked here
  }
  const base = dirname(fromFile);
  const candidates = [
    resolve(base, pathOnly),
    resolve(base, `${pathOnly}.md`),
    resolve(base, pathOnly, "index.md"),
  ];
  return candidates;
}

async function checkDocsLinksAndImages() {
  const files = await collectMarkdown(docsDir);
  let missingLinks = 0;
  let missingImages = 0;
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (target.startsWith("/images/")) {
        const imgPath = resolve(imagesDir, target.slice("/images/".length));
        if (!(await exists(imgPath))) {
          failures.push(`${file}: missing image ${target}`);
          missingImages += 1;
          continue;
        }
        const st = await stat(imgPath);
        if (st.size === 0) {
          failures.push(`${file}: empty image file ${target}`);
          missingImages += 1;
        }
      }
    }
    for (const m of text.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[2];
      if (!target || target.startsWith("#") || /^(https?:|mailto:|\/\/)/i.test(target)) {
        continue;
      }
      const pathOnly = target.split("#")[0];
      if (!pathOnly || pathOnly.startsWith("/")) continue;
      const candidates = resolveDocLink(file, target);
      if (candidates === true) continue;
      let ok = false;
      for (const c of candidates) {
        if (await exists(c)) {
          ok = true;
          break;
        }
      }
      if (!ok) {
        failures.push(`${file}: broken relative link ${target}`);
        missingLinks += 1;
      }
    }
  }

  // Scenario pages must stay substantial (goal + structure), not stubs.
  for (const name of ["office-docs.md", "automation-digest.md", "team-pilot.md"]) {
    const p = resolve(docsDir, "scenarios", name);
    if (!(await exists(p))) {
      failures.push(`missing scenario page: scenarios/${name}`);
      continue;
    }
    const body = await readFile(p, "utf8");
    const lines = body.split(/\r?\n/).length;
    if (lines < 40) failures.push(`scenario too short: scenarios/${name} (${lines} lines)`);
    if (!body.includes("## 目标")) failures.push(`scenario missing ## 目标: scenarios/${name}`);
    if (!body.includes("相关")) failures.push(`scenario missing 相关 section: scenarios/${name}`);
  }

  // Usage screenshot caption must not pretend the image is a fully loaded chart
  // while the asset still shows the loading state.
  const settingsMd = await readFile(resolve(docsDir, "guide/settings.md"), "utf8");
  if (
    settingsMd.includes("settings-usage.png") &&
    !/加载|loading/i.test(settingsMd)
  ) {
    failures.push(
      "guide/settings.md references settings-usage.png without acknowledging loading state",
    );
  }

  console.log(
    `docs link/image smoke: files=${files.length} missing_links=${missingLinks} missing_images=${missingImages}`,
  );
}

await checkDocsLinksAndImages();

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
