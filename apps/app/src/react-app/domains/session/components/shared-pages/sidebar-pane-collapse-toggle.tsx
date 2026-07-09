import type { CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "../../../../../i18n";
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
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={props.onToggle}
      title={title}
      aria-label={title}
      aria-expanded={!props.collapsed}
      className={cn(
        "absolute top-1/2 z-30 h-14 w-2.5 -translate-y-1/2 overflow-visible rounded-l-none rounded-r-md border-y border-r border-l-0 border-dls-border px-0 text-dls-secondary shadow-none transition-[width,color] duration-150 before:absolute before:-left-px before:inset-y-0 before:w-px hover:w-4 hover:text-dls-text mac:titlebar-no-drag",
        props.collapsed
          ? "bg-dls-rail before:bg-dls-rail"
          : "bg-dls-background before:bg-dls-background",
        props.className,
      )}
      style={props.style}
    >
      <Icon className="size-3.5" />
    </Button>
  );
}
