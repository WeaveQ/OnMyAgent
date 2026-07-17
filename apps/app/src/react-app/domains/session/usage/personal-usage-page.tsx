/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import type { WorkspaceInfo } from "@/app/lib/desktop";
import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyStateBox, NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
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
  /** @deprecated Header edit action removed; kept for call-site compatibility. */
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
  return parts
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
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

function Metric(props: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-3 text-center">
      <div className="truncate text-base font-medium tabular-nums text-dls-text">
        {props.value}
      </div>
      <div className="mt-1 truncate text-xs text-dls-secondary">{props.label}</div>
    </div>
  );
}

function monthLabels(today: string) {
  const locale = currentLocale();
  const formatter = new Intl.DateTimeFormat(locale, { month: "short" });
  const end = new Date(`${today}T00:00:00Z`);
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11 + index, 1),
    );
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
  const failureNames = usage.failures
    .map((failure) => failure.workspaceName)
    .join(", ");
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
    <main
      data-personal-usage-page="true"
      className="h-full min-h-0 overflow-y-auto bg-dls-background"
    >
      <header className="flex h-14 items-center px-5">
        <h1 className="text-base font-medium text-dls-text">
          {t("session.usage_profile_title")}
        </h1>
      </header>

      <div
        data-usage-profile="true"
        className="mx-auto w-full max-w-4xl px-4 pb-12 pt-10 sm:px-10 sm:pt-14"
      >
        <section className="text-center" aria-label={props.identity.name}>
          <div
            className="mx-auto flex size-20 items-center justify-center rounded-full bg-dls-decision text-2xl font-medium text-white"
            aria-hidden="true"
          >
            {initials(props.identity.name)}
          </div>
          <h2 className="mt-4 truncate text-lg font-medium leading-7 tracking-tight text-dls-text">
            {props.identity.name}
          </h2>
          <div className="mt-2 flex min-w-0 flex-wrap items-center justify-center gap-2 text-sm text-dls-secondary">
            {props.identity.email ? (
              <span className="max-w-80 truncate">{props.identity.email}</span>
            ) : null}
            <StatusBadge tone="neutral" shape="soft" size="sm">
              {t("session.usage_profile_plan")}
            </StatusBadge>
          </div>
        </section>

        {usage.isLoading ? (
          <div
            className="flex min-h-64 items-center justify-center gap-2 text-sm text-dls-secondary"
            role="status"
          >
            <LoadingSpinner size="default" />
            <span>{t("session.usage_loading")}</span>
          </div>
        ) : usage.isError || usage.allWorkspacesFailed ? (
          <NoticeBox
            tone="error"
            size="comfortable"
            className="mt-10 flex items-center justify-between gap-4"
          >
            <span>{t("session.usage_load_failed")}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => usage.refetch()}
            >
              <RefreshCw data-icon="inline-start" />
              {t("session.usage_refresh")}
            </Button>
          </NoticeBox>
        ) : (
          <>
            {usage.failures.length > 0 ? (
              <NoticeBox tone="warning" size="content" className="mt-8">
                {t("session.usage_partial_failure", {
                  workspaces: failureNames,
                })}
              </NoticeBox>
            ) : null}

            <div className="mt-10 overflow-x-auto pb-1">
              <section
                aria-label={t("session.usage_summary_label")}
                className="grid min-w-3xl grid-cols-5 overflow-hidden rounded-2xl border border-dls-border bg-dls-surface-solid [&>*:not(:last-child)]:border-r [&>*:not(:last-child)]:border-dls-border"
              >
                {metrics.map((metric) => (
                  <Metric key={metric.label} {...metric} />
                ))}
              </section>
            </div>

            <section data-token-activity="true" className="mt-10">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-medium text-dls-text">
                  {t("session.usage_activity")}
                </h2>
                <SegmentedTabGroup
                  density="filter"
                  role="tablist"
                  aria-label={t("session.usage_activity_mode_label")}
                >
                  {(["daily", "weekly", "cumulative"] as const).map((mode) => (
                    <NavTabButton
                      key={mode}
                      type="button"
                      role="tab"
                      size="filter"
                      shape="pill"
                      active={activityMode === mode}
                      aria-selected={activityMode === mode}
                      onClick={() => setActivityMode(mode)}
                    >
                      {usageActivityModeLabel(mode)}
                    </NavTabButton>
                  ))}
                </SegmentedTabGroup>
              </div>

              {usage.summary.totalTokens === 0 ? (
                <EmptyStateBox size="comfortable" className="mt-4">
                  {t("session.usage_empty")}
                </EmptyStateBox>
              ) : (
                <div className="mt-4 overflow-x-auto pb-2">
                  <div className="min-w-3xl">
                    <div
                      className={cn(
                        "grid w-full justify-between gap-y-1",
                        activityMode === "weekly"
                          ? "grid-flow-col grid-rows-1"
                          : "grid-flow-col grid-rows-7",
                      )}
                      role="grid"
                      aria-label={t("session.usage_activity_grid_label")}
                    >
                      {activity.map((point) => (
                        <div
                          key={point.date}
                          role="gridcell"
                          className={cn(
                            "size-3 rounded-xs",
                            activityLevelClass[point.level],
                          )}
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
                    <div
                      className="mt-2 grid grid-cols-12 text-xs text-dls-secondary"
                      aria-hidden="true"
                    >
                      {months.map((month, index) => (
                        <span key={`${month}-${index}`}>{month}</span>
                      ))}
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
