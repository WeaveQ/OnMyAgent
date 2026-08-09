/** @jsxImportSource react */
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
 * Height-driven so non-square viewBoxes do not get squashed into a square.
 */
export function EmptyStateIllustration(props: EmptyStateIllustrationProps) {
  const sizeClass =
    props.size === "compact"
      ? EMPTY_STATE_ILLUSTRATION_COMPACT_CLASS
      : EMPTY_STATE_ILLUSTRATION_CLASS;
  return (
    <img
      src={resolvePublicAssetUrl(props.src)}
      alt=""
      className={cn(sizeClass, props.className)}
      draggable={false}
    />
  );
}
