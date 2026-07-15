import type { MarkedExtension, Tokens } from "marked";

function mathText(token: Tokens.Generic) {
  const value = token["text"];
  return typeof value === "string" ? value : "";
}

function escapeMathText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeMarkdownMathDelimiters(markdown: string) {
  return markdown
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, content: string) => `$$${content}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, content: string) => `$${content}$`);
}

export function isFullLatexDocument(latex: string) {
  return [
    /\\documentclass\b/,
    /\\begin\s*\{\s*document\s*\}/,
    /\\end\s*\{\s*document\s*\}/,
    /\\usepackage\b/,
    /\\maketitle\b/,
    /\\section\b/,
    /\\subsection\b/,
    /\\chapter\b/,
    /\\part\b/,
    /\\appendix\b/,
    /\\tableofcontents\b/,
    /\\bibliography\b/,
  ].some((pattern) => pattern.test(latex));
}

export const markdownMathExtension = {
  extensions: [
    {
      name: "markdownBlockMath",
      level: "block",
      start(src) {
        const index = src.indexOf("$$");
        return index >= 0 ? index : undefined;
      },
      tokenizer(src) {
        const match = /^\$\$\n?([\s\S]+?)\n?\$\$(?:\n|$)/.exec(src);
        if (!match) return undefined;
        return {
          type: "markdownBlockMath",
          raw: match[0],
          text: match[1] ?? "",
        };
      },
      renderer(token) {
        return `<div data-markdown-math="block" class="my-4 overflow-x-auto py-2 text-center">${escapeMathText(mathText(token))}</div>`;
      },
    },
    {
      name: "markdownInlineMath",
      level: "inline",
      start(src) {
        const index = src.indexOf("$");
        return index >= 0 ? index : undefined;
      },
      tokenizer(src) {
        const match = /^\$(?!\$)([^\n$]+?)\$(?!\$)/.exec(src);
        if (!match) return undefined;
        return {
          type: "markdownInlineMath",
          raw: match[0],
          text: match[1] ?? "",
        };
      },
      renderer(token) {
        return `<span data-markdown-math="inline">${escapeMathText(mathText(token))}</span>`;
      },
    },
  ],
} satisfies MarkedExtension<string, string>;

export async function renderMarkdownMath(root: HTMLElement) {
  const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-markdown-math]"));
  if (!targets.length) return;

  const { default: katex } = await import("katex");
  for (const target of targets) {
    if (!target.isConnected || !root.contains(target) || target.dataset.markdownMathRendered === "true") continue;
    const latex = target.textContent ?? "";
    target.innerHTML = katex.renderToString(latex, {
      displayMode: target.dataset.markdownMath === "block",
      throwOnError: false,
      errorColor: "var(--dls-status-danger-text)",
      strict: false,
      trust: false,
    });
    target.dataset.markdownMathRendered = "true";
  }
}
