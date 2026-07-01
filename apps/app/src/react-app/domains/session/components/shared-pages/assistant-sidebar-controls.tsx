/** @jsxImportSource react */
import type { ComponentType } from "react";
import { BookOpen, Code2 } from "lucide-react";

import { NavListButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { t } from "../../../../../i18n";
import type { AssistantCategoryId } from "../../surface/personal-assistant-config";

const assistantCategoryTabClass =
  "relative z-10 inline-flex h-8 min-w-24 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors";

export type AssistantMenuItem = {
  id: "automation";
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export function AssistantCategorySwitch(props: {
  value: AssistantCategoryId;
  onChange: (value: AssistantCategoryId) => void;
}) {
  const items: Array<{
    id: AssistantCategoryId;
    label: string;
    icon: ComponentType<{ className?: string }>;
  }> = [
    { id: "office", label: t("assistant.category_work_short"), icon: BookOpen },
    { id: "code", label: t("assistant.category_code_short"), icon: Code2 },
  ];

  return (
    <div className="relative mx-auto mb-6 grid w-fit grid-cols-2 items-center gap-1 mac:titlebar-no-drag">
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-24 rounded-lg bg-dls-accent/10 transition-transform duration-200 ease-out",
          props.value === "code" ? "translate-x-[calc(100%+0.25rem)]" : "translate-x-0",
        )}
        aria-hidden
      />
      {items.map((item) => {
        const Icon = item.icon;
        const active = props.value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => props.onChange(item.id)}
            className={cn(
              assistantCategoryTabClass,
              "mac:titlebar-no-drag",
              active
                ? "text-dls-accent"
                : "text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
            )}
            aria-pressed={active}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

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
      className="text-sm"
    >
      <Icon className="size-4 shrink-0 text-dls-secondary" />
      <span className="min-w-0 flex-1 truncate">{props.item.label}</span>
    </NavListButton>
  );
}
