/** @jsxImportSource react */
import type { ComponentType } from "react";
import { BookOpen } from "lucide-react";

import {
  NavListButton,
  NavTabButton,
  SegmentedTabGroup,
} from "@/components/ui/action-row";
import { t } from "../../../../i18n";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";

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
    <div className="mb-2.5 flex w-full justify-center mac:titlebar-no-drag">
      {/*
        Same free-float pill as store 「专家」: density bare + shape tab (rounded-lg),
        inverted active fill — no track, so L/R radius stays uniform.
      */}
      <SegmentedTabGroup
        density="bare"
        role="tablist"
        className="h-8 w-full max-w-none"
      >
        {items.map((item) => {
          const Icon = item.icon;
          const active = props.value === item.id;
          return (
            <NavTabButton
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => props.onChange(item.id)}
              active={active}
              size="tab"
              shape="tab"
              className="relative z-10 h-8 min-h-8 min-w-0 flex-1 justify-center gap-1.5 px-3 text-sm"
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="leading-none">{item.label}</span>
            </NavTabButton>
          );
        })}
      </SegmentedTabGroup>
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
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{props.item.label}</span>
    </NavListButton>
  );
}
