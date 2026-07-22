import type { MessageBlockItem, StepClusterBlock, StepTimelineGroup } from "./types";

/**
 * Stable-key used to match a block across renders. For message blocks the
 * messageId is stable. For step clusters we reuse the cluster id (which is
 * derived from its first step group) as the identity anchor.
 */
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
 * Returns true when a newly-computed block is content-equivalent to the
 * previous block we rendered under the same identity key. We compare the
 * underlying UIMessage reference (`message.source`) for message blocks and
 * the messageIds array + stepGroups identity for step clusters. If equal,
 * the caller reuses the previous block reference so React.memo'd children
 * downstream can skip work.
 *
 * This is the structural-sharing trick from T3Tools' MessagesTimeline: on
 * every streaming token, `props.messages` is a fresh array, but only the
 * *currently-streaming* message has a new `source` reference — everything
 * else is still pointer-equal to last tick. Rebuilding blocks from the new
 * array gives fresh block objects for every message, so downstream memo
 * checks all fail by default. Reusing the previous block reference when
 * its content hasn't actually changed gives every non-streaming row a free
 * bailout during a streaming burst.
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
    // The single most important check. The session sync layer keeps
    // UIMessage references stable for every non-streaming message across
    // rerenders; only the actively-streaming message gets a fresh
    // `source` reference per token. If the source is pointer-equal, the
    // block hasn't changed and we can reuse the previous object.
    if (previous.message !== next.message) return false;
    if (previous.attachments.length !== next.attachments.length) return false;
    if (previous.renderableParts.length !== next.renderableParts.length) return false;
    if (previous.groups.length !== next.groups.length) return false;
    return true;
  }

  return false;
}

export function canMergeStepClusters(previous: MessageBlockItem | undefined, next: StepClusterBlock) {
  if (!previous || previous.kind !== "steps-cluster") return false;
  if (previous.isUser !== next.isUser) return false;
  return true;
}

/**
 * Structural sharing across transcript rebuilds: for each raw block, reuse
 * the previous block object when content-equivalent so React.memo children
 * keep pointer equality during streaming (only the active turn typically
 * changes `message` reference).
 */
export function stabilizeMessageBlocks(
  previousByKey: ReadonlyMap<string, MessageBlockItem>,
  rawBlocks: readonly MessageBlockItem[],
): {
  blocks: MessageBlockItem[];
  nextByKey: Map<string, MessageBlockItem>;
} {
  const nextByKey = new Map<string, MessageBlockItem>();
  const blocks = rawBlocks.map((block) => {
    const key = blockIdentityKey(block);
    const previous = previousByKey.get(key);
    const reused =
      previous && blocksAreEquivalent(previous, block) ? previous : block;
    nextByKey.set(key, reused);
    return reused;
  });
  return { blocks, nextByKey };
}

export function shouldFoldStepGroups(stepGroups: StepTimelineGroup[]) {
  return stepGroups.some((group) => group.parts.length > 0);
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
