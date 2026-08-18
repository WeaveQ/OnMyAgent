/** @jsxImportSource react */
import { useLayoutEffect, useRef, useState } from "react";

import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { PreviewError } from "./preview";

type Bounds = { x: number; y: number; width: number; height: number };

function computeBounds(element: HTMLElement): Bounds {
  const rect = element.getBoundingClientRect();
  const zoom = window.__ONMYAGENT_ZOOM_FACTOR__ ?? 1;
  return {
    x: Math.round(rect.x * zoom),
    y: Math.round(rect.y * zoom),
    width: Math.round(rect.width * zoom),
    height: Math.round(rect.height * zoom),
  };
}

function sameBounds(left: Bounds | null, right: Bounds) {
  return Boolean(left && left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height);
}

export function OfficeFilePreview(props: {
  filePath: string;
  name: string;
  /** Home space folder or isolated session dir — not always a registered workspace. */
  allowedRoot?: string;
  revision?: string | number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastBoundsRef = useRef<Bounds | null>(null);
  const [previewError, setPreviewError] = useState(false);

  useLayoutEffect(() => {
    setPreviewError(false);
    const preview = window.__ONMYAGENT_ELECTRON__?.artifactPreview;
    const container = containerRef.current;
    if (!preview || !container || !props.filePath) return;
    let frame: number | null = null;
    let shown = false;
    let lastAttachAt = 0;
    let active = true;
    let failed = false;
    const reportPreviewFailure = () => {
      if (!active) return;
      failed = true;
      setPreviewError(true);
      shown = false;
      void Promise.resolve(preview.hide?.()).catch(() => undefined);
    };
    const sync = () => {
      if (failed) return;
      const bounds = computeBounds(container);
      const now = performance.now();
      if (bounds.width < 1 || bounds.height < 1) {
        if (shown) void Promise.resolve(preview.hide?.()).catch(() => undefined);
        shown = false;
        return;
      }
      if (!shown) {
        const theme = document.documentElement.classList.contains("dark") || document.documentElement.dataset.theme === "dark" ? "dark" : "light";
        const locale = document.documentElement.lang || navigator.language;
        void Promise.resolve(preview.show?.({
          filePath: props.filePath,
          ...(props.allowedRoot?.trim() ? { allowedRoot: props.allowedRoot.trim() } : {}),
          bounds,
          theme,
          locale,
        }))
          .then(() => preview.setBounds?.(bounds))
          .catch(reportPreviewFailure);
        shown = true;
        lastAttachAt = now;
        lastBoundsRef.current = bounds;
      } else if (!sameBounds(lastBoundsRef.current, bounds) || now - lastAttachAt >= 500) {
        void Promise.resolve(preview.setBounds?.(bounds)).catch(reportPreviewFailure);
        lastAttachAt = now;
        lastBoundsRef.current = bounds;
      }
    };
    const loop = () => { sync(); frame = window.requestAnimationFrame(loop); };
    sync();
    frame = window.requestAnimationFrame(loop);
    const observer = new ResizeObserver(sync);
    observer.observe(container);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      if (frame !== null) window.cancelAnimationFrame(frame);
      void Promise.resolve(preview.hide?.()).catch(() => undefined);
      lastBoundsRef.current = null;
    };
  }, [props.filePath, props.allowedRoot, props.revision]);

  return (
    <div ref={containerRef} className={cn("h-full min-h-0 overflow-hidden bg-dls-surface-muted/30", props.className)} data-office-file-preview={props.name}>
      {previewError ? <PreviewError message={t("files.preview_failed")} /> : null}
    </div>
  );
}
