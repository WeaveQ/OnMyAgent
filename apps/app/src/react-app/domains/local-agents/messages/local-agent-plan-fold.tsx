/** @jsxImportSource react */
import { useState } from "react";
import { Check, ChevronDown, Terminal } from "lucide-react";

import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ConversationItemVM } from "../../../capabilities/conversation";

function planItems(item: ConversationItemVM) {
  const entries = Array.isArray(item.meta?.entries) ? item.meta.entries : [];
  if (entries.length) {
    return entries.flatMap((entry, index) => {
      if (!entry || typeof entry !== "object") return [];
      const title = "title" in entry && typeof entry.title === "string" ? entry.title : "";
      const content = "content" in entry && typeof entry.content === "string" ? entry.content : "";
      const status =
        "status" in entry && typeof entry.status === "string" ? entry.status : "pending";
      const label = (title || content).trim();
      if (!label) return [];
      return [{
        id: "id" in entry && typeof entry.id === "string" ? entry.id : `plan-${index}`,
        label,
        status,
      }];
    });
  }
  return item.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((label, index) => ({
      id: `plan-line-${index}`,
      label,
      status: "pending",
    }));
}

/** Plan disclosure with terminal-safe default collapse, limited to Local Agent UI. */
export function LocalAgentPlanFold(props: {
  item: ConversationItemVM;
  streaming?: boolean;
}) {
  const items = planItems(props.item);
  const running = Boolean(props.streaming);
  const [expanded, setExpanded] = useState(running);

  return (
    <section
      className="session-workbuddy-task-list"
      data-testid="local-agent-plan-fold"
      data-plan-status={running ? "running" : "completed"}
    >
      <button
        type="button"
        className="session-workbuddy-task-header focus-visible:ring-1 focus-visible:ring-dls-focus focus-visible:ring-offset-0"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        data-testid="local-agent-plan-fold-header"
      >
        <Terminal aria-hidden="true" />
        <span>{t("session.workbuddy_task_list")}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn("session-workbuddy-task-chevron", expanded && "is-expanded")}
        />
      </button>
      {expanded && items.length ? (
        <div className="session-workbuddy-task-detail" data-testid="local-agent-plan-fold-body">
          {items.map((item) => {
            const completed = /complete|done/i.test(item.status);
            const itemRunning =
              running && /in_progress|running|progress/i.test(item.status);
            return (
              <div
                key={item.id}
                className={cn(
                  "session-workbuddy-task-item",
                  completed && "is-completed",
                  itemRunning && "is-running",
                )}
              >
                <span className="session-workbuddy-task-icon" aria-hidden="true">
                  {completed ? <Check /> : null}
                  {itemRunning ? <LoadingSpinner /> : null}
                  {!completed && !itemRunning ? (
                    <span className="session-workbuddy-task-pending" />
                  ) : null}
                </span>
                <span className="session-workbuddy-task-text">{item.label}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
