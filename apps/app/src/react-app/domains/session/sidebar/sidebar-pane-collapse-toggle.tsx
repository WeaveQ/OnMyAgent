import type { CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "../../../../i18n";
import { cn } from "@/lib/utils";

export function SidebarPaneCollapseToggle(props: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const title = props.collapsed
    ? t("session.expand_sidebar_pane")
    : t("session.collapse_sidebar_pane");
  const Icon = props.collapsed ? ChevronRight : ChevronLeft;

  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={props.onToggle}
              aria-label={title}
              aria-expanded={!props.collapsed}
              className={cn(
                // Sit on the list/workspace seam as a small chevron grip — not a
                // second full-height divider (the resize handle owns that line).
                "absolute top-1/2 z-30 h-10 w-3 -translate-y-1/2 overflow-visible rounded-r-md rounded-l-none px-0",
                "border border-l-0 border-dls-mist/80 bg-dls-surface-solid text-dls-secondary ",
                "transition-[width,color,background-color] duration-150",
                "hover:w-4 hover:border-dls-border hover:text-dls-text",
                "mac:titlebar-no-drag",
                props.collapsed && "border-l border-dls-mist/80",
                props.className,
              )}
              style={props.style}
            >
              <Icon className="size-3.5" />
            </Button>
          }
        />
        <TooltipContent side="right" sideOffset={8}>
          {title}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
