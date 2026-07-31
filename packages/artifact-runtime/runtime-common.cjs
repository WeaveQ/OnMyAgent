"use strict";

const fs = require("node:fs");
const path = require("node:path");

function emit(payload, code = 0) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = code;
  return payload;
}

/**
 * Collect absolute/relative deliverable paths from a success payload.
 * Prefers explicit `wrote[]`, then `path`, then `outputs[].path`.
 */
function collectDeliverablePaths(payload) {
  if (!payload || typeof payload !== "object") return [];
  const paths = [];
  if (Array.isArray(payload.wrote)) {
    for (const item of payload.wrote) {
      if (typeof item === "string" && item.trim()) paths.push(item.trim());
    }
  }
  if (typeof payload.path === "string" && payload.path.trim()) {
    paths.push(payload.path.trim());
  }
  if (Array.isArray(payload.outputs)) {
    for (const item of payload.outputs) {
      if (item && typeof item.path === "string" && item.path.trim()) {
        paths.push(item.path.trim());
      }
    }
  }
  // Dedupe while preserving order.
  const seen = new Set();
  return paths.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/**
 * Emit a write success payload and register deliverables for product cards.
 *
 * Prints:
 * 1. JSON line with `deliverable: true` and normalized `wrote[]`
 * 2. One `ONMYAGENT_DELIVERABLE: <path>` line per file (machine marker)
 * 3. Human `Wrote <path>` lines (compat with existing shell scanners)
 */
function emitDeliverableResult(payload, code = 0) {
  const wrote = collectDeliverablePaths(payload);
  const enriched = {
    ...(payload && typeof payload === "object" ? payload : {}),
    deliverable: true,
    wrote,
  };
  if (typeof enriched.message !== "string" || !enriched.message.trim()) {
    enriched.message = wrote.map((item) => `Wrote ${item}`).join("\n");
  }
  process.stdout.write(`${JSON.stringify(enriched)}\n`);
  for (const item of wrote) {
    process.stdout.write(`ONMYAGENT_DELIVERABLE: ${item}\n`);
  }
  if (typeof enriched.message === "string" && enriched.message.trim()) {
    process.stdout.write(`${enriched.message}\n`);
  }
  process.exitCode = code;
  return enriched;
}

function parseArgs(argv) {
  const positional = [];
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const name = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { positional, flags };
}

function requireInput(input, extensions, label) {
  if (!input) throw new Error(`${label} requires an input path`);
  const source = path.resolve(input);
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Input file does not exist: ${source}`);
  }
  const extension = path.extname(source).toLowerCase();
  if (!extensions.has(extension)) {
    throw new Error(`Unsupported ${label} input extension: ${extension || "(none)"}`);
  }
  return source;
}

function dependencyReport(names) {
  return Object.fromEntries(
    names.map((name) => {
      try {
        require.resolve(name);
        return [name, true];
      } catch {
        return [name, false];
      }
    }),
  );
}

function countXmlTags(value, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (value.match(new RegExp(`<${escaped}(?:\\s|>)`, "g")) ?? []).length;
}

function decodeXmlText(value) {
  return value
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

async function loadZip(source) {
  const JSZip = require("jszip");
  return JSZip.loadAsync(fs.readFileSync(source));
}

async function requiredZipText(zip, name, label) {
  const entry = zip.file(name);
  if (!entry) throw new Error(`${label} package is missing ${name}`);
  return entry.async("string");
}

module.exports = {
  collectDeliverablePaths,
  countXmlTags,
  decodeXmlText,
  dependencyReport,
  emit,
  emitDeliverableResult,
  loadZip,
  parseArgs,
  requireInput,
  requiredZipText,
};
