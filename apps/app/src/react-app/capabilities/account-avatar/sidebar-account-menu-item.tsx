/** @jsxImportSource react */
import * as React from "react";
import { ChevronRight } from "lucide-react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const sidebarAccountMenuRowClass =
  "flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium text-sidebar-foreground hover:!bg-dls-hover hover:!text-dls-text focus:!bg-dls-hover focus:!text-dls-text data-highlighted:!bg-dls-hover data-highlighted:!text-dls-text data-open:!bg-dls-hover data-open:!text-dls-text data-popup-open:!bg-dls-hover data-popup-open:!text-dls-text data-state-open:!bg-dls-hover data-state-open:!text-dls-text aria-expanded:!bg-dls-hover aria-expanded:!text-dls-text [&_svg]:text-current";

export function SidebarAccountMenuItem(props: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSelect?: () => void;
  destructive?: boolean;
  /** Trailing chevron for items that open another page / panel. */
  showChevron?: boolean;
  trailing?: string;
}) {
  const Icon = props.icon;

  if (props.destructive) {
    return (
      <DropdownMenuItem
        onClick={props.onSelect}
        className={cn(
          sidebarAccountMenuRowClass,
          "flex text-dls-status-danger hover:!bg-dls-status-danger-soft hover:text-dls-status-danger focus:!bg-dls-status-danger-soft focus:text-dls-status-danger data-highlighted:!bg-dls-status-danger-soft data-highlighted:!text-dls-status-danger",
        )}
      >
        <Icon className="size-3.5 text-dls-status-danger" />
        <span className="flex-1 text-dls-status-danger">{props.label}</span>
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem onClick={props.onSelect} className={sidebarAccountMenuRowClass}>
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.trailing ? (
        <span className="shrink-0 text-xs font-normal tabular-nums text-dls-secondary">
          {props.trailing}
        </span>
      ) : null}
      {props.showChevron ? (
        <ChevronRight className="size-3.5 shrink-0 text-dls-secondary" aria-hidden />
      ) : null}
    </DropdownMenuItem>
  );
}
