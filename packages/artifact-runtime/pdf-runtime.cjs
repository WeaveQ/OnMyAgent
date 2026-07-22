"use strict";

const fs = require("node:fs");
const {
  dependencyReport,
  emit,
  parseArgs,
  requireInput,
} = require("./runtime-common.cjs");

const CAPABILITIES = Object.freeze([
  "read", "create", "merge", "split", "rotate", "forms", "watermark", "inspect", "verify",
]);
const EXTENSIONS = new Set([".pdf"]);
const DEPENDENCIES = ["pdf-lib"];

async function inspectPdf(input) {
  const source = requireInput(input, EXTENSIONS, "PDF inspection");
  const bytes = fs.readFileSync(source);
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`Input does not have a PDF header: ${source}`);
  }
  const { PDFDocument } = require("pdf-lib");
  const document = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  let formFieldCount = 0;
  try {
    formFieldCount = document.getForm().getFields().length;
  } catch {
    formFieldCount = 0;
  }
  return {
    status: "success",
    runtime: "pdf",
    source,
    format: "pdf",
    page_count: document.getPageCount(),
    encrypted: /\/Encrypt\b/.test(bytes.toString("latin1")),
    form_field_count: formFieldCount,
    title: document.getTitle(),
    author: document.getAuthor(),
  };
}

async function verifyPdf(input) {
  const inspection = await inspectPdf(input);
  const issues = inspection.page_count === 0 ? ["PDF has no pages"] : [];
  return {
    status: issues.length ? "issues_found" : "success",
    runtime: "pdf",
    inspection,
    issues,
  };
}

async function runPdfRuntime(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const command = flags.has("capabilities") ? "capabilities" : positional[0];
  try {
    if (command === "capabilities") {
      return emit({
        status: "ready",
        runtime: "pdf",
        language: "javascript",
        capabilities: CAPABILITIES,
        commands: ["doctor", "inspect", "verify"],
      });
    }
    if (command === "doctor") {
      const dependencies = dependencyReport(DEPENDENCIES);
      const ready = Object.values(dependencies).every(Boolean);
      return emit({
        status: ready ? "ready" : "degraded",
        runtime: "pdf",
        language: "javascript",
        dependencies,
        capabilities: CAPABILITIES,
      }, ready ? 0 : 1);
    }
    if (command === "inspect") return emit(await inspectPdf(positional[1]));
    if (command === "verify") return emit(await verifyPdf(positional[1]));
    throw new Error("A command is required: capabilities, doctor, inspect, or verify");
  } catch (error) {
    return emit({
      status: "error",
      runtime: "pdf",
      error: error instanceof Error ? error.message : String(error),
    }, 1);
  }
}

module.exports = { inspectPdf, runPdfRuntime, verifyPdf };
