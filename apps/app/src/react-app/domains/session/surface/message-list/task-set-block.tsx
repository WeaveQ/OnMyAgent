/** @jsxImportSource react */
import { ChevronDown } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { summarizeStep } from "../../../../../app/utils";
import { type MarkdownCodePathOpenMode } from "../markdown";
import {
  SpecializedToolDetails,
  specializedToolCanExpand,
} from "../specialized-tool-details";
import {
  buildTranscriptToolPresentation,
  taskPresentationTitle,
  type TranscriptToolPresentation,
} from "../transcript/tool-presentation";
import { isRecordValue } from "./parts";
import { isRunningStepStatus, stepPartToolClusterInput } from "./step-cluster";
import type { TranscriptPart } from "./types";

export type TaskSetBlockItem = {
  id: string;
  title: string;
  presentation: TranscriptToolPresentation;
  status?: string;
  error?: string;
  expanded: boolean;
  onToggle: () => void;
};

export function taskSetCompletedCount(items: Array<Pick<TaskSetBlockItem, "status" | "presentation">>) {
  return items.filter((item) => {
    if (isRunningStepStatus(item.status)) return false;
    const details = item.presentation.details;
    return details?.kind === "task" && Boolean(details.finalResult);
  }).length;
}

export function taskSetRowCanExpand(
  item: Pick<TaskSetBlockItem, "status" | "presentation" | "error">,
): boolean {
  if (isRunningStepStatus(item.status) || Boolean(item.error)) return true;
  const details = item.presentation.details;
  return details != null && specializedToolCanExpand(details);
}

export function toTaskSetRowModels(
  parts: TranscriptPart[],
  ids: string[],
): Array<Pick<TaskSetBlockItem, "id" | "title" | "presentation" | "status" | "error">> {
  return parts.map((part, index) => {
    const input = stepPartToolClusterInput(part);
    const presentation = buildTranscriptToolPresentation({
      toolName: input?.toolName ?? (part.type === "tool" ? part.tool : "task"),
      toolInput: input?.toolInput,
      toolOutput: input?.toolOutput,
      toolMetadata: input?.toolMetadata,
    });
    const error = partErrorText(part);
    return {
      id: ids[index] ?? `task-${index}`,
      title: taskPresentationTitle(presentation) ?? input?.toolName ?? ids[index] ?? `task-${index}`,
      presentation,
      status: summarizeStep(part).status ?? (error ? "error" : undefined),
      error,
    };
  });
}

function partErrorText(part: TranscriptPart): string | undefined {
  if (part.type !== "tool" || !("state" in part)) return undefined;
  const state = part.state as unknown;
  if (!isRecordValue(state) || typeof state.error !== "string") return undefined;
  return state.error.trim() || undefined;
}

export function TaskSetBlock(props: {
  items: TaskSetBlockItem[];
  onOpenCodePath?: (path: string, mode?: MarkdownCodePathOpenMode) => void;
}) {
  const completed = taskSetCompletedCount(props.items);
  return (
    <div className="overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
      <div className="flex items-center justify-between gap-3 border-b border-dls-border bg-dls-surface-muted px-3 py-2">
        <span className="text-sm font-medium text-dls-text">
          {t("session.tool_task_set_heading", {
            completed,
            total: props.items.length,
          })}
        </span>
      </div>
      <ul className="flex flex-col">
        {props.items.map((item) => {
          const details = item.presentation.details;
          const expandable = taskSetRowCanExpand(item);
          return (
            <li key={item.id} className="border-t border-dls-border first:border-t-0">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-dls-text hover:bg-dls-hover"
                aria-expanded={item.expanded}
                disabled={!expandable}
                onClick={item.onToggle}
              >
                {expandable ? (
                  <ChevronDown
                    size={14}
                    className={cn(
                      "shrink-0 text-dls-secondary transition-transform",
                      !item.expanded && "-rotate-90",
                    )}
                  />
                ) : (
                  <span className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                {isRunningStepStatus(item.status) ? (
                  <StatusBadge tone="accent" size="tiny">
                    {t("session.status_running")}
                  </StatusBadge>
                ) : item.error ? (
                  <StatusBadge tone="danger" size="tiny">
                    {t("session.tool_error")}
                  </StatusBadge>
                ) : null}
              </button>
              {item.expanded && (details || item.error) ? (
                <div className="px-3 pb-3">
                  {item.error ? (
                    <div className="mb-2 text-sm text-dls-danger">{item.error}</div>
                  ) : null}
                  {details ? (
                    <SpecializedToolDetails
                      details={details}
                      onOpenCodePath={props.onOpenCodePath}
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
