const MERMAID_LABEL_TOKENS = {
  code: "__ONMYAGENT_MERMAID_CODE__",
  diagram: "__ONMYAGENT_MERMAID_DIAGRAM__",
  copy: "__ONMYAGENT_MERMAID_COPY__",
  copied: "__ONMYAGENT_MERMAID_COPIED__",
  expand: "__ONMYAGENT_MERMAID_EXPAND__",
  collapse: "__ONMYAGENT_MERMAID_COLLAPSE__",
  theme: "__ONMYAGENT_MERMAID_THEME__",
  zoomIn: "__ONMYAGENT_MERMAID_ZOOM_IN__",
  zoomOut: "__ONMYAGENT_MERMAID_ZOOM_OUT__",
  download: "__ONMYAGENT_MERMAID_DOWNLOAD__",
  downloadSvg: "__ONMYAGENT_MERMAID_DOWNLOAD_SVG__",
  downloadPng: "__ONMYAGENT_MERMAID_DOWNLOAD_PNG__",
  syntaxError: "__ONMYAGENT_MERMAID_SYNTAX_ERROR__",
  copyError: "__ONMYAGENT_MERMAID_COPY_ERROR__",
};

export type MarkdownMermaidLabels = {
  code: string;
  diagram: string;
  copy: string;
  copied: string;
  expand: string;
  collapse: string;
  theme: string;
  zoomIn: string;
  zoomOut: string;
  download: string;
  downloadSvg: string;
  downloadPng: string;
  syntaxError: string;
  copyError: string;
};

type MermaidViewMode = "code" | "diagram";
type MermaidTheme = "light" | "dark";

type MermaidBlockState = {
  content: string;
  mode: MermaidViewMode;
  theme: MermaidTheme;
  scale: number;
  expanded: boolean;
  renderedContent: string;
  rendering: boolean;
};

const mermaidViewModeCache = new Map<string, MermaidViewMode>();
let mermaidRenderCount = 0;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function icon(path: string) {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

const COPY_ICON = icon('<rect width="14" height="14" x="8" y="8" rx="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>');
const EXPAND_ICON = icon('<path d="m15 3 6 6"></path><path d="m21 3-7 7"></path><path d="m9 21-6-6"></path><path d="m3 21 7-7"></path>');
const THEME_ICON = icon('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>');
const ZOOM_IN_ICON = icon('<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3M11 8v6M8 11h6"></path>');
const ZOOM_OUT_ICON = icon('<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3M8 11h6"></path>');
const DOWNLOAD_ICON = icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="m7 10 5 5 5-5M12 15V3"></path>');

function mermaidActionButton(action: string, labelToken: string, iconMarkup: string) {
  return `<button type="button" data-markdown-mermaid-action="${action}" class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-focus" title="${labelToken}" aria-label="${labelToken}">${iconMarkup}</button>`;
}

export function renderMarkdownMermaidMarkup(content: string) {
  const escaped = escapeHtml(content);
  return `<div data-markdown-mermaid-block class="my-4 overflow-hidden rounded-xl border border-dls-mist bg-dls-surface-muted"><div class="flex min-h-9 items-center justify-between gap-3 border-b border-dls-mist px-3"><div class="flex items-center gap-1 rounded-md bg-dls-active p-0.5"><button type="button" data-markdown-mermaid-action="code" class="rounded-md px-2 py-0.5 text-xs text-dls-secondary transition-colors hover:text-dls-text" aria-pressed="false">${MERMAID_LABEL_TOKENS.code}</button><button type="button" data-markdown-mermaid-action="diagram" class="rounded-md px-2 py-0.5 text-xs text-dls-secondary transition-colors hover:text-dls-text" aria-pressed="false">${MERMAID_LABEL_TOKENS.diagram}</button></div><div data-markdown-mermaid-code-actions class="flex items-center gap-1">${mermaidActionButton("copy", MERMAID_LABEL_TOKENS.copy, COPY_ICON)}${mermaidActionButton("expand", MERMAID_LABEL_TOKENS.expand, EXPAND_ICON)}</div><div data-markdown-mermaid-diagram-actions class="relative hidden items-center gap-1">${mermaidActionButton("theme", MERMAID_LABEL_TOKENS.theme, THEME_ICON)}${mermaidActionButton("zoom-in", MERMAID_LABEL_TOKENS.zoomIn, ZOOM_IN_ICON)}${mermaidActionButton("zoom-out", MERMAID_LABEL_TOKENS.zoomOut, ZOOM_OUT_ICON)}<div data-markdown-mermaid-download-menu class="relative">${mermaidActionButton("download-menu", MERMAID_LABEL_TOKENS.download, DOWNLOAD_ICON)}<div data-markdown-mermaid-download-list class="absolute right-0 top-full z-20 mt-1 hidden min-w-32 rounded-lg border border-dls-border bg-dls-surface p-1 text-xs"><button type="button" data-markdown-mermaid-action="download-svg" class="flex w-full rounded-md px-2 py-1.5 text-left text-dls-secondary hover:bg-dls-hover hover:text-dls-text">${MERMAID_LABEL_TOKENS.downloadSvg}</button><button type="button" data-markdown-mermaid-action="download-png" class="flex w-full rounded-md px-2 py-1.5 text-left text-dls-secondary hover:bg-dls-hover hover:text-dls-text">${MERMAID_LABEL_TOKENS.downloadPng}</button></div></div></div></div><pre data-markdown-mermaid-code class="max-h-96 overflow-auto px-4 py-3 text-xs leading-6 text-dls-secondary"><code class="language-mermaid">${escaped}</code></pre><div data-markdown-mermaid-diagram class="hidden max-h-96 min-h-48 overflow-auto p-4"><div data-markdown-mermaid-host class="origin-top-center transition-transform"></div><div data-markdown-mermaid-error class="hidden min-h-48 items-center justify-center p-4"><div class="w-full max-w-xl"><div class="mb-2 text-xs text-dls-secondary">${MERMAID_LABEL_TOKENS.syntaxError}</div><div class="relative rounded-md border border-dls-border bg-dls-surface p-3 pr-10"><pre data-markdown-mermaid-error-message class="m-0 overflow-x-auto whitespace-pre-wrap bg-transparent p-0 font-mono text-xs text-dls-status-danger-text"></pre><button type="button" data-markdown-mermaid-action="copy-error" class="absolute right-1 top-1 inline-flex size-7 items-center justify-center rounded-md text-dls-secondary hover:bg-dls-hover hover:text-dls-text" title="${MERMAID_LABEL_TOKENS.copyError}" aria-label="${MERMAID_LABEL_TOKENS.copyError}">${COPY_ICON}</button></div></div></div></div></div>`;
}

export function localizeMarkdownMermaidMarkup(html: string, labels: MarkdownMermaidLabels) {
  return html
    .replaceAll(MERMAID_LABEL_TOKENS.code, escapeHtml(labels.code))
    .replaceAll(MERMAID_LABEL_TOKENS.diagram, escapeHtml(labels.diagram))
    .replaceAll(MERMAID_LABEL_TOKENS.copy, escapeHtml(labels.copy))
    .replaceAll(MERMAID_LABEL_TOKENS.copied, escapeHtml(labels.copied))
    .replaceAll(MERMAID_LABEL_TOKENS.expand, escapeHtml(labels.expand))
    .replaceAll(MERMAID_LABEL_TOKENS.collapse, escapeHtml(labels.collapse))
    .replaceAll(MERMAID_LABEL_TOKENS.theme, escapeHtml(labels.theme))
    .replaceAll(MERMAID_LABEL_TOKENS.zoomIn, escapeHtml(labels.zoomIn))
    .replaceAll(MERMAID_LABEL_TOKENS.zoomOut, escapeHtml(labels.zoomOut))
    .replaceAll(MERMAID_LABEL_TOKENS.download, escapeHtml(labels.download))
    .replaceAll(MERMAID_LABEL_TOKENS.downloadSvg, escapeHtml(labels.downloadSvg))
    .replaceAll(MERMAID_LABEL_TOKENS.downloadPng, escapeHtml(labels.downloadPng))
    .replaceAll(MERMAID_LABEL_TOKENS.syntaxError, escapeHtml(labels.syntaxError))
    .replaceAll(MERMAID_LABEL_TOKENS.copyError, escapeHtml(labels.copyError));
}

function contentHash(content: string) {
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = ((hash << 5) - hash + content.charCodeAt(index)) | 0;
  }
  return String(Math.abs(hash));
}

function blockElement(block: HTMLElement, selector: string) {
  return block.querySelector<HTMLElement>(selector);
}

function setButtonActive(button: HTMLElement | null, active: boolean) {
  if (!button) return;
  button.setAttribute("aria-pressed", String(active));
  button.classList.toggle("bg-dls-surface", active);
  button.classList.toggle("text-dls-text", active);
}

function applyViewMode(block: HTMLElement, state: MermaidBlockState, streaming: boolean) {
  const code = blockElement(block, "[data-markdown-mermaid-code]");
  const diagram = blockElement(block, "[data-markdown-mermaid-diagram]");
  const codeActions = blockElement(block, "[data-markdown-mermaid-code-actions]");
  const diagramActions = blockElement(block, "[data-markdown-mermaid-diagram-actions]");
  const codeButton = blockElement(block, '[data-markdown-mermaid-action="code"]');
  const diagramButton = blockElement(block, '[data-markdown-mermaid-action="diagram"]');
  const showCode = streaming || state.mode === "code";
  code?.classList.toggle("hidden", !showCode);
  diagram?.classList.toggle("hidden", showCode);
  codeActions?.classList.toggle("hidden", !showCode);
  codeActions?.classList.toggle("flex", showCode);
  diagramActions?.classList.toggle("hidden", showCode);
  diagramActions?.classList.toggle("flex", !showCode);
  setButtonActive(codeButton, showCode);
  setButtonActive(diagramButton, !showCode);
  if (diagramButton instanceof HTMLButtonElement) diagramButton.disabled = streaming;
}

function applyExpanded(block: HTMLElement, state: MermaidBlockState, labels: MarkdownMermaidLabels) {
  const code = blockElement(block, "[data-markdown-mermaid-code]");
  const button = blockElement(block, '[data-markdown-mermaid-action="expand"]');
  code?.classList.toggle("max-h-96", !state.expanded);
  if (state.expanded) code?.style.setProperty("max-height", "none");
  else code?.style.removeProperty("max-height");
  if (button) {
    const label = state.expanded ? labels.collapse : labels.expand;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-expanded", String(state.expanded));
  }
}

function applyDiagramTheme(block: HTMLElement, state: MermaidBlockState) {
  const diagram = blockElement(block, "[data-markdown-mermaid-diagram]");
  // Match shell three-tier surfaces (dark background / light surface).
  if (diagram) diagram.style.backgroundColor = state.theme === "dark" ? "#1f1f1f" : "#ffffff";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderedSvg(block: HTMLElement) {
  return block.querySelector<SVGSVGElement>("[data-markdown-mermaid-host] svg");
}

async function downloadPng(svg: SVGSVGElement) {
  const serialized = svg.outerHTML.replace(/<br>/g, "<br/>");
  const viewBox = svg.viewBox.baseVal;
  const width = viewBox.width || svg.getBoundingClientRect().width || 800;
  const height = viewBox.height || svg.getBoundingClientRect().height || 600;
  const image = new Image();
  image.width = width;
  image.height = height;
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("mermaid-image-load-failed"));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
  await loaded;
  const ratio = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * ratio);
  canvas.height = Math.ceil(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
  if (blob) triggerDownload(blob, `mermaid-diagram-${Date.now()}.png`);
}

export function setupMarkdownMermaid(
  root: HTMLElement,
  options: { streaming: boolean; labels: MarkdownMermaidLabels },
) {
  const states = new Map<HTMLElement, MermaidBlockState>();
  const timers = new Set<number>();
  const menuCleanups: Array<() => void> = [];
  let active = true;

  const renderDiagram = async (block: HTMLElement, state: MermaidBlockState) => {
    if (!active || options.streaming || state.mode !== "diagram" || state.rendering) return;
    if (state.renderedContent === `${state.theme}:${state.content}`) return;
    const host = blockElement(block, "[data-markdown-mermaid-host]");
    const error = blockElement(block, "[data-markdown-mermaid-error]");
    const errorMessage = blockElement(block, "[data-markdown-mermaid-error-message]");
    if (!host || !error || !errorMessage) return;
    state.rendering = true;
    try {
      const { default: mermaid } = await import("mermaid");
      if (!active || !root.contains(block)) return;
      mermaid.initialize({
        startOnLoad: false,
        suppressErrorRendering: true,
        securityLevel: "strict",
        theme: state.theme === "dark" ? "dark" : "default",
        fontFamily: "system-ui, -apple-system, sans-serif",
        themeVariables: { fontFamily: "system-ui, -apple-system, sans-serif", fontSize: "13px" },
      });
      const id = `onmyagent-mermaid-${Date.now()}-${mermaidRenderCount++}`;
      const result = await mermaid.render(id, state.content, host);
      if (!active || !root.contains(block)) return;
      host.innerHTML = result.svg;
      host.style.transform = `scale(${state.scale})`;
      host.style.transformOrigin = state.scale > 1 ? "top left" : "top center";
      error.classList.add("hidden");
      error.classList.remove("flex");
      host.classList.remove("hidden");
      state.renderedContent = `${state.theme}:${state.content}`;
    } catch (renderError) {
      if (!active || !root.contains(block)) return;
      host.replaceChildren();
      host.classList.add("hidden");
      error.classList.remove("hidden");
      error.classList.add("flex");
      errorMessage.textContent = renderError instanceof Error ? renderError.message : String(renderError);
      state.renderedContent = "";
    } finally {
      state.rendering = false;
    }
  };

  root.querySelectorAll<HTMLElement>("[data-markdown-mermaid-block]").forEach((block) => {
    const content = blockElement(block, "[data-markdown-mermaid-code] code")?.textContent ?? "";
    const hash = contentHash(content);
    const mode = options.streaming ? "code" : mermaidViewModeCache.get(hash) ?? "diagram";
    const state: MermaidBlockState = {
      content,
      mode,
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      scale: 1,
      expanded: false,
      renderedContent: "",
      rendering: false,
    };
    states.set(block, state);
    applyViewMode(block, state, options.streaming);
    applyExpanded(block, state, options.labels);
    applyDiagramTheme(block, state);
    void renderDiagram(block, state);

    const menu = blockElement(block, "[data-markdown-mermaid-download-menu]");
    const list = blockElement(block, "[data-markdown-mermaid-download-list]");
    if (menu) {
      const showMenu = () => list?.classList.remove("hidden");
      const hideMenu = () => list?.classList.add("hidden");
      menu.addEventListener("pointerenter", showMenu);
      menu.addEventListener("pointerleave", hideMenu);
      menuCleanups.push(() => {
        menu.removeEventListener("pointerenter", showMenu);
        menu.removeEventListener("pointerleave", hideMenu);
      });
    }
  });

  const handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const actionElement = target.closest<HTMLElement>("[data-markdown-mermaid-action]");
    const block = actionElement?.closest<HTMLElement>("[data-markdown-mermaid-block]");
    if (!actionElement || !block) return;
    const state = states.get(block);
    const action = actionElement.dataset.markdownMermaidAction;
    if (!state || !action) return;
    event.preventDefault();

    if (action === "code" || action === "diagram") {
      if (options.streaming && action === "diagram") return;
      state.mode = action;
      state.scale = 1;
      mermaidViewModeCache.set(contentHash(state.content), action);
      applyViewMode(block, state, options.streaming);
      void renderDiagram(block, state);
      return;
    }
    if (action === "copy") {
      void navigator.clipboard.writeText(state.content).then(() => {
        actionElement.title = options.labels.copied;
        actionElement.setAttribute("aria-label", options.labels.copied);
        const timer = window.setTimeout(() => {
          actionElement.title = options.labels.copy;
          actionElement.setAttribute("aria-label", options.labels.copy);
          timers.delete(timer);
        }, 2_000);
        timers.add(timer);
      }).catch(() => undefined);
      return;
    }
    if (action === "expand") {
      state.expanded = !state.expanded;
      applyExpanded(block, state, options.labels);
      return;
    }
    if (action === "theme") {
      state.theme = state.theme === "dark" ? "light" : "dark";
      state.renderedContent = "";
      applyDiagramTheme(block, state);
      void renderDiagram(block, state);
      return;
    }
    if (action === "zoom-in" || action === "zoom-out") {
      state.scale = Math.min(4, Math.max(0.1, state.scale + (action === "zoom-in" ? 0.1 : -0.1)));
      const host = blockElement(block, "[data-markdown-mermaid-host]");
      if (host) {
        host.style.transform = `scale(${state.scale})`;
        host.style.transformOrigin = state.scale > 1 ? "top left" : "top center";
      }
      return;
    }
    if (action === "download-svg" || action === "download-png") {
      const svg = renderedSvg(block);
      if (!svg) return;
      blockElement(block, "[data-markdown-mermaid-download-list]")?.classList.add("hidden");
      if (action === "download-svg") {
        triggerDownload(
          new Blob([svg.outerHTML.replace(/<br>/g, "<br/>")], { type: "image/svg+xml;charset=utf-8" }),
          `mermaid-diagram-${Date.now()}.svg`,
        );
      } else {
        void downloadPng(svg);
      }
      return;
    }
    if (action === "copy-error") {
      const message = blockElement(block, "[data-markdown-mermaid-error-message]")?.textContent ?? "";
      if (message) void navigator.clipboard.writeText(message).catch(() => undefined);
    }
  };

  root.addEventListener("click", handleClick);
  return () => {
    active = false;
    root.removeEventListener("click", handleClick);
    menuCleanups.forEach((cleanup) => cleanup());
    timers.forEach((timer) => window.clearTimeout(timer));
  };
}
