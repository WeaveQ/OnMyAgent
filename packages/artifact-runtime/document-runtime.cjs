"use strict";

const {
  countXmlTags,
  decodeXmlText,
  dependencyReport,
  emit,
  loadZip,
  parseArgs,
  requireInput,
  requiredZipText,
} = require("./runtime-common.cjs");

const CAPABILITIES = Object.freeze([
  "create",
  "read",
  "edit",
  "review",
  "comments",
  "tracked-changes",
  "styles",
  "tables",
  "headers-footers",
  "toc",
  "inspect",
  "verify",
]);
const EXTENSIONS = new Set([".docx", ".docm", ".dotx", ".dotm"]);
const DEPENDENCIES = ["docx", "jszip", "fast-xml-parser"];

async function inspectDocument(input) {
  const source = requireInput(input, EXTENSIONS, "document inspection");
  const zip = await loadZip(source);
  await requiredZipText(zip, "[Content_Types].xml", "DOCX");
  const documentXml = await requiredZipText(zip, "word/document.xml", "DOCX");
  const names = Object.keys(zip.files);
  const text = [...documentXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXmlText(match[1] ?? ""))
    .join("");
  const relationshipNames = names.filter((name) => name.endsWith(".rels"));
  let externalRelationshipCount = 0;
  for (const name of relationshipNames) {
    const relationships = await zip.file(name)?.async("string");
    if (relationships) {
      externalRelationshipCount += countXmlTags(relationships, "Relationship")
        ? (relationships.match(/TargetMode=["']External["']/g) ?? []).length
        : 0;
    }
  }
  return {
    status: "success",
    runtime: "documents",
    source,
    format: source.split(".").pop()?.toLowerCase(),
    paragraph_count: countXmlTags(documentXml, "w:p"),
    table_count: countXmlTags(documentXml, "w:tbl"),
    character_count: text.length,
    has_comments: Boolean(zip.file("word/comments.xml")),
    has_footnotes: Boolean(zip.file("word/footnotes.xml")),
    has_endnotes: Boolean(zip.file("word/endnotes.xml")),
    has_tracked_changes:
      countXmlTags(documentXml, "w:ins") > 0 || countXmlTags(documentXml, "w:del") > 0,
    header_count: names.filter((name) => /^word\/header\d+\.xml$/i.test(name)).length,
    footer_count: names.filter((name) => /^word\/footer\d+\.xml$/i.test(name)).length,
    external_relationship_count: externalRelationshipCount,
  };
}

async function verifyDocument(input) {
  const inspection = await inspectDocument(input);
  const issues = [];
  if (inspection.paragraph_count === 0 && inspection.table_count === 0) {
    issues.push("document has no paragraphs or tables");
  }
  return {
    status: issues.length ? "issues_found" : "success",
    runtime: "documents",
    inspection,
    issues,
  };
}

async function runDocumentRuntime(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const command = flags.has("capabilities") ? "capabilities" : positional[0];
  try {
    if (command === "capabilities") {
      return emit({
        status: "ready",
        runtime: "documents",
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
        runtime: "documents",
        language: "javascript",
        dependencies,
        capabilities: CAPABILITIES,
      }, ready ? 0 : 1);
    }
    if (command === "inspect") return emit(await inspectDocument(positional[1]));
    if (command === "verify") return emit(await verifyDocument(positional[1]));
    throw new Error("A command is required: capabilities, doctor, inspect, or verify");
  } catch (error) {
    return emit({
      status: "error",
      runtime: "documents",
      error: error instanceof Error ? error.message : String(error),
    }, 1);
  }
}

module.exports = { inspectDocument, runDocumentRuntime, verifyDocument };
