/** @jsxImportSource react */
/**
 * Shared brand icon tile for local / custom / discoverable agents.
 *
 * Light: muted surface + soft ring.
 * Dark: white plate so black/color brand marks stay readable (matches
 * agent-management fleet cards).
 *
 * Resolution order: explicit src → local agent-icons map → Lobe brand → Bot.
 */
import type { ReactNode } from "react";
import { Bot } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  hasLobeAgentBrandIcon,
  LobeAgentBrandIcon,
} from "@/react-app/design-system/lobe-brand-icons";
import { resolveAgentIconUrl } from "./agent-icon-map";

export type AgentBrandIconSize = "xs" | "sm" | "md" | "lg";

// Radius aligns with skills marketplace icons (`rounded-md`).
// Glyph fills most of the plate so dense stacks (skill matrix) do not look
// like empty white chips with a tiny mark in the center.
const TILE_SIZE: Record<AgentBrandIconSize, string> = {
  xs: "size-6 rounded-md",
  sm: "size-8 rounded-md", // same footprint as skill card icons
  md: "size-10 rounded-md",
  lg: "size-12 rounded-md",
};

const GLYPH_SIZE: Record<AgentBrandIconSize, string> = {
  xs: "size-[1.125rem]", // ~18px in 24px plate
  sm: "size-5",
  md: "size-6",
  lg: "size-7",
};

const GLYPH_PX: Record<AgentBrandIconSize, number> = {
  xs: 18,
  sm: 20,
  md: 24,
  lg: 28,
};

const FALLBACK_ICON_SIZE: Record<AgentBrandIconSize, string> = {
  xs: "size-4",
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
};

/** Shared light/dark plate — use for any agent brand mark surface. */
export const agentBrandIconTileClass =
  "flex shrink-0 items-center justify-center overflow-hidden bg-dls-surface-muted text-dls-secondary ring-1 ring-dls-border/60 dark:bg-white dark:ring-black/10 dark:text-neutral-700";

export function AgentBrandIcon(props: {
  /** Explicit icon URL (wins over id/provider lookup). */
  src?: string | null;
  id?: string;
  provider?: string;
  size?: AgentBrandIconSize;
  className?: string;
  /** Optional status / activity badge (positioned relative to the tile). */
  badge?: ReactNode;
  /** Accessible name for the mark (decorative by default). */
  alt?: string;
}) {
  const size = props.size ?? "md";
  const resolvedUrl =
    props.src ??
    (props.id || props.provider
      ? resolveAgentIconUrl({
          id: props.id ?? "",
          provider: props.provider ?? "",
        })
      : null);

  return (
    <div className={cn("relative shrink-0", props.className)}>
      <div className={cn(agentBrandIconTileClass, TILE_SIZE[size])}>
        {resolvedUrl ? (
          <img
            src={resolvedUrl}
            alt={props.alt ?? ""}
            className={cn(GLYPH_SIZE[size], "object-contain")}
            loading="lazy"
            draggable={false}
          />
        ) : (
          <LobeOrBot id={props.id} provider={props.provider} size={size} />
        )}
      </div>
      {props.badge}
    </div>
  );
}

function LobeOrBot(props: {
  id?: string;
  provider?: string;
  size: AgentBrandIconSize;
}) {
  if (!hasLobeAgentBrandIcon(props.id, props.provider)) {
    return <Bot className={FALLBACK_ICON_SIZE[props.size]} aria-hidden />;
  }
  return (
    <LobeAgentBrandIcon
      id={props.id}
      provider={props.provider}
      size={GLYPH_PX[props.size]}
      className={cn(GLYPH_SIZE[props.size], "object-contain")}
    />
  );
}
