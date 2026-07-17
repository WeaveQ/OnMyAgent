export function countPrependedTranscriptMessages(
  previousIds: readonly string[],
  nextIds: readonly string[],
) {
  if (previousIds.length === 0 || nextIds.length <= previousIds.length) return 0;
  const previousFirstId = previousIds[0];
  if (!previousFirstId) return 0;
  const offset = nextIds.indexOf(previousFirstId);
  if (offset <= 0) return 0;
  if (offset + previousIds.length > nextIds.length) return 0;
  for (let index = 0; index < previousIds.length; index += 1) {
    if (nextIds[offset + index] !== previousIds[index]) return 0;
  }
  return offset;
}

export function anchoredTranscriptScrollTop(input: {
  scrollTop: number;
  anchorTopBefore: number;
  anchorTopAfter: number;
}) {
  return Math.max(
    0,
    input.scrollTop + (input.anchorTopAfter - input.anchorTopBefore),
  );
}
