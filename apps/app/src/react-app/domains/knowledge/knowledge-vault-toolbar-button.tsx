/** @jsxImportSource react */
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ToolbarIconButton(props: {
  label: string;
  hint: string;
  disabled?: boolean;
  pressed?: boolean;
  busy?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={`text-dls-secondary hover:bg-dls-hover hover:text-dls-text mac:titlebar-no-drag${props.pressed ? " bg-dls-hover text-dls-text" : ""}`}
            disabled={props.disabled}
            aria-pressed={props.pressed}
            aria-busy={props.busy}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onClick();
            }}
            aria-label={props.label}
          >
            {props.children}
          </Button>
        }
      />
      <TooltipContent side="bottom" sideOffset={6} className="max-w-none whitespace-nowrap">
        {props.hint}
      </TooltipContent>
    </Tooltip>
  );
}
