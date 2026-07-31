/** @jsxImportSource react */
/**
 * Option-B left column for the primary-rail Automation workspace.
 * Not assistant sessions — browse filters + create entry points only.
 */
import { CalendarClock, History, LayoutTemplate, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "../../../i18n";

export type AutomationNavKey = "tasks" | "runs" | "templates";

export function AutomationNavSidebar(props: {
  width: number;
  active: AutomationNavKey;
  onChange: (key: AutomationNavKey) => void;
  onCreate: () => void;
  taskCount?: number;
  runCount?: number;
}) {
  const items: Array<{
    key: AutomationNavKey;
    label: string;
    icon: typeof CalendarClock;
    count?: number;
  }> = [
    {
      key: "tasks",
      label: t("automation.nav_all_tasks"),
      icon: CalendarClock,
      count: props.taskCount,
    },
    {
      key: "runs",
      label: t("automation.nav_runs"),
      icon: History,
      count: props.runCount,
    },
    {
      key: "templates",
      label: t("automation.nav_templates"),
      icon: LayoutTemplate,
    },
  ];

  return (
    <aside
      className="flex h-full min-h-0 shrink-0 flex-col border-r border-dls-border bg-dls-surface text-dls-text"
      style={{ width: props.width }}
    >
      <div className="flex shrink-0 flex-col px-3 pb-2 pt-3.5">
        <Button
          type="button"
          size="default"
          className="h-10 w-full justify-center gap-2 rounded-xl text-sm font-medium shadow-none"
          onClick={props.onCreate}
        >
          <Plus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
          {t("automation.add")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-dls-secondary">
          {t("automation.nav_section_browse")}
        </div>
        <nav className="flex flex-col gap-0.5" aria-label={t("nav.automation")}>
          {items.map((item) => {
            const Icon = item.icon;
            const active = props.active === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => props.onChange(item.key)}
                aria-pressed={active}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors",
                  active
                    ? "bg-dls-list-selected font-medium text-dls-text"
                    : "text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
                )}
              >
                <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {typeof item.count === "number" ? (
                  <span
                    className={cn(
                      "tabular-nums text-xs font-medium",
                      active ? "opacity-70" : "text-dls-secondary",
                    )}
                  >
                    {item.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
