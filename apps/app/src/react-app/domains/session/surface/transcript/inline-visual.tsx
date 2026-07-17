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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

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
*,*::before,*::after{box-sizing:border-box}:root{--color-background-primary:#fff;--color-background-secondary:#f8fafc;--color-text-primary:#0f172a;--color-text-secondary:#64748b;--color-border-tertiary:#e5e7eb}.dark{--color-background-primary:#1e1e1e;--color-background-secondary:#2a2a2a;--color-text-primary:#f8fafc;--color-text-secondary:#94a3b8;--color-border-tertiary:#3a3a3a}html,body{width:100%;margin:0;overflow:visible;background:var(--color-background-primary)}body{font-family:system-ui,-apple-system,sans-serif;color:var(--color-text-primary);line-height:1.5}#root{width:100%;min-height:20px;overflow:visible;background:var(--color-background-primary)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
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

function SandboxedVisual(props: { source: string; title: string }) {
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
      if (!event.data || event.data.type !== "onmyagent:visual-resize") return;
      const nextHeight = Number(event.data.height);
      if (!Number.isFinite(nextHeight)) return;
      setHeight(Math.min(Math.max(Math.ceil(nextHeight), 20), MAX_SANDBOX_HEIGHT));
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [props.source]);

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

export function InlineVisual(props: { visual: TurnWidgetItem; className?: string }) {
  const [showSource, setShowSource] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);
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
