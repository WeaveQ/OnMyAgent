/** @jsxImportSource react */
import { currentLocale, t } from "@/i18n";
import { MarkdownBlock, type MarkdownCodePathOpenMode, type MarkdownVerifiedCodePath } from "../markdown";
import { InlineVisual } from "../transcript/inline-visual";
import {
  type TurnContentSegment,
  type TurnContentPresentation,
  type TurnFoldSegment,
  type TurnProcessItem,
} from "../transcript/turn-content";
import { FileCard } from "./file-card";
import {
  processFoldChipMeta,
  processItemToLegacyPart,
  processPlanDetails,
  shouldUseSemanticProcessFold,
} from "./process-fold";
import { WorkBuddyProcessFold } from "./process-fold-ui";
import { StepRow } from "./step-row";

export function WorkBuddyTurnContent(props: {
  presentation: TurnContentPresentation;
  detailsExpanded: boolean;
  expandedStepIds: Set<string>;
  onExpandedStepIdsChange: (updater: (current: Set<string>) => Set<string>) => void;
  onOpenCodePath?: (path: string, mode?: MarkdownCodePathOpenMode) => void;
  highlightQuery?: string;
  verifiedCodePaths?: readonly MarkdownVerifiedCodePath[];
}) {
  const running = props.presentation.state === "streaming" ||
    props.presentation.state === "awaiting-approval";
  const showExpandedProcess = !props.presentation.turnCollapseEligible ||
    props.detailsExpanded;
  const lastBodyId = props.presentation.segments.findLast(
    (segment) => segment.kind === "body",
  )?.id;

  const toggleStep = (id: string) => {
    props.onExpandedStepIdsChange((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderSingletonProcess = (
    id: string,
    item: TurnProcessItem,
    processRunning: boolean,
  ) => {
    const legacyPart = processItemToLegacyPart(item);
    if (item.part.type === "reasoning" || processPlanDetails([item])) {
      return (
        <WorkBuddyProcessFold
          key={id}
          id={id}
          items={[item]}
          running={processRunning}
          expandedStepIds={props.expandedStepIds}
          onExpandedStepIdsChange={props.onExpandedStepIdsChange}
          onOpenCodePath={props.onOpenCodePath}
        />
      );
    }
    if (!legacyPart) return null;
    const semanticMeta = shouldUseSemanticProcessFold(legacyPart)
      ? processFoldChipMeta([item], processRunning)
      : null;
    const stepId = `${item.messageId}:${item.partIndex}`;
    return (
      <StepRow
        key={id}
        id={stepId}
        part={legacyPart}
        expanded={props.expandedStepIds.has(stepId)}
        onToggle={() => toggleStep(stepId)}
        onOpenCodePath={props.onOpenCodePath}
        isStreamingReasoning={processRunning}
        headlineOverride={semanticMeta?.label}
        categoryOverride={semanticMeta?.category}
      />
    );
  };

  const renderProcess = (id: string, items: TurnProcessItem[]) => {
    const processRunning = running && items.some(
      (item) => item.messageId === props.presentation.streamingMessageId,
    );
    const item = items[0];
    if (items.length === 1 && item) {
      return renderSingletonProcess(id, item, processRunning);
    }
    return (
      <WorkBuddyProcessFold
        key={id}
        id={id}
        items={items}
        running={processRunning}
        expandedStepIds={props.expandedStepIds}
        onExpandedStepIdsChange={props.onExpandedStepIdsChange}
        onOpenCodePath={props.onOpenCodePath}
      />
    );
  };

  const renderExpandedSegment = (segment: TurnContentSegment) => {
    if (segment.kind === "process") return renderProcess(segment.id, segment.items);
    if (segment.kind === "synthetic-body") {
      return (
        <div key={segment.id} className="session-workbuddy-turn-body">
          <MarkdownBlock
            text={t(segment.messageKey)}
            streaming={false}
            showStreamingCursor={false}
            highlightQuery={props.highlightQuery}
            locale={currentLocale()}
            onOpenCodePath={props.onOpenCodePath}
            verifiedCodePaths={props.verifiedCodePaths}
          />
        </div>
      );
    }
    if (segment.kind === "widget") {
      return (
        <InlineVisual
          key={segment.id}
          visual={segment.visual}
          onOpenCodePath={props.onOpenCodePath}
        />
      );
    }
    if (segment.kind === "file" && segment.item.part.type === "file") {
      return (
        <FileCard
          key={segment.id}
          part={{
            filename: segment.item.part.filename,
            url: segment.item.part.url,
            mediaType: segment.item.part.mediaType,
          }}
          tone="assistant"
        />
      );
    }
    if (segment.kind !== "body") return null;
    if (segment.item.bodySegments) {
      return (
        <div key={segment.id} className="session-workbuddy-turn-body">
          {segment.item.bodySegments.map((bodySegment, index) => (
            bodySegment.kind === "widget"
              ? (
                  <InlineVisual
                    key={`${segment.id}:widget:${index}`}
                    visual={bodySegment.visual}
                    onOpenCodePath={props.onOpenCodePath}
                  />
                )
              : bodySegment.text.trim()
                ? (
                    <MarkdownBlock
                      key={`${segment.id}:text:${index}`}
                      text={bodySegment.text}
                      streaming={running && segment.id === lastBodyId}
                      showStreamingCursor={false}
                      highlightQuery={props.highlightQuery}
                      locale={currentLocale()}
                      onOpenCodePath={props.onOpenCodePath}
                      verifiedCodePaths={props.verifiedCodePaths}
                    />
                  )
                : null
          ))}
        </div>
      );
    }
    return (
      <div key={segment.id} className="session-workbuddy-turn-body">
        <MarkdownBlock
          text={segment.text}
          streaming={running && segment.id === lastBodyId}
          showStreamingCursor={false}
          highlightQuery={props.highlightQuery}
          locale={currentLocale()}
          onOpenCodePath={props.onOpenCodePath}
          verifiedCodePaths={props.verifiedCodePaths}
        />
      </div>
    );
  };

  const renderCollapsedSegment = (segment: TurnFoldSegment) => {
    if (segment.kind === "hidden") return null;
    if (segment.kind === "process") return renderProcess(segment.id, segment.items);
    if (segment.item.bodySegments) {
      return (
        <div key={segment.id} className="session-workbuddy-turn-body">
          {segment.item.bodySegments.map((bodySegment, index) => (
            bodySegment.kind === "widget"
              ? (
                  <InlineVisual
                    key={`${segment.id}:widget:${index}`}
                    visual={bodySegment.visual}
                    onOpenCodePath={props.onOpenCodePath}
                  />
                )
              : bodySegment.text.trim()
                ? (
                    <MarkdownBlock
                      key={`${segment.id}:text:${index}`}
                      text={bodySegment.text}
                      highlightQuery={props.highlightQuery}
                      locale={currentLocale()}
                      onOpenCodePath={props.onOpenCodePath}
                      verifiedCodePaths={props.verifiedCodePaths}
                    />
                  )
                : null
          ))}
        </div>
      );
    }
    return (
      <div key={segment.id} className="session-workbuddy-turn-body">
        <MarkdownBlock
          text={segment.text}
          highlightQuery={props.highlightQuery}
          locale={currentLocale()}
          onOpenCodePath={props.onOpenCodePath}
          verifiedCodePaths={props.verifiedCodePaths}
        />
      </div>
    );
  };

  return (
    <div className="session-workbuddy-turn-content" data-workbuddy-turn-content="true">
      {showExpandedProcess
        ? props.presentation.segments.map(renderExpandedSegment)
        : props.presentation.collapsedSegments.map(renderCollapsedSegment)}
      {!showExpandedProcess
        ? props.presentation.hoistedItems.map((visual) => (
            <InlineVisual
              key={`${visual.messageId}:${visual.partIndex}:${visual.toolName}`}
              visual={visual}
              onOpenCodePath={props.onOpenCodePath}
            />
          ))
        : null}
    </div>
  );
}
