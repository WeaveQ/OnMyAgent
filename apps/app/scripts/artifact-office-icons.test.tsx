import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ArtifactIcon } from "../src/react-app/capabilities/artifacts/artifact-icon";

function icon(type: Parameters<typeof ArtifactIcon>[0]["type"], name: string) {
  return renderToStaticMarkup(createElement(ArtifactIcon, { type, name }));
}

describe("WorkBuddy-style file icons", () => {
  it("uses dedicated colored document glyphs for each family", () => {
    expect(icon("document", "report.docx")).toContain('data-artifact-file-family="word"');
    expect(icon("sheet", "budget.xlsx")).toContain('data-artifact-file-family="spreadsheet"');
    expect(icon("presentation", "briefing.pptx")).toContain('data-artifact-file-family="presentation"');
    expect(icon("pdf", "brief.pdf")).toContain('data-artifact-file-family="pdf"');
    expect(icon("pdf", "invoice.ofd")).toContain('data-artifact-file-family="pdf"');
  });

  it("maps macro, template, and legacy extensions to the same family glyph", () => {
    expect(icon("document", "template.dotm")).toContain('data-artifact-file-family="word"');
    expect(icon("sheet", "model.xlsb")).toContain('data-artifact-file-family="spreadsheet"');
    expect(icon("presentation", "show.ppsx")).toContain('data-artifact-file-family="presentation"');
  });

  it("keeps URL targets as browser icons even when the URL ends in an Office extension", () => {
    expect(icon("browser", "https://example.com/report.docx")).not.toContain(
      "data-artifact-file-family",
    );
  });

  it("uses the reverse-engineered file colors and glyph families", () => {
    expect(icon("image", "page.png")).toContain('data-artifact-file-kind="image"');
    expect(icon("image", "page.png")).toContain("#5484D1");
    expect(icon("video", "demo.mp4")).toContain('data-artifact-file-kind="video"');
    expect(icon("video", "demo.mp4")).toContain("#49AB69");
    expect(icon("audio", "meeting.mp3")).toContain('data-artifact-file-kind="audio"');
  });

  it("uses the Codex file-tree builtin icons for source and text-oriented formats", () => {
    expect(icon("text", "script.py")).toContain('data-artifact-file-kind="codex-python"');
    expect(icon("external", "archive.zip")).toContain('data-artifact-file-kind="codex-zip"');
    expect(icon("text", "notes.txt")).toContain('data-artifact-file-kind="codex-text"');
    expect(icon("text", "config.json")).toContain('data-artifact-file-kind="codex-json"');
    expect(icon("markdown", "notes.md")).toContain('data-artifact-file-kind="codex-markdown"');
    expect(icon("html", "index.html")).toContain('data-artifact-file-kind="codex-html"');
    expect(icon("image", "diagram.svg")).toContain('data-artifact-file-kind="codex-svg"');
  });

  it("preserves the reverse-engineered Codex paths and adaptive colors", () => {
    expect(icon("text", "script.py")).toContain("M8.33 8.4H10");
    expect(icon("text", "script.py")).toContain("light-dark(#1a85d4, #69b1ff)");
    expect(icon("markdown", "notes.md")).toContain("M1 12V4h2l2 2.5L7 4h2v8");
    expect(icon("markdown", "notes.md")).toContain("light-dark(#199f43, #5ecc71)");
    expect(icon("html", "index.html")).toContain("M10.48 3.76");
    expect(icon("text", "config.json")).toContain("M13.25 11.5V9.75");
    expect(icon("image", "diagram.svg")).toContain("M5 7a2 2 0 0 1 2-2h6");
    expect(icon("external", "archive.zip")).toContain("M4.585 2a2 2 0 0 1 1.028.285");
    expect(icon("text", "notes.txt")).toContain("light-dark(#84848a, #adadb1)");
  });

  it("uses the neutral folded file for unsupported source and archive types", () => {
    expect(icon("text", "script.rs")).toContain('data-artifact-file-kind="default"');
    expect(icon("external", "archive.bin")).toContain('data-artifact-file-kind="default"');
    expect(icon("external", "archive.bin")).toContain("#CACAD1");
  });
});
