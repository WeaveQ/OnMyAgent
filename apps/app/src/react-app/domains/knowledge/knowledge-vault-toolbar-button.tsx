/** @jsxImportSource react */
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ToolbarIconButton(props: {
  label: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-dls-secondary hover:text-dls-text"
            disabled={props.disabled}
            onClick={props.onClick}
            aria-label={props.label}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-56">
        {props.hint}
      </TooltipContent>
    </Tooltip>
  );
}
