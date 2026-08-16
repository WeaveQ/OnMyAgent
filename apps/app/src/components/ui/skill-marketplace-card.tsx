/** @jsxImportSource react */
import type { KeyboardEvent, ReactNode } from "react";

import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

/**
 * Shared responsive grid for marketplace-style card shelves
 * (skills market, company store, expert market, plugins).
 * Single source — do not re-copy this Tailwind string in pages.
 */
export const MARKETPLACE_CARD_GRID =
  "grid grid-cols-1 items-start gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";

/** Same columns as MARKETPLACE_CARD_GRID without the 2xl breakpoint (dense shelves). */
export const MARKETPLACE_CARD_GRID_COMPACT =
  "grid grid-cols-1 items-start gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

export type SkillMarketplaceCardModel = {
  id: string;
  displayName: string;
  packageName?: string;
  description: string;
  iconUrl?: string | null;
  chips?: string[];
};

function SkillMarketplaceCardIcon(props: { skill: SkillMarketplaceCardModel }) {
  if (props.skill.iconUrl) {
    return (
      <img src={props.skill.iconUrl} alt="" className="size-9 shrink-0 rounded-md object-cover" />
    );
  }
  return (
    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-dls-surface-muted text-sm font-semibold text-dls-secondary">
      {props.skill.displayName.trim().slice(0, 1).toUpperCase() || "S"}
    </span>
  );
}

function SkillMarketplaceCardChips(props: { chips: string[] }) {
  return (
    <div className="mt-auto flex min-h-5 min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden pt-3">
      {props.chips.slice(0, 3).map((chip) => (
        <StatusBadge
          key={chip}
          tone="surface"
          shape="soft"
          size="tiny"
          className="max-w-[5.5rem] shrink-0 truncate"
          title={chip}
        >
          {chip}
        </StatusBadge>
      ))}
    </div>
  );
}

export function SkillMarketplaceCard(props: {
  skill: SkillMarketplaceCardModel;
  action?: ReactNode;
  selected?: boolean;
  ariaLabel: string;
  className?: string;
  onClick?: () => void;
}) {
  const activateFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!props.onClick || event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onClick();
    }
  };

  return (
    <div
      role={props.onClick ? "button" : "group"}
      tabIndex={props.onClick ? 0 : undefined}
      className={cn(
        "group flex h-full min-h-36 flex-col rounded-2xl border bg-dls-surface px-4 py-3.5 text-left transition-[background-color,border-color,box-shadow]",
        props.selected ? "border-dls-accent bg-dls-accent/8" : "border-transparent",
        props.onClick &&
          "cursor-pointer hover:border-dls-border-strong hover:bg-dls-list-selected focus-visible:border-dls-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30 dark:hover:shadow-none",
        "mac:titlebar-no-drag",
        props.className,
      )}
      onClick={props.onClick}
      onKeyDown={activateFromKeyboard}
      aria-label={props.ariaLabel}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <SkillMarketplaceCardIcon skill={props.skill} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-5 text-dls-text">
                {props.skill.displayName}
              </div>
              {props.skill.packageName && props.skill.packageName !== props.skill.displayName ? (
                <div className="mt-0.5 truncate text-xs leading-5 text-dls-secondary">
                  {props.skill.packageName}
                </div>
              ) : null}
            </div>
            {props.action}
          </div>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-dls-secondary">
        {props.skill.description}
      </p>
      <SkillMarketplaceCardChips chips={props.skill.chips ?? []} />
    </div>
  );
}
