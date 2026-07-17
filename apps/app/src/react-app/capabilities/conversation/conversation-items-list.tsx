/** @jsxImportSource react */
/**
 * Runtime-agnostic list of ConversationItemVM rows.
 * Hosts can use this for compact timelines (active runs, debug panels);
 * full OpenCode transcript remains in session message-list for rich UI.
 */
import { cn } from "@/lib/utils";
import type { ConversationItemVM } from "./item-types";
import { ConversationItemView } from "./ui/conversation-item-view";

export type ConversationItemsListProps = {
  items: ConversationItemVM[];
  className?: string;
  emptyLabel?: string;
  streaming?: boolean;
  onApprove?: (item: ConversationItemVM) => void;
  onReject?: (item: ConversationItemVM) => void;
};

export function ConversationItemsList(props: ConversationItemsListProps) {
  const { items, className, emptyLabel, streaming, onApprove, onReject } = props;
  if (items.length === 0) {
    if (!emptyLabel) return null;
    return (
      <div className={cn("text-sm text-dls-secondary", className)}>{emptyLabel}</div>
    );
  }

  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {items.map((item) => (
        <li key={item.id} className="min-w-0" data-kind={item.kind} data-role={item.role}>
          <ConversationItemView
            item={item}
            streaming={streaming}
            onApprove={onApprove}
            onReject={onReject}
          />
        </li>
      ))}
    </ul>
  );
}
