/** @jsxImportSource react */
/**
 * Presentational plan list from ConversationItemVM.
 * Prefers meta.entries when present; falls back to item.text.
 */
import { CheckCircle2, Clock3 } from "lucide-react";

import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { ConversationItemVM } from "../item-types";

export type PlanBlockProps = {
  item: ConversationItemVM;
  className?: string;
  streaming?: boolean;
};

type PlanEntryLike = {
  id?: string;
  title?: string;
  content?: string;
  status?: string;
  priority?: string;
};

function asPlanEntries(value: unknown): PlanEntryLike[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry === "object") as PlanEntryLike[];
}

export function PlanBlock(props: PlanBlockProps) {
  const { item, className, streaming = false } = props;
  const entries = asPlanEntries(item.meta?.entries);
  const lines =
    entries.length > 0
      ? entries.map((entry, index) => ({
          id: entry.id ?? `plan-${index}`,
          label: (entry.title || entry.content || item.text || "Plan step").trim() || "Plan step",
          status: entry.status ?? null,
          priority: entry.priority ?? null,
        }))
      : item.text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((label, index) => ({
            id: `plan-line-${index}`,
            label,
            status: null as string | null,
            priority: null as string | null,
          }));

  if (lines.length === 0) {
    return (
      <div
        className={cn("text-sm text-dls-secondary", className)}
        data-kind="plan"
        data-testid="conversation-plan-block"
      >
        {item.text || "Plan"}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "min-w-0 rounded-md border border-dls-border/70 bg-dls-surface-muted/50",
        className,
      )}
      data-kind="plan"
      data-testid="conversation-plan-block"
      data-legacy-testid="local-agent-plan-card"
    >
      <div
        className="flex items-center gap-2 border-b border-dls-border/50 px-3 py-1.5 text-sm"
        data-testid="conversation-plan-header"
        data-legacy-testid="local-agent-plan-header"
      >
        <span className="min-w-0 flex-1 truncate font-medium text-dls-text">Plan</span>
        <span
          className="shrink-0 text-xs text-dls-text-tertiary"
          data-testid="conversation-plan-count"
          data-legacy-testid="local-agent-plan-count"
        >
          {lines.filter((line) => /complete|done/i.test(line.status ?? "")).length}/{lines.length}
        </span>
      </div>
      <ul
        className="space-y-1.5 px-3 py-2 text-sm leading-5"
        data-testid="conversation-plan-body"
        data-legacy-testid="local-agent-plan-body"
      >
        {lines.map((line) => {
          const completed = /complete|done/i.test(line.status ?? "");
          const running =
            streaming && /in_progress|running|progress/i.test(line.status ?? "");
          return (
            <li key={line.id} className="flex min-w-0 items-center gap-2">
              {completed ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-dls-status-success-fg" />
              ) : running ? (
                <LoadingSpinner size="sm" className="shrink-0 text-dls-accent" />
              ) : (
                <Clock3 className="size-3.5 shrink-0 text-dls-text-tertiary" />
              )}
              <span className="min-w-0 flex-1 truncate text-dls-text">{line.label}</span>
              {line.priority ? (
                <StatusBadge tone="neutral" size="tiny">
                  {line.priority}
                </StatusBadge>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
