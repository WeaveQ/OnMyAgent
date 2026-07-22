import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ArtifactIcon } from "../src/react-app/capabilities/artifacts/artifact-icon";

function icon(type: Parameters<typeof ArtifactIcon>[0]["type"], name: string) {
  return renderToStaticMarkup(createElement(ArtifactIcon, { type, name }));
}

describe("WorkBuddy-style Office family icons", () => {
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
});
