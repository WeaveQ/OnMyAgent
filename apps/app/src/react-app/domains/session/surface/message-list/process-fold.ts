import type { Part } from "@opencode-ai/sdk/v2/client";
import { t } from "@/i18n";
import { summarizeStep } from "../../../../../app/utils";
import { buildTranscriptToolPresentation } from "../transcript/tool-presentation";
import type { TurnProcessItem } from "../transcript/turn-content";
import { isRecordValue, recordValue, toLegacyPart } from "./parts";
import { isRunningStepStatus, summarizeStepCluster } from "./step-cluster";

export function processItemToLegacyPart(item: TurnProcessItem) {
  return toLegacyPart(item.part, `${item.messageId}:${item.partIndex}`);
}

export function shouldUseSemanticProcessFold(part: Part) {
  if (part.type !== "tool") return false;
  const tool = part.tool.toLowerCase();
  return isVisualizerReadMeToolName(tool) ||
    tool === "skill" ||
    tool === "useskill" ||
    tool.includes("skill") ||
    tool === "bash" ||
    tool === "shell" ||
    tool.includes("command") ||
    tool.includes("terminal") ||
    tool.includes("browser") ||
    tool.includes("playwright");
}

/**
 * Multi-step tool process chrome stays collapsed by default (even while
 * tools run). Only the plan/task list may start open when actively running.
 */
export function shouldDefaultExpandProcessFold(input: {
  isPlanList: boolean;
  running: boolean;
}): boolean {
  if (input.isPlanList) return input.running;
  return false;
}

export function isVisualizerReadMeToolName(toolName: string) {
  return [
    "readme",
    "visualize:readme",
    "visualizer:readme",
    "visualizer:readmetool",
    "getdesignspec",
  ].includes(toolName.toLowerCase().replace(/[-_]/g, ""));
}

export function browserNodeReplProcessMeta(input: Record<string, unknown> | null): {
  label: string;
  category: string;
} {
  const code = typeof input?.code === "string" ? input.code : "";
  const normalized = code.toLowerCase();
  if (/\.goto\s*\(|\.navigate\s*\(|\.open\s*\(/.test(normalized)) {
    const rawUrl = code.match(/https?:\/\/[^"'`\s)]+/)?.[0];
    let domain = "";
    if (rawUrl) {
      try {
        domain = new URL(rawUrl).hostname;
      } catch {
        domain = "";
      }
    }
    return {
      label: domain
        ? t("session.process_summary_browser_open_page_target", { target: domain })
        : t("session.process_summary_browser_open_page"),
      category: "web",
    };
  }
  if (/\.click\s*\(|\.fill\s*\(|\.type\s*\(|\.press\s*\(|\.selectoption\s*\(|\.check\s*\(|\.hover\s*\(/.test(normalized)) {
    return {
      label: t("session.process_summary_browser_interact"),
      category: "browser",
    };
  }
  if (/\.screenshot\s*\(|emitimage\s*\(/.test(normalized)) {
    return {
      label: t("session.process_summary_browser_snapshot"),
      category: "image",
    };
  }
  if (/waitfortimeout\s*\(|waitforloadstate\s*\(|waitforselector\s*\(|waitforurl\s*\(/.test(normalized)) {
    return {
      label: t("session.process_summary_browser_wait"),
      category: "browser",
    };
  }
  if (/scrollby\s*\(|scrollto\s*\(|scrollintoview\s*\(|mouse\.wheel\s*\(/.test(normalized)) {
    return {
      label: t("session.process_summary_browser_browse"),
      category: "browser",
    };
  }
  if (/browsers\.getdefault\s*\(|tabs\.list\s*\(|tabs\.get\s*\(/.test(normalized)) {
    return {
      label: t("session.process_summary_browser_prepare"),
      category: "browser",
    };
  }
  if (/\.evaluate\s*\(|textcontent|innerhtml|queryselector|\.locator\s*\(|\.url\s*\(|\.title\s*\(/.test(normalized)) {
    return {
      label: t("session.process_summary_browser_inspect"),
      category: "read",
    };
  }
  return {
    label: t("session.tool_chip_browser"),
    category: "browser",
  };
}

export function processPlanDetails(items: TurnProcessItem[]) {
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

export function processFoldChipMeta(items: TurnProcessItem[], turnRunning = false): {
  label: string;
  category?: string;
  variant: "thinking" | "tool-chip" | "summary";
  running: boolean;
} {
  if (processPlanDetails(items)) {
    return {
      label: t("session.workbuddy_task_list"),
      category: "terminal",
      variant: "summary",
      running: turnRunning,
    };
  }
  const legacyParts = items.flatMap((item) => {
    const part = processItemToLegacyPart(item);
    return part ? [part] : [];
  });
  const toolParts = legacyParts.filter((part) => part.type === "tool");
  const running = turnRunning && toolParts.some((part) => (
    isRunningStepStatus(summarizeStep(part).status)
  ));
  if (legacyParts.length > 0 && legacyParts.every((part) => part.type === "reasoning")) {
    return {
      label: t("session.process_summary_deep_thinking"),
      variant: "thinking",
      running: turnRunning,
    };
  }

  // WorkBuddy summaries ignore reasoning and derive intent only from tool calls.
  if (toolParts.length === 1 && toolParts[0]) {
    const part = toolParts[0];
    const summary = summarizeStep(part);
    const tool = part.tool.toLowerCase();
    const toolState = "state" in part && isRecordValue(part.state) ? part.state : null;
    const toolInput = toolState && isRecordValue(toolState.input) ? toolState.input : null;
    const skillNameRaw = toolInput
      ? (typeof toolInput.name === "string" && toolInput.name.trim()
        ? toolInput.name.trim()
        : typeof toolInput.command === "string" && toolInput.command.trim()
          ? toolInput.command.trim()
          : "")
      : "";
    const skillName = skillNameRaw || summary.skillName?.trim() || "";

    if (isVisualizerReadMeToolName(tool)) {
      return {
        label: t("session.tool_visualizer_read_me"),
        category: "read",
        variant: "tool-chip",
        running,
      };
    }

    if (tool === "skill" || tool === "useskill" || tool.includes("skill")) {
      return {
        label: skillName
          ? t("session.tool_chip_load_skill", { skill: skillName })
          : t("session.tool_chip_load_skill_generic"),
        category: "skill",
        variant: "tool-chip",
        running,
      };
    }
    if (
      tool === "bash" ||
      tool === "shell" ||
      tool.includes("command") ||
      tool.includes("terminal")
    ) {
      return {
        label: t("session.tool_chip_run_command"),
        category: "terminal",
        variant: "tool-chip",
        running,
      };
    }
    if (
      tool.includes("browser") ||
      tool.includes("playwright")
    ) {
      const browserMeta = browserNodeReplProcessMeta(toolInput);
      return {
        ...browserMeta,
        variant: "summary",
        running,
      };
    }
  }

  const toolNames = toolParts.map((part) => part.tool.toLowerCase());
  const terminalCount = toolNames.filter((name) => (
    name === "bash" || name.includes("command") || name.includes("terminal") || name === "shell"
  )).length;
  const editCount = toolNames.filter((name) => (
    name.includes("write") || name.includes("edit") || name.includes("patch") || name.includes("replace")
  )).length;
  if (terminalCount > 0 && editCount > 0) {
    const topic = toolParts.flatMap((part) => {
      const state = "state" in part ? recordValue(part.state) : null;
      const input = recordValue(state?.input);
      const path = ["filePath", "file_path", "path"]
        .map((key) => input?.[key])
        .find((value): value is string => typeof value === "string" && value.trim().length > 0);
      if (!path) return [];
      const normalized = path.replace(/[\\/]+$/, "");
      return [normalized.split(/[\\/]/).at(-1) || normalized];
    })[0];
    if (topic) {
      return {
        label: t("session.process_summary_command_modify_topic", { topic }),
        category: toolNames.findIndex((name) => (
          name === "bash" || name.includes("command") || name.includes("terminal") || name === "shell"
        )) <= toolNames.findIndex((name) => (
          name.includes("write") || name.includes("edit") || name.includes("patch") || name.includes("replace")
        )) ? "terminal" : "edit",
        variant: "summary",
        running,
      };
    }
  }
  if (toolNames.some((name) => (
    name.includes("search") || name.includes("fetch") || name.includes("browser") || name.includes("web")
  ))) {
    return {
      label: t("session.process_summary_collecting_sources"),
      category: "search",
      variant: "summary",
      running,
    };
  }
  if (terminalCount > 0) {
    return {
      label: t("session.process_summary_ran_commands", { count: terminalCount }),
      category: "terminal",
      variant: "summary",
      running,
    };
  }
  if (editCount > 0) {
    return {
      label: t("session.process_summary_edited", { count: editCount }),
      category: "edit",
      variant: "summary",
      running,
    };
  }
  const readCount = toolNames.filter((name) => (
    name.includes("read") || name.includes("glob") || name.includes("list")
  )).length;
  if (readCount > 0) {
    return {
      label: t("session.process_summary_reviewed_files", { count: readCount }),
      category: "read",
      variant: "summary",
      running,
    };
  }
  if (toolParts.length > 0) {
    const summary = summarizeStepCluster([{
      id: `turn-process:${items[0]?.messageId ?? "unknown"}`,
      parts: toolParts,
      mode: "standalone",
    }]);
    if (summary.category !== "tool") {
      return {
        label: summary.label,
        category: summary.category,
        variant: "summary",
        running,
      };
    }
  }
  return {
    label: t("session.process_summary_continue_processing"),
    category: toolNames.some((name) => name.includes("browser") || name.includes("playwright"))
      ? "browser"
      : "tool",
    variant: "summary",
    running,
  };
}

export function processFoldLabel(items: TurnProcessItem[]) {
  return processFoldChipMeta(items).label;
}
