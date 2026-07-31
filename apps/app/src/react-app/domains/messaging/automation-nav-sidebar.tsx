/** @jsxImportSource react */
/**
 * Option-B left column for the primary-rail Automation workspace.
 * Browse filters + create, plus the same scheduled-task run groups as home.
 */
import { useEffect, useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  History,
  LayoutTemplate,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "../../../i18n";

/** Match home task-row trailing time (today clock / N days ago). */
function relativeTimeLabel(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const ms = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDelta = Math.round(
    (today.getTime() - targetDay.getTime()) / 86_400_000,
  );
  if (dayDelta === 0) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  if (dayDelta > 0) return t("time.days_ago", { count: dayDelta });
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export type AutomationNavKey = "tasks" | "runs" | "templates";

export type AutomationNavSessionRow = {
  id: string;
  title: string;
  updatedAt: number | null;
};

export type AutomationNavGroupRow = {
  id: string;
  title: string;
  sessions: AutomationNavSessionRow[];
};

export function AutomationNavSidebar(props: {
  width: number;
  active: AutomationNavKey;
  onChange: (key: AutomationNavKey) => void;
  onCreate: () => void;
  taskCount?: number;
  runCount?: number;
  /** Same scheduled-run groups as the home 定时 list. */
  groups?: AutomationNavGroupRow[];
  selectedSessionId?: string | null;
  workspaceId?: string;
  onOpenSession?: (workspaceId: string, sessionId: string) => void;
}) {
  const groups = props.groups ?? [];
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  // Expand first groups once they load (home 定时 list is usually open).
  useEffect(() => {
    if (groups.length === 0) return;
    setExpandedIds((current) => {
      if (current.length > 0) {
        // Drop ids that disappeared; keep user toggles for still-present groups.
        const next = current.filter((id) => groups.some((group) => group.id === id));
        return next.length > 0 ? next : groups.slice(0, 3).map((group) => group.id);
      }
      return groups.slice(0, 3).map((group) => group.id);
    });
  }, [groups]);

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

  const toggleExpanded = (groupId: string) => {
    setExpandedIds((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
  };

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

        {groups.length > 0 ? (
          <div className="mt-4">
            <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-dls-secondary">
              {t("automation.tab_tasks")}
            </div>
            <div className="flex flex-col gap-0.5">
              {groups.map((group) => {
                const expanded = expandedIds.includes(group.id);
                const groupLabel = t("automation.session_group_title", {
                  title: group.title,
                });
                const Chevron = expanded ? ChevronDown : ChevronRight;
                return (
                  <div key={group.id} className="flex min-w-0 flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(group.id)}
                      className="group flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-left text-sm text-dls-text transition-colors hover:bg-dls-hover"
                      aria-expanded={expanded}
                    >
                      <Chevron
                        className="size-3.5 shrink-0 text-dls-secondary"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <CalendarClock
                        className="size-3.5 shrink-0 text-dls-text/55"
                        strokeWidth={1.6}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {groupLabel}
                      </span>
                      <span className="tabular-nums text-[11px] text-dls-secondary">
                        {group.sessions.length}
                      </span>
                    </button>
                    {expanded
                      ? group.sessions.map((session) => {
                          const selected =
                            props.selectedSessionId === session.id;
                          return (
                            <button
                              key={session.id}
                              type="button"
                              onClick={() => {
                                if (!props.workspaceId || !props.onOpenSession) {
                                  return;
                                }
                                props.onOpenSession(
                                  props.workspaceId,
                                  session.id,
                                );
                              }}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-xl py-1.5 pl-8 pr-2.5 text-left text-sm transition-colors",
                                selected
                                  ? "bg-dls-list-selected font-medium text-dls-text"
                                  : "text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
                              )}
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {session.title}
                              </span>
                              <span className="shrink-0 tabular-nums text-[11px] text-dls-secondary">
                                {relativeTimeLabel(session.updatedAt)}
                              </span>
                            </button>
                          );
                        })
                      : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
