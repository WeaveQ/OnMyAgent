import { inflateSync } from "node:zlib";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_CHANNELS = new Map([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4],
]);
const MAX_PNG_DIMENSION = 16_384;
const MAX_PNG_PIXELS = 40_000_000;
const MAX_PNG_OUTPUT_BYTES = 160_000_000;
const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);
const SAFE_IMAGE_SCHEMES = new Set(["http:", "https:"]);

function decodeHtmlAttribute(value) {
  const named = new Map([
    ["amp", "&"],
    ["apos", "'"],
    ["colon", ":"],
    ["gt", ">"],
    ["lt", "<"],
    ["quot", '"'],
  ]);
  return value.replace(
    /&(?:#(\d+);?|#x([\da-f]+);?|([a-z][\w]+);)/gi,
    (entity, decimal, hexadecimal, name) => {
      if (name) return named.get(name.toLowerCase()) ?? entity;
      const codePoint = Number.parseInt(decimal ?? hexadecimal, hexadecimal ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return "\ufffd";
      return String.fromCodePoint(codePoint);
    },
  );
}

function attributesForTag(tag) {
  const attributes = new Map();
  const pattern = /\b([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) {
      attributes.set(
        name,
        decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? ""),
      );
    }
  }
  return attributes;
}

function scanRenderedTags(html) {
  const tags = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) break;
    if (html.startsWith("<!--", start)) {
      const commentEnd = html.indexOf("-->", start + 4);
      cursor = commentEnd < 0 ? html.length : commentEnd + 3;
      continue;
    }
    let quote = null;
    let end = start + 1;
    for (; end < html.length; end += 1) {
      const character = html[end];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
    }
    if (end >= html.length) break;
    const source = html.slice(start, end + 1);
    const nameMatch = source.match(/^<\s*(\/)?\s*([a-z][\w:-]*)\b/i);
    cursor = end + 1;
    if (!nameMatch) continue;
    const closing = Boolean(nameMatch[1]);
    const name = nameMatch[2].toLowerCase();
    if (!closing && (name === "script" || name === "style")) {
      const closingPattern = new RegExp(`<\\/\\s*${name}\\s*>`, "gi");
      closingPattern.lastIndex = cursor;
      const closingMatch = closingPattern.exec(html);
      cursor = closingMatch ? closingPattern.lastIndex : html.length;
      continue;
    }
    if (!closing) tags.push({ name, attributes: attributesForTag(source) });
  }
  return tags;
}

export function extractRenderedResources(html) {
  const tags = scanRenderedTags(html);
  return {
    links: tags
      .filter((tag) => tag.name === "a")
      .map((tag) => tag.attributes.get("href"))
      .filter((value) => typeof value === "string" && value.length > 0),
    images: tags
      .filter((tag) => tag.name === "img")
      .map((tag) => ({
        src: tag.attributes.get("src") ?? "",
        alt: tag.attributes.get("alt") ?? "",
      }))
      .filter((image) => image.src.length > 0),
  };
}

export function extractRenderedIds(html) {
  return new Set(
    scanRenderedTags(html)
      .map((tag) => tag.attributes.get("id"))
      .filter((value) => typeof value === "string" && value.length > 0),
  );
}

export function classifyResourceUrl(target, kind = "link") {
  const value = String(target ?? "").replace(/[\u0009\u000a\u000d]/g, "").trim();
  if (!value) return { type: "unsafe", reason: "empty URL" };
  if (value.startsWith("//")) return { type: "external" };
  const scheme = value.match(/^([a-z][a-z\d+.-]*:)/i)?.[1].toLowerCase();
  if (!scheme) return { type: "local" };
  const safeSchemes = kind === "image" ? SAFE_IMAGE_SCHEMES : SAFE_LINK_SCHEMES;
  if (safeSchemes.has(scheme)) return { type: "external" };
  return { type: "unsafe", reason: `disallowed ${kind} URL scheme ${scheme}` };
}

function withoutQueryOrFragment(target) {
  return target.split(/[?#]/, 1)[0];
}

export function localSourceImagePath(target, relativeMarkdownFile, docsDir) {
  const rawPath = withoutQueryOrFragment(target);
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  const root = resolve(docsDir);
  const candidate = decodedPath.startsWith("/")
    ? resolve(root, "public", decodedPath.replace(/^\/+/, ""))
    : resolve(root, dirname(relativeMarkdownFile), decodedPath);
  const rel = relative(root, candidate);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) {
    return candidate;
  }
  return null;
}

function resolveInside(rootDir, relativePath) {
  const candidate = resolve(rootDir, relativePath);
  const rel = relative(rootDir, candidate);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) {
    return candidate;
  }
  return null;
}

export function localBuiltAssetPath(pathname, {
  base,
  landingBase,
  distDir,
  docsOutputDir,
}) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decodedPath.startsWith(base)) {
    return resolveInside(docsOutputDir, decodedPath.slice(base.length));
  }
  if (decodedPath.startsWith(landingBase)) {
    return resolveInside(distDir, decodedPath.slice(landingBase.length));
  }
  return null;
}

export function checkModeFromArgs(args) {
  const allowed = new Set(["--source-only", "--require-dist"]);
  const unknown = args.filter((arg) => !allowed.has(arg));
  if (unknown.length > 0) throw new Error(`unknown checker option: ${unknown.join(", ")}`);
  if (args.includes("--source-only") && args.includes("--require-dist")) {
    throw new Error("checker modes --source-only and --require-dist are mutually exclusive");
  }
  return args.includes("--require-dist") ? "require-dist" : "source-only";
}

export function distRequirementFailures(mode, distExists) {
  return mode === "require-dist" && !distExists
    ? ["dist is required but missing; run the website build before --require-dist"]
    : [];
}

function renderedOutline(html) {
  const tags = scanRenderedTags(html);
  return tags
    .filter((tag) => /^h[1-6]$/.test(tag.name))
    .map((tag) => Number(tag.name[1]));
}

function meaningfulUnits(html) {
  const visible = html
    .replace(/<!--(?:[\s\S]*?)-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:[a-z]+|#\d+|#x[\da-f]+);/gi, " ");
  return visible.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]|[\p{L}\p{N}]+/gu)?.length ?? 0;
}

export function pairedPageCompletenessFailures(chineseHtml, englishHtml, route = "page") {
  const failures = [];
  const chineseOutline = renderedOutline(chineseHtml);
  const englishOutline = renderedOutline(englishHtml);
  if (chineseOutline.filter((level) => level === 1).length !== 1) {
    failures.push(`${route}: Chinese page must have exactly one H1`);
  }
  if (englishOutline.filter((level) => level === 1).length !== 1) {
    failures.push(`${route}: English page must have exactly one H1`);
  }
  if (chineseOutline.join(",") !== englishOutline.join(",")) {
    failures.push(`${route}: zh/en heading-level outlines differ`);
  }
  const chineseCodeBlocks = (chineseHtml.match(/<pre\b/gi) ?? []).length;
  const englishCodeBlocks = (englishHtml.match(/<pre\b/gi) ?? []).length;
  if (chineseCodeBlocks !== englishCodeBlocks) {
    failures.push(`${route}: zh/en code-block counts differ (${chineseCodeBlocks}/${englishCodeBlocks})`);
  }
  const chineseUnits = meaningfulUnits(chineseHtml);
  const englishUnits = meaningfulUnits(englishHtml);
  if (chineseUnits < 30 || englishUnits < 30) {
    failures.push(`${route}: paired pages need meaningful body substance (${chineseUnits}/${englishUnits})`);
  } else if (Math.min(chineseUnits, englishUnits) / Math.max(chineseUnits, englishUnits) < 0.3) {
    failures.push(`${route}: paired page substance is materially imbalanced (${chineseUnits}/${englishUnits})`);
  }
  return failures;
}

export function localeRouteOrderMismatches(chineseRoutes, englishRoutes) {
  const mismatches = [];
  const maxRoutes = Math.max(chineseRoutes.length, englishRoutes.length);
  for (let index = 0; index < maxRoutes; index += 1) {
    if (chineseRoutes[index] !== englishRoutes[index]) {
      mismatches.push({
        index,
        chinese: chineseRoutes[index],
        english: englishRoutes[index],
      });
    }
  }
  return mismatches;
}

export function lacksRequiredImageDisclosure(image, pageText, requiredPattern) {
  return !requiredPattern.test(image.alt ?? "") && !requiredPattern.test(pageText);
}

export function vitePressConfigFailures(config, expectedOutDir) {
  const failures = [];
  const base = config?.base;
  if (typeof base !== "string" || !base.startsWith("/") || !base.endsWith("/")) {
    failures.push(`vitepress base must be an absolute trailing-slash path: ${String(base)}`);
  } else if (!base.endsWith("/docs/")) {
    failures.push(`vitepress handbook base must end in /docs/: ${base}`);
  }
  if (config?.themeConfig?.search?.provider !== "local") {
    failures.push("local search not configured in the imported VitePress config");
  }
  if (!(config?.srcExclude ?? []).some((pattern) => String(pattern).split(/[\\/]/).includes("plan"))) {
    failures.push("plan/ not excluded by imported VitePress srcExclude");
  }
  if (expectedOutDir && resolve(String(config?.outDir ?? "")) !== resolve(expectedOutDir)) {
    failures.push(`VitePress outDir must resolve to ${resolve(expectedOutDir)}: ${String(config?.outDir)}`);
  }
  if (config?.cleanUrls !== true) failures.push("VitePress cleanUrls must stay enabled");
  const rootLocale = config?.locales?.root;
  const englishLocale = config?.locales?.en;
  if (rootLocale?.lang !== "zh-CN") failures.push(`root locale lang must be zh-CN: ${String(rootLocale?.lang)}`);
  if (englishLocale?.lang !== "en-US") failures.push(`English locale lang must be en-US: ${String(englishLocale?.lang)}`);
  if (englishLocale?.link !== "/en/") failures.push(`English locale link must be /en/: ${String(englishLocale?.link)}`);
  return failures;
}

export function missingBuiltRouteFiles(markdownFiles, builtHtmlFiles) {
  const built = new Set(builtHtmlFiles);
  return markdownFiles
    .map((file) => file.replace(/\.md$/, ".html"))
    .filter((file) => !built.has(file));
}

let crcTable;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[n] = value >>> 0;
  }
  return crcTable;
}

export function pngCrc32(data) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function unfilterScanlines(raw, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const expectedLength = height * (stride + 1);
  if (raw.length !== expectedLength) {
    throw new Error(`inflated data length ${raw.length} does not match ${expectedLength}`);
  }
  const pixels = Buffer.alloc(stride * height);
  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[sourceOffset];
    sourceOffset += 1;
    const rowOffset = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const value = raw[sourceOffset + column];
      const left = column >= bytesPerPixel ? pixels[rowOffset + column - bytesPerPixel] : 0;
      const up = row > 0 ? pixels[rowOffset + column - stride] : 0;
      const upperLeft = row > 0 && column >= bytesPerPixel
        ? pixels[rowOffset + column - stride - bytesPerPixel]
        : 0;
      let decoded;
      if (filter === 0) decoded = value;
      else if (filter === 1) decoded = value + left;
      else if (filter === 2) decoded = value + up;
      else if (filter === 3) decoded = value + Math.floor((left + up) / 2);
      else if (filter === 4) decoded = value + paeth(left, up, upperLeft);
      else throw new Error(`unsupported PNG filter ${filter}`);
      pixels[rowOffset + column] = decoded & 0xff;
    }
    sourceOffset += stride;
  }
  return pixels;
}

function toRgba(pixels, width, height, colorType, palette, transparency) {
  const rgba = Buffer.alloc(width * height * 4);
  const pixelCount = width * height;
  const transparentGray = colorType === 0 && transparency ? transparency.readUInt16BE(0) : null;
  const transparentRgb = colorType === 2 && transparency
    ? [
        transparency.readUInt16BE(0),
        transparency.readUInt16BE(2),
        transparency.readUInt16BE(4),
      ]
    : null;
  for (let index = 0; index < pixelCount; index += 1) {
    const target = index * 4;
    if (colorType === 0) {
      const gray = pixels[index];
      rgba.set([gray, gray, gray, gray === transparentGray ? 0 : 255], target);
    } else if (colorType === 2) {
      const source = index * 3;
      const rgb = [pixels[source], pixels[source + 1], pixels[source + 2]];
      const alpha = transparentRgb && rgb.every((value, channel) => value === transparentRgb[channel])
        ? 0
        : 255;
      rgba.set([...rgb, alpha], target);
    } else if (colorType === 3) {
      const paletteIndex = pixels[index];
      const source = paletteIndex * 3;
      if (!palette || source + 2 >= palette.length) throw new Error("indexed PNG has an invalid palette reference");
      rgba.set([
        palette[source],
        palette[source + 1],
        palette[source + 2],
        transparency?.[paletteIndex] ?? 255,
      ], target);
    } else if (colorType === 4) {
      const source = index * 2;
      const gray = pixels[source];
      rgba.set([gray, gray, gray, pixels[source + 1]], target);
    } else if (colorType === 6) {
      pixels.copy(rgba, target, target, target + 4);
    }
  }
  return rgba;
}

export function decodePng(data) {
  if (!Buffer.isBuffer(data) || data.length < 45 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("invalid PNG signature or truncated file");
  }
  let offset = 8;
  let header;
  let palette;
  let transparency;
  let sawEnd = false;
  const compressedParts = [];
  while (offset < data.length) {
    if (offset + 12 > data.length) throw new Error("truncated PNG chunk header");
    const length = data.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > data.length) throw new Error("truncated PNG chunk data");
    const typeBuffer = data.subarray(offset + 4, offset + 8);
    const type = typeBuffer.toString("ascii");
    const chunkData = data.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = data.readUInt32BE(offset + 8 + length);
    const actualCrc = pngCrc32(Buffer.concat([typeBuffer, chunkData]));
    if (actualCrc !== expectedCrc) throw new Error(`invalid CRC for ${type}`);
    if (!header && type !== "IHDR") throw new Error("IHDR must be the first PNG chunk");
    if (type === "IHDR") {
      if (header || length !== 13) throw new Error("invalid or duplicate IHDR");
      header = {
        width: chunkData.readUInt32BE(0),
        height: chunkData.readUInt32BE(4),
        bitDepth: chunkData[8],
        colorType: chunkData[9],
        compression: chunkData[10],
        filter: chunkData[11],
        interlace: chunkData[12],
      };
    } else if (type === "PLTE") palette = Buffer.from(chunkData);
    else if (type === "tRNS") transparency = Buffer.from(chunkData);
    else if (type === "IDAT") compressedParts.push(Buffer.from(chunkData));
    else if (type === "IEND") {
      if (length !== 0) throw new Error("IEND must be empty");
      sawEnd = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }
  if (!header || !sawEnd || offset !== data.length || compressedParts.length === 0) {
    throw new Error("PNG is missing IHDR, IDAT, or terminal IEND");
  }
  if (!header.width || !header.height) throw new Error("PNG dimensions must be positive");
  if (header.bitDepth !== 8 || !PNG_CHANNELS.has(header.colorType)) {
    throw new Error(`unsupported screenshot PNG format bitDepth=${header.bitDepth} colorType=${header.colorType}`);
  }
  if (header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    throw new Error("unsupported PNG compression, filter, or interlace method");
  }
  if (header.width > MAX_PNG_DIMENSION || header.height > MAX_PNG_DIMENSION) {
    throw new Error(`PNG dimensions exceed ${MAX_PNG_DIMENSION}px safety limit`);
  }
  const pixelCount = header.width * header.height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_PNG_PIXELS) {
    throw new Error(`PNG pixel count exceeds ${MAX_PNG_PIXELS} safety limit`);
  }
  if (header.colorType === 3 && (!palette || palette.length === 0 || palette.length % 3 !== 0)) {
    throw new Error("indexed PNG is missing a valid PLTE chunk");
  }
  if (transparency) {
    const validTransparency = (header.colorType === 0 && transparency.length === 2)
      || (header.colorType === 2 && transparency.length === 6)
      || (header.colorType === 3 && palette && transparency.length <= palette.length / 3);
    if (!validTransparency) throw new Error(`invalid tRNS chunk for color type ${header.colorType}`);
  }
  const channels = PNG_CHANNELS.get(header.colorType);
  const stride = header.width * channels;
  const expectedOutputLength = header.height * (stride + 1);
  const rgbaLength = pixelCount * 4;
  if (
    !Number.isSafeInteger(expectedOutputLength)
    || !Number.isSafeInteger(rgbaLength)
    || expectedOutputLength > MAX_PNG_OUTPUT_BYTES
    || rgbaLength > MAX_PNG_OUTPUT_BYTES
  ) {
    throw new Error(`PNG decoded output exceeds ${MAX_PNG_OUTPUT_BYTES} byte safety limit`);
  }
  let raw;
  try {
    raw = inflateSync(Buffer.concat(compressedParts), {
      maxOutputLength: expectedOutputLength,
    });
  } catch (error) {
    throw new Error(`invalid PNG image data: ${error instanceof Error ? error.message : String(error)}`);
  }
  const nativePixels = unfilterScanlines(raw, header.width, header.height, channels);
  return {
    ...header,
    pixels: toRgba(nativePixels, header.width, header.height, header.colorType, palette, transparency),
  };
}
