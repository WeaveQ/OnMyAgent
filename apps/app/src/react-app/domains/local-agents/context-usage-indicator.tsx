import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PersonalLocalAgentConversationMessage } from "@/app/lib/desktop";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Latest usage across a conversation. Iterates from the tail so pinned or
// stale entries never mask the most recent context_usage update.
export function latestContextUsage(messages: PersonalLocalAgentConversationMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const usage = messages[index]?.contextUsage;
    if (usage && Number.isFinite(usage.used) && Number.isFinite(usage.total) && usage.total > 0) return usage;
  }
  return null;
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) {
    const scaled = value / 1_000_000;
    return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const scaled = value / 1_000;
    return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)}K`;
  }
  return String(value);
}

function formatExactTokens(value: number) {
  return new Intl.NumberFormat().format(Math.round(value));
}

type Usage = { used: number; total: number; label?: string | null };

// Composer-embedded ring (AionUi-style). Click opens a popover with the exact
// used/total token counts and remaining budget. Threshold colors follow the
// same 70%/90% breakpoints used by AionUi.
export function ContextUsageIndicator(props: { usage: Usage | null; className?: string; size?: number }) {
  const usage = props.usage;
  if (!usage) return null;
  const size = props.size ?? 22;
  const percent = Math.min(100, Math.max(0, (usage.used / usage.total) * 100));
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (percent / 100) * circumference;
  const isDanger = percent >= 90;
  const isWarn = percent >= 70;
  const ringClass = isDanger
    ? "text-dls-danger"
    : isWarn
      ? "text-dls-warning"
      : "text-dls-accent";
  const title = t("local_agent.context_usage_tooltip", {
    used: formatTokenCount(usage.used),
    total: formatTokenCount(usage.total),
    percent: percent.toFixed(1),
  });
  const remaining = Math.max(0, usage.total - usage.used);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn("mac:titlebar-no-drag inline-flex items-center justify-center rounded-md p-1 text-dls-secondary hover:bg-dls-hover", props.className)}
            title={title}
            aria-label={title}
            data-testid="local-agent-context-usage"
            data-percent={percent.toFixed(1)}
          >
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
              <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={stroke} />
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
      <PopoverContent align="end" className="w-64 gap-2" data-testid="local-agent-context-usage-popover">
        <div className="text-xs font-medium text-dls-secondary">{t("local_agent.context_usage")}</div>
        <div className="flex items-baseline justify-between">
          <span className="text-base font-semibold tabular-nums text-dls-primary">
            {formatExactTokens(usage.used)}
            <span className="mx-1 text-dls-secondary">/</span>
            {formatExactTokens(usage.total)}
          </span>
          <span className={cn("text-sm tabular-nums", ringClass)}>{percent.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between text-xs text-dls-secondary">
          <span>{t("local_agent.context_usage_remaining", { remaining: formatExactTokens(remaining) })}</span>
          {usage.label ? <span className="truncate pl-2">{usage.label}</span> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
