/** @jsxImportSource react */
import { useState } from "react";
import { XIcon } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PersonalLocalAgentConversationMessage } from "@/app/lib/desktop";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CONTEXT_USAGE_BUCKET_COLOR,
  CONTEXT_USAGE_BUCKET_ORDER,
  CONTEXT_USAGE_DANGER_PERCENT,
  CONTEXT_USAGE_WARN_PERCENT,
  occupancyLegendIds,
  type ContextUsageBucketId,
  type ContextUsageSnapshot,
  bucketPercentOfTotal,
  contextUsageExceedsKnownLimit,
  contextUsageHasKnownLimit,
  contextUsagePercent,
  formatBucketPercent,
  formatCompactTokens,
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
    case "prompt":
      return t("local_agent.context_usage_bucket_prompt");
    case "cache":
      return t("local_agent.context_usage_bucket_cache");
    case "output":
      return t("local_agent.context_usage_turn_output");
    case "reasoning":
      return t("local_agent.context_usage_turn_reasoning");
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
  const segments = CONTEXT_USAGE_BUCKET_ORDER.map((id) => {
    const item = breakdown?.find((b) => b.id === id);
    const tokens = item?.tokens ?? 0;
    return { id, tokens, pct: bucketPercentOfTotal(tokens, total) };
  }).filter((s) => s.pct > 0);

  if (segments.length === 0) {
    const pct = contextUsagePercent(used, total);
    return (
      <div className="h-2 w-full overflow-hidden rounded-full bg-dls-surface-muted">
        <div
          className={cn("h-full", props.toneClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-dls-surface-muted">
      {segments.map((seg) => (
        <div
          key={seg.id}
          className="h-full shrink-0"
          style={{
            width: `${Math.max(seg.pct, 1.25)}%`,
            backgroundColor: CONTEXT_USAGE_BUCKET_COLOR[seg.id],
          }}
          title={`${bucketLabel(seg.id)} ${formatBucketPercent(seg.pct)}`}
        />
      ))}
    </div>
  );
}

function legendBucketIds(breakdown: ContextUsageSnapshot["breakdown"]): ContextUsageBucketId[] {
  const extra =
    breakdown?.some((item) => item.id === "other" && item.tokens > 0) === true
      ? (["other"] as const)
      : [];
  return [...occupancyLegendIds(breakdown), ...extra];
}

export function ContextUsagePopoverBody(props: {
  usage: ContextUsageSnapshot;
  percent: number;
  percentClass: string;
  barToneClass: string;
  isOverLimit: boolean;
  onClose: () => void;
}) {
  const { usage, percent, percentClass, barToneClass, isOverLimit, onClose } = props;
  const breakdown = usage.breakdown;
  const rows = legendBucketIds(breakdown);

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-dls-text">
          {t("local_agent.context_usage")}
        </div>
        <button
          type="button"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
          aria-label={t("common.close")}
          data-testid="local-agent-context-usage-close"
          onClick={onClose}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={cn("text-2xl font-bold tabular-nums leading-none", percentClass)}>
            {`${percent.toFixed(1)}%`}
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
        {isOverLimit ? (
          <div className="text-xs leading-4 text-dls-status-danger-fg" data-testid="local-agent-context-usage-exceeded">
            {t("local_agent.context_usage_exceeded")}
          </div>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2.5" data-testid="context-usage-breakdown">
        {rows.map((id) => {
          const item = breakdown?.find((b) => b.id === id);
          const tokens = item?.tokens ?? 0;
          const pct = bucketPercentOfTotal(tokens, usage.total);
          return (
            <li
              key={id}
              className="flex items-center justify-between gap-3 text-xs leading-4"
            >
              <span className="flex min-w-0 items-center gap-2 text-dls-text">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: CONTEXT_USAGE_BUCKET_COLOR[id] }}
                  aria-hidden
                />
                <span className="truncate">{bucketLabel(id)}</span>
              </span>
              <span className="shrink-0 tabular-nums text-dls-secondary">
                {formatBucketPercent(pct)}
              </span>
            </li>
          );
        })}
      </ul>
      {usage.turnOutput || usage.turnReasoning ? (
        <div className="flex flex-col gap-2 border-t border-dls-border pt-2.5" data-testid="context-usage-turn-extras">
          <div className="text-2xs leading-4 text-dls-secondary">
            {t("local_agent.context_usage_turn_extras_hint")}
          </div>
          <ul className="flex flex-col gap-2">
            {usage.turnOutput ? (
              <li className="flex items-center justify-between gap-3 text-xs leading-4 text-dls-secondary">
                <span>{t("local_agent.context_usage_turn_output")}</span>
                <span className="tabular-nums">
                  {t("local_agent.context_usage_tokens", {
                    count: formatCompactTokens(usage.turnOutput),
                  })}
                </span>
              </li>
            ) : null}
            {usage.turnReasoning ? (
              <li className="flex items-center justify-between gap-3 text-xs leading-4 text-dls-secondary">
                <span>{t("local_agent.context_usage_turn_reasoning")}</span>
                <span className="tabular-nums">
                  {t("local_agent.context_usage_tokens", {
                    count: formatCompactTokens(usage.turnReasoning),
                  })}
                </span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </>
  );
}

// Composer-embedded ring. Click opens a popover with used/total and category rows.
// Threshold colors: 70% warn / 90% danger, only when the window is known.
export function ContextUsageIndicator(props: {
  usage: ContextUsageSnapshot | { used: number; total: number; label?: string | null } | null;
  className?: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const usage = toContextUsageSnapshot(props.usage);
  if (!usage) return null;
  const size = props.size ?? 22;
  const percent = contextUsagePercent(usage.used, usage.total);
  const hasKnownLimit = contextUsageHasKnownLimit(usage);
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (percent / 100) * circumference;
  const isDanger = hasKnownLimit && percent >= CONTEXT_USAGE_DANGER_PERCENT;
  const isWarn = hasKnownLimit && percent >= CONTEXT_USAGE_WARN_PERCENT;
  const ringClass = isDanger
    ? "text-dls-danger"
    : isWarn
      ? "text-dls-warning"
      : "text-dls-accent";
  const percentClass = isDanger
    ? "text-dls-danger"
    : isWarn
      ? "text-dls-warning"
      : "text-dls-text";
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
  const isOverLimit = contextUsageExceedsKnownLimit(usage);

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
            data-limit-known={String(hasKnownLimit)}
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
        className="w-[min(20rem,calc(100vw-2rem))] gap-3.5 p-4"
        data-testid="local-agent-context-usage-popover"
      >
        <ContextUsagePopoverBody
          usage={usage}
          percent={percent}
          percentClass={percentClass}
          barToneClass={barToneClass}
          isOverLimit={isOverLimit}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
