/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Terminal,
} from "lucide-react";

import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { currentLocale, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { MarkdownBlock, type MarkdownCodePathOpenMode } from "../markdown";
import type { TranscriptTodoItem } from "../transcript/tool-presentation";
import type { TurnProcessItem } from "../transcript/turn-content";
import {
  processFoldChipMeta,
  processItemToLegacyPart,
  processPlanDetails,
  shouldDefaultExpandProcessFold,
} from "./process-fold";
import { StepRow } from "./step-row";
import { ToolActivityIcon } from "./tool-activity-icon";

export function WorkBuddyTaskList(props: {
  todos: TranscriptTodoItem[];
  running: boolean;
}) {
  const [displayRunning, setDisplayRunning] = useState(() => props.running);
  const [expanded, setExpanded] = useState(() =>
    shouldDefaultExpandProcessFold({
      isPlanList: true,
      running: props.running,
    }),
  );
  const previousRunningRef = useRef(props.running);
  const taskHistoryRef = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    if (props.running) {
      setDisplayRunning(true);
      return;
    }
    const timeout = window.setTimeout(() => setDisplayRunning(false), 1_000);
    return () => window.clearTimeout(timeout);
  }, [props.running]);
  useEffect(() => {
    const wasRunning = previousRunningRef.current;
    previousRunningRef.current = displayRunning;
    if (!wasRunning && displayRunning) setExpanded(true);
    if (wasRunning && !displayRunning) setExpanded(false);
  }, [displayRunning]);

  const todos = props.todos.map((todo, index) => {
    const content = (
      todo.status === "in_progress" && todo.activeForm
        ? todo.activeForm
        : todo.content
    ).trim();
    if (content) taskHistoryRef.current.set(index, content);
    return { ...todo, content: content || taskHistoryRef.current.get(index) || `Task ${index + 1}` };
  });

  return (
    <div className="session-workbuddy-task-list" data-workbuddy-task-list="true">
      <button
        type="button"
        className="session-workbuddy-task-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Terminal aria-hidden="true" />
        <span>{t("session.workbuddy_task_list")}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn("session-workbuddy-task-chevron", expanded && "is-expanded")}
        />
      </button>
      {expanded && todos.length > 0 ? (
        <div className="session-workbuddy-task-detail">
          {todos.map((todo, index) => (
            <div
              key={`task-${index}`}
              className={cn(
                "session-workbuddy-task-item",
                todo.status === "in_progress" && "is-running",
                todo.status === "completed" && "is-completed",
              )}
            >
              <span className="session-workbuddy-task-icon" aria-hidden="true">
                {todo.status === "completed" ? <Check /> : null}
                {todo.status === "in_progress" ? <LoadingSpinner /> : null}
                {todo.status === "cancelled" ? <CircleAlert /> : null}
                {todo.status === "pending" ? <span className="session-workbuddy-task-pending" /> : null}
              </span>
              <span className="session-workbuddy-task-text">{todo.content}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkBuddyProcessFold(props: {
  id: string;
  items: TurnProcessItem[];
  running: boolean;
  expandedStepIds: Set<string>;
  onExpandedStepIdsChange: (updater: (current: Set<string>) => Set<string>) => void;
  onOpenCodePath?: (path: string, mode?: MarkdownCodePathOpenMode) => void;
}) {
  const plan = processPlanDetails(props.items);
  const [expanded, setExpanded] = useState(() =>
    shouldDefaultExpandProcessFold({
      isPlanList: false,
      running: props.running,
    }),
  );
  if (plan) {
    return (
      <WorkBuddyTaskList
        todos={plan.todos}
        running={props.running}
      />
    );
  }

  const chip = processFoldChipMeta(props.items, props.running);
  const isThinking = chip.variant === "thinking";
  const isToolChip = chip.variant === "tool-chip";

  const toggleStep = (id: string) => {
    props.onExpandedStepIdsChange((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section
      className={cn(
        "session-workbuddy-process-fold",
        expanded && "is-expanded",
        isToolChip && "is-tool-chip",
        isThinking && "is-thinking",
        chip.variant === "summary" && "is-summary",
      )}
      data-process-variant={chip.variant}
    >
      <button
        type="button"
        className={cn(
          "session-workbuddy-process-head",
          isToolChip && "session-workbuddy-process-head-chip",
          isThinking && "session-workbuddy-process-head-thinking",
          chip.variant === "summary" && "session-workbuddy-process-head-chip",
        )}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {isThinking ? null : (
          <span className="session-workbuddy-process-icon-wrap" aria-hidden="true">
            <ToolActivityIcon category={chip.category} />
          </span>
        )}
        <span
          className={cn(
            isThinking && chip.running && "session-transcript-loading-shimmer",
          )}
        >
          {chip.label}
        </span>
        <ChevronDown aria-hidden="true" className="session-workbuddy-process-arrow" />
      </button>
      {expanded ? (
        <div className="session-workbuddy-process-body" data-scrollable="true">
          {props.items.map((item) => {
            const key = `${item.messageId}:${item.partIndex}`;
            if (item.part.type === "reasoning") {
              if (!item.part.text.trim()) return null;
              if (props.items.length > 1) {
                return (
                  <WorkBuddyProcessFold
                    key={key}
                    id={`${props.id}:${key}`}
                    items={[item]}
                    running={chip.running}
                    expandedStepIds={props.expandedStepIds}
                    onExpandedStepIdsChange={props.onExpandedStepIdsChange}
                    onOpenCodePath={props.onOpenCodePath}
                  />
                );
              }
              return (
                <MarkdownBlock
                  key={key}
                  text={item.part.text}
                  streaming={chip.running}
                  showStreamingCursor={false}
                  locale={currentLocale()}
                />
              );
            }
            const legacyPart = processItemToLegacyPart(item);
            if (!legacyPart) return null;
            return (
              <StepRow
                key={key}
                id={key}
                part={legacyPart}
                expanded={props.expandedStepIds.has(key)}
                onToggle={() => toggleStep(key)}
                onOpenCodePath={props.onOpenCodePath}
                isStreamingReasoning={chip.running}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
