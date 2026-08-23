import type { ComposerDraft } from "../../../../../app/types";

export const MAX_QUEUED_PROMPTS = 20;

export type QueuedPrompt = {
  id: string;
  draft: ComposerDraft;
};

export function shouldEnqueuePrompt(input: {
  busy: boolean;
  draftOnly: boolean;
  sessionId: string;
}): boolean {
  if (!input.busy || input.draftOnly) return false;
  const sessionId = input.sessionId.trim();
  return sessionId.length > 0 && !sessionId.startsWith("draft:");
}

/** Sending, liveStatus busy/retry, or activity thinking/tools/waiting. Error is idle for enqueue. */
export function isPromptQueueTurnBusy(input: {
  sending: boolean;
  remoteBusy: boolean;
  activityStatus: string;
}): boolean {
  if (input.sending || input.remoteBusy) return true;
  return input.activityStatus !== "idle" && input.activityStatus !== "error";
}

export type PromptQueueDrainLatch = {
  awaitingRemoteBusy: boolean;
  seenRemoteBusy: boolean;
};

export const EMPTY_PROMPT_QUEUE_DRAIN_LATCH: PromptQueueDrainLatch = {
  awaitingRemoteBusy: false,
  seenRemoteBusy: false,
};

export function notePromptQueueSendStarted(): PromptQueueDrainLatch {
  return { awaitingRemoteBusy: true, seenRemoteBusy: false };
}

/** Latch stays until this session is seen remote-busy, then idle. Tab switch must not reset it. */
export function advancePromptQueueDrainLatch(
  latch: PromptQueueDrainLatch,
  remoteBusy: boolean,
): PromptQueueDrainLatch {
  if (remoteBusy) return { awaitingRemoteBusy: false, seenRemoteBusy: true };
  if (latch.awaitingRemoteBusy) return latch;
  if (latch.seenRemoteBusy) return EMPTY_PROMPT_QUEUE_DRAIN_LATCH;
  return latch;
}

export function promptQueueDrainLatchBlocks(latch: PromptQueueDrainLatch): boolean {
  return latch.awaitingRemoteBusy || latch.seenRemoteBusy;
}

export function shouldDrainQueuedPrompt(input: {
  busy: boolean;
  draining: boolean;
  queuedCount: number;
  awaitingTurn: boolean;
  paused: boolean;
}): boolean {
  return (
    !input.busy
    && !input.draining
    && !input.awaitingTurn
    && !input.paused
    && input.queuedCount > 0
  );
}

/** Queued drain must not clear or overwrite the live composer. */
export function shouldTouchComposerOnSend(queuedDraft?: ComposerDraft): boolean {
  return queuedDraft == null;
}

export function composerDraftToRequeue(draft: ComposerDraft): ComposerDraft | null {
  if (!draft.text.trim() && draft.attachments.length === 0) return null;
  return draft;
}

export function insertQueuedPrompt(
  items: QueuedPrompt[],
  draft: ComposerDraft,
  id: string,
): QueuedPrompt[] {
  if (items.length >= MAX_QUEUED_PROMPTS) return items;
  return [...items, { id, draft }];
}

export function removeQueuedPrompt(
  items: QueuedPrompt[],
  id: string,
): { items: QueuedPrompt[]; removed: QueuedPrompt | null } {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return { items, removed: null };
  const next = items.slice();
  const [removed] = next.splice(index, 1);
  return { items: next, removed };
}

export function promoteQueuedPrompt(items: QueuedPrompt[], id: string): QueuedPrompt[] {
  const index = items.findIndex((item) => item.id === id);
  if (index <= 0) return items;
  const next = items.slice();
  const [item] = next.splice(index, 1);
  next.unshift(item);
  return next;
}

export function moveQueuedPrompt(
  items: QueuedPrompt[],
  fromId: string,
  toId: string,
): QueuedPrompt[] {
  if (fromId === toId) return items;
  const from = items.findIndex((item) => item.id === fromId);
  const to = items.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0) return items;
  const next = items.slice();
  const [item] = next.splice(from, 1);
  const insertAt = from < to ? to - 1 : to;
  next.splice(insertAt, 0, item);
  return next;
}

export function restoreQueuedPrompt(
  items: QueuedPrompt[],
  item: QueuedPrompt,
): QueuedPrompt[] {
  if (items.some((entry) => entry.id === item.id)) return items;
  if (items.length >= MAX_QUEUED_PROMPTS) {
    return [item, ...items.slice(0, MAX_QUEUED_PROMPTS - 1)];
  }
  return [item, ...items];
}

export function takeQueuedPrompt(items: QueuedPrompt[]): {
  next: QueuedPrompt | null;
  rest: QueuedPrompt[];
} {
  if (items.length === 0) return { next: null, rest: items };
  return { next: items[0], rest: items.slice(1) };
}
