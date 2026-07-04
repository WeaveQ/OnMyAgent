import type React from "react";

import { cn } from "@/lib/utils";

export function SelectionMark(props: {
  checked?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md border text-xs",
        props.checked
          ? "border-dls-accent/30 bg-dls-accent text-white"
          : "border-dls-border bg-dls-hover text-transparent",
        props.className,
      )}
    >
      {props.children}
    </span>
  );
}
