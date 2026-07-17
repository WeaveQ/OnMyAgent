/** @jsxImportSource react */
/**
 * Collapsible thinking / reasoning block from ConversationItemVM.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, ChevronRight } from "lucide-react";

import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils";
import type { ConversationItemVM } from "../item-types";

export type ThinkingBlockProps = {
  item: ConversationItemVM;
  className?: string;
  /** Override default expanded state (defaults: expanded while running). */
  defaultExpanded?: boolean;
};

function isThinkingDone(item: ConversationItemVM): boolean {
  const status = `${item.thinkingStatus ?? item.status ?? ""}`.toLowerCase();
  return status === "done" || status === "completed" || status === "complete";
}

export function ThinkingBlock(props: ThinkingBlockProps) {
  const { item, className } = props;
  const done = isThinkingDone(item);
  const [expanded, setExpanded] = useState(
    props.defaultExpanded ?? !done,
  );

  useEffect(() => {
    if (props.defaultExpanded !== undefined) return;
    if (done) setExpanded(false);
  }, [done, props.defaultExpanded]);

  const bodyText = item.text?.trim() || "Thinking...";
  const durationMs =
    typeof item.meta?.durationMs === "number" ? item.meta.durationMs : null;
  const durationSec =
    durationMs != null && durationMs > 0
      ? Math.max(1, Math.round(durationMs / 1000))
      : null;
  const summary = done
    ? durationSec
      ? `Thought for ${durationSec}s`
      : "Thinking complete"
    : durationSec
      ? `Thinking... ${durationSec}s`
      : "Thinking...";

  return (
    <div
      className={cn(
        "min-w-0 rounded-md border border-dls-border/70 bg-dls-surface-muted/50",
        className,
      )}
      data-kind="thinking"
      data-thinking-status={done ? "done" : "running"}
      data-testid="conversation-thinking-block"
      data-legacy-testid="local-agent-thinking-card"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm leading-5 text-dls-secondary transition-colors hover:bg-dls-hover/40"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        data-status={done ? "done" : "running"}
        data-testid="conversation-thinking-header"
        data-legacy-testid="local-agent-thinking-header"
      >
        {done ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-dls-status-success-fg" />
        ) : (
          <LoadingSpinner size="sm" className="shrink-0 text-dls-accent" />
        )}
        <span
          className="min-w-0 flex-1 truncate"
          data-testid="conversation-thinking-status"
          data-legacy-testid="local-agent-thinking-status"
        >
          {summary}
        </span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-dls-text-tertiary transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>
      {expanded ? (
        <div
          className="border-t border-dls-border/50 px-3 py-2"
          data-testid="conversation-thinking-body"
          data-legacy-testid="local-agent-thinking-body"
        >
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-dls-secondary">
            {bodyText}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
