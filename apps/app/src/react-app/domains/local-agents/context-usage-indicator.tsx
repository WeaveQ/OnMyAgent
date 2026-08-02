/** @jsxImportSource react */
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PersonalLocalAgentConversationMessage } from "@/app/lib/desktop";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CONTEXT_USAGE_BUCKET_COLOR,
  CONTEXT_USAGE_BUCKET_ORDER,
  CONTEXT_USAGE_DANGER_PERCENT,
  CONTEXT_USAGE_WARN_PERCENT,
  type ContextUsageBucketId,
  type ContextUsageSnapshot,
  bucketPercentOfTotal,
  contextUsagePercent,
  formatCompactTokens,
  formatExactTokens,
  toContextUsageSnapshot,
} from "../../capabilities/context-usage/context-usage-model";

// Latest usage across a conversation. Iterates from the tail so pinned or
// stale entries never mask the most recent context_usage update.
export function latestContextUsage(
  messages: PersonalLocalAgentConversationMessage[],
): ContextUsageSnapshot | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const snapshot = toContextUsageSnapshot(messages[index]?.contextUsage);
    if (snapshot) return snapshot;
  }
  return null;
}

function bucketLabel(id: ContextUsageBucketId): string {
  switch (id) {
    case "system":
      return t("local_agent.context_usage_bucket_system");
    case "tools":
      return t("local_agent.context_usage_bucket_tools");
    case "messages":
      return t("local_agent.context_usage_bucket_messages");
    case "connectors":
      return t("local_agent.context_usage_bucket_connectors");
    case "skills":
      return t("local_agent.context_usage_bucket_skills");
    case "other":
      return t("local_agent.context_usage_bucket_other");
    default:
      return id;
  }
}

function SegmentedUsageBar(props: {
  used: number;
  total: number;
  breakdown: ContextUsageSnapshot["breakdown"];
  toneClass: string;
}) {
  const { used, total, breakdown } = props;
  if (!breakdown || breakdown.length === 0) {
    const pct = contextUsagePercent(used, total);
    return (
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-dls-surface-muted">
        <div
          className={cn("h-full rounded-full transition-[width]", props.toneClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  }

  // Build segments as % of total; remainder is free capacity (track bg).
  const segments = CONTEXT_USAGE_BUCKET_ORDER.map((id) => {
    const item = breakdown.find((b) => b.id === id);
    const tokens = item?.tokens ?? 0;
    return { id, tokens, pct: bucketPercentOfTotal(tokens, total) };
  }).filter((s) => s.pct > 0);

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-dls-surface-muted">
      {segments.map((seg) => (
        <div
          key={seg.id}
          className={cn("h-full shrink-0", CONTEXT_USAGE_BUCKET_COLOR[seg.id])}
          style={{ width: `${seg.pct}%` }}
          title={`${bucketLabel(seg.id)} ${seg.pct.toFixed(1)}%`}
        />
      ))}
    </div>
  );
}

// Composer-embedded ring. Click opens a popover with used/total and optional
// category breakdown. Threshold colors: 70% warn / 90% danger.
export function ContextUsageIndicator(props: {
  usage: ContextUsageSnapshot | { used: number; total: number; label?: string | null } | null;
  className?: string;
  size?: number;
}) {
  const usage = toContextUsageSnapshot(props.usage);
  if (!usage) return null;
  const size = props.size ?? 22;
  const percent = contextUsagePercent(usage.used, usage.total);
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (percent / 100) * circumference;
  const isDanger = percent >= CONTEXT_USAGE_DANGER_PERCENT;
  const isWarn = percent >= CONTEXT_USAGE_WARN_PERCENT;
  const ringClass = isDanger
    ? "text-dls-danger"
    : isWarn
      ? "text-dls-warning"
      : "text-dls-accent";
  const barToneClass = isDanger
    ? "bg-dls-danger"
    : isWarn
      ? "bg-dls-warning"
      : "bg-dls-accent";
  const title = t("local_agent.context_usage_tooltip", {
    used: formatCompactTokens(usage.used),
    total: formatCompactTokens(usage.total),
    percent: percent.toFixed(1),
  });
  const remaining = Math.max(0, usage.total - usage.used);
  const breakdown = usage.breakdown;
  const hasBreakdown = Boolean(breakdown && breakdown.length > 0);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "mac:titlebar-no-drag inline-flex items-center justify-center rounded-md p-1 text-dls-secondary hover:bg-dls-hover",
              props.className,
            )}
            title={title}
            aria-label={title}
            data-testid="local-agent-context-usage"
            data-percent={percent.toFixed(1)}
          >
            <svg
              width={size}
              height={size}
              viewBox={`0 0 ${size} ${size}`}
              style={{ transform: "rotate(-90deg)" }}
              aria-hidden="true"
            >
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.15}
                strokeWidth={stroke}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className={ringClass}
                stroke="currentColor"
                style={{ transition: "stroke-dashoffset 0.3s ease" }}
              />
            </svg>
          </button>
        }
      />
      <PopoverContent
        align="end"
        className="w-[min(18rem,calc(100vw-2rem))] gap-3 p-3"
        data-testid="local-agent-context-usage-popover"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-medium text-dls-text">
            {t("local_agent.context_usage")}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className={cn("text-xl font-semibold tabular-nums", ringClass)}>
              {percent.toFixed(1)}%
            </span>
            <span className="text-xs text-dls-secondary">
              {t("local_agent.context_usage_used_of", {
                used: formatCompactTokens(usage.used),
                total: formatCompactTokens(usage.total),
              })}
            </span>
          </div>
          <SegmentedUsageBar
            used={usage.used}
            total={usage.total}
            breakdown={breakdown}
            toneClass={barToneClass}
          />
        </div>

        {hasBreakdown ? (
          <ul className="flex flex-col gap-1.5" data-testid="context-usage-breakdown">
            {CONTEXT_USAGE_BUCKET_ORDER.map((id) => {
              const item = breakdown!.find((b) => b.id === id);
              if (!item || item.tokens <= 0) return null;
              const pct = bucketPercentOfTotal(item.tokens, usage.total);
              return (
                <li
                  key={id}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-2 text-dls-text">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        CONTEXT_USAGE_BUCKET_COLOR[id],
                      )}
                      aria-hidden
                    />
                    <span className="truncate">{bucketLabel(id)}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-dls-secondary">
                    {pct.toFixed(1)}%
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex items-center justify-between text-xs text-dls-secondary">
            <span>
              {t("local_agent.context_usage_remaining", {
                remaining: formatExactTokens(remaining),
              })}
            </span>
            {usage.label ? (
              <span className="truncate pl-2">{usage.label}</span>
            ) : null}
          </div>
        )}

        {hasBreakdown ? (
          <div className="text-2xs text-dls-secondary">
            {t("local_agent.context_usage_remaining", {
              remaining: formatExactTokens(remaining),
            })}
            {usage.label ? (
              <span className="ml-2 truncate">{usage.label}</span>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
