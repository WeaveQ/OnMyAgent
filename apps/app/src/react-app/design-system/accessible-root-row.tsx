/** @jsxImportSource react */
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

// Shared workspace-root row used by weixin/feishu channel panels. Was
// duplicated inline in both panels with identical Tailwind classes; the
// primitive keeps the row shape aligned so future channels reuse it.
export function AccessibleRootRow(props: {
  root: string;
  onRemove: (root: string) => void;
  disabled?: boolean;
  removeLabel: string;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-dls-border bg-dls-surface-muted px-2 py-1.5">
      <span className="min-w-0 truncate font-mono text-xs text-dls-text">{props.root}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => props.onRemove(props.root)}
        disabled={props.disabled}
        aria-label={props.removeLabel}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
