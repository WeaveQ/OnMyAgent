/** @jsxImportSource react */
import type { KeyboardEvent, PointerEvent } from "react";

import { t } from "../../../../i18n";
import { cn } from "@/lib/utils";

/**
 * Vertical seam between the expert/assistant list and the main workspace.
 *
 * Layout width is zero so the list and workspace sit flush (no gutter gap).
 * A wider absolute hit target keeps resize usable; a 1px mist hairline marks
 * the seam and brightens on hover/focus/active.
 */
export function AgentPanelResizeHandle(props: {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyNudge: (delta: number) => void;
  className?: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      props.onKeyNudge(event.key === "ArrowLeft" ? -16 : 16);
    }
  };

  return (
    <div
      role="separator"
      aria-label={t("session.resize_agent_list")}
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={props.onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        // Zero flex footprint — negative margins cancel the hit width.
        "group relative z-10 -ml-1.5 -mr-1.5 w-3 shrink-0 cursor-col-resize touch-none outline-none",
        "mac:titlebar-no-drag",
        props.className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
          "bg-dls-mist transition-colors",
          "group-hover:bg-dls-border-strong group-active:bg-dls-accent",
          "group-focus-visible:bg-dls-accent",
        )}
      />
    </div>
  );
}
