/** @jsxImportSource react */
import { useMemo } from "react";
import DOMPurify from "dompurify";
import { CodeXml } from "lucide-react";

import { t } from "../../../i18n";

const HTML_SANDBOX_CSP =
  "default-src 'none'; style-src 'unsafe-inline' data:; img-src data: blob:; media-src data: blob:; font-src data:;";

function sanitizeHtmlDocument(source: string): string {
  if (typeof window === "undefined") return "";
  const purifier = DOMPurify(window);
  return purifier.sanitize(source, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [
      "script",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "base",
      "form",
      "input",
      "button",
      "textarea",
      "select",
    ],
    FORBID_ATTR: ["srcdoc"],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}

function wrapForSandbox(html: string): string {
  // Inject a restrictive CSP meta tag so the sandboxed document cannot reach the
  // network or run scripts even if sanitization missed something.
  const csp = `<meta http-equiv="Content-Security-Policy" content="${HTML_SANDBOX_CSP}">`;
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${csp}`);
  }
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${csp}</head>`);
  }
  return `<!doctype html><html><head>${csp}<meta charset="utf-8"></head><body>${html}</body></html>`;
}

type KnowledgeHtmlViewProps = {
  content: string;
  fileName: string;
};

/**
 * Read-only renderer for .html notes. The source is sanitized with DOMPurify
 * and rendered inside a sandboxed iframe with a strict CSP. The vault never
 * writes HTML back, and .html files are excluded from the full-text index.
 */
export function KnowledgeHtmlView(props: KnowledgeHtmlViewProps) {
  const documentHtml = useMemo(() => {
    const sanitized = sanitizeHtmlDocument(props.content);
    return wrapForSandbox(sanitized);
  }, [props.content]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-dls-background" aria-label={props.fileName}>
      <div className="flex shrink-0 items-center gap-2 border-b border-dls-border px-6 py-2 text-xs text-dls-secondary">
        <CodeXml className="size-3.5" />
        <span>{t("knowledge.html_readonly", { name: props.fileName })}</span>
      </div>
      <iframe
        title={props.fileName}
        srcDoc={documentHtml}
        sandbox=""
        className="min-h-0 flex-1 border-0 bg-dls-surface"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
