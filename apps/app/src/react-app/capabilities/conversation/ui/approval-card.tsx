/** @jsxImportSource react */
/**
 * Presentational approval card from ConversationItemVM.
 * Optional onApprove / onReject keep the component host-driven.
 */
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConversationItemVM } from "../item-types";

export type ApprovalCardProps = {
  item: ConversationItemVM;
  className?: string;
  onApprove?: (item: ConversationItemVM) => void;
  onReject?: (item: ConversationItemVM) => void;
  approveLabel?: string;
  rejectLabel?: string;
};

/** DESIGN.md §4f tool-approval riskTier (left-border anatomy). */
function resolveRiskTier(item: ConversationItemVM): "safe" | "careful" | "destructive" {
  const raw = item.meta?.riskTier ?? item.meta?.tier ?? item.meta?.risk;
  if (raw === "safe" || raw === "careful" || raw === "destructive") return raw;
  if (raw === "danger" || raw === "high") return "destructive";
  if (raw === "low") return "safe";
  return "careful";
}

const riskTierBorderClass: Record<"safe" | "careful" | "destructive", string> = {
  safe: "border-l-0",
  careful: "border-l-[2px] border-l-dls-warning",
  destructive: "border-l-[4px] border-l-dls-danger",
};

export function ApprovalCard(props: ApprovalCardProps) {
  const {
    item,
    className,
    onApprove,
    onReject,
    approveLabel = "Allow",
    rejectLabel = "Decline",
  } = props;
  const showActions = Boolean(onApprove || onReject);
  const riskTier = resolveRiskTier(item);
  const title =
    (typeof item.meta?.title === "string" && item.meta.title.trim())
    || item.text?.trim()
    || "Approval required";
  const detail =
    typeof item.meta?.summary === "string"
      ? item.meta.summary
      : typeof item.meta?.command === "string"
        ? item.meta.command
        : item.text !== title
          ? item.text
          : null;

  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border border-dls-border bg-dls-surface text-dls-text",
        riskTierBorderClass[riskTier],
        className,
      )}
      data-kind="approval"
      data-risk-tier={riskTier}
      data-approval-id={item.approvalId ?? undefined}
      data-testid="conversation-approval-card"
    >
      <div className="space-y-2 px-4 py-3">
        <div className="text-xs font-medium text-dls-text">{title}</div>
        {detail ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-dls-secondary">
            {detail}
          </pre>
        ) : null}
        {item.approvalId ? (
          <div className="font-mono text-2xs text-dls-text-tertiary">
            id: {item.approvalId}
          </div>
        ) : null}
      </div>
      {showActions ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-dls-border px-4 py-3">
          {onReject ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onReject(item)}
              data-testid="conversation-approval-reject"
            >
              {rejectLabel}
            </Button>
          ) : null}
          {onApprove ? (
            <Button
              type="button"
              size="sm"
              onClick={() => onApprove(item)}
              data-testid="conversation-approval-approve"
            >
              {approveLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
