/** @jsxImportSource react */
/**
 * Session Surface组件 - 从session-surface.tsx提取
 * 包含所有可复用的小组件
 */

import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import {
  Check,
  Clock3,
  Code2,
  BookOpenCheck,
  Goal,
  Minimize2,
  Pause,
  Play,
  Trash2,
} from "lucide-react";

import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PaperGrainGradient } from "@onmyagent/ui/react";
import { ActionRowButton, DisclosureRowButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import {
  ONMYAGENT_ASSISTANT_AVATAR,
  onmyagentAssistantName,
  PERSONAL_ASSISTANT_CATEGORIES,
  type AssistantCategoryId,
  type AssistantScenario,
} from "./personal-assistant-config";
import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  TodoItem,
} from "../../../../app/types";
import {
  resolvePlanStepItems,
  extractPlanDetailSections,
  goalElapsedMs,
  formatGoalElapsed,
  isGoalIntentRuntime,
} from "./session-surface-utils";

// ============================================================================
// Constants
// ============================================================================

const GOAL_RUNTIME_TICK_MS = 1000;

const sessionSurfaceTextClass = {
  assistantHeroTitle: "mt-4 text-lg font-medium text-dls-text",
  agentEmptyTitle: "mt-4 text-base font-medium text-dls-text",
  agentEmptyDescription: "mt-1.5 max-w-md text-center text-sm leading-6 text-dls-secondary",
  draftHomeTitle:
    "inline-flex items-center justify-center gap-2.5 text-2xl font-semibold tracking-tight text-dls-text",
  draftHomeSubtitle: "mt-2 max-w-md text-sm leading-6 text-dls-secondary",
  noVisibleOutput: "font-mono text-sm leading-6 text-dls-secondary whitespace-pre-wrap",
  headerAgentName: "min-w-0 truncate text-sm font-medium text-dls-text",
  openingSession: "text-sm text-dls-secondary",
};

const sessionSurfaceStateClass = {
  todoDone: "border-dls-status-success bg-dls-status-success-soft text-dls-status-success-fg",
  todoActive: "border-dls-status-warning bg-dls-status-warning-soft text-dls-status-warning-fg",
  todoActiveDot: "size-1.5 rounded-full bg-dls-status-warning",
  errorPanel: "rounded-xl border border-dls-status-danger-border bg-dls-status-danger-soft px-5 py-4",
  errorText: "text-sm font-medium text-dls-status-danger",
  errorDismiss: "shrink-0 text-dls-status-danger hover:bg-dls-status-danger/10 hover:text-dls-status-danger",
  snapshotError: "mx-auto max-w-xl rounded-xl border border-dls-status-danger-border bg-dls-status-danger-soft px-6 py-5 text-sm text-dls-status-danger",
};

const AGENT_AVATAR_PALETTES = [
  { background: "#d7ecf8", foreground: "#16324f" },
  { background: "#e1e2f0", foreground: "#42475f" },
  { background: "#ffe1c7", foreground: "#6d3b1f" },
  { background: "#cceaf5", foreground: "#174767" },
  { background: "#ddefc8", foreground: "#355a18" },
] as const;

// ============================================================================
// Avatar Components
// ============================================================================

export function AssistantDraftHomeMark(props: { categoryId: AssistantCategoryId }) {
  const Icon = props.categoryId === "code" ? Code2 : BookOpenCheck;

  return (
    <span className="inline-flex size-6 shrink-0 items-center justify-center text-current">
      <Icon className="size-6" strokeWidth={1.7} />
    </span>
  );
}

export function PendingAgentAvatar(props: {
  name: string;
  avatarUrl: string | null;
  avatarBackground?: string | null;
  className?: string;
}) {
  if (!props.avatarUrl) {
    // Pick a palette that matches the agent name so siblings don't twin.
    const index =
      Math.abs(
        Array.from(props.name).reduce(
          (acc, ch) => acc * 31 + ch.charCodeAt(0),
          0,
        ),
      ) % AGENT_AVATAR_PALETTES.length;
    const palette = AGENT_AVATAR_PALETTES[index]!;
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-full font-medium",
          props.className,
        )}
        style={{ background: palette.background, color: palette.foreground }}
      >
        {props.name.slice(0, 1) || t("session.agent_initial")}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-full",
        props.className,
      )}
      style={
        props.avatarBackground
          ? { background: props.avatarBackground }
          : undefined
      }
    >
      <img
        src={props.avatarUrl}
        alt={props.name}
        className="size-full rounded-full object-cover"
      />
    </div>
  );
}

// ============================================================================
// Assistant Status Components
// ============================================================================

export function AssistantWaitingCard({
  label = t("session.assistant_thinking"),
  collapseLayout = false,
  detail,
}: {
  label?: string;
  collapseLayout?: boolean;
  detail?: string;
}) {
  const content = (
    <div className="flex justify-start" role="status" aria-live="polite">
      <div className="inline-flex items-center gap-1.5 px-1 py-1 text-xs text-dls-secondary">
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            overflow: "hidden",
          }}
        >
          <PaperGrainGradient
            speed={12}
            softness={0.1}
            intensity={1}
            noise={0.05}
            shape="sphere"
            colors={["#818cf8", "#fb7185", "#fbbf24", "#34d399"]}
            colorBack="#ffffff00"
            style={{
              backgroundColor: "#818cf8",
              width: "100%",
              height: "100%",
              borderRadius: "50%",
            }}
          />
        </div>
        <span>{label}</span>
        {detail ? <span className="text-dls-text-tertiary">{detail}</span> : null}
      </div>
    </div>
  );

  if (collapseLayout) {
    return <div>{content}</div>;
  }

  return content;
}

export function AssistantNoVisibleOutputCard(props: { text: string }) {
  return (
    <div
      className={sessionSurfaceTextClass.noVisibleOutput}
      role="status"
      aria-live="polite"
    >
      <div className="max-w-3xl">
        {props.text || t("session.assistant_empty_response")}
      </div>
    </div>
  );
}

export function AssistantStatusSpacer() {
  return (
    <div className="invisible" aria-hidden="true">
      <AssistantWaitingCard
        label={t("session.assistant_responding")}
        collapseLayout
      />
    </div>
  );
}

// ============================================================================
// Todo Panel
// ============================================================================

export function TodoPanel(props: { todos: TodoItem[] }) {
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
                      <span className={sessionSurfaceStateClass.todoActiveDot} />
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

// ============================================================================
// Plan Approval Panel
// ============================================================================

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
                        <span
                          className={sessionSurfaceStateClass.todoActiveDot}
                        />
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

// ============================================================================
// Goal Runtime Panel
// ============================================================================

export function GoalRuntimePanel(props: {
  runtime: CollaborationGoalRuntime;
  busy: boolean;
  canPause: boolean;
  canResume: boolean;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const elapsed = formatGoalElapsed(goalElapsedMs(props.runtime, now));

  useEffect(() => {
    if (
      props.runtime.status === "paused" ||
      props.runtime.status === "completed" ||
      props.runtime.waitingReason === "user"
    ) {
      setNow(Date.now());
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), GOAL_RUNTIME_TICK_MS);
    return () => window.clearInterval(id);
  }, [props.runtime.status]);

  const objective = props.runtime.objective.slice(0, 80);

  return (
    <div className="overflow-hidden border-b border-dls-border bg-transparent">
      <div className="flex items-center gap-3 px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <Goal
            size={14}
            strokeWidth={1.8}
            className="shrink-0 text-dls-secondary"
          />
          <span className="shrink-0 font-medium text-dls-text">
            {t("session.goal_runtime_active")}
          </span>
          <span
            className="min-w-0 truncate text-dls-secondary"
            title={objective}
          >
            {objective || t("session.goal_runtime_untitled")}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-dls-secondary">
            <Clock3 size={12} />
            {t("session.goal_runtime_elapsed", { duration: elapsed })}
          </span>
          {props.canResume ? (
            <Button
              type="button"
              size="icon-xs"
              onClick={props.onResume}
              disabled={props.busy}
              aria-label={t("session.goal_runtime_resume")}
              title={t("session.goal_runtime_resume")}
            >
              <Play size={14} />
            </Button>
          ) : null}
          {props.canPause ? (
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              onClick={props.onPause}
              aria-label={t("session.goal_runtime_pause")}
              title={t("session.goal_runtime_pause")}
            >
              <Pause size={14} />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={props.onClear}
            aria-label={t("session.goal_runtime_clear")}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Personal Assistant Components
// ============================================================================

export function PersonalAssistantHero() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 pb-6 pt-14 text-center">
      <img
        src={resolvePublicAssetUrl(ONMYAGENT_ASSISTANT_AVATAR)}
        alt=""
        className="size-36 rounded-xl object-cover"
        draggable={false}
      />
      <h2 className={sessionSurfaceTextClass.assistantHeroTitle}>
        {t("session.assistant_intro")}
      </h2>
    </div>
  );
}

export function AssistantScenarioPill(props: {
  scenario: AssistantScenario;
  active?: boolean;
  onClick: () => void;
}) {
  const Icon = props.scenario.icon;
  return (
    <Button
      type="button"
      variant={props.active ? "default" : "outline"}
      size="sm"
      onClick={props.onClick}
      className={cn(
        "h-8 shrink-0 rounded-lg text-xs",
        props.active
          ? "text-dls-accent-foreground"
          : "text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
      )}
    >
      <Icon className="size-3.5" />
      <span className="whitespace-nowrap">{props.scenario.label}</span>
    </Button>
  );
}

export function PersonalAssistantAccessory(props: {
  categoryId: AssistantCategoryId;
  selectedScenario: AssistantScenario | null;
  showPrompts: boolean;
  onSelectScenario: (scenario: AssistantScenario) => void;
  onSelectPrompt: (prompt: string) => void;
}) {
  const category =
    PERSONAL_ASSISTANT_CATEGORIES.find(
      (item) => item.id === props.categoryId,
    ) ?? PERSONAL_ASSISTANT_CATEGORIES[1];
  const prompts = props.selectedScenario?.prompts ?? [];

  return (
    <div className="px-1 pt-2">
      {!props.selectedScenario ? (
        <div className="flex justify-center gap-2 px-0 pt-0">
          {category.scenarios.slice(0, 4).map((scenario) => (
            <AssistantScenarioPill
              key={scenario.id}
              scenario={scenario}
              onClick={() => props.onSelectScenario(scenario)}
            />
          ))}
        </div>
      ) : null}
      {props.selectedScenario && props.showPrompts ? (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {prompts.slice(0, 6).map((prompt) => (
            <ActionRowButton
              density="compact"
              key={prompt}
              type="button"
              onClick={() => props.onSelectPrompt(prompt)}
              className="w-auto items-center gap-1.5 rounded-lg border-transparent bg-dls-surface-muted px-3 py-2 text-xs leading-4 text-dls-text hover:border-transparent hover:bg-dls-hover"
            >
              <span className="max-w-56 truncate">{prompt}</span>
              <span className="shrink-0 text-dls-text">↗</span>
            </ActionRowButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ============================================================================
// Error Components
// ============================================================================

export function SessionErrorCard({
  error,
  onDismiss,
  onChangeModel,
  onOpenModelPicker,
}: {
  error: { message: string; kind?: string; suggestions?: Array<{ providerID: string; modelID: string }> };
  onDismiss: () => void;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
  onOpenModelPicker?: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-3 py-3 sm:px-5">
      <div className={sessionSurfaceStateClass.errorPanel}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className={sessionSurfaceStateClass.errorText}>
              {error.message}
            </div>
            {error.kind === "model-not-found" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {error.suggestions && error.suggestions.length > 0
                  ? error.suggestions.map((s) => (
                      <Button
                        key={`${s.providerID}/${s.modelID}`}
                        type="button"
                        variant="outline"
                        size="xs"
                        className="rounded-full text-dls-text hover:bg-dls-hover"
                        onClick={() => {
                          onChangeModel?.(s);
                          onDismiss();
                        }}
                      >
                        Use {s.providerID}/{s.modelID}
                      </Button>
                    ))
                  : null}
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="rounded-full text-dls-text hover:bg-dls-hover"
                  onClick={() => {
                    onOpenModelPicker?.();
                    onDismiss();
                  }}
                >
                  Change model
                </Button>
              </div>
            ) : null}
          </div>
          <Button variant="ghost" size="icon-xs"
            type="button"
            className={sessionSurfaceStateClass.errorDismiss}
            onClick={onDismiss}
            aria-label={t("session.dismiss_error")}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3.5 3.5l7 7M10.5 3.5l-7 7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export { sessionSurfaceTextClass, sessionSurfaceStateClass };