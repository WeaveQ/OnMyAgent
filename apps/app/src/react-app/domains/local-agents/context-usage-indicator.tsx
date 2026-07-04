import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PersonalLocalAgentConversationMessage } from "../../../app/lib/desktop";

export function latestContextUsage(messages: PersonalLocalAgentConversationMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const usage = messages[index]?.contextUsage;
    if (usage && Number.isFinite(usage.used) && Number.isFinite(usage.total) && usage.total > 0) return usage;
  }
  return null;
}

function formatTokenCount(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

export function ContextUsageIndicator(props: { usage: { used: number; total: number; label?: string | null } | null; className?: string }) {
  if (!props.usage) return null;
  const percent = Math.min(100, Math.max(0, Math.round((props.usage.used / props.usage.total) * 100)));
  const title = t("local_agent.context_usage_tooltip", {
    used: formatTokenCount(props.usage.used),
    total: formatTokenCount(props.usage.total),
    percent,
  });
  return (
    <div className={cn("flex items-center gap-2 rounded-md border border-dls-border bg-dls-surface-muted px-3 py-2 text-xs text-dls-secondary", props.className)} title={title} data-testid="local-agent-context-usage">
      <span className="shrink-0 font-medium text-dls-text">{props.usage.label || t("local_agent.context_usage")}</span>
      <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-dls-border" aria-hidden="true">
        <div className="h-full rounded-full bg-dls-accent" style={{ width: `${percent}%` }} />
      </div>
      <span className="shrink-0 tabular-nums">{formatTokenCount(props.usage.used)} / {formatTokenCount(props.usage.total)}</span>
    </div>
  );
}
