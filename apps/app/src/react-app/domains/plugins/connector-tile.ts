import { cn } from "@/lib/utils";

/** Shared tile chrome for built-in extensions + file-tool cards. */
export const connectorTileClassName = cn(
  "group flex h-full min-h-[8rem] flex-col rounded-2xl border border-dls-border/60 bg-dls-surface px-3.5 py-3 text-left transition-colors",
  "hover:border-dls-border hover:bg-dls-hover",
  "focus-within:border-dls-border focus-within:bg-dls-hover",
  "mac:titlebar-no-drag",
);
