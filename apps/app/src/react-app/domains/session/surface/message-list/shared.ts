/** Pure helpers and conversion utilities shared by message-list modules. */
import { isToolUIPart, type DynamicToolUIPart, type UIMessage } from "ai";

import {
  openDesktopPath,
  revealDesktopItemInDir,
} from "../../../../../app/lib/desktop";
import { t } from "@/i18n";
import type { MessageGroup } from "../../../../../app/types";
import { summarizeStep } from "../../../../../app/utils";
import {
  blockIdentityKey,
  canMergeStepClusters,
  isInternalAssistantNarration,
  isTranscriptDividerReady,
  mergeLeadingAssistantStepClusters,
  messageIdsForBlock,
  resolveDisplayedPastedText,
  shouldFoldStepGroups,
  toggleTranscriptFeedback,
  type MessageBlockItem,
  type SessionTranscriptDivider,
  type StepClusterBlock,
  type StepClusterSummary,
  type StepTimelineGroup,
  type TranscriptPart,
} from "@/react-app/capabilities/conversation";
import {
  deriveOpenTargets,
  isCollectibleArtifactTarget,
  isLocalhostBrowserTarget,
  type OpenTarget,
} from "../../artifacts/open-target";
import {
  specializedToolHeadline,
} from "../specialized-tool-details";
import {
  buildTranscriptToolPresentation,
} from "../transcript/tool-presentation";
import type { TranscriptRenderItem } from "../transcript/render-items";

export {
  blockIdentityKey,
  canMergeStepClusters,
  isInternalAssistantNarration,
  isTranscriptDividerReady,
  mergeLeadingAssistantStepClusters,
  messageIdsForBlock,
  resolveDisplayedPastedText,
  shouldFoldStepGroups,
  toggleTranscriptFeedback,
};

export function cancelledAssistantMessageIds(
  messages: UIMessage[],
  dividers: SessionTranscriptDivider[] | undefined,
) {
  const ids = new Set<string>();
  for (const divider of dividers ?? []) {
    if (divider.variant !== "cancelled") continue;
    const precedingMessages = messages.slice(
      0,
      Math.min(messages.length, divider.afterMessageCount),
    );
    const assistantMessage = precedingMessages.findLast(
      (message) => message.role === "assistant",
    );
    if (assistantMessage) ids.add(assistantMessage.id);
  }
  return ids;
}

export function clampVirtualEstimate(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function estimateTextBlockSize(text: string, isUser: boolean) {
  const explicitLines = text.split("\n").length;
  const wrappedLines = Math.ceil(text.length / (isUser ? 68 : 86));
  const markdownStructureLines = text
    .split("\n")
    .filter((line) => /^\s*([-*+]\s+|\d+\.\s+|>\s+|#{1,6}\s+|\|)/.test(line)).length;
  const fencedCodeBlocks = Math.floor((text.match(/```/g) ?? []).length / 2);
  const estimatedLines = Math.max(explicitLines, wrappedLines) + markdownStructureLines * 0.5;
  const base = isUser ? 76 : 160;
  return base + estimatedLines * 22 + fencedCodeBlocks * 72;
}

export function estimateBlockSize(block: MessageBlockItem | undefined) {
  if (!block) return 360;

  if (block.kind === "divider") {
    return 56;
  }

  if (block.kind === "steps-cluster") {
    const partCount = block.stepGroups.reduce((total, group) => total + group.parts.length, 0);
    return clampVirtualEstimate(64 + partCount * 58, 96, 900);
  }

  const leadingStepSize = (block.leadingStepGroups ?? []).reduce(
    (total, group) => total + 72 + group.parts.length * 58,
    0,
  );
  const textSize = block.groups.reduce((total, group) => {
    if (group.kind === "steps") {
      return total + 72 + group.parts.length * 58;
    }
    return total + estimateTextBlockSize(partToText(group.part), block.isUser);
  }, 0);
  const attachmentSize = block.attachments.length > 0 ? 76 : 0;
  const openTargetsSize = !block.isUser ? 44 : 0;
  const actionsSize = block.isUser ? 24 : 36;

  return clampVirtualEstimate(
    leadingStepSize + textSize + attachmentSize + openTargetsSize + actionsSize,
    block.isUser ? 112 : 260,
    block.isUser ? 720 : 1800,
  );
}

export function estimateRenderItemSize(item: TranscriptRenderItem<MessageBlockItem> | undefined) {
  if (!item) return 360;
  if (item.kind === "divider") return estimateBlockSize(item.block);
  return item.blocks.reduce((total, block) => total + estimateBlockSize(block), 0);
}

export function partIdFromUiPart(part: UIMessage["parts"][number], fallbackId: string) {
  const metadata = (part as { providerMetadata?: { opencode?: { partId?: unknown } } })
    .providerMetadata?.opencode;
  if (typeof metadata?.partId === "string" && metadata.partId.trim()) {
    return metadata.partId;
  }
  return fallbackId;
}

export function toDynamicToolPart(part: UIMessage["parts"][number]) {
  if (part.type === "dynamic-tool") {
    return part;
  }
  if (!isToolUIPart(part)) return null;
  return {
    ...part,
    toolName: part.type.replace(/^tool-/, ""),
    type: "dynamic-tool",
  } as DynamicToolUIPart;
}

export function toLegacyPart(
  part: UIMessage["parts"][number],
  fallbackId: string,
): TranscriptPart | null {
  const id = partIdFromUiPart(part, fallbackId);

  if (part.type === "text") {
    return { id, type: "text", text: part.text } as TranscriptPart;
  }

  if (part.type === "reasoning") {
    return { id, type: "reasoning", text: part.text } as TranscriptPart;
  }

  if (part.type === "file") {
    return {
      id,
      type: "file",
      url: part.url,
      filename: part.filename,
      mime: part.mediaType,
    } as TranscriptPart;
  }

  if (part.type === "step-start") {
    return { id, type: "step-start" } as TranscriptPart;
  }

  const toolPart = toDynamicToolPart(part);
  if (toolPart) {
    const opencodeMetadata = isRecordValue(toolPart.callProviderMetadata?.opencode)
      ? toolPart.callProviderMetadata.opencode
      : null;
    const toolMetadata = isRecordValue(opencodeMetadata?.toolMetadata)
      ? opencodeMetadata.toolMetadata
      : null;
    const state: Record<string, unknown> = {
      input: toolPart.input,
      ...(toolMetadata ? { metadata: toolMetadata } : {}),
    };

    if (toolPart.state === "output-available") {
      state.output = toolPart.output;
    }

    if (toolPart.state === "output-error") {
      state.error = toolPart.errorText;
    }

    return {
      id: toolPart.toolCallId || id,
      type: "tool",
      tool: toolPart.toolName,
      state,
    } as TranscriptPart;
  }

  return null;
}

export function isAttachmentPart(part: TranscriptPart) {
  if (part.type !== "file") return false;
  const url = (part as { url?: string }).url;
  return typeof url === "string" && !url.startsWith("file://");
}

export function attachmentsForParts(parts: TranscriptPart[]) {
  return parts.flatMap((part) => {
      if (!isAttachmentPart(part)) return [];
      const record = part as {
        url?: string;
        filename?: string;
        mime?: string;
      };
      const attachment = {
        url: record.url ?? "",
        filename: record.filename ?? "attachment",
        mime: record.mime ?? "application/octet-stream",
      };
      return attachment.url ? [attachment] : [];
    });
}

export function partToText(part: TranscriptPart) {
  if (part.type === "text") {
    return String((part as { text?: string }).text ?? "");
  }
  if (part.type === "reasoning") {
    return String((part as { text?: string }).text ?? "");
  }
  if (part.type === "agent") {
    const name = (part as { name?: string }).name ?? "";
    return name ? `@${name}` : "@agent";
  }
  if (part.type === "file") {
    const record = part as {
      label?: string;
      path?: string;
      filename?: string;
      url?: string;
    };
    const label = record.label ?? record.path ?? record.filename ?? record.url ?? "";
    return label ? `@${label}` : "@file";
  }
  if (part.type === "tool") {
    return summarizeStep(part).title;
  }
  return "";
}

export function messageToText(message: UIMessage) {
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") return [part.text];
      if (part.type === "reasoning") return [part.text];
      if (part.type === "file") return [part.filename ?? part.url];
      const toolPart = toDynamicToolPart(part);
      if (toolPart) {
        if (toolPart.state === "output-error") {
          return [`[tool:${toolPart.toolName}] ${toolPart.errorText}`];
        }
        if (toolPart.state === "output-available") {
          return [`[tool:${toolPart.toolName}] ${JSON.stringify(toolPart.output)}`];
        }
        return [`[tool:${toolPart.toolName}] ${JSON.stringify(toolPart.input)}`];
      }
      return [];
    })
    .join("\n\n")
    .trim();
}

export function isImageAttachment(mime: string) {
  return mime.startsWith("image/");
}

export function humanMediaType(raw: string) {
  if (!raw || raw === "application/octet-stream") return null;
  const short = raw.replace(/^application\//, "").replace(/^text\//, "");
  return short.toUpperCase();
}

export function formatStructuredValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasStructuredValue(value: unknown) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecordValue(value)) {
    return Object.keys(value).length > 0;
  }
  return true;
}

export function toolStatusText(status?: string) {
  if (!status) return null;
  const normalized = status.toLowerCase();
  if (normalized.includes("approval") || normalized.includes("pending")) return t("session.status_awaiting_approval");
  if (normalized.includes("running") || normalized.includes("progress")) return t("session.status_in_progress");
  if (normalized.includes("error") || normalized.includes("failed")) return t("session.status_failed");
  return null;
}

export function isRunningStepStatus(status?: string) {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return normalized.includes("running") || normalized.includes("progress") || normalized.includes("pending");
}

export function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) record[key] = item;
  return record;
}

export function recordText(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
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

export async function openFileWithOS(path: string) {
  try {
    await openDesktopPath(path);
  } catch {
    // silently fail on web
  }
}

export async function revealFileInFinder(path: string) {
  try {
    await revealDesktopItemInDir(path);
  } catch {
    // silently fail on web
  }
}

export function messageGroupKey(messageId: string, group: MessageGroup) {
  if (group.kind === "steps") return `${messageId}:steps:${group.id}`;
  const partId = "id" in group.part && typeof group.part.id === "string" ? group.part.id : partToText(group.part);
  return `${messageId}:text:${group.segment}:${partId}`;
}

export function selectTurnOpenTargets(
  messages: UIMessage[],
  verifiedTargets: OpenTarget[] | undefined,
) {
  const verifiedById = new Map((verifiedTargets ?? []).map((target) => [target.id, target] as const));
  const inlineTargets = new Map<string, OpenTarget>();
  for (const candidate of deriveOpenTargets(messages, { includeFileMentions: true })) {
    const verified = verifiedById.get(candidate.id);
    if (candidate.kind === "url" && isLocalhostBrowserTarget(candidate)) {
      inlineTargets.set(candidate.id, verified ?? candidate);
      continue;
    }
    if (verified && isCollectibleArtifactTarget(verified)) {
      inlineTargets.set(verified.id, verified);
    }
  }
  return Array.from(inlineTargets.values()).slice(0, 4);
}
