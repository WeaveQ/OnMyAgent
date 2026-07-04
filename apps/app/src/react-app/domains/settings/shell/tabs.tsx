/** @jsxImportSource react */
import type * as React from "react";

import { NavListButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";

type TabsSidebarProps = {
  children: React.ReactNode;
};

export function TabsSidebar(props: TabsSidebarProps) {
  return (
    <aside className={cn("space-y-6 md:sticky md:top-4 md:self-start")}>{props.children}</aside>
  );
}

type TabsGroupProps = {
  children: React.ReactNode;
};

export function TabsGroup(props: TabsGroupProps) {
  return (
    <div className={cn("rounded-xl border border-dls-border bg-dls-sidebar p-3")}>
      {props.children}
    </div>
  );
}

type TabsGroupTitleProps = {
  children: React.ReactNode;
};

export function TabsGroupTitle(props: TabsGroupTitleProps) {
  return (
    <div className={cn("mb-2 px-2 text-xs font-medium text-dls-secondary")}>
      {props.children}
    </div>
  );
}

type TabsListProps = {
  children: React.ReactNode;
};

export function TabsList(props: TabsListProps) {
  return <div className={cn("space-y-1")}>{props.children}</div>;
}

type TabsTriggerProps = {
  active: boolean;
  onSelect: () => void;
  children: React.ReactNode;
};

export function TabsTrigger(props: TabsTriggerProps) {
  return (
    <NavListButton
      type="button"
      active={props.active}
      className={cn(
        "justify-between rounded-xl px-3 py-2.5",
        props.active
          ? "bg-dls-surface text-dls-text hover:bg-dls-surface hover:text-dls-text"
          : "text-dls-secondary hover:bg-dls-surface hover:text-dls-text",
      )}
      onClick={props.onSelect}
    >
      <span>{props.children}</span>
    </NavListButton>
  );
}
