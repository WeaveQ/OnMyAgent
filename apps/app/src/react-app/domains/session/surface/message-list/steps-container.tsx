/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { summarizeStep } from "../../../../../app/utils";
import { type MarkdownCodePathOpenMode } from "../markdown";
import { shouldFoldStepGroups } from "./block-model";
import type { StepTimelineGroup } from "./types";
import {
  clusterStepTimelineParts,
  flattenStepTimelineParts,
  summarizeStepCluster,
} from "./step-cluster";
import { StepRow } from "./step-row";
import { TaskSetBlock, toTaskSetRowModels } from "./task-set-block";
import { ToolActivityIcon } from "./tool-activity-icon";

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
  onOpenCodePath?: (path: string, mode?: MarkdownCodePathOpenMode) => void;
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
  const stepEntries = useMemo(
    () => flattenStepTimelineParts(props.stepGroups),
    [props.stepGroups],
  );
  const stepClusters = useMemo(
    () => clusterStepTimelineParts(stepEntries),
    [stepEntries],
  );
  const lastStepId = stepEntries.at(-1)?.id;
  const streamLast =
    props.isActive && props.isTrailingMessageContent !== false;
  const renderedSteps = (
    <div className="flex flex-col gap-5">
      {stepClusters.map((cluster) => {
        if (cluster.kind === "task-set") {
          return (
            <TaskSetBlock
              key={cluster.ids.join(":")}
              items={toTaskSetRowModels(cluster.parts, cluster.ids).map((item) => ({
                ...item,
                expanded: props.expandedStepIds.has(item.id),
                onToggle: () => toggleSteps(item.id),
              }))}
            />
          );
        }
        return (
          <StepRow
            key={cluster.id}
            id={cluster.id}
            part={cluster.part}
            expanded={props.expandedStepIds.has(cluster.id)}
            onToggle={() => toggleSteps(cluster.id)}
            onOpenCodePath={props.onOpenCodePath}
            isStreamingReasoning={streamLast && cluster.id === lastStepId}
          />
        );
      })}
    </div>
  );

  if (!shouldFold) {
    return <div className="max-w-[760px]">{renderedSteps}</div>;
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
          {renderedSteps}
        </div>
      ) : null}
    </div>
  );
}
