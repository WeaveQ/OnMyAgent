"use strict";

const fs = require("node:fs");
const path = require("node:path");

function emit(payload, code = 0) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = code;
  return payload;
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
  countXmlTags,
  decodeXmlText,
  dependencyReport,
  emit,
  loadZip,
  parseArgs,
  requireInput,
  requiredZipText,
};
