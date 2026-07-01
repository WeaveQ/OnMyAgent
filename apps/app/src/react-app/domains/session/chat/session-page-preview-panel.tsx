import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SessionPreviewPanel(props: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section";
  size?: "default" | "comfortable" | "none";
}) {
  const className = cn(
    "rounded-xl border border-dls-border bg-dls-surface",
    props.size === "comfortable" && "p-5",
    props.size !== "comfortable" && props.size !== "none" && "p-4",
    props.className,
  );

  if (props.as === "section") {
    return <section className={className}>{props.children}</section>;
  }

  return <div className={className}>{props.children}</div>;
}
