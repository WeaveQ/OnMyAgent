import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { constants as fsConstants } from "node:fs";
import { createMarkdownRenderer } from "vitepress";
import {
  checkModeFromArgs,
  classifyResourceUrl,
  decodePng,
  distRequirementFailures,
  extractRenderedIds,
  extractRenderedResources,
  lacksRequiredImageDisclosure,
  localSourceImagePath,
  localBuiltAssetPath,
  localeRouteOrderMismatches,
  missingBuiltRouteFiles,
  pairedPageCompletenessFailures,
  vitePressConfigFailures,
} from "./check-helpers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = resolve(root, "public/index.html");
const distDir = resolve(root, "dist");
const docsDir = resolve(root, "docs");
const docsOutputDir = resolve(distDir, "docs");
const checkMode = checkModeFromArgs(process.argv.slice(2));
// Deliberate bilingual handbook contract; increase only with a matched zh/en pair.
const expectedLocaleRouteCount = 56;
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
  'href="docs/"',
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

const { default: vitepressConfig } = await import("../docs/.vitepress/config.mjs");
failures.push(...vitePressConfigFailures(vitepressConfig, docsOutputDir));

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

function toPosixRelative(from, file) {
  return relative(from, file).split(sep).join("/");
}

function markdownCandidatesForRoute(target, fromRelativeFile = "index.md") {
  const rawPath = target.split(/[?#]/, 1)[0];
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    decodedPath = rawPath;
  }
  const relativePath = decodedPath.startsWith("/")
    ? decodedPath.replace(/^\/+/, "")
    : posix.normalize(posix.join(posix.dirname(fromRelativeFile), decodedPath));
  if (relativePath === "." || relativePath === "") return ["index.md"];
  if (relativePath.startsWith("../")) return [];
  if (relativePath.endsWith("/")) return [`${relativePath}index.md`];
  if (relativePath.endsWith(".html")) return [relativePath.replace(/\.html$/, ".md")];
  if (relativePath.endsWith(".md")) return [relativePath];
  return [`${relativePath}.md`, `${relativePath}/index.md`];
}

function decodeFragment(target) {
  const hashIndex = target.indexOf("#");
  if (hashIndex < 0 || hashIndex === target.length - 1) return null;
  const raw = target.slice(hashIndex + 1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function decodeHtmlAttribute(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function checkLocaleRouteParity(files) {
  const relativeFiles = files.map((file) => toPosixRelative(docsDir, file));
  const zhRoutes = relativeFiles.filter((file) => !file.startsWith("en/"));
  const enRoutes = relativeFiles
    .filter((file) => file.startsWith("en/"))
    .map((file) => file.slice("en/".length));
  const zhSet = new Set(zhRoutes);
  const enSet = new Set(enRoutes);
  const missingEnglish = zhRoutes.filter((route) => !enSet.has(route));
  const orphanEnglish = enRoutes.filter((route) => !zhSet.has(route));

  if (
    zhRoutes.length !== expectedLocaleRouteCount ||
    enRoutes.length !== expectedLocaleRouteCount
  ) {
    failures.push(
      `locale route count: expected ${expectedLocaleRouteCount} per locale, found zh=${zhRoutes.length} en=${enRoutes.length}`,
    );
  }
  for (const route of missingEnglish) {
    failures.push(`locale route missing English counterpart: en/${route}`);
  }
  for (const route of orphanEnglish) {
    failures.push(`locale route missing Chinese counterpart: ${route}`);
  }

  console.log(
    `locale route parity: zh=${zhRoutes.length} en=${enRoutes.length} missing_en=${missingEnglish.length} missing_zh=${orphanEnglish.length}`,
  );
}

function collectSidebarLinks(groups, acc = []) {
  for (const group of groups ?? []) {
    if (typeof group.link === "string") acc.push(group.link);
    if (Array.isArray(group.items)) collectSidebarLinks(group.items, acc);
  }
  return acc;
}

function sidebarLinkToMarkdown(link) {
  const pathOnly = link.split(/[?#]/, 1)[0].replace(/^\/+/, "");
  if (!pathOnly) return "index.md";
  if (pathOnly.endsWith("/")) return `${pathOnly}index.md`;
  if (pathOnly.endsWith(".md")) return pathOnly;
  return `${pathOnly}.md`;
}

function checkSidebarRouteCoverage(markdownFiles) {
  const localeContracts = [
    {
      locale: "zh",
      sidebar: vitepressConfig.locales?.root?.themeConfig?.sidebar,
      expected: [...markdownFiles].filter((file) => !file.startsWith("en/")),
      linkInScope: (link) => link.startsWith("/") && !link.startsWith("/en/"),
    },
    {
      locale: "en",
      sidebar: vitepressConfig.locales?.en?.themeConfig?.sidebar,
      expected: [...markdownFiles].filter((file) => file.startsWith("en/")),
      linkInScope: (link) => link === "/en/" || link.startsWith("/en/"),
    },
  ];

  const orderedRoutes = new Map();

  for (const contract of localeContracts) {
    const links = collectSidebarLinks(contract.sidebar);
    orderedRoutes.set(contract.locale, links.map(sidebarLinkToMarkdown));
    const counts = new Map();
    for (const link of links) {
      if (!contract.linkInScope(link)) {
        failures.push(`${contract.locale} sidebar link outside locale scope: ${link}`);
      }
      const file = sidebarLinkToMarkdown(link);
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
    for (const file of contract.expected) {
      if (!counts.has(file)) {
        failures.push(`${contract.locale} sidebar missing published route: ${file}`);
      }
    }
    for (const [file, count] of counts) {
      if (!markdownFiles.has(file)) {
        failures.push(`${contract.locale} sidebar targets unpublished route: ${file}`);
      }
      if (count > 1) {
        failures.push(`${contract.locale} sidebar duplicates route ${file} (${count} entries)`);
      }
    }
    console.log(
      `sidebar route coverage: locale=${contract.locale} links=${links.length} published=${contract.expected.length}`,
    );
  }

  const chineseOrder = orderedRoutes.get("zh") ?? [];
  const englishOrder = (orderedRoutes.get("en") ?? []).map((file) =>
    file.startsWith("en/") ? file.slice("en/".length) : file,
  );
  for (const mismatch of localeRouteOrderMismatches(chineseOrder, englishOrder)) {
    failures.push(
      `sidebar locale order mismatch at ${mismatch.index + 1}: zh=${String(mismatch.chinese)} en=${String(mismatch.english)}`,
    );
  }

  const chineseLinks = new Set(collectSidebarLinks(vitepressConfig.locales?.root?.themeConfig?.sidebar));
  for (const route of [
    "/guide/sessions",
    "/scenarios/office-docs",
    "/install/macos",
    "/security",
    "/faq",
  ]) {
    if (!chineseLinks.has(route)) failures.push(`Chinese sidebar missing required route: ${route}`);
  }
}

async function checkDocsLinksAndImages() {
  const files = await collectMarkdown(docsDir);
  checkLocaleRouteParity(files);
  const markdownFiles = new Set(
    files.map((file) => toPosixRelative(docsDir, file)),
  );
  checkSidebarRouteCoverage(markdownFiles);
  const renderer = await createMarkdownRenderer(docsDir);
  const headingIdsByFile = new Map();
  const renderedByFile = new Map();
  const resourcesByFile = new Map();
  for (const file of files) {
    const relativeFile = toPosixRelative(docsDir, file);
    const text = await readFile(file, "utf8");
    const rendered = renderer.render(text, { path: relativeFile });
    renderedByFile.set(relativeFile, rendered);
    resourcesByFile.set(relativeFile, extractRenderedResources(rendered));
    const headingIds = new Set(
      [...rendered.matchAll(/<h[1-6]\b[^>]*\bid="([^"]+)"/g)].map((match) =>
        decodeHtmlAttribute(match[1]),
      ),
    );
    headingIdsByFile.set(relativeFile, headingIds);
    if (relativeFile.startsWith("en/") && /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(text)) {
      failures.push(`${relativeFile}: English handbook page contains CJK text`);
    }
  }
  let checkedLocalePairs = 0;
  for (const [relativeFile, rendered] of renderedByFile) {
    if (relativeFile.startsWith("en/")) continue;
    const englishFile = `en/${relativeFile}`;
    const englishRendered = renderedByFile.get(englishFile);
    if (!englishRendered) continue;
    failures.push(
      ...pairedPageCompletenessFailures(rendered, englishRendered, relativeFile),
    );
    checkedLocalePairs += 1;
  }
  let missingLinks = 0;
  let missingImages = 0;
  let missingAnchors = 0;
  let englishLinkScopeFailures = 0;
  for (const file of files) {
    const relativeFile = toPosixRelative(docsDir, file);
    const resources = resourcesByFile.get(relativeFile) ?? { links: [], images: [] };
    const isEnglishPage = relativeFile.startsWith("en/");
    // Inspect rendered HTML so reference links, raw HTML and fenced code follow
    // the same semantics users receive from VitePress.
    for (const image of resources.images) {
      const target = image.src;
      const disposition = classifyResourceUrl(target, "image");
      if (disposition.type === "unsafe") {
        failures.push(`${relativeFile}: unsafe handbook image ${target} (${disposition.reason})`);
        missingImages += 1;
        continue;
      }
      if (disposition.type === "external") continue;
      const assetPath = localSourceImagePath(target, relativeFile, docsDir);
      if (!assetPath || !(await exists(assetPath))) {
        failures.push(`${relativeFile}: missing local handbook image ${target}`);
        missingImages += 1;
        continue;
      }
      const assetStat = await stat(assetPath);
      if (!assetStat.isFile() || assetStat.size === 0) {
        failures.push(`${relativeFile}: empty or non-file handbook image ${target}`);
        missingImages += 1;
        continue;
      }
      const targetPath = target.split(/[?#]/, 1)[0];
      if (targetPath.toLowerCase().endsWith(".png")) {
        try {
          decodePng(await readFile(assetPath));
        } catch (error) {
          failures.push(
            `${relativeFile}: invalid local PNG ${target} (${error instanceof Error ? error.message : String(error)})`,
          );
          missingImages += 1;
          continue;
        }
      }
    }
    for (const target of resources.links) {
      const disposition = classifyResourceUrl(target, "link");
      if (disposition.type === "unsafe") {
        failures.push(`${relativeFile}: unsafe handbook link ${target} (${disposition.reason})`);
        missingLinks += 1;
        continue;
      }
      if (disposition.type === "external") continue;
      const fragment = decodeFragment(target);
      let targetRelativeFile = target.startsWith("#") ? relativeFile : null;
      if (isEnglishPage) {
        if (!target.startsWith("#") && !target.startsWith("/en/")) {
          failures.push(
            `${relativeFile}: English handbook link must stay under /en/: ${target}`,
          );
          englishLinkScopeFailures += 1;
          continue;
        }
      }
      if (!target.startsWith("#")) {
        const candidates = markdownCandidatesForRoute(target, relativeFile);
        targetRelativeFile =
          candidates.find((candidate) => markdownFiles.has(candidate)) ?? null;
        if (!targetRelativeFile) {
          failures.push(`${relativeFile}: broken handbook link ${target}`);
          missingLinks += 1;
        }
      }
      if (
        fragment &&
        targetRelativeFile &&
        !headingIdsByFile.get(targetRelativeFile)?.has(fragment)
      ) {
        failures.push(
          `${relativeFile}: broken heading anchor ${target} (target ${targetRelativeFile} has no #${fragment})`,
        );
        missingAnchors += 1;
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

  // Handoff: no customer-specific brand names in public product docs.
  const bannedBrands = ["一枕星河", "剧鲸"];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const brand of bannedBrands) {
      if (text.includes(brand)) {
        failures.push(`${file}: customer brand leak: ${brand}`);
      }
    }
  }

  // Handoff hubs must exist and show a product screenshot.
  for (const rel of [
    "scenarios/usage-guide.md",
    "scenarios/practice/index.md",
    "guide/efficient-tips.md",
  ]) {
    const p = resolve(docsDir, rel);
    if (!(await exists(p))) {
      failures.push(`missing handoff hub: ${rel}`);
      continue;
    }
    const hubResources = resourcesByFile.get(rel);
    if (!hubResources?.images.some((image) => image.src.startsWith("/images/"))) {
      failures.push(`${rel}: handoff hub missing /images/ screenshot`);
    }
  }

  // Caption honesty for screenshot assets with a known transient UI state.
  const dishonestCaptionPatterns = [
    {
      fileSubstring: "settings-usage.png",
      // Must acknowledge loading if that asset is still the loading frame
      requireIfPresent: /加载|loading/i,
      reason: "settings-usage.png may show loading state",
    },
  ];

  for (const file of files) {
    const relativeFile = toPosixRelative(docsDir, file);
    const text = await readFile(file, "utf8");
    const resources = resourcesByFile.get(relativeFile) ?? { images: [] };
    for (const image of resources.images) {
      const caption = image.alt;
      const src = image.src;
      for (const rule of dishonestCaptionPatterns) {
        if (!src.includes(rule.fileSubstring)) continue;
        if (rule.badCaption && rule.badCaption.test(caption)) {
          failures.push(
            `${file}: dishonest caption for ${src}: "${caption}" (${rule.reason})`,
          );
        }
        if (
          rule.requireIfPresent &&
          src.includes("settings-usage") &&
          lacksRequiredImageDisclosure(image, text, rule.requireIfPresent)
        ) {
          failures.push(
            `${relativeFile}: caption/prose for ${src} must acknowledge its transient state (${rule.reason})`,
          );
        }
      }
    }
  }

  // Practice numbering: sidebar labels and page H1 must use continuous 1–9 (not 八/十一).
  const practiceNumbering = [
    ["scenarios/practice/files.md", "实践 1"],
    ["scenarios/practice/docs.md", "实践 2"],
    ["scenarios/practice/data.md", "实践 3"],
    ["scenarios/practice/content.md", "实践 4"],
    ["scenarios/practice/daily-brief.md", "实践 5"],
    ["scenarios/practice/skills-evolve.md", "实践 6"],
    ["scenarios/practice/self-drive.md", "实践 7"],
    ["scenarios/practice/meetings.md", "实践 8"],
    ["scenarios/practice/tencent-docs.md", "实践 9"],
  ];
  for (const [rel, needle] of practiceNumbering) {
    const p = resolve(docsDir, rel);
    if (!(await exists(p))) continue;
    const body = await readFile(p, "utf8");
    if (!body.includes(needle)) {
      failures.push(`${rel}: expected title numbering "${needle}"`);
    }
    if (/实践[八九十]/.test(body) || /实践十一/.test(body)) {
      failures.push(`${rel}: legacy Chinese ordinal practice numbering found`);
    }
  }

  console.log(
    `docs link/image smoke: files=${files.length} missing_links=${missingLinks} missing_anchors=${missingAnchors} missing_images=${missingImages}`,
  );
  console.log(
    `handbook locale gates: en_link_scope_failures=${englishLinkScopeFailures}`,
  );
  console.log(`paired page completeness: pairs=${checkedLocalePairs}`);
}

async function collectHtmlFiles(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) await collectHtmlFiles(full, acc);
    else if (entry.isFile() && entry.name.endsWith(".html")) acc.push(full);
  }
  return acc;
}

function parentUrlPath(base) {
  const parent = posix.dirname(base.replace(/\/$/, ""));
  return parent === "/" ? "/" : `${parent}/`;
}

function docsUrlForHtml(file, docsOutputDir, base) {
  const relativeHtml = toPosixRelative(docsOutputDir, file);
  if (relativeHtml === "index.html") return base;
  if (relativeHtml.endsWith("/index.html")) {
    return `${base}${relativeHtml.slice(0, -"index.html".length)}`;
  }
  return `${base}${relativeHtml.replace(/\.html$/, "")}`;
}

function builtAssetPath(pathname, base, landingBase) {
  return localBuiltAssetPath(pathname, {
    base,
    landingBase,
    distDir,
    docsOutputDir,
  });
}

async function checkBuiltDist() {
  const distExists = await exists(distDir);
  failures.push(...distRequirementFailures(checkMode, distExists));
  if (!distExists) return;
  const base = vitepressConfig.base;
  const landingBase = parentUrlPath(base);
  const landingIndex = resolve(distDir, "index.html");
  const docsIndex = resolve(docsOutputDir, "index.html");
  if (!(await exists(landingIndex))) failures.push("dist/index.html missing after build");
  if (!(await exists(docsIndex))) failures.push("dist/docs/index.html missing after build");
  if (!(await exists(landingIndex)) || !(await exists(docsIndex))) return;

  const markdownFiles = (await collectMarkdown(docsDir)).map((file) =>
    toPosixRelative(docsDir, file),
  );
  const docsHtmlFiles = await collectHtmlFiles(docsOutputDir);
  const builtHtmlRoutes = docsHtmlFiles.map((file) => toPosixRelative(docsOutputDir, file));
  for (const missingRoute of missingBuiltRouteFiles(markdownFiles, builtHtmlRoutes)) {
    failures.push(`built route missing: ${missingRoute}`);
  }

  const htmlFiles = [landingIndex, ...docsHtmlFiles];
  const pageByUrlPath = new Map();
  const urlByPage = new Map();
  const bodyByPage = new Map();
  const idsByPage = new Map();
  const registerRoute = (urlPath, file) => {
    pageByUrlPath.set(new URL(urlPath, "https://handbook.invalid").pathname, file);
  };
  registerRoute(landingBase, landingIndex);
  registerRoute(`${landingBase}index.html`, landingIndex);
  urlByPage.set(landingIndex, `https://handbook.invalid${landingBase}`);
  for (const file of htmlFiles) {
    const body = await readFile(file, "utf8");
    bodyByPage.set(file, body);
    idsByPage.set(file, extractRenderedIds(body));
    if (file === landingIndex) continue;
    const route = docsUrlForHtml(file, docsOutputDir, base);
    registerRoute(route, file);
    if (route.endsWith("/")) {
      registerRoute(`${route}index.html`, file);
      registerRoute(route.slice(0, -1), file);
    } else {
      registerRoute(`${route}.html`, file);
    }
    urlByPage.set(file, `https://handbook.invalid${route}`);
  }

  let checkedLinks = 0;
  let checkedImages = 0;
  let brokenLinks = 0;
  let brokenAnchors = 0;
  let brokenImages = 0;
  for (const file of htmlFiles) {
    const body = bodyByPage.get(file) ?? "";
    const currentUrl = urlByPage.get(file);
    const resources = extractRenderedResources(body);
    for (const href of resources.links) {
      const disposition = classifyResourceUrl(href, "link");
      if (disposition.type === "unsafe") {
        failures.push(`${file}: unsafe built href ${href} (${disposition.reason})`);
        brokenLinks += 1;
        continue;
      }
      if (disposition.type === "external") continue;
      let targetUrl;
      try {
        targetUrl = new URL(href, currentUrl);
      } catch {
        failures.push(`${file}: invalid built href ${href}`);
        brokenLinks += 1;
        continue;
      }
      checkedLinks += 1;
      let targetFile = pageByUrlPath.get(targetUrl.pathname);
      if (!targetFile) {
        const diskTarget = builtAssetPath(targetUrl.pathname, base, landingBase);
        if (diskTarget && await exists(diskTarget)) continue;
        failures.push(`${file}: broken built link ${href}`);
        brokenLinks += 1;
        continue;
      }
      const fragment = targetUrl.hash ? decodeFragment(targetUrl.hash) : null;
      if (fragment && !idsByPage.get(targetFile)?.has(fragment)) {
        failures.push(`${file}: broken built anchor ${href}`);
        brokenAnchors += 1;
      }
    }
    for (const image of resources.images) {
      const disposition = classifyResourceUrl(image.src, "image");
      if (disposition.type === "unsafe") {
        failures.push(`${file}: unsafe built image ${image.src} (${disposition.reason})`);
        brokenImages += 1;
        continue;
      }
      if (disposition.type === "external") continue;
      let targetUrl;
      try {
        targetUrl = new URL(image.src, currentUrl);
      } catch {
        failures.push(`${file}: invalid built image URL ${image.src}`);
        brokenImages += 1;
        continue;
      }
      checkedImages += 1;
      const diskTarget = builtAssetPath(targetUrl.pathname, base, landingBase);
      if (!diskTarget || !(await exists(diskTarget))) {
        failures.push(`${file}: broken built image ${image.src}`);
        brokenImages += 1;
        continue;
      }
      const imageStat = await stat(diskTarget);
      if (!imageStat.isFile() || imageStat.size === 0) {
        failures.push(`${file}: empty or non-file built image ${image.src}`);
        brokenImages += 1;
        continue;
      }
      if (targetUrl.pathname.toLowerCase().endsWith(".png")) {
        try {
          decodePng(await readFile(diskTarget));
        } catch (error) {
          failures.push(
            `${file}: invalid built PNG ${image.src} (${error instanceof Error ? error.message : String(error)})`,
          );
          brokenImages += 1;
        }
      }
    }
  }
  console.log(
    `built dist crawl: html=${htmlFiles.length} links=${checkedLinks} images=${checkedImages} broken_links=${brokenLinks} broken_anchors=${brokenAnchors} broken_images=${brokenImages}`,
  );
}

await checkDocsLinksAndImages();
if (checkMode === "require-dist") await checkBuiltDist();

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`checked ${htmlPath}`);
console.log(`checker mode: ${checkMode}`);
if (checkMode === "require-dist") console.log(`checked combined dist at ${distDir}`);
