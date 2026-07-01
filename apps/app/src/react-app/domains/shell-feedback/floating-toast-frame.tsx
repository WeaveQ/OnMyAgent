/** @jsxImportSource react */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type FloatingToastFrameProps = {
  children: ReactNode;
  className?: string;
};

const floatingToastFrameClass = {
  viewport: "fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 animate-in slide-in-from-bottom-4 fade-in duration-300",
  surface: "flex max-w-[calc(100vw-1.5rem)] items-center gap-4 rounded-2xl border border-dls-border bg-dls-surface px-5 py-3.5",
};

export function FloatingToastFrame(props: FloatingToastFrameProps) {
  return (
    <div className={floatingToastFrameClass.viewport}>
      <div className={cn(floatingToastFrameClass.surface, props.className)}>
        {props.children}
      </div>
    </div>
  );
}
