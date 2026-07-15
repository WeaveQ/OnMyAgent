export type TranscriptRenderEntry<Block> = {
  key: string;
  block: Block;
  messageIds: string[];
  dividerId: string | null;
};

export type TranscriptTurnRenderItem<Block> = {
  kind: "turn";
  id: string;
  turnId: string | null;
  blocks: Block[];
};

export type TranscriptDividerRenderItem<Block> = {
  kind: "divider";
  id: string;
  block: Block;
};

export type TranscriptRenderItem<Block> =
  | TranscriptTurnRenderItem<Block>
  | TranscriptDividerRenderItem<Block>;

export function groupTranscriptRenderItems<Block>(
  entries: TranscriptRenderEntry<Block>[],
  turnIdByMessageId: ReadonlyMap<string, string>,
): TranscriptRenderItem<Block>[] {
  const items: TranscriptRenderItem<Block>[] = [];
  const segmentCounts = new Map<string, number>();

  entries.forEach((entry) => {
    if (entry.dividerId) {
      items.push({ kind: "divider", id: `divider:${entry.dividerId}`, block: entry.block });
      return;
    }

    const turnId = entry.messageIds
      .map((messageId) => turnIdByMessageId.get(messageId))
      .find((candidate) => candidate !== undefined) ?? null;
    const previous = items.at(-1);
    if (previous?.kind === "turn" && previous.turnId === turnId) {
      previous.blocks.push(entry.block);
      return;
    }

    const identity = turnId ?? entry.key;
    const segment = segmentCounts.get(identity) ?? 0;
    segmentCounts.set(identity, segment + 1);
    items.push({
      kind: "turn",
      id: `turn:${identity}:${segment}`,
      turnId,
      blocks: [entry.block],
    });
  });

  return items;
}
