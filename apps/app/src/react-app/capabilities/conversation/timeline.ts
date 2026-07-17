/** Pure helpers for conversation timeline normalization / mapping. */
import type {
  MessageBlockItem,
  SessionTranscriptDivider,
  StepClusterBlock,
  StepTimelineGroup,
  TranscriptFeedbackValue,
} from "./types";

export function isTranscriptDividerReady(
  divider: SessionTranscriptDivider | undefined,
  messageCount: number,
): boolean {
  return Boolean(divider && divider.afterMessageCount <= messageCount);
}

export function isInternalAssistantNarration(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, " ");
  return /^(?:the user(?: wants|['’]s| is| said| has| just| seems)|let me|i(?:'ll| will| need to| should| can) |first,? i(?:'ll| will| need to)|now,? i(?:'ll| will| need to)|next,? i(?:'ll| will| need to))/i.test(
    normalized,
  );
}

export function toggleTranscriptFeedback(
  state: Record<string, TranscriptFeedbackValue>,
  messageId: string,
  value: TranscriptFeedbackValue,
) {
  if (state[messageId] === value) {
    const next = { ...state };
    delete next[messageId];
    return next;
  }
  return { ...state, [messageId]: value };
}

const PASTE_TOKEN_RE = /(\[pasted text [^\]]+\])/;
const PASTE_TOKEN_EXACT_RE = /^\[pasted text (.+)\]$/;

export function resolveDisplayedPastedText(
  text: string,
  pastedTextMap?: Map<string, string>,
) {
  if (!pastedTextMap?.size || !PASTE_TOKEN_RE.test(text)) return text;
  return text
    .split(PASTE_TOKEN_RE)
    .map((segment) => {
      const match = segment.match(PASTE_TOKEN_EXACT_RE);
      if (!match?.[1]) return segment;
      return pastedTextMap.get(match[1]) ?? segment;
    })
    .join("");
}

export function shouldFoldStepGroups(stepGroups: StepTimelineGroup[]) {
  return stepGroups.some((group) => group.parts.length > 0);
}

export function canMergeStepClusters(previous: MessageBlockItem | undefined, next: StepClusterBlock) {
  if (!previous || previous.kind !== "steps-cluster") return false;
  if (previous.isUser !== next.isUser) return false;
  return true;
}

export function mergeLeadingAssistantStepClusters(blocks: MessageBlockItem[]) {
  const merged: MessageBlockItem[] = [];
  for (const block of blocks) {
    const previousBlock = merged.at(-1);
    if (
      block.kind === "message" &&
      !block.isUser &&
      previousBlock?.kind === "steps-cluster" &&
      !previousBlock.isUser
    ) {
      merged.pop();
      merged.push({
        ...block,
        leadingStepGroups: previousBlock.stepGroups,
        leadingStepMessageIds: previousBlock.messageIds,
      });
      continue;
    }
    merged.push(block);
  }
  return merged;
}

export function blockIdentityKey(block: MessageBlockItem): string {
  if (block.kind === "divider") return `divider:${block.id}`;
  if (block.kind === "steps-cluster") return `cluster:${block.id}`;
  return `msg:${block.messageId}`;
}

export function messageIdsForBlock(block: MessageBlockItem) {
  if (block.kind === "divider") return [];
  if (block.kind === "steps-cluster") return block.messageIds;
  return [...(block.leadingStepMessageIds ?? []), block.messageId];
}

/**
 * Structural-sharing equivalence for transcript blocks so non-streaming rows
 * keep stable object identity across streaming updates.
 */
export function blocksAreEquivalent(
  previous: MessageBlockItem | undefined,
  next: MessageBlockItem,
): boolean {
  if (!previous) return false;
  if (previous.kind !== next.kind) return false;
  if (previous.isUser !== next.isUser) return false;

  if (previous.kind === "divider" && next.kind === "divider") {
    return (
      previous.id === next.id &&
      previous.label === next.label &&
      previous.variant === next.variant &&
      previous.afterMessageCount === next.afterMessageCount
    );
  }

  if (previous.kind === "steps-cluster" && next.kind === "steps-cluster") {
    if (previous.id !== next.id) return false;
    if (previous.messageIds.length !== next.messageIds.length) return false;
    for (let i = 0; i < previous.messageIds.length; i += 1) {
      if (previous.messageIds[i] !== next.messageIds[i]) return false;
    }
    if (previous.stepGroups.length !== next.stepGroups.length) return false;
    for (let i = 0; i < previous.stepGroups.length; i += 1) {
      const prevGroup = previous.stepGroups[i];
      const nextGroup = next.stepGroups[i];
      if (!prevGroup || !nextGroup) return false;
      if (prevGroup.id !== nextGroup.id) return false;
      if (prevGroup.mode !== nextGroup.mode) return false;
      if (prevGroup.parts.length !== nextGroup.parts.length) return false;
      for (let p = 0; p < prevGroup.parts.length; p += 1) {
        if (prevGroup.parts[p] !== nextGroup.parts[p]) return false;
      }
    }
    return true;
  }

  if (previous.kind === "message" && next.kind === "message") {
    if (previous.messageId !== next.messageId) return false;
    const previousLeadingStepGroups = previous.leadingStepGroups ?? [];
    const nextLeadingStepGroups = next.leadingStepGroups ?? [];
    if (previousLeadingStepGroups.length !== nextLeadingStepGroups.length) return false;
    for (let i = 0; i < previousLeadingStepGroups.length; i += 1) {
      const prevGroup = previousLeadingStepGroups[i];
      const nextGroup = nextLeadingStepGroups[i];
      if (!prevGroup || !nextGroup) return false;
      if (prevGroup.id !== nextGroup.id) return false;
      if (prevGroup.mode !== nextGroup.mode) return false;
      if (prevGroup.parts.length !== nextGroup.parts.length) return false;
      for (let p = 0; p < prevGroup.parts.length; p += 1) {
        if (prevGroup.parts[p] !== nextGroup.parts[p]) return false;
      }
    }
    const previousLeadingMessageIds = previous.leadingStepMessageIds ?? [];
    const nextLeadingMessageIds = next.leadingStepMessageIds ?? [];
    if (previousLeadingMessageIds.length !== nextLeadingMessageIds.length) return false;
    for (let i = 0; i < previousLeadingMessageIds.length; i += 1) {
      if (previousLeadingMessageIds[i] !== nextLeadingMessageIds[i]) return false;
    }
    if (previous.message !== next.message) return false;
    if (previous.attachments.length !== next.attachments.length) return false;
    if (previous.renderableParts.length !== next.renderableParts.length) return false;
    if (previous.groups.length !== next.groups.length) return false;
    return true;
  }

  return false;
}
