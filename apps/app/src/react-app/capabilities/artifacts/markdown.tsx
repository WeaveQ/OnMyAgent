/** @jsxImportSource react */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Marked, type Tokens } from "marked";
import { markedEmoji } from "marked-emoji";
import markedShiki from "marked-shiki";
import emojiKeywords from "emojilib";
import {
  transformerMetaHighlight,
  transformerMetaWordHighlight,
  transformerNotationDiff,
  transformerNotationErrorLevel,
  transformerNotationFocus,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from "@shikijs/transformers";
import { bundledLanguages, codeToHtml } from "shiki";

import { StreamingCursor } from "@/components/ui/streaming-cursor";
import { t } from "@/i18n";
import { applyTextHighlights } from "./text-highlights";

const MARKDOWN_COPY_LABEL_TOKEN = "__ONMYAGENT_MARKDOWN_COPY_LABEL__";

export type MarkdownCodeFenceInfo = {
  language: string;
  filePath: string | null;
  fileName: string | null;
  startLine: number | null;
  endLine: number | null;
};

export type MarkdownInlinePath = {
  path: string;
  startLine: number | null;
  endLine: number | null;
};

export type MarkdownVerifiedCodePath = {
  path: string;
  resolvedPath: string;
};

const MARKDOWN_INLINE_PATH_RANGE = /^(.+?)#L(\d+)(?:-L(\d+))?$/;
const MARKDOWN_INLINE_FILE = /^(?:[a-zA-Z]:[\\/]|[\\/])?(?:[^\\/]+[\\/])*[^\\/]+\.[a-zA-Z0-9]+$/;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function safeHref(href: string) {
  const trimmed = href.trim();
  if (!trimmed) return "#";
  if (trimmed.startsWith("#") || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) return trimmed;
  } catch {
    return "#";
  }
  return "#";
}

function alignAttribute(align: Tokens.TableCell["align"]) {
  return align ? ` style="text-align: ${align}"` : "";
}

function codeLanguageClass(lang: string | undefined) {
  const normalized = lang?.trim().split(/\s+/)[0];
  return normalized ? ` class="language-${escapeAttribute(normalized)}"` : "";
}

function codeFenceFileName(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function positiveLineNumber(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : null;
}

export function parseMarkdownCodeFenceInfo(rawLanguage: string | undefined): MarkdownCodeFenceInfo {
  const raw = rawLanguage?.trim().split(/\s+/)[0] ?? "";
  const withLanguageAndColonRange = raw.match(/^([a-zA-Z][a-zA-Z0-9]*):(\d+):(\d+):(.+)$/);
  const withLanguageAndDashRange = raw.match(/^([a-zA-Z][a-zA-Z0-9]*):(\d+)-(\d+):(.+)$/);
  const withColonRange = raw.match(/^(\d+):(\d+):(.+)$/);
  const match = withLanguageAndColonRange ?? withLanguageAndDashRange ?? withColonRange;
  if (!match) {
    return {
      language: raw,
      filePath: null,
      fileName: null,
      startLine: null,
      endLine: null,
    };
  }

  const hasLanguage = match.length === 5;
  const filePath = match[hasLanguage ? 4 : 3] ?? "";
  return {
    language: hasLanguage ? match[1] ?? "" : "",
    filePath,
    fileName: codeFenceFileName(filePath),
    startLine: positiveLineNumber(match[hasLanguage ? 2 : 1] ?? ""),
    endLine: positiveLineNumber(match[hasLanguage ? 3 : 2] ?? ""),
  };
}

export function parseMarkdownInlinePath(code: string): MarkdownInlinePath | null {
  const trimmed = code.trim();
  const range = trimmed.match(MARKDOWN_INLINE_PATH_RANGE);
  const path = range?.[1] ?? trimmed;
  if (!MARKDOWN_INLINE_FILE.test(path)) return null;
  return {
    path,
    startLine: range?.[2] ? positiveLineNumber(range[2]) : null,
    endLine: range?.[3] ? positiveLineNumber(range[3]) : null,
  };
}

export function truncateMarkdownPathDisplay(text: string, maxLength = 40) {
  if (text.length <= maxLength) return text;
  const separatorIndex = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  const fileName = separatorIndex >= 0 ? text.slice(separatorIndex + 1) : text;
  const directory = separatorIndex >= 0 ? text.slice(0, separatorIndex + 1) : "";
  if (!directory || fileName.length >= maxLength - 4) {
    const available = maxLength - 3;
    const head = Math.ceil(available / 2);
    const tail = Math.floor(available / 2);
    return `${text.slice(0, head)}...${text.slice(text.length - tail)}`;
  }
  const directoryBudget = maxLength - fileName.length - 3;
  return `${directory.slice(0, Math.max(1, directoryBudget))}...${fileName}`;
}

function resolveVerifiedCodePath(paths: readonly MarkdownVerifiedCodePath[], path: string) {
  const normalizedPath = path.replace(/[\\]+/g, "/").replace(/^\.\//, "");
  return paths.find((candidate) => (
    candidate.path === normalizedPath || candidate.path.endsWith(`/${normalizedPath}`)
  ))?.resolvedPath ?? null;
}

function markdownCodeCopyButton() {
  return `<button type="button" data-markdown-code-copy class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-focus" title="${MARKDOWN_COPY_LABEL_TOKEN}" aria-label="${MARKDOWN_COPY_LABEL_TOKEN}"><span data-markdown-copy-default aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></span><span data-markdown-copy-success aria-hidden="true" hidden><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m20 6-11 11-5-5"></path></svg></span></button>`;
}

function markdownCodeHeader(info: MarkdownCodeFenceInfo) {
  const title = info.fileName || info.language || "code";
  const lineRange = info.startLine && info.endLine
    ? `<span class="ml-2 font-normal text-dls-secondary">L${info.startLine}-L${info.endLine}</span>`
    : "";
  const pathAttribute = info.filePath
    ? ` data-markdown-code-path="${escapeAttribute(info.filePath)}" title="${escapeAttribute(info.filePath)}"`
    : " disabled";
  return `<div class="flex min-h-9 items-center justify-between gap-3 border-b border-dls-mist bg-dls-surface-muted px-3"><button type="button" data-markdown-code-title class="min-w-0 truncate font-mono text-xs font-medium text-dls-secondary disabled:cursor-default"${pathAttribute}>${escapeHtml(title)}${lineRange}</button>${markdownCodeCopyButton()}</div>`;
}

function localizeMarkdownHtml(html: string, copyLabel: string) {
  return html.replaceAll(MARKDOWN_COPY_LABEL_TOKEN, escapeAttribute(copyLabel));
}

function createEmojiAliases() {
  const aliases: Record<string, string> = {};
  for (const [emoji, names] of Object.entries(emojiKeywords)) {
    for (const name of names) {
      if (aliases[name] === undefined) aliases[name] = emoji;
    }
  }
  return aliases;
}

const emojiAliases = createEmojiAliases();

function normalizeShikiLanguage(lang: string) {
  const normalized = lang.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return normalized in bundledLanguages ? normalized : "text";
}

function hasFencedCodeBlock(text: string) {
  return /(^|\n)```/.test(text);
}

const shikiAllowedTags = new Set(["div", "pre", "code", "span"]);
const shikiAllowedAttributes = new Set([
  "class",
  "data-onmyagent-shiki",
  "style",
  "tabindex",
]);
const shikiAllowedStyleProperties = new Set([
  "background-color",
  "color",
  "font-style",
  "font-weight",
  "text-decoration",
]);

function isSafeShikiStyle(value: string) {
  const declarations = value.split(";").map((item) => item.trim()).filter(Boolean);
  if (!declarations.length) return true;
  return declarations.every((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator <= 0) return false;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const rawValue = declaration.slice(separator + 1).trim().toLowerCase();
    if (!shikiAllowedStyleProperties.has(property)) return false;
    if (/url\s*\(|expression\s*\(|@import|javascript:|data:/i.test(rawValue)) return false;
    return /^#[0-9a-f]{3,8}$/i.test(rawValue) || /^[a-z-]+$/i.test(rawValue) || /^[0-9.]+$/.test(rawValue);
  });
}

function isSafeShikiHtml(text: string) {
  if (!text.includes('data-onmyagent-shiki="true"')) return false;
  if (/<\s*(script|style|iframe|object|embed|link|meta|img|svg|math)\b/i.test(text)) return false;

  const tagPattern = /<\/?([a-z][a-z0-9-]*)(\s[^>]*)?>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(text)) !== null) {
    const tagName = match[1].toLowerCase();
    if (!shikiAllowedTags.has(tagName)) return false;

    const attributesText = match[2] ?? "";
    const attributePattern = /([:@a-zA-Z0-9_-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
    let attributeMatch: RegExpExecArray | null;
    while ((attributeMatch = attributePattern.exec(attributesText)) !== null) {
      const attributeName = attributeMatch[1].toLowerCase();
      if (!shikiAllowedAttributes.has(attributeName)) return false;
      if (attributeName.startsWith("on")) return false;

      const rawAttributeValue = attributeMatch[2] ?? "";
      const attributeValue = rawAttributeValue.replace(/^['"]|['"]$/g, "");
      if (/javascript:|data:/i.test(attributeValue)) return false;
      if (attributeName === "style" && !isSafeShikiStyle(attributeValue)) return false;
    }
  }

  return true;
}

const baseMarkedOptions = {
  async: false,
  breaks: false,
  gfm: true,
  pedantic: false,
  silent: true,
  renderer: {
    html({ text }) {
      return isSafeShikiHtml(text) ? text : "";
    },
    paragraph({ tokens }) {
      return `<p class="my-3 leading-relaxed">${this.parser.parseInline(tokens)}</p>`;
    },
    heading({ tokens, depth }) {
      const className = depth === 1
        ? "my-5 text-lg font-medium"
        : depth === 2
          ? "my-4 text-base font-medium"
          : "my-3 text-sm font-medium";
      return `<h${depth} class="${className}">${this.parser.parseInline(tokens)}</h${depth}>`;
    },
    list(token) {
      const tag = token.ordered ? "ol" : "ul";
      const className = token.ordered ? "my-3 list-decimal pl-6" : "my-3 list-disc pl-6";
      const start = token.ordered && typeof token.start === "number" && token.start !== 1
        ? ` start="${token.start}"`
        : "";
      return `<${tag}${start} class="${className}">${token.items.map((item) => this.listitem(item)).join("")}</${tag}>`;
    },
    listitem(item) {
      const checkbox = item.task
        ? `<input disabled="" type="checkbox"${item.checked ? " checked=\"\"" : ""}> `
        : "";
      return `<li class="my-1">${checkbox}${this.parser.parse(item.tokens)}</li>`;
    },
    blockquote({ tokens }) {
      return `<blockquote class="my-4 rounded-r-lg border-l border-dls-border bg-dls-surface-muted px-4 py-2 italic text-muted-foreground">${this.parser.parse(tokens)}</blockquote>`;
    },
    code({ text, lang }) {
      const info = parseMarkdownCodeFenceInfo(lang);
      return `<div data-markdown-code-block class="my-4 overflow-hidden rounded-xl border border-dls-mist bg-dls-surface-muted">${markdownCodeHeader(info)}<pre class="overflow-x-auto px-4 py-3 text-xs leading-6 text-muted-foreground"><code${codeLanguageClass(info.language)}>${escapeHtml(text)}</code></pre></div>`;
    },
    codespan({ text }) {
      return `<code data-markdown-inline-code="${escapeAttribute(text)}" class="rounded-md bg-dls-surface-muted px-1.5 py-0.5 font-mono text-sm text-foreground">${escapeHtml(text)}</code>`;
    },
    del({ raw, tokens }) {
      if (!raw.startsWith("~~")) return escapeHtml(raw);
      return `<del>${this.parser.parseInline(tokens)}</del>`;
    },
    link({ href, title, tokens }) {
      const safe = escapeAttribute(safeHref(href));
      const titleAttr = title ? ` title="${escapeAttribute(title)}"` : "";
      return `<a href="${safe}"${titleAttr} target="_blank" rel="noreferrer noopener" class="text-dls-accent underline underline-offset-2 transition-colors hover:text-dls-accent-hover">${this.parser.parseInline(tokens)}</a>`;
    },
    image({ href, title, text }) {
      const safe = escapeAttribute(safeHref(href));
      const titleAttr = title ? ` title="${escapeAttribute(title)}"` : "";
      return `<img src="${safe}" alt="${escapeAttribute(text)}"${titleAttr} loading="lazy" decoding="async" class="my-4 max-w-full rounded-xl border border-dls-mist">`;
    },
    table(token) {
      const header = token.header.map((cell) => this.tablecell({ ...cell, header: true })).join("");
      const body = token.rows.map((row) => this.tablerow({ text: row.map((cell) => this.tablecell(cell)).join("") })).join("");
      return `<div class="my-4 overflow-x-auto rounded-xl border border-dls-mist"><table class="w-full min-w-max border-collapse"><thead>${this.tablerow({ text: header })}</thead><tbody>${body}</tbody></table></div>`;
    },
    tablerow({ text }) {
      return `<tr>${text}</tr>`;
    },
    tablecell({ tokens, header, align }) {
      const tag = header ? "th" : "td";
      const className = header
        ? "border border-dls-border bg-dls-surface-muted p-2 text-left"
        : "border border-dls-border bg-dls-surface-muted p-2 align-top";
      return `<${tag}${alignAttribute(align)} class="${className}">${this.parser.parseInline(tokens)}</${tag}>`;
    },
    hr() {
      return `<hr class="my-6 border-none h-px bg-dls-active">`;
    },
  },
} satisfies ConstructorParameters<typeof Marked<string, string>>[0];

const markdownParser = new Marked<string, string>(baseMarkedOptions).use(
  markedEmoji({
    emojis: emojiAliases,
    renderer: (token) => escapeHtml(token.emoji),
  }),
);

const highlightedMarkdownParser = new Marked<string, string>({
  ...baseMarkedOptions,
  async: true,
}).use(
  markedEmoji({
    emojis: emojiAliases,
    renderer: (token) => escapeHtml(token.emoji),
  }),
  markedShiki({
    async highlight(code, lang, props) {
      const info = parseMarkdownCodeFenceInfo(lang);
      const language = normalizeShikiLanguage(info.language || lang);
      const html = await codeToHtml(code, {
        lang: language,
        meta: { __raw: props.join(" ") },
        theme: "github-light",
        transformers: [
          transformerNotationDiff({ matchAlgorithm: "v3" }),
          transformerNotationHighlight({ matchAlgorithm: "v3" }),
          transformerNotationWordHighlight({ matchAlgorithm: "v3" }),
          transformerNotationFocus({ matchAlgorithm: "v3" }),
          transformerNotationErrorLevel({ matchAlgorithm: "v3" }),
          transformerMetaHighlight(),
          transformerMetaWordHighlight(),
        ],
      });
      const fileName = info.fileName ? ` data-markdown-highlight-file-name="${escapeAttribute(info.fileName)}"` : "";
      const filePath = info.filePath ? ` data-markdown-highlight-file-path="${escapeAttribute(info.filePath)}"` : "";
      const startLine = info.startLine ? ` data-markdown-highlight-start-line="${info.startLine}"` : "";
      const endLine = info.endLine ? ` data-markdown-highlight-end-line="${info.endLine}"` : "";
      return `<div data-markdown-highlight-language="${escapeAttribute(language)}"${fileName}${filePath}${startLine}${endLine}>${html}</div>`;
    },
    container: `<div data-onmyagent-shiki="true" data-markdown-code-block class="my-4 overflow-hidden rounded-xl border border-dls-mist bg-dls-surface-muted">${markdownCodeHeader(parseMarkdownCodeFenceInfo(undefined))}<div class="overflow-x-auto p-4 text-xs leading-6">%s</div></div>`,
  }),
);

function MarkdownBlockInner(props: {
  text: string;
  streaming?: boolean;
  highlightQuery?: string;
  locale?: string;
  onOpenCodePath?: (path: string) => void;
  verifiedCodePaths?: readonly MarkdownVerifiedCodePath[];
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const syncHtml = useMemo(() => {
    if (!props.text.trim()) return "";
    return markdownParser.parse(props.text, { async: false });
  }, [props.text]);
  const [highlightedHtml, setHighlightedHtml] = useState<{ text: string; html: string } | null>(null);

  useEffect(() => {
    if (props.streaming || !hasFencedCodeBlock(props.text)) {
      setHighlightedHtml(null);
      return;
    }

    let cancelled = false;
    void highlightedMarkdownParser.parse(props.text, { async: true }).then((html) => {
      if (!cancelled && html.trim()) setHighlightedHtml({ text: props.text, html });
    }).catch(() => {
      if (!cancelled) setHighlightedHtml(null);
    });
    return () => {
      cancelled = true;
    };
  }, [props.streaming, props.text]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    queueMicrotask(() => {
      if (!rootRef.current || rootRef.current !== root) return;
      applyTextHighlights(root, props.highlightQuery ?? "");
    });
  }, [props.highlightQuery, props.streaming, props.text]);

  const copyLabel = t("common.copy");
  const copiedLabel = t("common.copied");
  const html = localizeMarkdownHtml(
    highlightedHtml?.text === props.text ? highlightedHtml.html : syncHtml,
    copyLabel,
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("[data-markdown-code-block]").forEach((block) => {
      const metadata = block.querySelector<HTMLElement>("[data-markdown-highlight-language]");
      const title = block.querySelector<HTMLButtonElement>("[data-markdown-code-title]");
      if (!metadata || !title) return;
      const language = metadata.dataset.markdownHighlightLanguage ?? "code";
      const fileName = metadata.dataset.markdownHighlightFileName;
      const filePath = metadata.dataset.markdownHighlightFilePath;
      const startLine = metadata.dataset.markdownHighlightStartLine;
      const endLine = metadata.dataset.markdownHighlightEndLine;
      title.replaceChildren(document.createTextNode(fileName || language));
      if (startLine && endLine) {
        const range = document.createElement("span");
        range.className = "ml-2 font-normal text-dls-secondary";
        range.textContent = `L${startLine}-L${endLine}`;
        title.append(range);
      }
      if (filePath) {
        title.disabled = false;
        title.dataset.markdownCodePath = filePath;
        title.title = filePath;
      }
    });
    root.querySelectorAll<HTMLButtonElement>("button[data-markdown-code-path]").forEach((pathButton) => {
      const path = pathButton.dataset.markdownCodePath ?? "";
      const resolvedPath = resolveVerifiedCodePath(props.verifiedCodePaths ?? [], path);
      if (resolvedPath) {
        pathButton.dataset.markdownCodePath = resolvedPath;
        return;
      }
      pathButton.disabled = true;
      pathButton.removeAttribute("data-markdown-code-path");
      pathButton.removeAttribute("title");
    });
    root.querySelectorAll<HTMLElement>("[data-markdown-inline-code]").forEach((inlineCode) => {
      const rawCode = inlineCode.dataset.markdownInlineCode ?? "";
      const detected = parseMarkdownInlinePath(rawCode);
      const resolvedPath = detected
        ? resolveVerifiedCodePath(props.verifiedCodePaths ?? [], detected.path)
        : null;
      if (!detected || !resolvedPath) return;
      inlineCode.dataset.markdownCodePath = resolvedPath;
      inlineCode.setAttribute("role", "button");
      inlineCode.tabIndex = 0;
      inlineCode.title = t("files.open_file");
      inlineCode.classList.add("cursor-pointer", "text-dls-accent", "hover:bg-dls-hover");
      inlineCode.textContent = truncateMarkdownPathDisplay(rawCode);
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("width", "14");
      icon.setAttribute("height", "14");
      icon.setAttribute("fill", "none");
      icon.setAttribute("stroke", "currentColor");
      icon.setAttribute("stroke-width", "2");
      icon.setAttribute("stroke-linecap", "round");
      icon.setAttribute("stroke-linejoin", "round");
      icon.setAttribute("aria-hidden", "true");
      icon.classList.add("mr-1", "inline-block", "align-text-bottom");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z");
      const fold = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      fold.setAttribute("points", "14 2 14 8 20 8");
      icon.append(path, fold);
      inlineCode.prepend(icon);
    });
    const resetTimers = new Set<number>();
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const pathLabel = target.closest<HTMLElement>("[data-markdown-code-path]");
      const path = pathLabel?.dataset.markdownCodePath;
      if (path && props.onOpenCodePath) {
        props.onOpenCodePath(path);
        return;
      }

      const button = target.closest<HTMLButtonElement>("[data-markdown-code-copy]");
      if (!button) return;
      const block = button.closest<HTMLElement>("[data-markdown-code-block]");
      const code = block?.querySelector("code")?.textContent ?? "";
      if (!code) return;
      void navigator.clipboard.writeText(code).then(() => {
        button.title = copiedLabel;
        button.setAttribute("aria-label", copiedLabel);
        button.querySelector<HTMLElement>("[data-markdown-copy-default]")?.setAttribute("hidden", "");
        button.querySelector<HTMLElement>("[data-markdown-copy-success]")?.removeAttribute("hidden");
        const timer = window.setTimeout(() => {
          button.title = copyLabel;
          button.setAttribute("aria-label", copyLabel);
          button.querySelector<HTMLElement>("[data-markdown-copy-default]")?.removeAttribute("hidden");
          button.querySelector<HTMLElement>("[data-markdown-copy-success]")?.setAttribute("hidden", "");
          resetTimers.delete(timer);
        }, 2_000);
        resetTimers.add(timer);
      }).catch(() => undefined);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches("[data-markdown-inline-code][data-markdown-code-path]")) return;
      event.preventDefault();
      target.click();
    };
    root.addEventListener("click", handleClick);
    root.addEventListener("keydown", handleKeyDown);
    return () => {
      root.removeEventListener("click", handleClick);
      root.removeEventListener("keydown", handleKeyDown);
      resetTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [copyLabel, copiedLabel, html, props.onOpenCodePath, props.verifiedCodePaths]);

  if (!html && !props.streaming) return null;

  return (
    <div className="markdown-content max-w-none text-dls-text">
      {html ? (
        <div
          ref={rootRef}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : null}
      {props.streaming ? <StreamingCursor className="ml-0.5" /> : null}
    </div>
  );
}

/**
 * Memoize so a message block that has already been rendered — the usual
 * case for every assistant bubble above the currently-streaming one —
 * doesn't re-parse its markdown on every token. Only re-renders when its
 * own text / streaming / highlightQuery props change.
 */
export const MarkdownBlock = memo(MarkdownBlockInner);
MarkdownBlock.displayName = "MarkdownBlock";
