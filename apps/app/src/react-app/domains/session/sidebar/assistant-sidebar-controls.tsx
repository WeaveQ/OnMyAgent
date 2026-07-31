/** @jsxImportSource react */
import type { ComponentType } from "react";

import { NavListButton } from "@/components/ui/action-row";

export type AssistantMenuItem = {
  id: "automation";
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
};

export function AssistantMenuRow(props: {
  item: AssistantMenuItem;
  active?: boolean;
  onClick?: () => void;
}) {
  const Icon = props.item.icon;
  return (
    <NavListButton
      type="button"
      onClick={props.onClick}
      active={props.active}
      size="sidebar"
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
      {props.item.label}
    </NavListButton>
  );
}
