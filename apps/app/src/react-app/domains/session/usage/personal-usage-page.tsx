/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { LockKeyhole, Pencil, RefreshCw, Share2 } from "lucide-react";

import type { WorkspaceInfo } from "@/app/lib/desktop";
import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyStateBox, NoticeBox } from "@/components/ui/notice-box";
import { cn } from "@/lib/utils";
import { currentLocale, t } from "@/i18n";
import {
  buildTokenActivitySeries,
  formatPersonalTokenCount,
  formatTaskDuration,
  type PersonalUsageClient,
  type TokenActivityMode,
} from "./personal-usage-model";
import { usePersonalUsage } from "./use-personal-usage";

type PersonalUsagePageProps = {
  client: PersonalUsageClient | null;
  workspaces: WorkspaceInfo[];
  identity: {
    name: string;
    email?: string | null;
  };
  onEdit?: () => void;
};

const activityLevelClass: Record<number, string> = {
  0: "bg-dls-surface-muted",
  1: "bg-dls-accent/15",
  2: "bg-dls-accent/30",
  3: "bg-dls-accent/55",
  4: "bg-dls-accent",
};

function usageActivityModeLabel(mode: TokenActivityMode): string {
  switch (mode) {
    case "daily":
      return t("session.usage_daily");
    case "weekly":
      return t("session.usage_weekly");
    case "cumulative":
      return t("session.usage_cumulative");
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((part) => part.slice(0, 1).toUpperCase()).join("");
}

function formatDuration(minutes: number) {
  const duration = formatTaskDuration(minutes);
  if (duration.hours === 0) {
    return t("session.usage_duration_minutes", { minutes: duration.minutes });
  }
  return t("session.usage_duration_hours_minutes", duration);
}

function formatDays(count: number) {
  return count === 1
    ? t("session.usage_day", { count })
    : t("session.usage_days", { count });
}

function Metric(props: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 px-2 py-2.5 text-center">
      <div className="truncate text-base font-medium tabular-nums text-dls-text">{props.value}</div>
      <div className="mt-0.5 truncate text-sm text-dls-secondary">{props.label}</div>
    </div>
  );
}

function monthLabels(today: string) {
  const locale = currentLocale();
  const formatter = new Intl.DateTimeFormat(locale, { month: "short" });
  const end = new Date(`${today}T00:00:00Z`);
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11 + index, 1));
    return formatter.format(date);
  });
}

export function PersonalUsagePage(props: PersonalUsagePageProps) {
  const [activityMode, setActivityMode] = useState<TokenActivityMode>("daily");
  const today = new Date().toISOString().slice(0, 10);
  const usage = usePersonalUsage({
    client: props.client,
    workspaces: props.workspaces,
    scopeId: "all",
  });
  const activity = useMemo(
    () => buildTokenActivitySeries(usage.summary.daily, activityMode, today),
    [activityMode, today, usage.summary.daily],
  );
  const months = useMemo(() => monthLabels(today), [today]);
  const failureNames = usage.failures.map((failure) => failure.workspaceName).join(", ");
  const metrics = [
    {
      label: t("session.usage_total_tokens"),
      value: formatPersonalTokenCount(usage.summary.totalTokens),
    },
    {
      label: t("session.usage_peak_tokens"),
      value: formatPersonalTokenCount(usage.summary.peakSessionTokens),
    },
    {
      label: t("session.usage_longest_task"),
      value: formatDuration(usage.summary.longestSessionMinutes),
    },
    {
      label: t("session.usage_current_streak"),
      value: formatDays(usage.summary.currentStreakDays),
    },
    {
      label: t("session.usage_longest_streak"),
      value: formatDays(usage.summary.longestStreakDays),
    },
  ];

  return (
    <main data-personal-usage-page="true" className="h-full min-h-0 overflow-y-auto bg-dls-surface">
      <header className="flex h-14 items-center justify-between px-5">
        <h1 className="text-base font-medium text-dls-text">{t("session.usage_profile_title")}</h1>
        <div className="mac:titlebar-no-drag flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-base"
            onClick={() => {
              if (props.identity.email) void navigator.clipboard.writeText(props.identity.email);
            }}
          >
            <Share2 data-icon="inline-start" />
            {t("session.usage_share")}
          </Button>
          <span className="flex h-8 items-center gap-1.5 px-2 text-base text-dls-secondary">
            <LockKeyhole className="size-4" aria-hidden="true" />
            {t("session.usage_private")}
          </span>
          <Button type="button" variant="ghost" size="sm" className="text-base" onClick={props.onEdit}>
            <Pencil data-icon="inline-start" />
            {t("session.usage_edit")}
          </Button>
        </div>
      </header>

      <div data-usage-profile="true" className="mx-auto w-full max-w-4xl px-4 pb-12 pt-12 sm:px-10 sm:pt-18">
        <section className="text-center" aria-label={props.identity.name}>
          <div className="mx-auto flex size-22 items-center justify-center rounded-full bg-dls-decision text-3xl font-normal text-white" aria-hidden="true">
            {initials(props.identity.name)}
          </div>
          <h2 className="mt-5 truncate text-2xl font-medium tracking-tight text-dls-text">{props.identity.name}</h2>
          <div className="mt-2 flex min-w-0 items-center justify-center gap-2 text-base text-dls-secondary">
            {props.identity.email ? <span className="max-w-80 truncate">{props.identity.email}</span> : null}
            {props.identity.email ? <span aria-hidden="true">·</span> : null}
            <span className="rounded-lg border border-dls-border px-2 py-0.5 text-sm">{t("session.usage_profile_plan")}</span>
          </div>
        </section>

        {usage.isLoading ? (
          <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-dls-secondary" role="status">
            <LoadingSpinner size="default" />
            <span>{t("session.usage_loading")}</span>
          </div>
        ) : usage.isError || usage.allWorkspacesFailed ? (
          <NoticeBox tone="error" size="comfortable" className="flex items-center justify-between gap-4">
            <span>{t("session.usage_load_failed")}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => usage.refetch()}>
              <RefreshCw data-icon="inline-start" />
              {t("session.usage_refresh")}
            </Button>
          </NoticeBox>
        ) : (
          <>
            {usage.failures.length > 0 ? (
              <NoticeBox tone="warning" size="content" className="mt-8">
                {t("session.usage_partial_failure", { workspaces: failureNames })}
              </NoticeBox>
            ) : null}

            <div className="mt-12 overflow-x-auto pb-1">
              <section aria-label={t("session.usage_summary_label")} className="grid min-w-3xl grid-cols-5 overflow-hidden rounded-xl border border-dls-border bg-dls-surface [&>*:not(:last-child)]:border-r [&>*:not(:last-child)]:border-dls-border">
                {metrics.map((metric) => <Metric key={metric.label} {...metric} />)}
              </section>
            </div>

            <section data-token-activity="true" className="mt-10">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-dls-text">{t("session.usage_activity")}</h2>
                <SegmentedTabGroup className="border-0 bg-transparent p-0" role="tablist" aria-label={t("session.usage_activity_mode_label")}>
                  {(["daily", "weekly", "cumulative"] as const).map((mode) => (
                    <NavTabButton
                      key={mode}
                      type="button"
                      role="tab"
                      size="tab"
                      shape="tab"
                      active={activityMode === mode}
                      aria-selected={activityMode === mode}
                      className="px-2 py-0 text-base font-normal hover:bg-transparent"
                      onClick={() => setActivityMode(mode)}
                    >
                      {usageActivityModeLabel(mode)}
                    </NavTabButton>
                  ))}
                </SegmentedTabGroup>
              </div>

              {usage.summary.totalTokens === 0 ? (
                <EmptyStateBox size="comfortable" className="mt-4">{t("session.usage_empty")}</EmptyStateBox>
              ) : (
                <div className="mt-3 overflow-x-auto pb-2">
                  <div className="min-w-3xl">
                    <div
                      className={cn(
                        "grid w-full justify-between gap-y-1",
                        activityMode === "weekly" ? "grid-flow-col grid-rows-1" : "grid-flow-col grid-rows-7",
                      )}
                      role="grid"
                      aria-label={t("session.usage_activity_grid_label")}
                    >
                      {activity.map((point) => (
                        <div
                          key={point.date}
                          role="gridcell"
                          className={cn("size-3 rounded-xs", activityLevelClass[point.level])}
                          aria-label={t("session.usage_cell_label", {
                            date: point.date,
                            tokens: formatPersonalTokenCount(point.value),
                          })}
                          title={t("session.usage_cell_label", {
                            date: point.date,
                            tokens: formatPersonalTokenCount(point.value),
                          })}
                        />
                      ))}
                    </div>
                    <div className="mt-2 grid grid-cols-12 text-sm text-dls-secondary" aria-hidden="true">
                      {months.map((month, index) => <span key={`${month}-${index}`}>{month}</span>)}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
