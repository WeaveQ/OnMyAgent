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
  monthLabelColumns,
  type PersonalUsageClient,
  type TokenActivityCell,
  type TokenActivityColumn,
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
  defaultActivityMode?: TokenActivityMode;
};

const activityLevelClass: Record<number, string> = {
  0: "bg-dls-surface-muted",
  1: "bg-[color-mix(in_srgb,var(--profile-usage-accent)_22%,transparent)]",
  2: "bg-[color-mix(in_srgb,var(--profile-usage-accent)_42%,transparent)]",
  3: "bg-[color-mix(in_srgb,var(--profile-usage-accent)_68%,transparent)]",
  4: "bg-[var(--profile-usage-accent)]",
};

const weeklyCellClass = {
  empty:
    "bg-dls-surface-muted group-hover:bg-[color-mix(in_srgb,var(--profile-usage-accent)_14%,var(--dls-surface-muted))]",
  active:
    "bg-[color-mix(in_srgb,var(--profile-usage-accent)_78%,transparent)] group-hover:bg-[var(--profile-usage-accent)] group-hover:ring-1 group-hover:ring-[color-mix(in_srgb,var(--profile-usage-accent)_55%,transparent)]",
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

function isGenericDisplayName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return true;
  // Default fallback from i18n (`session.current_user`) also counts as generic;
  // resolve the current-locale label at runtime so we do not hardcode CJK here.
  const localizedMe = t("session.current_user").trim();
  const generic = new Set(["me", "you", "user", "anonymous"]);
  if (localizedMe) generic.add(localizedMe.toLowerCase());
  return generic.has(trimmed.toLowerCase());
}

function resolveProfileIdentity(identity: PersonalUsagePageProps["identity"]) {
  const rawName = identity.name?.trim() || "";
  const email = identity.email?.trim() || "";
  const emailLocal = email.includes("@") ? email.split("@")[0]?.trim() || "" : "";
  const generic = isGenericDisplayName(rawName);
  const displayName = !generic
    ? rawName
    : emailLocal || email || t("session.usage_profile_default_name");
  const showEmail = Boolean(email) && displayName !== email;
  return { displayName, email, showEmail, generic };
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  // CJK / single-token names: one character is enough for the avatar.
  if (parts.length === 1 && parts[0] && /[\u4e00-\u9fff]/.test(parts[0])) {
    return parts[0].slice(0, 1);
  }
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

function formatLocalizedTokenCount(tokens: number) {
  const locale = currentLocale();
  if (locale === "zh" || locale === "zh-TW") {
    const roundedTokens = Math.max(0, Math.round(tokens));
    if (roundedTokens >= 100_000_000) {
      return t("session.usage_token_count_yi", {
        value: Number((roundedTokens / 100_000_000).toFixed(1)),
      });
    }
    if (roundedTokens >= 10_000) {
      return t("session.usage_token_count_wan", {
        value: Number((roundedTokens / 10_000).toFixed(1)),
      });
    }
    return t("session.usage_token_count", { value: roundedTokens });
  }
  return formatPersonalTokenCount(tokens);
}

function formatActivityDate(date: string, mode: TokenActivityMode) {
  const locale = currentLocale();
  const value = new Date(`${date}T00:00:00Z`);
  if (mode === "daily") {
    return new Intl.DateTimeFormat(locale, {
      month: "long",
      day: "numeric",
    }).format(value);
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(value);
}

function activityTooltip(props: {
  mode: TokenActivityMode;
  column: TokenActivityColumn;
  cell: TokenActivityCell;
}) {
  if (props.mode === "daily") {
    const date = formatActivityDate(props.cell.date, "daily");
    return t("session.usage_daily_tooltip", {
      date,
      tokens: formatLocalizedTokenCount(props.cell.value),
    });
  }
  if (props.mode === "weekly") {
    const date = formatActivityDate(props.column.weekStart, "weekly");
    return t("session.usage_weekly_tooltip", {
      date,
      tokens: formatLocalizedTokenCount(props.column.weeklyValue),
    });
  }
  const date = formatActivityDate(props.column.weekStart, "weekly");
  return t("session.usage_cumulative_tooltip", {
    date,
    tokens: formatLocalizedTokenCount(props.column.cumulativeValue),
  });
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-2 py-2.5 text-center">
      <div className="truncate text-base font-medium tabular-nums text-dls-text">
        {props.value}
      </div>
      <div className="mt-0.5 truncate text-sm text-dls-secondary">
        {props.label}
      </div>
    </div>
  );
}

function ActivityGrid(props: {
  columns: TokenActivityColumn[];
  mode: TokenActivityMode;
  today: string;
}) {
  const [hovered, setHovered] = useState<{
    column: TokenActivityColumn;
    cell: TokenActivityCell;
    x: number;
    y: number;
  } | null>(null);

  return (
    <div
      className="relative [--profile-usage-accent:#339cff] dark:[--profile-usage-accent:#99ceff]"
      role="grid"
      aria-label={t("session.usage_activity_grid_label")}
      onMouseLeave={() => setHovered(null)}
    >
      <div className="flex justify-end gap-1 overflow-hidden">
        {props.columns.map((column) => (
          <div
            key={column.weekStart}
            className="group flex shrink-0 flex-col gap-1"
          >
            {column.cells.map((cell, index) => {
              if (props.mode === "daily" && cell.date > props.today) {
                return null;
              }
              const keyboardTarget =
                props.mode === "daily"
                  ? cell.value > 0
                  : index === 0 && cell.value > 0;
              return (
                <div
                  key={index}
                  role="gridcell"
                  tabIndex={keyboardTarget ? 0 : -1}
                  className={cn(
                    "size-3 shrink-0 rounded-xs",
                    "transition-colors outline-none",
                    "focus-visible:ring-2 focus-visible:ring-dls-accent",
                    props.mode === "daily"
                      ? activityLevelClass[cell.level]
                      : cell.level > 0
                        ? weeklyCellClass.active
                        : weeklyCellClass.empty,
                  )}
                  aria-label={activityTooltip({
                    mode: props.mode,
                    column,
                    cell,
                  })}
                  onMouseEnter={(event) =>
                    setHovered({
                      column,
                      cell,
                      x: event.clientX,
                      y: event.clientY,
                    })
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
      {hovered ? (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg border border-dls-border bg-dls-surface px-3 py-1.5 text-xs text-dls-text shadow-md"
          style={{ left: hovered.x, top: hovered.y - 8 }}
        >
          {activityTooltip({
            mode: props.mode,
            column: hovered.column,
            cell: hovered.cell,
          })}
        </div>
      ) : null}
    </div>
  );
}

export function PersonalUsagePage(props: PersonalUsagePageProps) {
  const [activityMode, setActivityMode] = useState<TokenActivityMode>(
    props.defaultActivityMode ?? "daily",
  );
  const today = new Date().toISOString().slice(0, 10);
  const usage = usePersonalUsage({
    client: props.client,
    workspaces: props.workspaces,
    scopeId: "all",
  });
  const profile = useMemo(
    () => resolveProfileIdentity(props.identity),
    [props.identity],
  );
  // Full trailing-year window (~53 weeks). Do not trim leading empty weeks —
  // that left a blank gap on the left and only a short right-aligned strip.
  const activity = useMemo(
    () =>
      buildTokenActivitySeries(usage.summary.daily, activityMode, today),
    [activityMode, today, usage.summary.daily],
  );
  const monthLabels = useMemo(
    () => monthLabelColumns(activity, today, currentLocale()),
    [activity, today],
  );
  const failureNames = usage.failures
    .map((failure) => failure.workspaceName)
    .join(", ");
  const metrics = [
    {
      label: t("session.usage_total_tokens"),
      value: formatLocalizedTokenCount(usage.summary.totalTokens),
    },
    {
      label: t("session.usage_peak_tokens"),
      value: formatLocalizedTokenCount(usage.summary.peakSessionTokens),
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
      className="flex h-full min-h-0 w-full justify-center overflow-y-auto bg-transparent"
    >
      <div
        data-usage-profile="true"
        className="mx-auto w-full max-w-4xl px-4 pb-12 pt-2 sm:pt-4"
      >
        <section className="text-center" aria-label={profile.displayName}>
          <div
            className="mx-auto flex size-20 items-center justify-center rounded-full bg-dls-decision text-2xl font-medium text-white"
            aria-hidden="true"
          >
            {initials(profile.displayName)}
          </div>
          <h2 className="mt-5 truncate text-2xl font-medium tracking-tight text-dls-text">
            {profile.displayName}
          </h2>
          <div className="mt-2 flex min-w-0 flex-wrap items-center justify-center gap-2 text-base text-dls-secondary">
            {profile.showEmail ? (
              <span className="max-w-80 truncate">{profile.email}</span>
            ) : null}
            {profile.showEmail ? <span aria-hidden="true">·</span> : null}
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

            <div className="mt-12 overflow-x-auto pb-1">
              <section
                aria-label={t("session.usage_summary_label")}
                className="grid min-w-3xl grid-cols-5 overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid [&>*:not(:last-child)]:border-r [&>*:not(:last-child)]:border-dls-border"
              >
                {metrics.map((metric) => (
                  <Metric key={metric.label} {...metric} />
                ))}
              </section>
            </div>

            <section data-token-activity="true" className="mt-10">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-dls-text">
                  {t("session.usage_activity")}
                </h2>
                <SegmentedTabGroup
                  density="bare"
                  role="tablist"
                  aria-label={t("session.usage_activity_mode_label")}
                >
                  {(["daily", "weekly", "cumulative"] as const).map((mode) => (
                    <NavTabButton
                      key={mode}
                      type="button"
                      role="tab"
                      size="underline"
                      shape="underline"
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
                <div className="mt-3 overflow-hidden pb-2">
                  <ActivityGrid
                    columns={activity}
                    mode={activityMode}
                    today={today}
                  />
                  <div className="relative mt-2 h-5" aria-hidden="true">
                    {monthLabels.map(({ label, columnIndex }) => (
                      <span
                        key={`${label}-${columnIndex}`}
                        className="absolute top-0 text-sm text-dls-secondary"
                        style={{
                          left: `${(columnIndex / Math.max(activity.length, 1)) * 100}%`,
                        }}
                      >
                        {label}
                      </span>
                    ))}
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
