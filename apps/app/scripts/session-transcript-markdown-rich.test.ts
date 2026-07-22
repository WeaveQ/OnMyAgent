import { describe, expect, test } from "bun:test";

import {
  highlightSessionMarkdownCode,
  preprocessSessionMarkdown,
  renderSessionMarkdownHtml,
} from "../src/react-app/capabilities/artifacts/markdown";
import { localizeMarkdownMermaidMarkup } from "../src/react-app/capabilities/artifacts/markdown-mermaid";
import {
  isFullLatexDocument,
  normalizeMarkdownMathDelimiters,
} from "../src/react-app/capabilities/artifacts/markdown-math";

const labels = {
  code: "Code",
  diagram: "Diagram",
  copy: "Copy",
  copied: "Copied",
  expand: "Expand",
  collapse: "Collapse",
  theme: "Theme",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  download: "Download",
  downloadSvg: "Download SVG",
  downloadPng: "Download PNG",
  syntaxError: "Syntax error",
  copyError: "Copy error",
};

describe("session transcript rich markdown", () => {
  test("matches WorkBuddy line breaks and repeated-character truncation", () => {
    const html = renderSessionMarkdownHtml("first line\nsecond line");
    const truncated = preprocessSessionMarkdown("x".repeat(207));
    expect(html).toContain("first line<br>second line");
    expect(truncated).toContain(`${"x".repeat(200)}…[7 chars omitted]`);
  });

  test("hides internal waybill-patch fences from user-visible markdown", () => {
    const text = preprocessSessionMarkdown([
      "我已在预览中保存字段修改。",
      "",
      "```waybill-patch",
      "{\"shipper.phone\":\"138\"}",
      "```",
    ].join("\n"));
    expect(text).toContain("我已在预览中保存字段修改。");
    expect(text).not.toContain("waybill-patch");
    expect(text).not.toContain("shipper.phone");
  });

  test("uses WorkBuddy table surface hierarchy", () => {
    const html = renderSessionMarkdownHtml([
      "| Dimension | Score |",
      "| --- | --- |",
      "| Fundamentals | 8/10 |",
    ].join("\n"));

    expect(html).toContain("session-markdown-table");
    expect(html).toContain("session-markdown-table-header");
    expect(html).toContain("session-markdown-table-cell");
    expect(html).not.toContain("bg-dls-surface-muted px-4 py-2 text-left");
    expect(html).not.toContain("bg-dls-surface-muted p-2 align-top");
  });

  test("renders local artifact links as actions without visible paths", () => {
    const html = renderSessionMarkdownHtml(
      "| 文件 | 操作 |\n| --- | --- |\n| Excel 运单 | [查看](artifact:output/运单_WX-001.xlsx) |",
    );

    expect(html).toContain('data-markdown-file-path="output/运单_WX-001.xlsx"');
    expect(html).toContain('data-markdown-open-mode="preview"');
    expect(html).toContain('data-markdown-link-source="artifact"');
    expect(html).toContain(">查看</a>");
    expect(html).not.toContain(">./output/运单_WX-001.xlsx<");
  });

  test("treats plain generated file links as reveal actions", () => {
    const html = renderSessionMarkdownHtml(
      "[下载](output/物流单_WX-001_一联-白色存根_最终版.pdf)",
    );

    expect(html).toContain('data-markdown-file-path="output/物流单_WX-001_一联-白色存根_最终版.pdf"');
    expect(html).toContain('data-markdown-open-mode="reveal"');
    expect(html).not.toContain('target="_blank"');
  });

  test("treats reveal: links as folder reveal actions", () => {
    const html = renderSessionMarkdownHtml(
      "[在文件夹中显示](reveal:output/运单_WX-001.xlsx)",
    );

    expect(html).toContain('data-markdown-file-path="output/运单_WX-001.xlsx"');
    expect(html).toContain('data-markdown-open-mode="reveal"');
    expect(html).toContain('data-markdown-link-source="reveal"');
  });

  test("does not open unsupported link schemes in a new app window", () => {
    const html = renderSessionMarkdownHtml("[下载](sandbox:unknown-file.pdf)");

    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('target="_blank"');
  });

  test("renders HTML preview links as preview actions", () => {
    const html = renderSessionMarkdownHtml(
      "[查看物流单效果图](preview:output/物流单_WX-001.html)",
    );

    expect(html).toContain('data-markdown-file-path="output/物流单_WX-001.html"');
    expect(html).toContain('data-markdown-open-mode="preview"');
    expect(html).toContain(">查看物流单效果图</a>");
  });

  test("uses the neutral WorkBuddy surface for transcript quotes", () => {
    const html = renderSessionMarkdownHtml("> Data source: annual report");

    expect(html).toContain("session-markdown-muted-surface");
    expect(html).not.toContain("bg-dls-surface-muted");
  });

  test("normalizes WorkBuddy math delimiters", () => {
    expect(normalizeMarkdownMathDelimiters("Inline \\(x + y\\) and block \\[x^2\\]"))
      .toBe("Inline $x + y$ and block $$x^2$$");
  });

  test("keeps fenced blocks after a normalized display formula", () => {
    const markdown = [
      "\\[",
      "\\int_0^1 x^2\\,dx = \\frac{1}{3}",
      "\\]",
      "",
      "```latex",
      "\\frac{a}{b}",
      "```",
      "",
      "```mermaid",
      "graph TD",
      "A --> B",
      "```",
    ].join("\n");
    const html = renderSessionMarkdownHtml(markdown);
    expect(html).toContain("data-markdown-latex-block");
    expect(html).toContain("data-markdown-mermaid-block");
  });

  test("enhances ordinary code independently from special fenced blocks", async () => {
    const html = await highlightSessionMarkdownCode("const value = 1;", "typescript", false);
    expect(html).toContain("class=\"shiki");
    expect(html).toContain("<span");
    expect(html).toContain("const");
  });

  test("emits KaTeX enhancement targets for inline and block math", () => {
    const html = renderSessionMarkdownHtml("Inline $x + y$.\n\n$$\nx^2\n$$\n\n```mermaid\ngraph TD\nA --> B\n```");
    expect(html).toContain('data-markdown-math="inline"');
    expect(html).toContain('data-markdown-math="block"');
    expect(html).toContain("x^2");
    expect(html).toContain("data-markdown-mermaid-block");
  });

  test("renders latex fences as math but preserves full documents as code", () => {
    const formula = renderSessionMarkdownHtml("```latex\n\\frac{a}{b}\n```");
    const document = renderSessionMarkdownHtml("```latex\n\\documentclass{article}\n```");
    expect(formula).toContain("data-markdown-latex-block");
    expect(formula).toContain('data-markdown-math="block"');
    expect(document).not.toContain("data-markdown-latex-block");
    expect(document).toContain("language-latex");
    expect(isFullLatexDocument("\\begin{document}x\\end{document}")).toBe(true);
  });

  test("dispatches mermaid fences to the WorkBuddy diagram surface", () => {
    const html = renderSessionMarkdownHtml("```mermaid\ngraph TD\nA --> B\n```");
    expect(html).toContain("data-markdown-mermaid-block");
    expect(html).toContain('data-markdown-mermaid-action="diagram"');
    expect(html).toContain("graph TD");
    expect(html).not.toContain("data-markdown-code-block");
  });

  test("localizes mermaid controls without exposing placeholder tokens", () => {
    const html = localizeMarkdownMermaidMarkup(
      renderSessionMarkdownHtml("```mermaid\ngraph TD\nA --> B\n```"),
      labels,
    );
    expect(html).toContain(">Diagram</button>");
    expect(html).toContain("Download PNG");
    expect(html).not.toContain("__ONMYAGENT_MERMAID_");
  });
});
