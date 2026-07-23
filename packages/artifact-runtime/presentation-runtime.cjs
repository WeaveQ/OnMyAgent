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
  "create", "read", "edit", "slides", "text", "images", "charts", "notes", "inspect", "verify",
]);
const EXTENSIONS = new Set([".pptx", ".pptm", ".potx", ".potm", ".ppsx", ".ppsm"]);
const DEPENDENCIES = ["pptxgenjs", "jszip", "fast-xml-parser"];

async function inspectPresentation(input) {
  const source = requireInput(input, EXTENSIONS, "presentation inspection");
  const zip = await loadZip(source);
  await requiredZipText(zip, "[Content_Types].xml", "PPTX");
  const names = Object.keys(zip.files);
  const slides = names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name));
  let textCharacterCount = 0;
  let shapeCount = 0;
  for (const slide of slides) {
    const xml = await requiredZipText(zip, slide, "PPTX");
    textCharacterCount += [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXmlText(match[1] ?? ""))
      .join("").length;
    shapeCount += countXmlTags(xml, "p:sp");
  }
  return {
    status: "success",
    runtime: "presentations",
    source,
    format: source.split(".").pop()?.toLowerCase(),
    slide_count: slides.length,
    shape_count: shapeCount,
    character_count: textCharacterCount,
    media_count: names.filter((name) => name.startsWith("ppt/media/") && !name.endsWith("/")).length,
    chart_count: names.filter((name) => /^ppt\/charts\/chart\d+\.xml$/i.test(name)).length,
    notes_count: names.filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name)).length,
  };
}

async function verifyPresentation(input) {
  const inspection = await inspectPresentation(input);
  const issues = inspection.slide_count === 0 ? ["presentation has no slides"] : [];
  return {
    status: issues.length ? "issues_found" : "success",
    runtime: "presentations",
    inspection,
    issues,
  };
}

async function runPresentationRuntime(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const command = flags.has("capabilities") ? "capabilities" : positional[0];
  try {
    if (command === "capabilities") {
      return emit({
        status: "ready",
        runtime: "presentations",
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
        runtime: "presentations",
        language: "javascript",
        dependencies,
        capabilities: CAPABILITIES,
      }, ready ? 0 : 1);
    }
    if (command === "inspect") return emit(await inspectPresentation(positional[1]));
    if (command === "verify") return emit(await verifyPresentation(positional[1]));
    throw new Error("A command is required: capabilities, doctor, inspect, or verify");
  } catch (error) {
    return emit({
      status: "error",
      runtime: "presentations",
      error: error instanceof Error ? error.message : String(error),
    }, 1);
  }
}

module.exports = { inspectPresentation, runPresentationRuntime, verifyPresentation };
