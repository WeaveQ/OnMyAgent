/** @jsxImportSource react */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

// Collapsed preview uses DESIGN.md § chat/illustration ceiling `max-h-60`
// (240px, ~10 lines at text-sm/leading-relaxed); the overflow test matches
// that rendered ceiling against real content height.
const COLLAPSE_PX = 240;
const COLLAPSE_MAX_HEIGHT_CLASS = "max-h-60";

/**
 * Clamps a block of children to a max-height preview with a bottom fade and a
 * single "show more" toggle. Overflow is measured from the real rendered block
 * (after paint, with a ResizeObserver), so long turns never sprout multiple
 * per-message toggles or cut text across a half-rendered line.
 */
export function ClampExpandBody({
  groupKey,
  fadeFromClass,
  showMoreLabel,
  showLessLabel,
  children,
}: {
  groupKey: string;
  fadeFromClass: string;
  showMoreLabel: string;
  showLessLabel: string;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const measure = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const prev = el.style.maxHeight;
    el.style.maxHeight = "none";
    const full = el.scrollHeight;
    el.style.maxHeight = prev;
    setIsOverflowing(full - COLLAPSE_PX > 2);
  }, []);

  useLayoutEffect(() => {
    setExpanded(false);
  }, [groupKey]);

  useLayoutEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    // Two frames: the first lets the markdown block / fonts lay out, the second
    // measures after that paint is committed.
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(measure);
    });
    const observer = new ResizeObserver(() => measure());
    if (bodyRef.current) observer.observe(bodyRef.current);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      observer.disconnect();
    };
  }, [groupKey, children, measure]);

  const collapsed = isOverflowing && !expanded;

  return (
    <div className="flex flex-col">
      <div className="relative">
        <div
          ref={bodyRef}
          className={cn(
            "min-w-0 overflow-hidden transition-[max-height] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
            collapsed && COLLAPSE_MAX_HEIGHT_CLASS,
          )}
        >
          {children}
        </div>
        {collapsed && (
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t to-transparent",
              fadeFromClass,
            )}
          />
        )}
      </div>
      {isOverflowing && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 inline-flex w-fit items-center gap-0.5 text-2xs font-medium text-dls-accent hover:underline"
        >
          {expanded ? showLessLabel : showMoreLabel}
          <ChevronDown
            className={cn("size-3 transition-transform", expanded && "rotate-180")}
          />
        </button>
      )}
    </div>
  );
}
