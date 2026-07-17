/** @jsxImportSource react */
import { memo, useEffect, useMemo, useRef } from "react";
import { Marked, type Tokens } from "marked";
import { markedEmoji } from "marked-emoji";
import emojiKeywords from "emojilib";
import "katex/dist/katex.min.css";
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
import {
  localizeMarkdownMermaidMarkup,
  renderMarkdownMermaidMarkup,
  setupMarkdownMermaid,
  type MarkdownMermaidLabels,
} from "./markdown-mermaid";
import {
  isFullLatexDocument,
  markdownMathExtension,
  normalizeMarkdownMathDelimiters,
  renderMarkdownMath,
} from "./markdown-math";
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

function renderSpecialMarkdownCodeFence(text: string, info: MarkdownCodeFenceInfo) {
  const language = info.language.toLowerCase();
  if (language === "mermaid") return renderMarkdownMermaidMarkup(text);
  if (language === "latex" && !isFullLatexDocument(text)) {
    return `<div data-markdown-code-block data-markdown-latex-block class="my-4 overflow-hidden rounded-xl border border-dls-mist bg-dls-surface-muted">${markdownCodeHeader(info)}<div data-markdown-math="block" class="overflow-x-auto px-4 py-4 text-center">${escapeHtml(text)}</div></div>`;
  }
  return null;
}

function localizeMarkdownHtml(
  html: string,
  copyLabel: string,
  mermaidLabels: MarkdownMermaidLabels,
) {
  return localizeMarkdownMermaidMarkup(
    html.replaceAll(MARKDOWN_COPY_LABEL_TOKEN, escapeAttribute(copyLabel)),
    mermaidLabels,
  );
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

export function preprocessSessionMarkdown(markdown: string) {
  const repeatLimit = 200;
  const truncated = markdown.replace(/(.)\1{200,}/g, (match, character: string) => (
    `${character.repeat(repeatLimit)}…${t("session.markdown_chars_omitted", { count: match.length - repeatLimit })}`
  ));
  return normalizeMarkdownMathDelimiters(truncated);
}

function normalizeShikiLanguage(lang: string) {
  const normalized = lang.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return normalized in bundledLanguages ? normalized : "text";
}

const baseMarkedOptions = {
  async: false,
  breaks: true,
  gfm: true,
  pedantic: false,
  silent: true,
  renderer: {
    html() {
      return "";
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
      return `<blockquote class="session-markdown-muted-surface my-4 rounded-r-lg border-l px-4 py-2 italic text-muted-foreground">${this.parser.parse(tokens)}</blockquote>`;
    },
    code({ text, lang }) {
      const info = parseMarkdownCodeFenceInfo(lang);
      const special = renderSpecialMarkdownCodeFence(text, info);
      if (special) return special;
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
      return `<div class="session-markdown-table my-4 overflow-x-auto rounded-xl border"><table class="w-full min-w-max border-collapse"><thead>${this.tablerow({ text: header })}</thead><tbody>${body}</tbody></table></div>`;
    },
    tablerow({ text }) {
      return `<tr>${text}</tr>`;
    },
    tablecell({ tokens, header, align }) {
      const tag = header ? "th" : "td";
      const className = header
        ? "session-markdown-table-header border px-4 py-2 text-left font-semibold"
        : "session-markdown-table-cell border px-4 py-2 align-top";
      return `<${tag}${alignAttribute(align)} class="${className}">${this.parser.parseInline(tokens)}</${tag}>`;
    },
    hr() {
      return `<hr class="my-6 border-none h-px bg-dls-active">`;
    },
  },
} satisfies ConstructorParameters<typeof Marked<string, string>>[0];

const markdownParser = new Marked<string, string>(baseMarkedOptions).use(
  markdownMathExtension,
  markedEmoji({
    emojis: emojiAliases,
    renderer: (token) => escapeHtml(token.emoji),
  }),
);

export function renderSessionMarkdownHtml(markdown: string) {
  return markdownParser.parse(preprocessSessionMarkdown(markdown), { async: false });
}

export function highlightSessionMarkdownCode(code: string, language: string, dark: boolean) {
  return codeToHtml(code, {
    lang: normalizeShikiLanguage(language),
    theme: dark ? "github-dark" : "github-light",
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
}

function MarkdownBlockInner(props: {
  text: string;
  streaming?: boolean;
  showStreamingCursor?: boolean;
  highlightQuery?: string;
  locale?: string;
  onOpenCodePath?: (path: string) => void;
  verifiedCodePaths?: readonly MarkdownVerifiedCodePath[];
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const normalizedText = useMemo(() => preprocessSessionMarkdown(props.text), [props.text]);
  const syncHtml = useMemo(() => {
    if (!normalizedText.trim()) return "";
    return renderSessionMarkdownHtml(props.text);
  }, [normalizedText, props.text]);
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
  const mermaidLabels = useMemo<MarkdownMermaidLabels>(() => ({
    code: t("session.markdown_mermaid_code"),
    diagram: t("session.markdown_mermaid_diagram"),
    copy: t("common.copy"),
    copied: t("common.copied"),
    expand: t("session.markdown_mermaid_expand"),
    collapse: t("session.markdown_mermaid_collapse"),
    theme: t("session.markdown_mermaid_theme"),
    zoomIn: t("session.markdown_mermaid_zoom_in"),
    zoomOut: t("session.markdown_mermaid_zoom_out"),
    download: t("session.markdown_mermaid_download"),
    downloadSvg: t("session.markdown_mermaid_download_svg"),
    downloadPng: t("session.markdown_mermaid_download_png"),
    syntaxError: t("session.markdown_mermaid_syntax_error"),
    copyError: t("session.markdown_mermaid_copy_error"),
  }), [props.locale]);
  const html = localizeMarkdownHtml(
    syncHtml,
    copyLabel,
    mermaidLabels,
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    void renderMarkdownMath(root).catch(() => undefined);
  }, [html]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return setupMarkdownMermaid(root, {
      streaming: props.streaming === true,
      labels: mermaidLabels,
    });
  }, [html, mermaidLabels, props.streaming]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || props.streaming) return;
    let cancelled = false;
    let renderGeneration = 0;

    const enhanceCodeBlocks = async () => {
      const generation = ++renderGeneration;
      const dark = document.documentElement.classList.contains("dark");
      const theme = dark ? "dark" : "light";
      const blocks = Array.from(root.querySelectorAll<HTMLElement>(
        "[data-markdown-code-block]:not([data-markdown-latex-block])",
      ));
      await Promise.all(blocks.map(async (block) => {
        const code = block.querySelector<HTMLElement>("pre code");
        const pre = code?.closest<HTMLElement>("pre");
        if (!code || !pre || code.dataset.markdownShikiTheme === theme) return;
        const languageClass = Array.from(code.classList).find((className) => className.startsWith("language-"));
        const language = languageClass?.slice("language-".length) ?? "text";
        const highlighted = await highlightSessionMarkdownCode(code.textContent ?? "", language, dark);
        if (cancelled || generation !== renderGeneration || !root.contains(code)) return;
        const template = document.createElement("template");
        template.innerHTML = highlighted;
        const highlightedPre = template.content.querySelector<HTMLElement>("pre");
        const highlightedCode = template.content.querySelector<HTMLElement>("code");
        if (!highlightedCode) return;
        code.innerHTML = highlightedCode.innerHTML;
        code.dataset.markdownShikiTheme = theme;
        const color = highlightedPre?.style.color;
        if (color) pre.style.color = color;
      }));
      if (!cancelled && generation === renderGeneration) {
        applyTextHighlights(root, props.highlightQuery ?? "");
      }
    };

    void enhanceCodeBlocks().catch(() => undefined);
    const themeObserver = new MutationObserver(() => {
      void enhanceCodeBlocks().catch(() => undefined);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => {
      cancelled = true;
      renderGeneration += 1;
      themeObserver.disconnect();
    };
  }, [html, props.highlightQuery, props.streaming]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
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
      {props.streaming && props.showStreamingCursor !== false
        ? <StreamingCursor className="ml-0.5" />
        : null}
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
