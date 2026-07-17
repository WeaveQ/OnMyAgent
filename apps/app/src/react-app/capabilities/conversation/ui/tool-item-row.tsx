/** @jsxImportSource react */
/**
 * Presentational tool / ACP tool row from ConversationItemVM.
 * Hosts can pass richer detail via meta; this row stays compact.
 */
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { ConversationItemVM } from "../item-types";

export type ToolItemRowProps = {
  item: ConversationItemVM;
  className?: string;
};

function toolBadgeTone(status: string | null | undefined): "accent" | "success" | "danger" | "neutral" {
  const raw = `${status ?? ""}`.toLowerCase();
  if (/fail|error|cancel/.test(raw)) return "danger";
  if (/complete|done|success|ok|output-available|result/.test(raw)) return "success";
  if (/run|progress|execut|pending|queued|partial|call/.test(raw)) return "accent";
  return "neutral";
}

export function ToolItemRow(props: ToolItemRowProps) {
  const { item, className } = props;
  const name = (item.toolName ?? item.text ?? "tool").trim() || "tool";
  const status = item.toolStatus ?? item.status ?? null;
  const description =
    typeof item.meta?.description === "string"
      ? item.meta.description
      : item.text && item.text !== name
        ? item.text
        : null;

  return (
    <div
      className={cn(
        "flex min-w-0 items-start justify-between gap-3 rounded-xl border border-dls-border bg-dls-surface-muted px-3 py-2.5",
        className,
      )}
      data-kind="tool"
      data-tool-status={status ?? undefined}
      data-testid="conversation-tool-item-row"
    >
      <div className="min-w-0 space-y-1 font-mono text-xs">
        <div className="truncate font-medium text-dls-text">{name}</div>
        {description ? (
          <div className="truncate text-dls-secondary">{description}</div>
        ) : null}
      </div>
      {status ? (
        <StatusBadge tone={toolBadgeTone(status)} size="tiny">
          {status}
        </StatusBadge>
      ) : null}
    </div>
  );
}
