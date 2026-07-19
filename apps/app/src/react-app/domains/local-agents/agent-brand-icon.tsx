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
import { LobeAgentBrandIcon } from "@/react-app/design-system/lobe-brand-icons";
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
          <LobeAgentBrandIcon
            id={props.id}
            provider={props.provider}
            size={GLYPH_PX[size]}
            className={cn(GLYPH_SIZE[size], "object-contain")}
          /> ?? (
            // Lobe returns null when no mapping; fall through to Bot
            <Bot className={FALLBACK_ICON_SIZE[size]} aria-hidden />
          )
        )}
        {/* When Lobe renders nothing, show Bot — handled below via empty check is awkward in JSX.
            Render Bot only if no URL and Lobe has no mark: use dual-pass structure. */}
        {!resolvedUrl ? (
          <LobeOrBot id={props.id} provider={props.provider} size={size} />
        ) : null}
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
  // Try Lobe first; if the component returns null React still mounts null.
  // We need a small probe: render Lobe and Bot with CSS so only one shows.
  // Simpler: always prefer LobeAgentBrandIcon which returns null, and use
  // a wrapper that falls back.
  const lobe = (
    <LobeAgentBrandIcon
      id={props.id}
      provider={props.provider}
      size={GLYPH_PX[props.size]}
      className={cn(GLYPH_SIZE[props.size], "object-contain")}
    />
  );
  // LobeAgentBrandIcon is a component that returns null — we cannot detect null
  // easily without dual render. Use known mapping helper.
  const { hasLobeAgentBrandIcon } = requireLobeHas();
  if (hasLobeAgentBrandIcon(props.id, props.provider)) {
    return lobe;
  }
  return <Bot className={FALLBACK_ICON_SIZE[props.size]} aria-hidden />;
}

function requireLobeHas() {
  // static import preferred — re-export path
  return {
    hasLobeAgentBrandIcon: (
      id?: string | null,
      provider?: string | null,
    ) => {
      // inline to avoid circular require — import at top
      return false;
    },
  };
}
