/** @jsxImportSource react */
/**
 * Runtime-agnostic list of ConversationItemVM rows.
 * Hosts can use this for compact timelines (active runs, debug panels);
 * full OpenCode transcript remains in session message-list for rich UI.
 */
import { cn } from "@/lib/utils";
import type { ConversationItemVM } from "./item-types";

export type ConversationItemsListProps = {
  items: ConversationItemVM[];
  className?: string;
  emptyLabel?: string;
};

export function ConversationItemsList(props: ConversationItemsListProps) {
  const { items, className, emptyLabel } = props;
  if (items.length === 0) {
    if (!emptyLabel) return null;
    return (
      <div className={cn("text-sm text-dls-secondary", className)}>{emptyLabel}</div>
    );
  }

  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "rounded-md px-2 py-1.5 text-sm",
            item.role === "user" && "bg-dls-list-hover/40 text-dls-text",
            item.role === "assistant" && "bg-dls-surface text-dls-text",
            item.role === "system" && "text-dls-secondary",
            item.role === "tool" && "font-mono text-xs text-dls-secondary",
          )}
          data-kind={item.kind}
          data-role={item.role}
        >
          {item.text}
        </li>
      ))}
    </ul>
  );
}
