/** @jsxImportSource react */
import { useMemo } from "react";
import {
  ChevronDown,
  HelpCircle,
} from "lucide-react";

import {
  openDesktopPath,
} from "../../../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { DisclosureRowButton } from "@/components/ui/action-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { summarizeStep } from "../../../../../app/utils";
import { usePlatform } from "../../../../kernel/platform";
import { type MarkdownCodePathOpenMode } from "../markdown";
import {
  ImageGenerationToolCard,
  SpecializedToolDetails,
  VisualizerReadMeToolRow,
  specializedToolCanExpand,
  specializedToolHeadline,
} from "../specialized-tool-details";
import { normalizeTranscriptQuestionAnswers } from "../transcript/question-answer";
import { buildTranscriptToolPresentation } from "../transcript/tool-presentation";
import {
  messageStateClass,
  messageTextClass,
} from "./styles";
import type { TranscriptPart } from "./types";
import {
  formatStructuredValue,
  hasStructuredValue,
  isRecordValue,
} from "./parts";
import { isRunningStepStatus } from "./step-cluster";
import { TranscriptReasoning } from "./reasoning";
import { ToolActivityIcon, toolStatusText } from "./tool-activity-icon";

export function StepRow(props: {
  id: string;
  part: TranscriptPart;
  expanded: boolean;
  onToggle: () => void;
  onOpenCodePath?: (path: string, mode?: MarkdownCodePathOpenMode) => void;
  isStreamingReasoning: boolean;
  headlineOverride?: string;
  categoryOverride?: string;
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
  const headline = props.headlineOverride ?? (specializedDetails
    ? specializedToolHeadline(specializedDetails, isRunningStepStatus(summary.status))
    : summary.title?.trim() || t("session.step_progress"));
  const iconCategory = props.categoryOverride ?? summary.toolCategory;
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

  if (specializedDetails?.kind === "visualizer-read-me") {
    return (
      <VisualizerReadMeToolRow
        details={specializedDetails}
        running={isRunningStepStatus(summary.status)}
        expanded={props.expanded}
        onToggle={props.onToggle}
      />
    );
  }

  if (props.part.type === "reasoning") {
    if (!props.part.text.trim()) return null;
    return (
      <TranscriptReasoning
        text={props.part.text}
        complete={!props.isStreamingReasoning}
      />
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
          <ToolActivityIcon category={iconCategory} />
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
          <ToolActivityIcon category={iconCategory} />
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
          <ToolActivityIcon category={iconCategory} />
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
