/** @jsxImportSource react */
import { useLayoutEffect, useRef } from "react";

import { cn } from "@/lib/utils";

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
  revision?: string | number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastBoundsRef = useRef<Bounds | null>(null);

  useLayoutEffect(() => {
    const preview = window.__ONMYAGENT_ELECTRON__?.artifactPreview;
    const container = containerRef.current;
    if (!preview || !container || !props.filePath) return;
    let frame: number | null = null;
    let shown = false;
    let lastAttachAt = 0;
    const sync = () => {
      const bounds = computeBounds(container);
      const now = performance.now();
      if (bounds.width < 1 || bounds.height < 1) {
        if (shown) void preview.hide?.();
        shown = false;
        return;
      }
      if (!shown) {
        const theme = document.documentElement.classList.contains("dark") || document.documentElement.dataset.theme === "dark" ? "dark" : "light";
        const locale = document.documentElement.lang || navigator.language;
        void preview.show?.({ filePath: props.filePath, bounds, theme, locale }).then(() => preview.setBounds?.(bounds));
        shown = true;
        lastAttachAt = now;
        lastBoundsRef.current = bounds;
      } else if (!sameBounds(lastBoundsRef.current, bounds) || now - lastAttachAt >= 500) {
        void preview.setBounds?.(bounds);
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
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      if (frame !== null) window.cancelAnimationFrame(frame);
      void preview.hide?.();
      lastBoundsRef.current = null;
    };
  }, [props.filePath, props.revision]);

  return <div ref={containerRef} className={cn("h-full min-h-0 overflow-hidden bg-dls-surface-muted/30", props.className)} data-office-file-preview={props.name} />;
}
