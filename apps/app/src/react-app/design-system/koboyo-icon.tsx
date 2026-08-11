/** @jsxImportSource react */
import { useMemo, type CSSProperties } from "react";

import { resolvePublicAssetAbsoluteUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";

type KoboyoIconProps = {
  src: string;
  /**
   * Square paint box in px (SVG is mask-contained — non-square viewBoxes stay
   * legible). Default 16 to match Lucide tile glyphs.
   * Prefer `width`/`height` for tall marks (e.g. rail person glyphs).
   */
  size?: number;
  /** Explicit box width in px (overrides `size` width). */
  width?: number;
  /** Explicit box height in px (overrides `size` height). */
  height?: number;
  className?: string;
};

/**
 * Compact monochrome Koboyo mark for product tiles / chrome.
 *
 * External SVG `<img>` cannot recolor `currentColor`; we paint with
 * `background-color` + CSS mask so light plates (dark ink) and brand tiles
 * (white ink) both work. Prefer `text-*` + `bg-current`, or an explicit `bg-*`.
 */
export function KoboyoIcon(props: KoboyoIconProps) {
  const fallback = props.size ?? 16;
  const width = props.width ?? fallback;
  const height = props.height ?? fallback;
  const url = resolvePublicAssetAbsoluteUrl(props.src);
  const style = useMemo(
    (): CSSProperties => ({
      width,
      height,
      ["--k-icon" as string]: `url(${JSON.stringify(url)})`,
    }),
    [url, width, height],
  );

  return (
    <span
      role="img"
      aria-hidden
      className={cn(
        "inline-block shrink-0 select-none bg-current",
        "[mask-image:var(--k-icon)] [mask-size:contain] [mask-repeat:no-repeat] [mask-position:center]",
        "[-webkit-mask-image:var(--k-icon)] [-webkit-mask-size:contain] [-webkit-mask-repeat:no-repeat] [-webkit-mask-position:center]",
        props.className,
      )}
      style={style}
    />
  );
}
