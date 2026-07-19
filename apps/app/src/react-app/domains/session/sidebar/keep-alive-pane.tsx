/** @jsxImportSource react */
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Track which rail views have been opened so we can keep them mounted
 * (lazy keep-alive) without mounting everything on first paint.
 * `resetKey` (e.g. workspace id) clears the visited set on change.
 */
export function useVisitedRailViews<T extends string>(
  active: T,
  resetKey?: string,
): Set<T> {
  const [visited, setVisited] = useState(() => new Set<T>([active]));

  useEffect(() => {
    setVisited(new Set<T>([active]));
    // Only reset when workspace (or other scope) changes — not on every view switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: resetKey only
  }, [resetKey]);

  useEffect(() => {
    setVisited((prev) => {
      if (prev.has(active)) return prev;
      const next = new Set(prev);
      next.add(active);
      return next;
    });
  }, [active]);

  return visited;
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
  children: ReactNode;
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
      {props.children}
    </div>
  );
}
