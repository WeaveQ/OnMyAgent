/** @jsxImportSource react */
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import FileViewer from "@file-viewer/react";
import wordRenderer from "@file-viewer/renderer-word";
import spreadsheetRenderer from "@file-viewer/renderer-spreadsheet";
import presentationRenderer from "@file-viewer/renderer-presentation";

import "./office-viewer.css";

type ArtifactFilePayload = {
  bytes: Uint8Array;
  name: string;
  extension: string;
  size: number;
  mtimeMs: number;
  theme: "light" | "dark";
  locale: string;
};

type SpreadsheetGridMetrics = {
  bottomHeight: number;
  bottomTop: number;
  columnCount: number;
  columnWidth: number;
  headerHeight: number;
  indexWidth: number;
  left: number;
  rightLeft: number;
  rightWidth: number;
  rowCount: number;
  rowHeight: number;
  tableHeight: number;
  tableWidth: number;
  top: number;
};

declare global {
  interface Window {
    __ONMYAGENT_ARTIFACT_VIEWER__?: {
      onFile: (callback: (payload: ArtifactFilePayload) => void) => () => void;
    };
  }
}

function OutlineIcon(props: { presentation: boolean }) {
  return props.presentation ? (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.25" y="2.25" width="11.5" height="4.25" rx="1" />
      <rect x="2.25" y="9.5" width="4.5" height="4.25" rx="1" />
      <rect x="9.25" y="9.5" width="4.5" height="4.25" rx="1" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 3.25h1.5M7 3.25h6M3 8h1.5M7 8h6M3 12.75h1.5M7 12.75h6" />
    </svg>
  );
}

function spreadsheetColumnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function readSpreadsheetCounts(summary: string) {
  const values = summary.match(/\d[\d,]*/g)?.map((value) => Number(value.replaceAll(",", ""))) ?? [];
  return {
    rows: Number.isFinite(values[0]) ? values[0] : 0,
    columns: Number.isFinite(values[1]) ? values[1] : 0,
  };
}

function SpreadsheetGridExtension(props: { metrics: SpreadsheetGridMetrics }) {
  const { metrics } = props;
  const extraColumnCount = Math.ceil(metrics.rightWidth / metrics.columnWidth) + 1;
  const extraRowCount = Math.min(200, Math.ceil(metrics.bottomHeight / metrics.rowHeight) + 1);
  const columnNames = Array.from(
    { length: extraColumnCount },
    (_, index) => spreadsheetColumnName(metrics.columnCount + index),
  );
  const rowNumbers = Array.from(
    { length: extraRowCount },
    (_, index) => metrics.rowCount + index + 1,
  );
  const gridBackground = {
    backgroundImage: "linear-gradient(to right, transparent calc(100% - 1px), #d7dbe0 calc(100% - 1px)), linear-gradient(to bottom, transparent calc(100% - 1px), #d7dbe0 calc(100% - 1px))",
    backgroundSize: `${metrics.columnWidth}px 100%, 100% ${metrics.rowHeight}px`,
  };

  return (
    <div className="spreadsheet-grid-extension" aria-hidden="true">
      {metrics.rightWidth > 0 ? (
        <div
          className="spreadsheet-grid-extension-right"
          style={{
            left: metrics.rightLeft,
            top: metrics.top,
            width: metrics.rightWidth,
            height: metrics.tableHeight,
          }}
        >
          <div
            className="spreadsheet-grid-extension-columns"
            style={{ height: metrics.headerHeight, gridTemplateColumns: `repeat(${extraColumnCount}, ${metrics.columnWidth}px)` }}
          >
            {columnNames.map((name) => <span key={name}>{name}</span>)}
          </div>
          <div
            className="spreadsheet-grid-extension-body"
            style={{ ...gridBackground, top: metrics.headerHeight }}
          />
        </div>
      ) : null}
      {metrics.bottomHeight > 0 ? (
        <div
          className="spreadsheet-grid-extension-bottom"
          style={{
            left: metrics.left,
            top: metrics.bottomTop,
            width: metrics.tableWidth,
            height: metrics.bottomHeight,
          }}
        >
          <div className="spreadsheet-grid-extension-rows" style={{ width: metrics.indexWidth }}>
            {rowNumbers.map((number) => (
              <span key={number} style={{ height: metrics.rowHeight }}>{number}</span>
            ))}
          </div>
          <div
            className="spreadsheet-grid-extension-cells"
            style={{ ...gridBackground, left: metrics.indexWidth }}
          />
        </div>
      ) : null}
    </div>
  );
}

function OfficeViewer() {
  const [payload, setPayload] = useState<ArtifactFilePayload | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [spreadsheetGrid, setSpreadsheetGrid] = useState<SpreadsheetGridMetrics | null>(null);
  const outlineRef = useRef<HTMLDivElement>(null);
  const presentationViewportRef = useRef<HTMLDivElement>(null);
  const spreadsheetViewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => window.__ONMYAGENT_ARTIFACT_VIEWER__?.onFile(setPayload), []);

  const file = useMemo(() => {
    if (!payload) return null;
    const bytes = new Uint8Array(payload.bytes);
    return new File([bytes], payload.name, { type: "application/octet-stream" });
  }, [payload]);

  const isPresentation = Boolean(
    payload && /\.(ppt|pptx|pptm|pot|potx|potm|pps|ppsx|ppsm|odp)$/i.test(payload.name),
  );
  const isDocument = Boolean(
    payload && /\.(doc|docx|docm|dot|dotx|dotm|rtf|odt)$/i.test(payload.name),
  );
  const isSpreadsheet = Boolean(
    payload && /\.(xls|xlsx|xlsm|xlsb|xlt|xltx|xltm|ods|fods|numbers|csv|tsv)$/i.test(payload.name),
  );
  const hasPageOutline = isPresentation || isDocument;
  const isChineseLocale = (payload?.locale || navigator.language).toLowerCase().startsWith("zh");
  const outlineTitle = isDocument
    ? (isChineseLocale ? "\u5927\u7eb2" : "Outline")
    : (isChineseLocale ? "\u9884\u89c8" : "Preview");

  const options = useMemo(
    () => ({
      theme: payload?.theme ?? "light",
      locale: "auto" as const,
      rendererMode: "replace" as const,
      renderers: [wordRenderer, spreadsheetRenderer, presentationRenderer],
      fit: { mode: "auto" as const, resize: "until-interaction" as const },
      ui: { density: "compact" as const },
      docx: { visualPagination: true },
      toolbar: {
        download: false,
        print: false,
        exportHtml: false,
        search: true,
        zoom: true,
        theme: false,
        position: "bottom-right" as const,
      },
    }),
    [payload?.theme],
  );

  useEffect(() => {
    if (!isPresentation) return;
    const removeLeakedChart = (node: Node) => {
      if (node instanceof HTMLElement && node.parentElement === document.body && node.matches(".bb")) node.remove();
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(removeLeakedChart);
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [isPresentation]);

  useEffect(() => {
    const host = spreadsheetViewerRef.current;
    if (!isSpreadsheet || !host) {
      setSpreadsheetGrid(null);
      return;
    }

    let frame: number | null = null;
    let lastSignature = "";
    const sync = () => {
      frame = null;
      const table = host.querySelector<HTMLElement>(".table-wrapper");
      const header = host.querySelector<HTMLElement>(".e-virt-table-overlayer-header");
      const body = host.querySelector<HTMLElement>(".e-virt-table-overlayer-body");
      const summary = host.querySelector<HTMLElement>(".summary");
      if (!table || !header || !body || !summary) return;

      const hostRect = host.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const headerData = header.children.item(1);
      const bodyData = body.children.item(1);
      if (!(headerData instanceof HTMLElement) || !(bodyData instanceof HTMLElement)) return;

      const counts = readSpreadsheetCounts(summary.textContent ?? "");
      const cells = Array.from(bodyData.children).filter((element) => element instanceof HTMLElement);
      const visibleCells = cells.filter((cell) => cell.getBoundingClientRect().width > 0);
      const rowHeight = Math.max(
        8,
        Math.min(...visibleCells.map((cell) => cell.getBoundingClientRect().height).filter((height) => height > 0)),
      );
      if (!Number.isFinite(rowHeight) || !counts.rows || !counts.columns) return;

      const renderedBottom = visibleCells.reduce(
        (bottom, cell) => Math.max(bottom, cell.getBoundingClientRect().bottom),
        bodyRect.top + counts.rows * rowHeight,
      );
      const scrollbarGuard = 14;
      const tableRight = tableRect.right - scrollbarGuard;
      const tableBottom = tableRect.bottom - scrollbarGuard;
      const usedRight = Math.min(headerData.getBoundingClientRect().right, tableRight);
      const usedBottom = Math.min(renderedBottom, tableBottom);
      const columnWidth = Math.max(64, Math.min(112, headerData.getBoundingClientRect().width / counts.columns));
      const next: SpreadsheetGridMetrics = {
        bottomHeight: Math.max(0, tableBottom - usedBottom),
        bottomTop: usedBottom - hostRect.top,
        columnCount: counts.columns,
        columnWidth,
        headerHeight: headerRect.height,
        indexWidth: headerData.getBoundingClientRect().left - headerRect.left,
        left: tableRect.left - hostRect.left,
        rightLeft: usedRight - hostRect.left,
        rightWidth: Math.max(0, tableRight - usedRight),
        rowCount: counts.rows,
        rowHeight,
        tableHeight: tableBottom - tableRect.top,
        tableWidth: tableRight - tableRect.left,
        top: tableRect.top - hostRect.top,
      };
      const signature = Object.values(next).map((value) => Math.round(value * 10) / 10).join(":");
      if (signature !== lastSignature) {
        lastSignature = signature;
        setSpreadsheetGrid(next);
      }
    };
    const scheduleSync = () => {
      if (frame === null) frame = requestAnimationFrame(sync);
    };
    const observer = new MutationObserver(scheduleSync);
    const resizeObserver = new ResizeObserver(scheduleSync);
    observer.observe(host, { childList: true, subtree: true, characterData: true });
    resizeObserver.observe(host);
    host.addEventListener("scroll", scheduleSync, { capture: true, passive: true });
    scheduleSync();
    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      host.removeEventListener("scroll", scheduleSync, { capture: true });
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [isSpreadsheet, payload?.mtimeMs]);

  useEffect(() => {
    const viewport = presentationViewportRef.current;
    const outline = outlineRef.current;
    if (!hasPageOutline || !viewport || !outline) return;

    let frame: number | null = null;
    let lastSignature = "";

    const slideSlots = () => {
      const surface = viewport.querySelector<HTMLElement>(".pptx-render-surface");
      if (surface) {
        const slots = Array.from(surface.querySelectorAll<HTMLElement>(".flyfish-pptx-slide-slot"));
        if (slots.length) return slots;
        return Array.from(surface.querySelectorAll<HTMLElement>("[data-slide-index], .slide"));
      }
      if (isPresentation) {
        return Array.from(viewport.querySelectorAll<HTMLElement>(".ppt-binary-page, .odf-page"));
      }
      return [];
    };

    const documentHeadings = () => Array.from(viewport.querySelectorAll<HTMLElement>(
      "h1, h2, h3, h4, h5, h6, [class*='docx_heading'], [class*='docx_Heading']",
    )).filter((heading) => heading.innerText.trim());

    const headingLevel = (heading: HTMLElement) => {
      const tagLevel = /^H([1-6])$/.exec(heading.tagName)?.[1];
      if (tagLevel) return Number(tagLevel);
      const classLevel = /heading[_-]?(\d)/i.exec(heading.className)?.[1];
      return classLevel ? Number(classLevel) : 1;
    };

    const updateActiveHeading = (headings: HTMLElement[]) => {
      if (!headings.length) return;
      const viewportTop = viewport.getBoundingClientRect().top + 32;
      let activeIndex = 0;
      headings.forEach((heading, index) => {
        if (heading.getBoundingClientRect().top <= viewportTop) activeIndex = index;
      });
      outline.querySelectorAll<HTMLElement>("[data-outline-index]").forEach((item, index) => {
        item.classList.toggle("is-active", index === activeIndex);
        if (index === activeIndex) item.setAttribute("aria-current", "location");
        else item.removeAttribute("aria-current");
      });
    };

    const rebuildDocumentOutline = (headings: HTMLElement[]) => {
      outline.replaceChildren();
      const root = document.createElement("ul");
      root.className = "document-outline-tree";
      const stack: Array<{ level: number; list: HTMLUListElement }> = [{ level: 0, list: root }];

      headings.forEach((heading, index) => {
        const level = headingLevel(heading);
        let stackTail = stack[stack.length - 1];
        while (stack.length > 1 && stackTail && stackTail.level >= level) {
          stack.pop();
          stackTail = stack[stack.length - 1];
        }
        if (!stackTail) return;
        const parent = stackTail.list;
        const item = document.createElement("li");
        item.className = "document-outline-item";
        item.dataset.outlineIndex = String(index);
        const row = document.createElement("div");
        row.className = "document-outline-row";
        row.style.setProperty("--outline-depth", String(Math.max(0, level - 1)));
        const caret = document.createElement("button");
        caret.type = "button";
        caret.className = "document-outline-caret";
        caret.setAttribute("aria-label", "Toggle section");
        caret.setAttribute("aria-expanded", "true");
        caret.textContent = "▾";
        const link = document.createElement("button");
        link.type = "button";
        link.className = "document-outline-link";
        link.textContent = heading.innerText.trim();
        link.addEventListener("click", () => heading.scrollIntoView({ behavior: "smooth", block: "start" }));
        row.append(caret, link);
        const children = document.createElement("ul");
        children.className = "document-outline-children";
        caret.addEventListener("click", () => {
          const expanded = caret.getAttribute("aria-expanded") === "true";
          caret.setAttribute("aria-expanded", String(!expanded));
          caret.textContent = expanded ? "▸" : "▾";
          children.hidden = expanded;
        });
        item.append(row, children);
        parent.append(item);
        stack.push({ level, list: children });
      });

      root.querySelectorAll<HTMLLIElement>(".document-outline-item").forEach((item) => {
        const children = item.querySelector<HTMLUListElement>(":scope > .document-outline-children");
        const caret = item.querySelector<HTMLButtonElement>(":scope > .document-outline-row > .document-outline-caret");
        if (!children?.children.length && caret) {
          caret.disabled = true;
          caret.textContent = "";
        }
      });
      outline.append(root);
    };

    const updateActiveSlide = (slots: HTMLElement[]) => {
      if (!slots.length) return;
      const viewportTop = viewport.getBoundingClientRect().top;
      let activeIndex = 0;
      let activeDistance = Number.POSITIVE_INFINITY;
      slots.forEach((slot, index) => {
        const distance = Math.abs(slot.getBoundingClientRect().top - viewportTop - 12);
        if (distance < activeDistance) {
          activeDistance = distance;
          activeIndex = index;
        }
      });
      outline.querySelectorAll<HTMLElement>("[data-outline-index]").forEach((item, index) => {
        item.classList.toggle("is-active", index === activeIndex);
        if (index === activeIndex) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      });
    };

    const rebuildOutline = (slots: HTMLElement[]) => {
      outline.replaceChildren();
      slots.forEach((slot, index) => {
        const pageSelector = ".slide, [data-slide-index], .ppt-binary-page, .docx-page-frame, .docx-flow-frame, .msdoc-page, .odf-page, .flyfish-rtf-paper";
        const slide = slot.matches(pageSelector)
          ? slot
          : slot.querySelector<HTMLElement>(pageSelector);
        const slideNumber = isDocument || slot.matches(".ppt-binary-page, .odf-page")
          ? index + 1
          : Number(slot.dataset.slideNumber || slide?.dataset.slideIndex) || index + 1;
        const title = slide?.innerText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean)
          ?.slice(0, 80) ?? "";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "presentation-outline-item";
        button.dataset.outlineIndex = String(index);
        button.setAttribute("aria-label", title ? `${slideNumber}. ${title}` : String(slideNumber));

        const number = document.createElement("span");
        number.className = "presentation-outline-number";
        number.textContent = String(slideNumber);
        const thumbnail = document.createElement("span");
        thumbnail.className = "presentation-outline-thumbnail pptx-render-surface";

        if (slide) {
          const clone = slide.cloneNode(true);
          if (clone instanceof HTMLElement) {
            clone.removeAttribute("id");
            clone.querySelectorAll<HTMLElement>("[id]").forEach((element) => element.removeAttribute("id"));
            clone.classList.add("presentation-outline-clone");
            const sourceCanvas = slide.querySelector<HTMLCanvasElement>("canvas");
            const clonedCanvas = clone.querySelector<HTMLCanvasElement>("canvas");
            if (sourceCanvas && clonedCanvas) {
              try {
                const image = document.createElement("img");
                image.src = sourceCanvas.toDataURL("image/png");
                image.alt = "";
                image.style.width = `${sourceCanvas.width}px`;
                image.style.height = `${sourceCanvas.height}px`;
                clonedCanvas.replaceWith(image);
              } catch {
                // Worker-owned canvases can reject main-thread encoding. The
                // numbered outline still remains navigable in that fallback.
              }
            }
            thumbnail.append(clone);
            requestAnimationFrame(() => {
              const sourceWidth = slide.offsetWidth || 960;
              const sourceHeight = slide.offsetHeight || 540;
              const targetWidth = thumbnail.clientWidth;
              const targetHeight = thumbnail.clientHeight;
              const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
              clone.style.width = `${sourceWidth}px`;
              clone.style.height = `${sourceHeight}px`;
              clone.style.transform = `scale(${scale})`;
              clone.style.left = `${Math.max(0, (targetWidth - sourceWidth * scale) / 2)}px`;
              clone.style.top = `${Math.max(0, (targetHeight - sourceHeight * scale) / 2)}px`;
            });
          }
        }

        const caption = document.createElement("span");
        caption.className = "presentation-outline-caption";
        caption.textContent = title || String(slideNumber);
        button.append(number, thumbnail, caption);
        button.addEventListener("click", () => {
          slot.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        outline.append(button);
      });
    };

    const sync = () => {
      frame = null;
      if (isDocument) {
        const headings = documentHeadings();
        const signature = headings.map((heading) => `${headingLevel(heading)}:${heading.innerText.trim()}`).join("|");
        if (signature !== lastSignature) {
          lastSignature = signature;
          rebuildDocumentOutline(headings);
        }
        updateActiveHeading(headings);
        return;
      }
      const slots = slideSlots();
      const signature = slots
        .map((slot) => `${slot.dataset.slideNumber ?? slot.dataset.slideIndex ?? ""}:${slot.childElementCount}`)
        .join("|");
      if (signature !== lastSignature) {
        lastSignature = signature;
        rebuildOutline(slots);
      }
      updateActiveSlide(slots);
    };
    const scheduleSync = () => {
      if (frame === null) frame = requestAnimationFrame(sync);
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(viewport, { childList: true, subtree: true });
    viewport.addEventListener("scroll", scheduleSync, { passive: true });
    scheduleSync();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", scheduleSync);
      if (frame !== null) cancelAnimationFrame(frame);
      outline.replaceChildren();
    };
  }, [hasPageOutline, isDocument, isPresentation, payload?.mtimeMs]);

  if (!file || !payload) return <div className="office-viewer-status">Loading preview…</div>;
  const viewer = <FileViewer key={`${payload.name}:${payload.mtimeMs}`} file={file} filename={payload.name} options={options} />;
  if (isSpreadsheet) {
    return (
      <div ref={spreadsheetViewerRef} className="spreadsheet-viewer">
        {viewer}
        {spreadsheetGrid ? <SpreadsheetGridExtension metrics={spreadsheetGrid} /> : null}
      </div>
    );
  }
  if (!hasPageOutline) return viewer;
  return (
    <div className={`presentation-viewer${outlineOpen ? " is-outline-open" : ""}${isDocument ? " is-document" : ""}`}>
      {!outlineOpen ? (
        <button
          type="button"
          className="presentation-outline-tab"
          aria-label={isDocument ? "Open document outline" : "Open slide previews"}
          aria-expanded="false"
          onClick={() => setOutlineOpen(true)}
        >
          <span className="presentation-outline-tab-icon"><OutlineIcon presentation={isPresentation} /></span>
          <span className="presentation-outline-tab-label">{outlineTitle}</span>
        </button>
      ) : null}
      <aside className="presentation-outline" aria-label={isDocument ? "Document outline" : "Slides"} aria-hidden={!outlineOpen}>
        <header className="presentation-outline-header">
          <span className="presentation-outline-title">
            <span className="presentation-outline-title-icon"><OutlineIcon presentation={isPresentation} /></span>
            {outlineTitle}
          </span>
          <button
            type="button"
            className="presentation-outline-close"
            aria-label={isDocument ? "Close document outline" : "Close slide previews"}
            onClick={() => setOutlineOpen(false)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div ref={outlineRef} className="presentation-outline-list" />
      </aside>
      <main ref={presentationViewportRef} className="presentation-viewport">
        {viewer}
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Office viewer root is missing");
createRoot(root).render(<StrictMode><OfficeViewer /></StrictMode>);
