/** @jsxImportSource react */
/**
 * Presentational approval card from ConversationItemVM.
 * Optional onApprove / onReject keep the component host-driven.
 */
import { Button } from "@/components/ui/button";
import { MonoLogBox } from "@/components/ui/mono-log-box";
import {
  ToolApprovalCard,
  ToolApprovalCardBody,
  ToolApprovalCardHeader,
} from "@/components/ui/tool-approval-card";
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
    <ToolApprovalCard
      risk={riskTier}
      className={cn(className)}
      data-kind="approval"
      data-risk-tier={riskTier}
      data-approval-id={item.approvalId ?? undefined}
      data-testid="conversation-approval-card"
    >
      <ToolApprovalCardHeader className="min-w-0 flex-col items-stretch gap-1 pb-0">
        <div className="min-w-0 break-words text-xs font-medium leading-5 text-dls-text">
          {title}
        </div>
      </ToolApprovalCardHeader>
      {detail ? (
        <ToolApprovalCardBody className="min-w-0 pt-2">
          <MonoLogBox
            wrap="preBreak"
            className="max-h-40 min-w-0 overflow-auto"
          >
            {detail}
          </MonoLogBox>
        </ToolApprovalCardBody>
      ) : null}
      {showActions ? (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-dls-border/70 px-4 py-3">
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
    </ToolApprovalCard>
  );
}
