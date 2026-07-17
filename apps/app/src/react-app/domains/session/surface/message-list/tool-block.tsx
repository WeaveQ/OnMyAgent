/** @jsxImportSource react */
/** Tool call / step cluster presentation for the session transcript. */
import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import {
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  File as FileIcon,
  Folder,
  HelpCircle,
  Search,
  Terminal,
} from "lucide-react";

import { openDesktopPath } from "../../../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { DisclosureRowButton } from "@/components/ui/action-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { MessageRolePrefix, MessageRoleRow } from "@/components/ui/message-role";
import { currentLocale, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { summarizeStep } from "../../../../../app/utils";
import {
  ConversationItemView,
  mapOpenCodeReasoningPartToItem,
  mapOpenCodeToolPartToItem,
} from "../../../../capabilities/conversation";
import { usePlatform } from "../../../../kernel/platform";
import { MarkdownBlock } from "../markdown";
import {
  ImageGenerationToolCard,
  SpecializedToolDetails,
  specializedToolCanExpand,
  specializedToolHeadline,
} from "../specialized-tool-details";
import { normalizeTranscriptQuestionAnswers } from "../transcript/question-answer";
import {
  buildTranscriptToolPresentation,
  type TranscriptTodoItem,
} from "../transcript/tool-presentation";
import type { TurnProcessItem } from "../transcript/turn-content";
import type { StepTimelineGroup, TranscriptPart } from "./types";
import { messageTextClass, messageStateClass } from "./styles";
import {
  formatStructuredValue,
  hasStructuredValue,
  isRecordValue,
  isRunningStepStatus,
  recordValue,
  summarizeStepCluster,
  toLegacyPart,
  toolStatusText,
  shouldFoldStepGroups,
} from "./shared";

export function ToolActivityIcon(props: { category?: string }) {
  const className = "size-4 shrink-0 text-dls-secondary";
  switch (props.category) {
    case "terminal":
      return <Terminal className={className} strokeWidth={1.9} />;
    case "read":
    case "edit":
    case "write":
      return <FileIcon className={className} strokeWidth={1.9} />;
    case "glob":
      return <Folder className={className} strokeWidth={1.9} />;
    case "search":
      return <Search className={className} strokeWidth={1.9} />;
    default:
      return <Box className={className} strokeWidth={1.9} />;
  }
}


export function TranscriptReasoning(props: {
  text: string;
  complete: boolean;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const trustedScrollRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || collapsed || props.complete || !autoScrollRef.current) return;
    const nextScrollTop = Math.max(0, content.scrollHeight - content.clientHeight);
    if (Math.abs(content.scrollTop - nextScrollTop) <= 1) {
      trustedScrollRef.current = false;
      lastScrollTopRef.current = content.scrollTop;
      return;
    }
    trustedScrollRef.current = true;
    content.scrollTo({ top: nextScrollTop, behavior: "auto" });
  }, [collapsed, props.complete, props.text]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const currentScrollTop = target.scrollTop;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (trustedScrollRef.current) {
      trustedScrollRef.current = false;
      lastScrollTopRef.current = currentScrollTop;
      return;
    }
    const scrollingUp = currentScrollTop < lastScrollTopRef.current;
    if (!scrollingUp && Math.abs(distanceFromBottom) < 10) {
      autoScrollRef.current = true;
    } else if (scrollingUp && distanceFromBottom > 20) {
      autoScrollRef.current = false;
    }
    lastScrollTopRef.current = currentScrollTop;
  };

  return (
    <section
      data-reasoning="true"
      data-reasoning-state={props.complete ? "complete" : "streaming"}
      className="flex max-w-[760px] flex-col gap-0.5 py-0.5 text-dls-secondary"
    >
      <DisclosureRowButton
        type="button"
        density="flush"
        aria-expanded={!collapsed}
        className="gap-1 text-sm leading-6 text-dls-secondary hover:bg-transparent hover:text-dls-text"
        onClick={() => setCollapsed((current) => !current)}
      >
        <MessageRolePrefix role="thinking" />
        <span className={cn(!props.complete && "session-transcript-loading-shimmer")}>
          {t("session.reasoning")}
        </span>
        {props.complete ? (
          <ChevronDown
            size={12}
            className={cn(
              "transition-transform",
              collapsed && "-rotate-90 opacity-0 group-hover:opacity-100",
            )}
          />
        ) : null}
      </DisclosureRowButton>
      <MessageRoleRow
        role="thinking"
        ref={contentRef}
        hidden={collapsed}
        data-scrollable="true"
        onScroll={handleScroll}
        className="max-h-[200px] overflow-x-hidden overflow-y-auto rounded-none bg-transparent py-0.5 pl-3 pr-1 text-dls-text not-italic"
      >
        <MarkdownBlock
          text={props.text}
          streaming={!props.complete}
          showStreamingCursor={false}
          locale={currentLocale()}
        />
      </MessageRoleRow>
    </section>
  );
}


export function StepRow(props: {
  id: string;
  part: TranscriptPart;
  expanded: boolean;
  onToggle: () => void;
  onOpenCodePath?: (path: string) => void;
  isStreamingReasoning: boolean;
}) {
  const platform = usePlatform();
  const summary = useMemo(() => summarizeStep(props.part), [props.part]);
  const toolState = useMemo<Record<string, unknown>>(() => {
    if (props.part.type !== "tool" || !("state" in props.part)) return {};
    return isRecordValue(props.part.state) ? props.part.state : {};
  }, [props.part]);
  const toolInput = isRecordValue(toolState.input) ? toolState.input : undefined;
  const toolOutput = toolState.output;
  const toolMetadata = isRecordValue(toolState.metadata) ? toolState.metadata : undefined;
  const toolError = typeof toolState.error === "string" ? toolState.error : null;
  const toolPresentation = props.part.type === "tool"
    ? buildTranscriptToolPresentation({
        toolName: props.part.tool,
        toolInput,
        toolOutput,
        toolMetadata,
      })
    : null;
  const specializedDetails = toolPresentation?.details ?? null;
  const expandable =
    props.part.type === "tool" &&
    toolPresentation?.family !== "read" &&
    (specializedDetails
      ? specializedToolCanExpand(specializedDetails) || Boolean(toolError)
      : hasStructuredValue(toolInput) || hasStructuredValue(toolOutput) || Boolean(toolError));
  const headline = specializedDetails
    ? specializedToolHeadline(specializedDetails, isRunningStepStatus(summary.status))
    : summary.title?.trim() || t("session.step_progress");
  const statusText = toolStatusText(summary.status);
  const questionAnswers =
    props.part.type === "tool" && props.part.tool.toLowerCase() === "question"
      ? normalizeTranscriptQuestionAnswers(toolInput, toolOutput)
      : [];

  if (questionAnswers.length > 0) {
    return (
      <div className="rounded-lg border border-dls-border bg-dls-surface p-3 text-sm">
        <div className="mb-3 flex items-center gap-2 font-medium text-dls-text">
          <HelpCircle className="size-4 text-dls-accent" />
          <span>{t("session.question_answered")}</span>
        </div>
        <div className="space-y-3">
          {questionAnswers.map((item, index) => (
            <div key={`${item.question}:${index}`} className="space-y-1">
              <div className="text-xs text-dls-secondary">
                {item.header || t("common.question")}
              </div>
              <div className="leading-5 text-dls-text">{item.question}</div>
              <div className="flex flex-wrap items-center gap-1.5 text-sm leading-5">
                <span className="text-dls-secondary">{t("session.question_answer")}</span>
                {item.answers.map((answer) => (
                  <StatusBadge key={answer} size="tiny" shape="soft">
                    {answer}
                  </StatusBadge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (specializedDetails?.kind === "image-gen") {
    return (
      <ImageGenerationToolCard
        details={specializedDetails}
        running={isRunningStepStatus(summary.status)}
        expanded={props.expanded}
        onToggle={props.onToggle}
      />
    );
  }

  if (props.part.type === "reasoning") {
    if (!props.part.text.trim()) return null;
    // Primary path: shared ConversationItemView (ThinkingBlock) for both
    // completed and streaming reasoning. Host-only TranscriptReasoning remains
    // available for specialized auto-scroll chrome when explicitly needed.
    const thinkingItem = mapOpenCodeReasoningPartToItem(
      { type: "reasoning", text: props.part.text },
      { id: props.id, complete: !props.isStreamingReasoning },
    );
    return (
      <ConversationItemView
        item={thinkingItem}
        streaming={Boolean(props.isStreamingReasoning)}
        className="max-w-[760px]"
      />
    );
  }

  const toolStateStatus =
    props.part.type === "tool"
      ? (
        typeof toolState.status === "string"
          ? toolState.status
          : typeof summary.status === "string"
            ? summary.status
            : null
      )
      : null;

  const sharedToolItem = props.part.type === "tool"
    ? mapOpenCodeToolPartToItem(
      {
        type: "tool",
        toolName: props.part.tool,
        tool: props.part.tool,
        toolCallId: props.id,
        state: toolStateStatus ?? undefined,
        input: toolInput,
        output: toolOutput,
      },
      { id: props.id },
    )
    : null;

  // Compact shared tool row for simple tools (no specialized expand UI).
  // Includes non-expandable specialized compact tools except preview-url /
  // open-result which keep host-specific affordances. image-gen returns earlier.
  const specializedBlocksSharedRow =
    specializedDetails != null
    && specializedDetails.kind !== "open-result"
    && !(specializedDetails.kind === "compact-tool" && specializedDetails.variant === "preview-url")
    && !specializedToolCanExpand(specializedDetails)
    && !expandable;

  const useSharedSimpleToolRow =
    props.part.type === "tool"
    && sharedToolItem != null
    && questionAnswers.length === 0
    && (
      (!specializedDetails && !expandable)
      || specializedBlocksSharedRow
    );

  if (useSharedSimpleToolRow && sharedToolItem) {
    return (
      <div className={messageTextClass.body}>
        <ConversationItemView
          item={{
            ...sharedToolItem,
            text: headline,
            toolName: sharedToolItem.toolName,
            meta: {
              ...sharedToolItem.meta,
              description: toolPresentation?.secondary ?? undefined,
            },
          }}
        />
      </div>
    );
  }

  if (
    specializedDetails?.kind === "compact-tool" &&
    specializedDetails.variant === "preview-url" &&
    specializedDetails.summary
  ) {
    return (
      <div className={messageTextClass.body}>
        <div className="inline-flex min-w-0 max-w-[760px] items-center gap-3 text-dls-secondary">
          <ToolActivityIcon category={summary.toolCategory} />
          <span>{headline}</span>
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto min-w-0 justify-start p-0 font-normal"
            title={specializedDetails.summary}
            onClick={() => platform.openLink(specializedDetails.summary ?? "")}
          >
            <span className="truncate">{specializedDetails.summary}</span>
          </Button>
        </div>
      </div>
    );
  }

  if (specializedDetails?.kind === "open-result" && specializedDetails.target) {
    return (
      <div className={messageTextClass.body}>
        <div className="inline-flex min-w-0 max-w-[760px] items-center gap-3 text-dls-secondary">
          <ToolActivityIcon category={summary.toolCategory} />
          <span>{headline}</span>
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto min-w-0 justify-start p-0 font-mono font-normal"
            title={specializedDetails.target}
            onClick={() => {
              if (props.onOpenCodePath) props.onOpenCodePath(specializedDetails.target);
              else void openDesktopPath(specializedDetails.target);
            }}
          >
            <span className="truncate">{specializedDetails.target}</span>
          </Button>
          <StatusBadge size="tiny" shape="soft">{specializedDetails.viewType}</StatusBadge>
        </div>
      </div>
    );
  }

  return (
    <div className={messageTextClass.body}>
      <DisclosureRowButton
        type="button"
        density="flush"
        className="text-dls-secondary hover:bg-transparent hover:text-dls-text disabled:cursor-default"
        aria-expanded={expandable ? props.expanded : undefined}
        disabled={!expandable}
        onClick={() => {
          if (!expandable) return;
          props.onToggle();
        }}
      >
        <span className="inline-flex min-w-0 max-w-[760px] items-center gap-3">
          <ToolActivityIcon category={summary.toolCategory} />
          <span className="min-w-0 flex-1">
            <span className="block wrap-break-word">{headline}</span>
            {toolPresentation?.secondary ? (
              <span
                className="mt-0.5 block truncate font-mono text-xs text-dls-secondary"
                title={toolPresentation.secondary}
              >
                {toolPresentation.secondary}
              </span>
            ) : null}
          </span>
          {toolPresentation?.lineRange ? (
            <StatusBadge size="tiny" shape="soft">
              {toolPresentation.lineRange}
            </StatusBadge>
          ) : null}
          {toolPresentation && toolPresentation.addedLines > 0 ? (
            <span className="text-xs text-dls-status-success-fg">
              +{toolPresentation.addedLines}
            </span>
          ) : null}
          {toolPresentation && toolPresentation.removedLines > 0 ? (
            <span className="text-xs text-dls-status-danger-fg">
              -{toolPresentation.removedLines}
            </span>
          ) : null}
          {expandable ? (
            <ChevronDown
              size={14}
              className={cn(
                "shrink-0 text-dls-secondary transition-transform",
                !props.expanded && "-rotate-90",
              )}
            />
          ) : null}
        </span>
      </DisclosureRowButton>
      {statusText ? <div className={messageTextClass.toolStatus}>{statusText}</div> : null}
      {props.expanded ? (
        <div className="mt-3 ml-7 space-y-3">
          {specializedDetails ? (
            <SpecializedToolDetails
              details={specializedDetails}
              onOpenCodePath={props.onOpenCodePath}
            />
          ) : null}
          {!specializedDetails && hasStructuredValue(toolInput) && (
            toolPresentation?.family === "generic" ||
            toolPresentation?.family === "write"
          ) ? (
            <div>
              <div className={messageTextClass.toolLabel}>{t("session.tool_request")}</div>
              <pre className="overflow-x-auto rounded-xl border border-dls-mist bg-dls-surface px-4 py-3 text-xs leading-6 text-dls-secondary">
                {formatStructuredValue(toolInput)}
              </pre>
            </div>
          ) : null}
          {!specializedDetails && hasStructuredValue(toolOutput) ? (
            <div>
              <div className={messageTextClass.toolLabel}>{t("session.tool_result")}</div>
              <pre className="overflow-x-auto rounded-xl border border-dls-mist bg-dls-surface px-4 py-3 text-xs leading-6 text-dls-secondary">
                {formatStructuredValue(toolOutput)}
              </pre>
            </div>
          ) : null}
          {toolError ? (
            <div>
              <div className={messageTextClass.toolLabel}>{t("session.tool_error")}</div>
              <pre className={messageStateClass.toolError}>
                {toolError}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}


function processItemToLegacyPart(item: TurnProcessItem) {
  return toLegacyPart(item.part, `${item.messageId}:${item.partIndex}`);
}

function processPlanDetails(items: TurnProcessItem[]) {
  for (const item of items) {
    const part = processItemToLegacyPart(item);
    if (!part || part.type !== "tool") continue;
    const state = recordValue(part.state);
    const presentation = buildTranscriptToolPresentation({
      toolName: part.tool,
      toolInput: recordValue(state?.input) ?? undefined,
      toolOutput: state?.output,
      toolMetadata: recordValue(state?.metadata) ?? undefined,
    });
    if (presentation.details?.kind === "plan") return presentation.details;
  }
  return null;
}

function processFoldLabel(items: TurnProcessItem[]) {
  if (processPlanDetails(items)) return t("session.workbuddy_task_list");
  const legacyParts = items.flatMap((item) => {
    const part = processItemToLegacyPart(item);
    return part ? [part] : [];
  });
  if (legacyParts.length > 0 && legacyParts.every((part) => part.type === "reasoning")) {
    return t("session.process_summary_deep_thinking");
  }
  const toolNames = legacyParts.flatMap((part) => (
    part.type === "tool" ? [part.tool.toLowerCase()] : []
  ));
  if (toolNames.some((name) => (
    name.includes("search") || name.includes("fetch") || name.includes("browser") || name.includes("web")
  ))) {
    return t("session.process_summary_collecting_sources");
  }
  const terminalCount = toolNames.filter((name) => (
    name === "bash" || name.includes("command") || name.includes("terminal") || name === "shell"
  )).length;
  if (terminalCount > 0) {
    return t("session.process_summary_ran_commands", { count: terminalCount });
  }
  const editCount = toolNames.filter((name) => (
    name.includes("write") || name.includes("edit") || name.includes("patch") || name.includes("replace")
  )).length;
  if (editCount > 0) return t("session.process_summary_edited", { count: editCount });
  const readCount = toolNames.filter((name) => (
    name.includes("read") || name.includes("glob") || name.includes("list")
  )).length;
  if (readCount > 0) return t("session.process_summary_reviewed_files", { count: readCount });
  if (legacyParts.length > 0) {
    const summary = summarizeStepCluster([{
      id: `turn-process:${items[0]?.messageId ?? "unknown"}`,
      parts: legacyParts,
      mode: "standalone",
    }]);
    if (summary.category !== "tool") return summary.label;
  }
  return t("session.process_summary_continue_processing");
}

export function WorkBuddyTaskList(props: {
  todos: TranscriptTodoItem[];
  running: boolean;
}) {
  const [displayRunning, setDisplayRunning] = useState(() => props.running);
  const [expanded, setExpanded] = useState(() => props.running);
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
  onOpenCodePath?: (path: string) => void;
}) {
  const plan = processPlanDetails(props.items);
  const [expanded, setExpanded] = useState(false);
  if (plan) return <WorkBuddyTaskList todos={plan.todos} running={props.running} />;

  const toggleStep = (id: string) => {
    props.onExpandedStepIdsChange((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section className={cn("session-workbuddy-process-fold", expanded && "is-expanded")}>
      <button
        type="button"
        className="session-workbuddy-process-head"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>{processFoldLabel(props.items)}</span>
        <ChevronDown aria-hidden="true" className="session-workbuddy-process-arrow" />
      </button>
      {expanded ? (
        <div className="session-workbuddy-process-body" data-scrollable="true">
          {props.items.map((item) => {
            const key = `${item.messageId}:${item.partIndex}`;
            if (item.part.type === "reasoning") {
              if (!item.part.text.trim()) return null;
              // Streaming keeps markdown stream; completed folds use shared thinking VM.
              if (props.running) {
                return (
                  <MarkdownBlock
                    key={key}
                    text={item.part.text}
                    streaming
                    showStreamingCursor={false}
                    locale={currentLocale()}
                  />
                );
              }
              const thinkingItem = mapOpenCodeReasoningPartToItem(
                { type: "reasoning", text: item.part.text },
                { id: key, complete: true },
              );
              return <ConversationItemView key={key} item={thinkingItem} />;
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
                isStreamingReasoning={props.running}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export function StepsContainer(props: {
  stepGroups: StepTimelineGroup[];
  isUser: boolean;
  isInline?: boolean;
  isNestedVariant: boolean;
  isActive: boolean;
  expandedStepIds: Set<string>;
  onExpandedStepIdsChange: (updater: (current: Set<string>) => Set<string>) => void;
  turnDetailsExpanded?: boolean;
  onTurnDetailsExpandedChange?: (expanded: boolean) => void;
  onOpenCodePath?: (path: string) => void;
  isTrailingMessageContent?: boolean;
}) {
  const toggleSteps = (id: string) => {
    props.onExpandedStepIdsChange((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const shouldFold = shouldFoldStepGroups(props.stepGroups);
  const active = props.isActive;
  const [containerExpanded, setContainerExpanded] = useState(active);
  const detailsExpanded = props.turnDetailsExpanded === true || containerExpanded;
  const toggleContainer = () => {
    if (props.onTurnDetailsExpandedChange) {
      props.onTurnDetailsExpandedChange(!detailsExpanded);
      return;
    }
    setContainerExpanded((value) => !value);
  };
  const stepSummaries = useMemo(
    () =>
      props.stepGroups.flatMap((group) =>
        group.parts.map((part) => summarizeStep(part).title?.trim()).filter(Boolean),
      ),
    [props.stepGroups],
  );
  const clusterSummary = useMemo(
    () => summarizeStepCluster(props.stepGroups),
    [props.stepGroups],
  );
  const previewItems = stepSummaries.slice(0, 2);

  if (!shouldFold) {
    return (
      <div className="max-w-[760px]">
        <div className="flex flex-col gap-5">
          {props.stepGroups.map((group, groupIndex) => (
            <div key={group.id} className="flex flex-col gap-5">
              {group.parts.map((part, index) => {
                const rowId = `${group.id}:${index}`;
                const isLastPartInGroup = index === group.parts.length - 1;
                const isLastStepGroup = groupIndex === props.stepGroups.length - 1;
                return (
                  <StepRow
                    key={rowId}
                    id={rowId}
                    part={part}
                    expanded={props.expandedStepIds.has(rowId)}
                    onToggle={() => toggleSteps(rowId)}
                    onOpenCodePath={props.onOpenCodePath}
                    isStreamingReasoning={
                      props.isActive &&
                      props.isTrailingMessageContent !== false &&
                      isLastStepGroup &&
                      isLastPartInGroup
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[760px] rounded-xl border border-dls-mist bg-dls-surface-muted">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-dls-secondary transition-colors hover:bg-dls-surface-muted hover:text-dls-text"
        aria-expanded={detailsExpanded}
        onClick={toggleContainer}
      >
        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-dls-secondary transition-transform",
            !detailsExpanded && "-rotate-90",
          )}
        />
        <ToolActivityIcon category={clusterSummary.category} />
        <span className="font-medium text-dls-text">{clusterSummary.label}</span>
        {active ? (
          <StatusBadge tone="accent" size="tiny">
            {t("session.status_running")}
          </StatusBadge>
        ) : null}
      </button>
      {!detailsExpanded && previewItems.length > 0 ? (
        <div className="border-t border-dls-mist px-3 py-2 text-xs leading-5 text-dls-secondary">
          {previewItems.map((item) => (
            <div key={item} className="truncate">
              {item}
            </div>
          ))}
        </div>
      ) : null}
      {detailsExpanded ? (
        <div
          data-scrollable={!props.isNestedVariant ? "true" : undefined}
          className={cn(
            "border-t border-dls-mist px-3 py-3",
            !props.isNestedVariant && "max-h-[520px] overflow-y-auto pr-3",
          )}
        >
          <div className="flex flex-col gap-5">
            {props.stepGroups.map((group, groupIndex) => (
              <div key={group.id} className="flex flex-col gap-5">
                {group.parts.map((part, index) => {
                  const rowId = `${group.id}:${index}`;
                  const isLastPartInGroup = index === group.parts.length - 1;
                  const isLastStepGroup = groupIndex === props.stepGroups.length - 1;
                  return (
                    <StepRow
                      key={rowId}
                      id={rowId}
                      part={part}
                      expanded={props.expandedStepIds.has(rowId)}
                      onToggle={() => toggleSteps(rowId)}
                      onOpenCodePath={props.onOpenCodePath}
                      isStreamingReasoning={
                        props.isActive &&
                        props.isTrailingMessageContent !== false &&
                        isLastStepGroup &&
                        isLastPartInGroup
                      }
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

