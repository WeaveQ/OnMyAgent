/** @jsxImportSource react */
import { useState } from "react";
import { CheckCircle2, ChevronDown, Clock3 } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ConversationItemVM } from "../../../capabilities/conversation";
import { ConversationItemView } from "../../../capabilities/conversation";

function planCount(item: ConversationItemVM) {
  const entries = Array.isArray(item.meta?.entries) ? item.meta.entries : [];
  if (entries.length) return entries.length;
  return item.text.split("\n").map((line) => line.trim()).filter(Boolean).length;
}

function completedPlanCount(item: ConversationItemVM) {
  const entries = Array.isArray(item.meta?.entries) ? item.meta.entries : [];
  return entries.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const status = "status" in entry ? entry.status : undefined;
    return /complete|done/i.test(typeof status === "string" ? status : "");
  }).length;
}

/** Plan disclosure with terminal-safe default collapse, limited to Local Agent UI. */
export function LocalAgentPlanFold(props: {
  item: ConversationItemVM;
  streaming?: boolean;
}) {
  const count = planCount(props.item);
  const completed = completedPlanCount(props.item);
  const running = Boolean(props.streaming);
  const [expanded, setExpanded] = useState(running);

  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-dls-border bg-dls-surface-muted",
        expanded && "bg-dls-surface-muted/70",
      )}
      data-testid="local-agent-plan-fold"
      data-plan-status={running ? "running" : "completed"}
    >
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs text-dls-secondary outline-none transition-colors hover:bg-dls-hover/40 focus-visible:ring-1 focus-visible:ring-dls-focus focus-visible:ring-offset-0"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        data-testid="local-agent-plan-fold-header"
      >
        {running ? (
          <Clock3 className="size-3.5 shrink-0 text-dls-accent" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-dls-status-success-fg" aria-hidden="true" />
        )}
        <span className={cn("min-w-0 flex-1 truncate", running && "font-medium text-dls-text")}>
          {t("local_agent.process_plan")}
        </span>
        <StatusBadge tone={running ? "accent" : "success"} shape="pill" size="tiny">
          {count ? `${completed}/${count}` : running ? t("local_agent.status_running") : t("local_agent.status_completed")}
        </StatusBadge>
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3.5 shrink-0 text-dls-text-tertiary transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded ? (
        <div className="border-t border-dls-border/60 px-2.5 py-2" data-testid="local-agent-plan-fold-body">
          <ConversationItemView item={props.item} streaming={props.streaming} />
        </div>
      ) : null}
    </section>
  );
}
