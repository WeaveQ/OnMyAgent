/** @jsxImportSource react */
/**
 * Switch on ConversationItemVM.kind to shared presentational blocks.
 */
import { cn } from "@/lib/utils";
import type { ConversationItemVM } from "../item-types";
import { ApprovalCard } from "./approval-card";
import { PlanBlock } from "./plan-block";
import { ThinkingBlock } from "./thinking-block";
import { ToolItemRow } from "./tool-item-row";

export type ConversationItemViewProps = {
  item: ConversationItemVM;
  className?: string;
  streaming?: boolean;
  onApprove?: (item: ConversationItemVM) => void;
  onReject?: (item: ConversationItemVM) => void;
};

export function ConversationItemView(props: ConversationItemViewProps) {
  const { item, className, streaming, onApprove, onReject } = props;

  switch (item.kind) {
    case "tool":
      return <ToolItemRow item={item} className={className} />;
    case "thinking":
      return <ThinkingBlock item={item} className={className} />;
    case "plan":
      return <PlanBlock item={item} className={className} streaming={streaming} />;
    case "approval":
      return (
        <ApprovalCard
          item={item}
          className={className}
          onApprove={onApprove}
          onReject={onReject}
        />
      );
    case "error":
      return (
        <div
          className={cn(
            "rounded-md border border-dls-status-danger/30 bg-dls-status-danger-soft px-3 py-2 text-xs leading-5 text-dls-status-danger-fg",
            className,
          )}
          data-kind="error"
          data-testid="conversation-error-item"
        >
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans">
            {item.text}
          </pre>
        </div>
      );
    case "tips":
    case "system":
      return (
        <div
          className={cn("text-xs leading-5 text-dls-secondary", className)}
          data-kind={item.kind}
          data-role={item.role}
        >
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans">
            {item.text}
          </pre>
        </div>
      );
    case "user_text":
    case "assistant_text":
    default:
      return (
        <div
          className={cn(
            "rounded-md px-2 py-1.5 text-sm text-dls-text",
            item.role === "user" && "bg-dls-list-hover/40",
            item.role === "assistant" && "bg-dls-surface",
            className,
          )}
          data-kind={item.kind}
          data-role={item.role}
        >
          {item.text}
        </div>
      );
  }
}
