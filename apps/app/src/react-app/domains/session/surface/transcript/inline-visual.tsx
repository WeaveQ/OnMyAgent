/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Check, CircleAlert, Code2, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { ArtifactIcon } from "../../../../capabilities/artifacts/artifact-icon";

import type { TurnWidgetItem } from "./turn-content";

const COMPLETE_DOCUMENT_PATTERN = /<!doctype|<\/?(?:html|head|body)(?:\s|>)/i;
const SVG_FRAGMENT_PATTERN = /^<svg\b/i;
const HTML_FRAGMENT_ROOT_PATTERN = /^<(?:div|section|article|figure|main|h2|style|canvas)\b/i;
const SANDBOX_BLOCKED_PATTERN = /<\s*(?:iframe|object|embed|base|meta|link|form)\b|\b(?:localStorage|sessionStorage)\b|position\s*:\s*fixed/i;
const SCRIPT_TAG_PATTERN = /<script\b([^>]*)>/gi;
const SCRIPT_SRC_PATTERN = /\bsrc\s*=\s*["']([^"']+)["']/i;
const WIDGET_CDN_HOSTS = new Set([
  "cdnjs.cloudflare.com",
  "esm.sh",
  "cdn.jsdelivr.net",
  "unpkg.com",
]);
const MAX_VISUAL_SOURCE_LENGTH = 200_000;
const DEFAULT_SANDBOX_HEIGHT = 360;
const MAX_SANDBOX_HEIGHT = 2_000;
const browserPurifier = typeof window === "undefined" ? null : DOMPurify(window);

const VISUALIZER_SANDBOX_STYLE = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--color-background-primary:#fff;--color-background-secondary:#f5f5f5;--color-background-tertiary:#ebebeb;--color-background-info:#e6f1fb;--color-background-danger:#fcebeb;--color-background-success:#eaf3de;--color-background-warning:#faeeda;--color-text-primary:#1a1a1a;--color-text-secondary:#666;--color-text-tertiary:#999;--color-text-info:#185fa5;--color-text-danger:#a32d2d;--color-text-success:#3b6d11;--color-text-warning:#854f0b;--color-border-primary:rgba(0,0,0,.4);--color-border-secondary:rgba(0,0,0,.3);--color-border-tertiary:rgba(0,0,0,.15);--color-border-info:#378add;--color-border-danger:#e24b4a;--color-border-success:#639922;--color-border-warning:#ba7517;--font-sans:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--font-serif:Georgia,"Times New Roman",serif;--font-mono:"SF Mono",Monaco,"Cascadia Code","Roboto Mono",Consolas,monospace;--border-radius-sm:4px;--border-radius-md:8px;--border-radius-lg:12px;--border-radius-xl:16px}
.dark{--color-background-primary:#1a1a1a;--color-background-secondary:#2a2a2a;--color-background-tertiary:#333;--color-background-info:#042c53;--color-background-danger:#501313;--color-background-success:#173404;--color-background-warning:#412402;--color-text-primary:#e0e0e0;--color-text-secondary:#a0a0a0;--color-text-tertiary:#707070;--color-text-info:#b5d4f4;--color-text-danger:#f7c1c1;--color-text-success:#c0dd97;--color-text-warning:#fac775;--color-border-primary:rgba(255,255,255,.4);--color-border-secondary:rgba(255,255,255,.3);--color-border-tertiary:rgba(255,255,255,.15)}
html,body{width:100%;height:auto;overflow:visible;background:transparent}body{font-family:var(--font-sans);color:var(--color-text-primary);line-height:1.5}#root{width:100%;min-height:20px;overflow:visible;overflow-x:hidden;background:transparent}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}script{display:none!important}
.t{font-family:var(--font-sans);font-size:14px;fill:var(--color-text-primary,currentColor)}.ts{font-family:var(--font-sans);font-size:12px;fill:var(--color-text-secondary,currentColor)}.th{font-family:var(--font-sans);font-size:14px;font-weight:500;fill:var(--color-text-primary,currentColor)}.box{fill:var(--color-background-secondary,#f5f5f5);stroke:var(--color-border-tertiary,#e0e0e0);stroke-width:1;rx:6}.node{cursor:pointer}.node:hover .box{fill:var(--color-background-tertiary,#ebebeb)}.arr{stroke:var(--color-text-secondary,#666);stroke-width:1.5;fill:none;marker-end:url(#arrow)}.leader{stroke:var(--color-border-tertiary,#ccc);stroke-width:.5;stroke-dasharray:4 2;fill:none}
.c-purple{--node-bg:#eeedfe;--node-border:#7f77dd;--node-text:#26215c;--node-text-sub:#534ab7}.c-teal{--node-bg:#e1f5ee;--node-border:#1d9e75;--node-text:#04342c;--node-text-sub:#0f6e56}.c-coral{--node-bg:#faece7;--node-border:#d85a30;--node-text:#4a1b0c;--node-text-sub:#9b3318}.c-pink{--node-bg:#fbeaf0;--node-border:#d4537e;--node-text:#4b1528;--node-text-sub:#9c2d56}.c-gray{--node-bg:#f1efe8;--node-border:#888780;--node-text:#2c2c2a;--node-text-sub:#5c5c5a}.c-blue{--node-bg:#e6f1fb;--node-border:#378add;--node-text:#042c53;--node-text-sub:#1b5c99}.c-green{--node-bg:#eaf3de;--node-border:#639922;--node-text:#173404;--node-text-sub:#3a6b10}.c-amber{--node-bg:#faeeda;--node-border:#ba7517;--node-text:#412402;--node-text-sub:#7a4a10}.c-red{--node-bg:#fcebeb;--node-border:#e24b4a;--node-text:#501313;--node-text-sub:#9b2222}
.dark .c-purple{--node-bg:#26215c;--node-border:#7f77dd;--node-text:#eeedfe;--node-text-sub:#b8b4f5}.dark .c-teal{--node-bg:#04342c;--node-border:#1d9e75;--node-text:#e1f5ee;--node-text-sub:#7dddc0}.dark .c-coral{--node-bg:#4a1b0c;--node-border:#d85a30;--node-text:#faece7;--node-text-sub:#f0a080}.dark .c-pink{--node-bg:#4b1528;--node-border:#d4537e;--node-text:#fbeaf0;--node-text-sub:#f0a0c0}.dark .c-gray{--node-bg:#2c2c2a;--node-border:#888780;--node-text:#f1efe8;--node-text-sub:#b8b6b0}.dark .c-blue{--node-bg:#042c53;--node-border:#378add;--node-text:#e6f1fb;--node-text-sub:#90c4f0}.dark .c-green{--node-bg:#173404;--node-border:#639922;--node-text:#eaf3de;--node-text-sub:#a0d060}.dark .c-amber{--node-bg:#412402;--node-border:#ba7517;--node-text:#faeeda;--node-text-sub:#e0a860}.dark .c-red{--node-bg:#501313;--node-border:#e24b4a;--node-text:#fcebeb;--node-text-sub:#f09090}
@media(prefers-color-scheme:dark){.c-purple{--node-bg:#26215c;--node-border:#7f77dd;--node-text:#eeedfe;--node-text-sub:#b8b4f5}.c-teal{--node-bg:#04342c;--node-border:#1d9e75;--node-text:#e1f5ee;--node-text-sub:#7dddc0}.c-coral{--node-bg:#4a1b0c;--node-border:#d85a30;--node-text:#faece7;--node-text-sub:#f0a080}.c-pink{--node-bg:#4b1528;--node-border:#d4537e;--node-text:#fbeaf0;--node-text-sub:#f0a0c0}.c-gray{--node-bg:#2c2c2a;--node-border:#888780;--node-text:#f1efe8;--node-text-sub:#b8b6b0}.c-blue{--node-bg:#042c53;--node-border:#378add;--node-text:#e6f1fb;--node-text-sub:#90c4f0}.c-green{--node-bg:#173404;--node-border:#639922;--node-text:#eaf3de;--node-text-sub:#a0d060}.c-amber{--node-bg:#412402;--node-border:#ba7517;--node-text:#faeeda;--node-text-sub:#e0a860}.c-red{--node-bg:#501313;--node-border:#e24b4a;--node-text:#fcebeb;--node-text-sub:#f09090}}
.c-purple .box,.c-teal .box,.c-coral .box,.c-pink .box,.c-gray .box,.c-blue .box,.c-green .box,.c-amber .box,.c-red .box{fill:var(--node-bg);stroke:var(--node-border)}.c-purple .t,.c-teal .t,.c-coral .t,.c-pink .t,.c-gray .t,.c-blue .t,.c-green .t,.c-amber .t,.c-red .t,.c-purple .th,.c-teal .th,.c-coral .th,.c-pink .th,.c-gray .th,.c-blue .th,.c-green .th,.c-amber .th,.c-red .th{fill:var(--node-text)}.c-purple .ts,.c-teal .ts,.c-coral .ts,.c-pink .ts,.c-gray .ts,.c-blue .ts,.c-green .ts,.c-amber .ts,.c-red .ts{fill:var(--node-text-sub)}
.c-purple rect,.c-teal rect,.c-coral rect,.c-pink rect,.c-gray rect,.c-blue rect,.c-green rect,.c-amber rect,.c-red rect,.c-purple circle,.c-teal circle,.c-coral circle,.c-pink circle,.c-gray circle,.c-blue circle,.c-green circle,.c-amber circle,.c-red circle,.c-purple ellipse,.c-teal ellipse,.c-coral ellipse,.c-pink ellipse,.c-gray ellipse,.c-blue ellipse,.c-green ellipse,.c-amber ellipse,.c-red ellipse{fill:var(--node-bg);stroke:var(--node-border)}.c-purple text,.c-teal text,.c-coral text,.c-pink text,.c-gray text,.c-blue text,.c-green text,.c-amber text,.c-red text{fill:var(--node-text)}
`;

export type SanitizedVisualFragment = {
  html: string;
  valid: boolean;
};

export function sanitizeVisualFragment(source: string): SanitizedVisualFragment {
  const trimmed = source.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_VISUAL_SOURCE_LENGTH ||
    COMPLETE_DOCUMENT_PATTERN.test(trimmed) ||
    !browserPurifier
  ) {
    return { html: "", valid: false };
  }

  const html = browserPurifier.sanitize(trimmed, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
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
  }).trim();

  return { html, valid: html.length > 0 };
}

export function isSandboxedHtmlVisual(source: string): boolean {
  const trimmed = source.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_VISUAL_SOURCE_LENGTH ||
    COMPLETE_DOCUMENT_PATTERN.test(trimmed) ||
    SVG_FRAGMENT_PATTERN.test(trimmed) ||
    !HTML_FRAGMENT_ROOT_PATTERN.test(trimmed) ||
    SANDBOX_BLOCKED_PATTERN.test(trimmed)
  ) {
    return false;
  }

  for (const match of trimmed.matchAll(SCRIPT_TAG_PATTERN)) {
    const attributes = match[1] ?? "";
    const src = attributes.match(SCRIPT_SRC_PATTERN)?.[1];
    if (!src) continue;
    try {
      const url = new URL(src);
      if (url.protocol !== "https:" || !WIDGET_CDN_HOSTS.has(url.hostname)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function buildVisualSandboxDocument(source: string, dark = false): string {
  const cdnSources = [...WIDGET_CDN_HOSTS].map((host) => `https://${host}`).join(" ");
  return `<!doctype html>
<html${dark ? ' class="dark"' : ""}>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${cdnSources}; style-src 'unsafe-inline'; img-src data: blob: ${cdnSources}; font-src ${cdnSources}; connect-src ${cdnSources}">
<style>
${VISUALIZER_SANDBOX_STYLE}
</style>
</head>
<body>
<div id="root">${source}</div>
<script>
(()=>{const root=document.getElementById("root");let last=0;const report=()=>{const next=Math.min(Math.max(Math.ceil(root.getBoundingClientRect().height),20),${MAX_SANDBOX_HEIGHT});if(next!==last){last=next;parent.postMessage({type:"onmyagent:visual-resize",height:next},"*")}};new ResizeObserver(()=>requestAnimationFrame(report)).observe(root);addEventListener("load",report);requestAnimationFrame(report)})();
</script>
</body>
</html>`;
}

function SandboxedVisual(props: {
  source: string;
  title: string;
  onArtifactCopyChange?: (key: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(DEFAULT_SANDBOX_HEIGHT);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const sourceDocument = useMemo(
    () => buildVisualSandboxDocument(props.source, dark),
    [dark, props.source],
  );

  useEffect(() => {
    setHeight(DEFAULT_SANDBOX_HEIGHT);
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!event.data) return;
      if (event.data.type === "onmyagent:waybill-copy") {
        if (typeof event.data.key === "string") props.onArtifactCopyChange?.(event.data.key);
        return;
      }
      if (event.data.type === "onmyagent:waybill-fields") {
        const patch = event.data.patch;
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
        // Bubble out of the sandbox so the host can merge data without dumping
        // JSON into the transcript UI.
        window.dispatchEvent(
          new CustomEvent("onmyagent-waybill-fields-patch", {
            detail: { patch },
          }),
        );
        return;
      }
      if (event.data.type === "onmyagent:visual-resize") {
        const nextHeight = Number(event.data.height);
        if (!Number.isFinite(nextHeight)) return;
        setHeight(Math.min(Math.max(Math.ceil(nextHeight), 20), MAX_SANDBOX_HEIGHT));
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [props.onArtifactCopyChange, props.source]);

  useEffect(() => {
    const root = document.documentElement;
    const updateTheme = () => setDark(
      root.classList.contains("dark") || root.dataset.theme === "dark",
    );
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <iframe
      ref={frameRef}
      className="session-inline-visual-frame"
      srcDoc={sourceDocument}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      title={props.title}
      style={{ height }}
    />
  );
}

export function InlineVisual(props: {
  visual: TurnWidgetItem;
  className?: string;
  onOpenCodePath?: (path: string, mode?: "preview" | "reveal") => void;
}) {
  const [showSource, setShowSource] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [selectedCopyKey, setSelectedCopyKey] = useState(
    () => props.visual.artifactCopies[0]?.key ?? "white",
  );
  const loadingMessagesKey = props.visual.loadingMessages.join("\n");
  const loadingMessages = useMemo(
    () => loadingMessagesKey
      ? loadingMessagesKey.split("\n")
      : [t("session.visual_loading")],
    [loadingMessagesKey],
  );
  const sanitized = useMemo(
    () => sanitizeVisualFragment(props.visual.html),
    [props.visual.html],
  );
  const sandboxedHtml = useMemo(
    () => isSandboxedHtmlVisual(props.visual.html),
    [props.visual.html],
  );
  const selectedCopy = props.visual.artifactCopies.find(
    (copy) => copy.key === selectedCopyKey,
  ) ?? props.visual.artifactCopies[0];

  useEffect(() => {
    setSelectedCopyKey(props.visual.artifactCopies[0]?.key ?? "white");
  }, [props.visual.artifactCopies]);

  useEffect(() => {
    setLoadingIndex(0);
    if (props.visual.status !== "running" || loadingMessages.length <= 1) return;
    const timer = window.setInterval(() => {
      setLoadingIndex((current) => (current + 1) % loadingMessages.length);
    }, 1_400);
    return () => window.clearInterval(timer);
  }, [loadingMessages, props.visual.status]);

  const loadingLabel = loadingMessages[loadingIndex] ?? loadingMessages[0];
  if (props.visual.status === "running" && !props.visual.html.trim()) {
    return (
      <div
        className={cn("session-inline-visual-loading", props.className)}
        data-inline-visual="true"
        data-inline-visual-state="running"
        role="status"
        aria-live="polite"
      >
        <LoadingSpinner size="sm" />
        <span className="session-transcript-loading-shimmer">{loadingLabel}</span>
      </div>
    );
  }

  return (
    <section
      className={cn(
        "session-inline-visual",
        props.className,
      )}
      data-inline-visual="true"
      data-inline-visual-state={props.visual.status}
      aria-label={props.visual.title ?? t("session.visual_details")}
    >
      <header className="session-inline-visual-header">
        {props.visual.status === "failed" ? (
          <CircleAlert className="size-4 shrink-0 text-dls-status-danger" />
        ) : props.visual.status === "running" ? (
          <LoadingSpinner size="sm" />
        ) : (
          <Check className="size-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">
          {props.visual.status === "running"
            ? loadingLabel
            : t("session.visual_details")}
        </span>
        {props.visual.html ? <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("session.visual_actions")}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {selectedCopy && props.onOpenCodePath ? (
              <>
                {selectedCopy.pdf.trim() ? (
                  <DropdownMenuItem onSelect={() => props.onOpenCodePath?.(selectedCopy.pdf, "reveal")}>
                    <ArtifactIcon name={selectedCopy.pdf} className="size-4" />
                    {t("session.visual_reveal_pdf")}
                  </DropdownMenuItem>
                ) : null}
                {selectedCopy.xlsx.trim() ? (
                  <DropdownMenuItem onSelect={() => props.onOpenCodePath?.(selectedCopy.xlsx, "reveal")}>
                    <ArtifactIcon name={selectedCopy.xlsx} className="size-4" />
                    {t("session.visual_reveal_excel")}
                  </DropdownMenuItem>
                ) : null}
                {(selectedCopy.pdf.trim() || selectedCopy.xlsx.trim()) ? (
                  <DropdownMenuSeparator />
                ) : null}
              </>
            ) : null}
            <DropdownMenuItem onSelect={() => setShowSource((current) => !current)}>
              <Code2 className="size-4" />
              {showSource
                ? t("session.visual_hide_source")
                : t("session.visual_show_source")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu> : null}
      </header>

      {props.visual.status === "failed" ? (
        <div className="session-inline-visual-error" role="alert">
          {props.visual.errorText || t("session.visual_failed")}
        </div>
      ) : showSource ? (
        <pre className="session-inline-visual-source">
          {props.visual.html}
        </pre>
      ) : props.visual.status === "completed" && sandboxedHtml ? (
        <SandboxedVisual
          source={props.visual.html}
          title={props.visual.title ?? t("session.visual_details")}
          onArtifactCopyChange={setSelectedCopyKey}
        />
      ) : sanitized.valid ? (
        <div
          className="session-inline-visual-body"
          // DOMPurify removes scripts, event handlers, unsafe URLs and active embeds.
          dangerouslySetInnerHTML={{ __html: sanitized.html }}
        />
      ) : (
        <div className="session-inline-visual-invalid" role="alert">
          {t("session.visual_invalid")}
        </div>
      )}
    </section>
  );
}
