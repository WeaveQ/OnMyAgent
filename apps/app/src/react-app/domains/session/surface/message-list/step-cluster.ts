import { t } from "@/i18n";
import { summarizeStep } from "../../../../../app/utils";
import { specializedToolHeadline } from "../specialized-tool-details";
import { buildTranscriptToolPresentation } from "../transcript/tool-presentation";
import type { StepTimelineGroup } from "./types";
import { recordValue } from "./parts";

export type StepClusterSummary = {
  category: "read" | "edit" | "terminal" | "search" | "tool";
  label: string;
};

export function isRunningStepStatus(status?: string) {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return normalized.includes("running") || normalized.includes("progress") || normalized.includes("pending");
}

export function summarizeStepCluster(stepGroups: StepTimelineGroup[]): StepClusterSummary {
  const toolParts = stepGroups.flatMap((group) =>
    group.parts.filter((part) => part.type === "tool"),
  );
  if (toolParts.length === 1) {
    const toolPart = toolParts[0];
    const summary = summarizeStep(toolPart);
    const toolState = recordValue(toolPart.state);
    const presentation = buildTranscriptToolPresentation({
      toolName: toolPart.tool,
      toolInput: recordValue(toolState?.input) ?? undefined,
      toolOutput: toolState?.output,
      toolMetadata: recordValue(toolState?.metadata) ?? undefined,
    });
    const category = summary.toolCategory === "terminal"
      ? "terminal"
      : summary.toolCategory === "search"
        ? "search"
        : summary.toolCategory === "edit" || summary.toolCategory === "write"
          ? "edit"
          : summary.toolCategory === "read" || summary.toolCategory === "glob"
            ? "read"
            : "tool";
    return {
      category,
      label: presentation.details
        ? specializedToolHeadline(
            presentation.details,
            isRunningStepStatus(summary.status),
          )
        : summary.title,
    };
  }
  const counts = {
    read: 0,
    edit: 0,
    terminal: 0,
    search: 0,
    other: 0,
  };
  let editing = false;
  let processing = false;
  let running = false;

  for (const group of stepGroups) {
    for (const part of group.parts) {
      const summary = summarizeStep(part);
      running = running || isRunningStepStatus(summary.status);
      if (summary.toolCategory === "edit" || summary.toolCategory === "write") {
        counts.edit += 1;
        editing = editing || isRunningStepStatus(summary.status);
      } else if (summary.toolCategory === "terminal") {
        counts.terminal += 1;
      } else if (summary.toolCategory === "search") {
        counts.search += 1;
      } else if (summary.toolCategory === "read" || summary.toolCategory === "glob") {
        counts.read += 1;
      } else {
        counts.other += 1;
        processing = processing || isRunningStepStatus(summary.status);
      }
    }
  }

  const populatedCategoryCount = [
    counts.read,
    counts.edit,
    counts.terminal,
    counts.search,
    counts.other,
  ].filter((count) => count > 0).length;
  const totalCount =
    counts.read + counts.edit + counts.terminal + counts.search + counts.other;
  if (populatedCategoryCount > 1) {
    return {
      category: "tool",
      label: t(
        running
          ? "session.process_summary_processing_items"
          : "session.process_summary_processed_items",
        { count: totalCount },
      ),
    };
  }

  if (counts.edit > 0) {
    return {
      category: "edit",
      label: t(editing ? "session.process_summary_editing" : "session.process_summary_edited", { count: counts.edit }),
    };
  }
  if (counts.terminal > 0) {
    return {
      category: "terminal",
      label: t("session.process_summary_ran_commands", { count: counts.terminal }),
    };
  }
  if (counts.search > 0) {
    return {
      category: "search",
      label: t("session.process_summary_searched_items", { count: counts.search }),
    };
  }
  if (counts.read > 0) {
    return {
      category: "read",
      label: t("session.process_summary_reviewed_files", { count: counts.read }),
    };
  }
  return {
    category: "tool",
    label: t(processing ? "session.process_summary_processing_items" : "session.process_summary_processed_items", { count: counts.other }),
  };
}
