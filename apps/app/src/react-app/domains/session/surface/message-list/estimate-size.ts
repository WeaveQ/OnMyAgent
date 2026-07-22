import { parseSkillReference } from "../skill-reference";
import type { TranscriptRenderItem } from "../transcript/render-items";
import type { MessageBlockItem } from "./types";
import { partToText } from "./parts";

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
    // Folded process timeline is compact; do not reserve full expanded height.
    const partCount = block.stepGroups.reduce((total, group) => total + group.parts.length, 0);
    return clampVirtualEstimate(64 + Math.min(partCount, 6) * 36, 72, 320);
  }

  const leadingStepSize = (block.leadingStepGroups ?? []).reduce(
    (total, group) => total + 48 + Math.min(group.parts.length, 4) * 28,
    0,
  );
  const textSize = block.groups.reduce((total, group) => {
    if (group.kind === "steps") {
      return total + 48 + Math.min(group.parts.length, 4) * 28;
    }
    const text = partToText(group.part);
    // Expanded auto-slash dumps collapse to a single chip row in the UI.
    if (block.isUser && parseSkillReference(text)) {
      return total + 56;
    }
    return total + estimateTextBlockSize(text, block.isUser);
  }, 0);
  const attachmentSize = block.attachments.length > 0 ? 76 : 0;
  const openTargetsSize = !block.isUser ? 44 : 0;
  const actionsSize = block.isUser ? 24 : 36;

  // Cap assistant estimates tightly: tool-heavy turns collapse in the UI but
  // step counting used to reserve ~1800px each and leave multi-viewport blanks
  // until measureElement ran (often deferred while sticky-bottom scrolls).
  return clampVirtualEstimate(
    leadingStepSize + textSize + attachmentSize + openTargetsSize + actionsSize,
    block.isUser ? 112 : 200,
    block.isUser ? 720 : 720,
  );
}

export function estimateRenderItemSize(item: TranscriptRenderItem<MessageBlockItem> | undefined) {
  if (!item) return 360;
  if (item.kind === "divider") return estimateBlockSize(item.block);
  return item.blocks.reduce((total, block) => total + estimateBlockSize(block), 0);
}
