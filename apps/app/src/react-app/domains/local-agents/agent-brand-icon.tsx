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

const TILE_SIZE: Record<AgentBrandIconSize, string> = {
  xs: "size-5 rounded-md",
  sm: "size-7 rounded-lg",
  md: "size-11 rounded-xl",
  lg: "size-12 rounded-xl",
};

const GLYPH_SIZE: Record<AgentBrandIconSize, string> = {
  xs: "size-3",
  sm: "size-4",
  md: "size-6",
  lg: "size-7",
};

const GLYPH_PX: Record<AgentBrandIconSize, number> = {
  xs: 12,
  sm: 16,
  md: 24,
  lg: 28,
};

const FALLBACK_ICON_SIZE: Record<AgentBrandIconSize, string> = {
  xs: "size-3",
  sm: "size-3.5",
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
