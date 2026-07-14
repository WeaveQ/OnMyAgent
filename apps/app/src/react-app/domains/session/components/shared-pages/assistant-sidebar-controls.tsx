/** @jsxImportSource react */
import type { ComponentType } from "react";
import { BookOpen } from "lucide-react";

import { NavListButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { t } from "../../../../../i18n";
import type { AssistantCategoryId } from "../../surface/personal-assistant-config";

const assistantCategoryTabClass =
  "relative z-10 inline-flex h-8 min-w-24 items-center justify-center gap-2 rounded-lg px-4 text-xs transition-colors";

function AssistantCodeTabIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={props.className}
    >
      <path
        d="M6.67 13.33 9.33 2.67M12 5.33l1.32 1.18c.9.79.9 2.19 0 2.98L12 10.67M4 10.67 2.68 9.49c-.9-.79-.9-2.19 0-2.98L4 5.33"
        stroke="currentColor"
        strokeWidth="1.33"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
    {
      id: "code",
      label: t("assistant.category_code_short"),
      icon: AssistantCodeTabIcon,
    },
  ];

  return (
    <div className="relative mx-auto mb-6 grid w-fit grid-cols-2 items-center gap-1 mac:titlebar-no-drag">
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-24 rounded-lg bg-dls-list-selected transition-transform duration-200 ease-out",
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
                ? "font-semibold text-dls-text"
                : "font-normal text-dls-secondary hover:bg-dls-list-hover hover:text-dls-text",
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
      size="sidebar"
    >
      <Icon className="size-4 shrink-0 text-dls-secondary" />
      <span className="min-w-0 flex-1 truncate">{props.item.label}</span>
    </NavListButton>
  );
}
