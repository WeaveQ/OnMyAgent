import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
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
  pngCrc32,
  vitePressConfigFailures,
} from "./check-helpers.mjs";

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return chunk;
}

function rgbaPng(width, height, pixels, compressionLevel = 6) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * width * 4;
    const targetOffset = row * (width * 4 + 1);
    scanlines[targetOffset] = 0;
    pixels.copy(scanlines, targetOffset + 1, sourceOffset, sourceOffset + width * 4);
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: compressionLevel })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngWithColorType(width, height, colorType, pixels, transparency) {
  const channels = new Map([[0, 1], [2, 3]]).get(colorType);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, colorType, 0, 0, 0], 8);
  const scanlines = Buffer.alloc(height * (width * channels + 1));
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * width * channels;
    const targetOffset = row * (width * channels + 1);
    pixels.copy(scanlines, targetOffset + 1, sourceOffset, sourceOffset + width * channels);
  }
  const chunks = [pngChunk("IHDR", header)];
  if (transparency) chunks.push(pngChunk("tRNS", transparency));
  chunks.push(pngChunk("IDAT", deflateSync(scanlines)), pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), ...chunks]);
}

test("rendered resource extraction follows Markdown semantics", async () => {
  const renderer = await createMarkdownRenderer(process.cwd());
  const rendered = renderer.render(`
[reference][settings]

[settings]: /en/guide/settings#system

<a href='/en/raw-link'>Raw link</a>
<img src=/images/en-home-session.png alt='Home'>
<script>const example = '<a href="/en/script-only">not visible</a>';</script>

\`\`\`md
[not-a-link](/en/does-not-exist)
![not-an-image](/images/missing.png)
\`\`\`
`, { path: "en/fixture.md" });
  const resources = extractRenderedResources(rendered);
  assert.deepEqual(resources.links, [
    "/en/guide/settings.html#system",
    "/en/raw-link",
  ]);
  assert.deepEqual(resources.images, [
    { src: "/images/en-home-session.png", alt: "Home" },
  ]);
});

test("rendered resource scanner is quote-aware and ignores comments, scripts, and styles", () => {
  const resources = extractRenderedResources(`
    <!-- <img src="/comment.png"> -->
    <a title="1 > 0" href="/safe>route">Safe</a>
    <img alt='A > B' src='/assets/picture.png'>
    <script>const fake = '<img src="/script.png">';</script>
    <style>.x { background: url('/style.png') }</style>
  `);
  assert.deepEqual(resources.links, ["/safe>route"]);
  assert.deepEqual(resources.images, [{ src: "/assets/picture.png", alt: "A > B" }]);
});

test("resource URL gate uses an explicit safe-scheme allowlist", () => {
  assert.equal(classifyResourceUrl("/assets/logo.png", "image").type, "local");
  assert.equal(classifyResourceUrl("https://example.com/a.png", "image").type, "external");
  assert.equal(classifyResourceUrl("mailto:docs@example.com", "link").type, "external");
  for (const target of ["javascript:alert(1)", "vbscript:msgbox(1)", "file:///tmp/a"]) {
    assert.equal(classifyResourceUrl(target, "link").type, "unsafe");
  }
  assert.equal(classifyResourceUrl("data:image/png;base64,AA==", "image").type, "unsafe");
  for (const encoded of [
    "javascript&#58;alert(1)",
    "javascript&#58alert(1)",
    "javascript&#x3a;alert(1)",
    "javascript&#x3a//alert(1)",
    "javascript&colon;alert(1)",
    "java&#10;script&#58;alert(1)",
  ]) {
    const href = extractRenderedResources(`<a href="${encoded}">bad</a>`).links[0];
    assert.equal(classifyResourceUrl(href, "link").type, "unsafe");
  }
  const duplicateHref = extractRenderedResources(
    '<a href="javascript:alert(1)" href="/safe">bad</a>',
  ).links[0];
  assert.equal(duplicateHref, "javascript:alert(1)");
  assert.equal(classifyResourceUrl(duplicateHref, "link").type, "unsafe");
});

test("rendered ID extraction does not treat data-id as an anchor", () => {
  const ids = extractRenderedIds(`
    <!-- <div id="comment-only"></div> -->
    <div data-id="not-an-anchor" title="1 > 0"></div>
    <section id="real-anchor"></section>
    <script>const fake = '<div id="script-only"></div>';</script>
  `);
  assert.deepEqual([...ids], ["real-anchor"]);
});

test("source image resolver covers every local public and relative image", () => {
  assert.equal(
    localSourceImagePath("/logo.png", "guide/page.md", "/tmp/docs"),
    "/tmp/docs/public/logo.png",
  );
  assert.equal(
    localSourceImagePath("./diagram.svg", "guide/page.md", "/tmp/docs"),
    "/tmp/docs/guide/diagram.svg",
  );
  assert.equal(localSourceImagePath("../../secret.png", "guide/page.md", "/tmp/docs"), null);
});

test("built image resolver covers docs and landing assets under project bases", () => {
  const roots = {
    base: "/OnMyAgent/docs/",
    landingBase: "/OnMyAgent/",
    distDir: "/tmp/website/dist",
    docsOutputDir: "/tmp/website/dist/docs",
  };
  assert.equal(
    localBuiltAssetPath("/OnMyAgent/docs/logo.png", roots),
    "/tmp/website/dist/docs/logo.png",
  );
  assert.equal(
    localBuiltAssetPath("/OnMyAgent/hero.png", roots),
    "/tmp/website/dist/hero.png",
  );
  assert.equal(localBuiltAssetPath("/outside.png", roots), null);
});

test("checker modes are hermetic and require dist only when explicitly requested", () => {
  assert.equal(checkModeFromArgs([]), "source-only");
  assert.equal(checkModeFromArgs(["--source-only"]), "source-only");
  assert.equal(checkModeFromArgs(["--require-dist"]), "require-dist");
  assert.throws(() => checkModeFromArgs(["--source-only", "--require-dist"]), /mutually exclusive/);
  assert.throws(() => checkModeFromArgs(["--stale-dist"]), /unknown checker option/);
  assert.deepEqual(distRequirementFailures("source-only", false), []);
  assert.deepEqual(distRequirementFailures("require-dist", true), []);
  assert.match(distRequirementFailures("require-dist", false)[0], /dist is required but missing/);
});

test("PNG decoder rejects a signature-only dimension forgery", () => {
  const forged = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(forged);
  forged.writeUInt32BE(1600, 16);
  forged.writeUInt32BE(1025, 20);
  assert.throws(() => decodePng(forged), /truncated|invalid/i);
});

test("locale route order gate detects swaps even when coverage is unchanged", () => {
  const chinese = ["index.md", "quickstart.md", "first-task.md"];
  const english = ["index.md", "first-task.md", "quickstart.md"];
  assert.deepEqual(localeRouteOrderMismatches(chinese, english), [
    { index: 1, chinese: "quickstart.md", english: "first-task.md" },
    { index: 2, chinese: "first-task.md", english: "quickstart.md" },
  ]);
  assert.deepEqual(localeRouteOrderMismatches(chinese, chinese), []);
});

test("caption disclosure gate fails when neither alt text nor prose acknowledges state", () => {
  const image = { src: "/images/settings-usage.png", alt: "Usage chart" };
  assert.equal(lacksRequiredImageDisclosure(image, "Current usage.", /loading/i), true);
  assert.equal(lacksRequiredImageDisclosure(image, "Loading current usage.", /loading/i), false);
  assert.equal(
    lacksRequiredImageDisclosure({ ...image, alt: "Loading usage chart" }, "Current usage.", /loading/i),
    false,
  );
});

test("VitePress config gate reads resolved values instead of source comments", () => {
  const expectedOutDir = "/workspace/website/dist/docs";
  const valid = {
    base: "/docs/",
    outDir: expectedOutDir,
    cleanUrls: true,
    srcExclude: ["**/plan/**"],
    themeConfig: { search: { provider: "local" } },
    locales: {
      root: { lang: "zh-CN" },
      en: { lang: "en-US", link: "/en/" },
    },
  };
  assert.deepEqual(vitePressConfigFailures(valid, expectedOutDir), []);
  const invalid = {
    ...valid,
    base: "/",
    cleanUrls: false,
    outDir: "/workspace/website/dist/not-docs",
    srcExclude: ["**/planet/**"],
    themeConfig: { search: { provider: "remote" } },
    locales: { root: { lang: "en" }, en: { lang: "zh", link: "/" } },
    sourceComment: "DOCS_BASE provider: local srcExclude plan",
  };
  const failures = vitePressConfigFailures(invalid, expectedOutDir);
  assert.equal(failures.length, 8);
  assert.equal(failures.some((failure) => failure.includes("end in /docs/")), true);
  assert.equal(failures.some((failure) => failure.includes("local search")), true);
  assert.equal(failures.some((failure) => failure.includes("srcExclude")), true);
  assert.equal(failures.some((failure) => failure.includes("outDir")), true);
});

test("paired-page completeness rejects translated shells and structure drift", () => {
  const substantial = (title, extra = "") => `
    <h1>${title}</h1><p>${"meaningful guidance ".repeat(35)}</p>
    <h2>Workflow</h2><pre><code>pnpm check</code></pre><img src="/asset.png" alt="Asset">${extra}
  `;
  assert.deepEqual(
    pairedPageCompletenessFailures(substantial("中文"), substantial("English"), "guide/test"),
    [],
  );
  const shellFailures = pairedPageCompletenessFailures(substantial("中文"), "<h1>Stub</h1>", "guide/test");
  assert.equal(shellFailures.some((failure) => failure.includes("heading-level outlines")), true);
  assert.equal(shellFailures.some((failure) => failure.includes("code-block counts")), true);
  assert.equal(shellFailures.some((failure) => failure.includes("meaningful body substance")), true);
});

test("built route gate catches a missing non-index HTML page", () => {
  const markdown = ["index.md", "en/index.md", "en/guide/settings.md"];
  const built = ["index.html", "en/index.html"];
  assert.deepEqual(missingBuiltRouteFiles(markdown, built), ["en/guide/settings.html"]);
});

test("PNG decoder validates CRC and terminal IEND", () => {
  const valid = rgbaPng(1, 1, Buffer.from([1, 2, 3, 255]));
  const badCrc = Buffer.from(valid);
  badCrc[badCrc.length - 5] ^= 0xff;
  assert.throws(() => decodePng(badCrc), /CRC/);
  assert.throws(() => decodePng(valid.subarray(0, -12)), /IEND|truncated|missing/);
});

test("PNG decoder bounds dimensions before inflate", () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(100_000, 0);
  header.writeUInt32BE(100_000, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const bomb = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.from([0]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  assert.throws(() => decodePng(bomb), /safety limit/);

  const headerSmall = Buffer.alloc(13);
  headerSmall.writeUInt32BE(1, 0);
  headerSmall.writeUInt32BE(1, 4);
  headerSmall.set([8, 6, 0, 0, 0], 8);
  const oversizedInflation = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", headerSmall),
    pngChunk("IDAT", deflateSync(Buffer.alloc(1_000))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  assert.throws(() => decodePng(oversizedInflation), /image data|maxOutputLength|larger than/i);
});

test("PNG decoder applies grayscale and truecolor tRNS alpha", () => {
  const grayTransparency = Buffer.alloc(2);
  grayTransparency.writeUInt16BE(42);
  const gray = decodePng(pngWithColorType(2, 1, 0, Buffer.from([42, 43]), grayTransparency));
  assert.deepEqual([...gray.pixels], [42, 42, 42, 0, 43, 43, 43, 255]);

  const rgbTransparency = Buffer.alloc(6);
  rgbTransparency.writeUInt16BE(10, 0);
  rgbTransparency.writeUInt16BE(20, 2);
  rgbTransparency.writeUInt16BE(30, 4);
  const rgb = decodePng(pngWithColorType(
    2,
    1,
    2,
    Buffer.from([10, 20, 30, 10, 20, 31]),
    rgbTransparency,
  ));
  assert.deepEqual([...rgb.pixels], [10, 20, 30, 0, 10, 20, 31, 255]);
});
