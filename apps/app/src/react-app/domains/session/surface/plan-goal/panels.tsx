/** @jsxImportSource react */
import { useState } from "react";
import { Check, Minimize2, Trash2 } from "lucide-react";

import type { CollaborationPlanRuntime, TodoItem } from "../../../../../app/types";
import { t } from "../../../../../i18n";
import { ActionRowButton, DisclosureRowButton } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import { extractPlanDetailSections, resolvePlanStepItems } from "./plan-parse";
import { sessionSurfaceStateClass } from "../surface-styles";
import { AssistantWaitingCard } from "../chrome/assistant-status";

export function TodoPanel(props: { todos: TodoItem[]; onClear?: () => void }) {
  const [pinnedExpanded, setPinnedExpanded] = useState(false);
  const todos = props.todos.filter((todo) => todo.content.trim());
  const completedTodos = todos.filter(
    (todo) => todo.status === "completed",
  ).length;
  const expanded = pinnedExpanded;
  const progressLabel = t("session.todo_progress_label");
  const label = expanded
    ? progressLabel
    : `${progressLabel} · ${completedTodos}/${todos.length}`;

  if (todos.length === 0) return null;

  return (
    <div className="overflow-hidden border-b border-dls-border bg-transparent">
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2",
          expanded ? "border-b border-dls-border" : "",
        )}
      >
        <DisclosureRowButton
          type="button"
          density="flush"
          className="min-w-0 flex-1 justify-start gap-2 text-xs text-dls-secondary hover:bg-transparent hover:text-dls-text"
          onClick={() => setPinnedExpanded((current) => !current)}
        >
          <span className="truncate font-medium text-dls-secondary">
            {label}
          </span>
        </DisclosureRowButton>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => setPinnedExpanded((current) => !current)}
          aria-label={
            expanded
              ? t("session.plan_runtime_collapse")
              : t("session.plan_runtime_expand")
          }
        >
          <Minimize2
            size={12}
            className={`text-dls-secondary transition-transform ${expanded ? "" : "rotate-180"}`}
          />
        </Button>
        {props.onClear ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="text-dls-secondary hover:text-dls-text"
            onClick={props.onClear}
            aria-label={t("session.goal_runtime_clear")}
          >
            <Trash2 size={12} />
          </Button>
        ) : null}
      </div>
      {expanded ? (
        <div className="max-h-60 space-y-2.5 overflow-auto px-4 pb-3">
          {todos.map((todo, index) => {
            const done = todo.status === "completed";
            const cancelled = todo.status === "cancelled";
            const active = todo.status === "in_progress";
            return (
              <div
                key={todo.id}
                className="flex items-start gap-2.5 pt-2.5 first:pt-2.5"
              >
                <div className="flex items-center gap-1.5 pt-0.5">
                  <div
                    className={`flex size-4.5 items-center justify-center rounded-full border ${
                      done
                        ? sessionSurfaceStateClass.todoDone
                        : active
                          ? sessionSurfaceStateClass.todoActive
                          : cancelled
                            ? "border-dls-border bg-dls-surface-muted text-dls-secondary"
                            : "border-dls-border bg-dls-surface text-dls-secondary"
                    }`}
                  >
                    {done ? (
                      <Check size={12} />
                    ) : active ? (
                      <StatusDot size="xs" tone="warning" />
                    ) : null}
                  </div>
                </div>
                <div
                  className={`flex-1 text-sm leading-relaxed ${cancelled ? "text-dls-secondary line-through" : "text-dls-text"}`}
                >
                  <span className="mr-1.5 text-dls-secondary">{index + 1}.</span>
                  {todo.content}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function PlanApprovalPanel(props: {
  runtime: CollaborationPlanRuntime;
  todos: TodoItem[];
  busy: boolean;
  onExecute: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isDrafting = props.runtime.status === "drafting";
  const isExecuting = props.runtime.status === "executing";
  const isCompleted = props.runtime.status === "completed";
  const isBlocked = props.runtime.status === "blocked";
  const detailsExpanded = expanded;
  const planText = props.runtime.planText?.trim() || "";
  const planSteps = resolvePlanStepItems({
    planText,
    originalPrompt: props.runtime.originalPrompt,
    runtimeStatus: props.runtime.status,
    todos: props.todos,
  });
  const planDetails = extractPlanDetailSections(planText);
  const completedSteps = planSteps.filter(
    (step) => step.status === "completed",
  ).length;
  const progressLabel = t("session.todo_progress_label");
  const statusLabel = isDrafting
    ? t("session.plan_runtime_drafting")
    : isExecuting
      ? t("session.plan_runtime_executing")
      : isCompleted
        ? t("session.plan_runtime_completed")
        : isBlocked
          ? t("session.plan_runtime_blocked")
        : t("session.plan_runtime_title");
  const label =
    detailsExpanded || planSteps.length === 0
      ? statusLabel
      : `${progressLabel} · ${completedSteps}/${planSteps.length}`;
  const showReadyBadge =
    detailsExpanded && props.runtime.status === "awaiting_approval";

  return (
    <div className="overflow-hidden border-b border-dls-border bg-transparent">
      <div className="flex items-center gap-2 border-b border-dls-border px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <DisclosureRowButton
            type="button"
            density="flush"
            className="min-w-0 justify-start gap-2 text-xs text-dls-secondary hover:bg-transparent hover:text-dls-text"
            onClick={() => setExpanded((current) => !current)}
          >
            <span className="truncate font-medium text-dls-secondary">
              {label}
            </span>
            {showReadyBadge ? (
              <StatusBadge tone="success" size="tiny">
                {t("session.plan_runtime_ready")}
              </StatusBadge>
            ) : null}
          </DisclosureRowButton>
        </div>
        {isCompleted || isBlocked ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" size="xs" onClick={props.onConfirm}>
              {t("session.plan_runtime_confirm")}
            </Button>
          </div>
        ) : isExecuting ? null : (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={props.onCancel}
              disabled={props.busy}
            >
              {t("session.plan_runtime_cancel")}
            </Button>
            <Button
              type="button"
              size="xs"
              onClick={props.onExecute}
              disabled={props.busy || isDrafting}
            >
              {t("session.plan_runtime_execute")}
            </Button>
          </div>
        )}
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => setExpanded((current) => !current)}
          aria-label={
            expanded
              ? t("session.plan_runtime_collapse")
              : t("session.plan_runtime_expand")
          }
        >
          <Minimize2
            size={12}
            className={`text-dls-secondary transition-transform ${expanded ? "" : "rotate-180"}`}
          />
        </Button>
      </div>
      {detailsExpanded ? (
        <div className="max-h-60 space-y-2.5 overflow-auto px-4 pb-3">
          {isDrafting ? (
            <div className="pt-2.5">
              <AssistantWaitingCard
                label={t("session.plan_runtime_drafting")}
                collapseLayout
              />
            </div>
          ) : planSteps.length > 0 ? (
            planSteps.map((step, index) => {
              const done = step.status === "completed";
              const active = step.status === "active";
              return (
                <div
                  key={step.id}
                  className="flex items-start gap-2.5 pt-2.5 first:pt-2.5"
                >
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <div
                      className={`flex size-4.5 items-center justify-center rounded-full border ${
                        done
                          ? sessionSurfaceStateClass.todoDone
                          : active
                            ? sessionSurfaceStateClass.todoActive
                            : "border-dls-border bg-dls-surface text-dls-secondary"
                      }`}
                    >
                      {done ? (
                        <Check size={12} />
                      ) : active ? (
                        <StatusDot size="xs" tone="warning" />
                      ) : null}
                    </div>
                  </div>
                  <div className="flex-1 text-sm leading-relaxed text-dls-text">
                    <span className="mr-1.5 text-dls-secondary">
                      {index + 1}.
                    </span>
                    {step.content}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="pt-2.5 text-sm leading-relaxed text-dls-secondary">
              {t("session.plan_runtime_empty")}
            </div>
          )}
          {!isDrafting && planDetails.length > 0 ? (
            <div className="space-y-2 border-t border-dls-border pt-3">
              {planDetails.map((section) => (
                <div key={section.kind} className="text-xs leading-5">
                  <div className="font-medium text-dls-secondary">
                    {section.title}
                  </div>
                  <div className="mt-1 space-y-1 text-dls-secondary">
                    {section.items.map((item) => (
                      <div key={`${section.kind}-${item}`} className="truncate">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

