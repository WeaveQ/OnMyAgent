/** @jsxImportSource react */
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  DEFAULT_SECONDARY_RAIL_KEEP_ALIVE_MAX,
  nextVisitedRailViews,
} from "../pages/rail-keep-alive-lru";

/**
 * Track which rail views have been opened so we can keep them mounted
 * (lazy keep-alive) without mounting everything on first paint.
 * `resetKey` (e.g. workspace id) clears the visited set on change.
 *
 * Secondary panes use an LRU budget (default 3) so store/files/billing/…
 * do not all stay mounted after long browsing.
 */
export function useVisitedRailViews<T extends string>(
  active: T,
  resetKey?: string,
  maxSecondary: number = DEFAULT_SECONDARY_RAIL_KEEP_ALIVE_MAX,
): Set<T> {
  const [visited, setVisited] = useState(() => new Set<T>([active]));

  useEffect(() => {
    setVisited(new Set<T>([active]));
    // Only reset when workspace (or other scope) changes — not on every view switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: resetKey only
  }, [resetKey]);

  useEffect(() => {
    setVisited((prev) => {
      const next = nextVisitedRailViews(prev, active, maxSecondary) as Set<T>;
      if (setsEqual(prev, next)) return prev;
      return next;
    });
  }, [active, maxSecondary]);

  return visited;
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  // Preserve LRU order: last inserted must match (most recent).
  const aLast = [...a].at(-1);
  const bLast = [...b].at(-1);
  return aLast === bLast;
}

/**
 * Keep children mounted once visited; hide with `hidden` (display:none).
 *
 * Do NOT use Tailwind `invisible` (visibility:hidden) — descendants default to
 * visibility:visible and still paint, which stacks ghost UIs (e.g. 管理 cards
 * under the assistant sticky composer).
 */
export function KeepAlivePane(props: {
  active: boolean;
  mounted: boolean;
  children: ReactNode | ((active: boolean) => ReactNode);
  className?: string;
}) {
  if (!props.mounted) return null;
  return (
    <div
      className={cn(
        "absolute inset-0 min-h-0 min-w-0 overflow-hidden",
        props.active ? "z-[1]" : "z-0 hidden",
        props.className,
      )}
      aria-hidden={!props.active}
      {...(!props.active ? ({ inert: "" } as Record<string, string>) : {})}
    >
      {typeof props.children === "function"
        ? props.children(props.active)
        : props.children}
    </div>
  );
}
