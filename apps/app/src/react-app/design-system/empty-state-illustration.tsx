/** @jsxImportSource react */
import { useMemo, type CSSProperties } from "react";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";
import {
  EMPTY_STATE_ILLUSTRATION_CLASS,
  EMPTY_STATE_ILLUSTRATION_COMPACT_CLASS,
} from "./empty-state-assets";

type EmptyStateIllustrationProps = {
  src: string;
  /** Full-page empty vs compact list empty. */
  size?: "default" | "compact";
  className?: string;
};

/**
 * Local Koboyo (or other) monochrome illustration for empty surfaces.
 *
 * External SVG `<img>` ignores CSS `color` / `currentColor`, so marks paint
 * black and vanish on dark backgrounds. We paint with `background-color`
 * (theme token) and mask the SVG shape so light/dark both stay legible.
 *
 * Size classes stay height-driven with an explicit max width so the mask box
 * does not collapse (unlike img intrinsic sizing).
 */
export function EmptyStateIllustration(props: EmptyStateIllustrationProps) {
  const sizeClass =
    props.size === "compact"
      ? EMPTY_STATE_ILLUSTRATION_COMPACT_CLASS
      : EMPTY_STATE_ILLUSTRATION_CLASS;
  const url = resolvePublicAssetUrl(props.src);
  const style = useMemo(
    (): CSSProperties =>
      ({
        ["--empty-illust" as string]: `url(${JSON.stringify(url)})`,
      }),
    [url],
  );

  return (
    <span
      role="img"
      aria-hidden
      className={cn(sizeClass, props.className)}
      style={style}
    />
  );
}
