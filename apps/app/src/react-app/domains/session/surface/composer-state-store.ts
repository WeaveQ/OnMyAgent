import { create } from "zustand";

import type {
  ComposerAttachment,
  ComposerDraft,
  ComposerMentionKind,
} from "../../../../app/types";

export type ComposerPastePart = {
  id: string;
  label: string;
  text: string;
  lines: number;
};

export type ComposerSessionState = {
  draft: string;
  attachments: ComposerAttachment[];
  mentions: Record<string, ComposerMentionKind>;
  pasteParts: ComposerPastePart[];
};

export type ComposerStateStore = {
  sessions: Record<string, ComposerSessionState>;
  setDraft: (sessionId: string, draft: string) => void;
  setAttachments: (sessionId: string, attachments: ComposerAttachment[]) => void;
  setMentions: (sessionId: string, mentions: Record<string, ComposerMentionKind>) => void;
  setPasteParts: (sessionId: string, pasteParts: ComposerPastePart[]) => void;
  clearSession: (sessionId: string) => void;
};

const EMPTY_ATTACHMENTS: ComposerAttachment[] = [];
const EMPTY_MENTIONS: Record<string, ComposerMentionKind> = {};
const EMPTY_PASTE_PARTS: ComposerPastePart[] = [];

function createEmptyComposerSession(): ComposerSessionState {
  return {
    draft: "",
    attachments: [],
    mentions: {},
    pasteParts: [],
  };
}

function getWritableSession(state: ComposerStateStore, sessionId: string): ComposerSessionState {
  return state.sessions[sessionId] ?? createEmptyComposerSession();
}

export const useComposerStateStore = create<ComposerStateStore>((set) => ({
  sessions: {},
  setDraft: (sessionId, draft) => set((state) => {
    const current = getWritableSession(state, sessionId);
    if (current.draft === draft) return state;
    return { sessions: { ...state.sessions, [sessionId]: { ...current, draft } } };
  }),
  setAttachments: (sessionId, attachments) => set((state) => {
    const current = getWritableSession(state, sessionId);
    if (current.attachments === attachments) return state;
    return { sessions: { ...state.sessions, [sessionId]: { ...current, attachments } } };
  }),
  setMentions: (sessionId, mentions) => set((state) => {
    const current = getWritableSession(state, sessionId);
    if (current.mentions === mentions) return state;
    return { sessions: { ...state.sessions, [sessionId]: { ...current, mentions } } };
  }),
  setPasteParts: (sessionId, pasteParts) => set((state) => {
    const current = getWritableSession(state, sessionId);
    if (current.pasteParts === pasteParts) return state;
    return { sessions: { ...state.sessions, [sessionId]: { ...current, pasteParts } } };
  }),
  clearSession: (sessionId) => set((state) => {
    if (!state.sessions[sessionId]) return state;
    const sessions = { ...state.sessions };
    delete sessions[sessionId];
    return { sessions };
  }),
}));

export function getComposerDraft(state: ComposerStateStore, sessionId: string): string {
  return state.sessions[sessionId]?.draft ?? "";
}

export function getComposerAttachments(state: ComposerStateStore, sessionId: string): ComposerAttachment[] {
  return state.sessions[sessionId]?.attachments ?? EMPTY_ATTACHMENTS;
}

export function getComposerMentions(state: ComposerStateStore, sessionId: string): Record<string, ComposerMentionKind> {
  return state.sessions[sessionId]?.mentions ?? EMPTY_MENTIONS;
}

export function getComposerPasteParts(state: ComposerStateStore, sessionId: string): ComposerPastePart[] {
  return state.sessions[sessionId]?.pasteParts ?? EMPTY_PASTE_PARTS;
}

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

type SessionPromptQueueStore = {
  bySession: Record<string, QueuedPrompt[]>;
  enqueue: (sessionId: string, draft: ComposerDraft) => string | null;
  remove: (sessionId: string, id: string) => QueuedPrompt | null;
  promote: (sessionId: string, id: string) => void;
  reorder: (sessionId: string, fromId: string, toId: string) => void;
  take: (sessionId: string) => QueuedPrompt | null;
  restore: (sessionId: string, item: QueuedPrompt) => void;
};

const pausedByStopBySession = new Set<string>();
const drainLatchBySession = new Map<string, PromptQueueDrainLatch>();

function latchFor(sessionId: string): PromptQueueDrainLatch {
  return drainLatchBySession.get(sessionId) ?? EMPTY_PROMPT_QUEUE_DRAIN_LATCH;
}

export function pauseSessionPromptQueueDrain(sessionId: string) {
  const id = sessionId.trim();
  if (id) pausedByStopBySession.add(id);
}

export function releaseSessionPromptQueueDrainPause(sessionId: string) {
  pausedByStopBySession.delete(sessionId);
}

export function isSessionPromptQueueDrainPaused(sessionId: string): boolean {
  return pausedByStopBySession.has(sessionId);
}

export function markSessionPromptQueueSendStarted(sessionId: string) {
  drainLatchBySession.set(sessionId, notePromptQueueSendStarted());
}

export function advanceSessionPromptQueueDrainLatch(
  sessionId: string,
  remoteBusy: boolean,
): PromptQueueDrainLatch {
  const next = advancePromptQueueDrainLatch(latchFor(sessionId), remoteBusy);
  if (next.awaitingRemoteBusy || next.seenRemoteBusy) {
    drainLatchBySession.set(sessionId, next);
  } else {
    drainLatchBySession.delete(sessionId);
  }
  return next;
}

export function sessionPromptQueueDrainLatchBlocks(sessionId: string): boolean {
  return promptQueueDrainLatchBlocks(latchFor(sessionId));
}

export function clearSessionPromptQueueState(sessionId: string) {
  const id = sessionId.trim();
  if (!id) return;
  pausedByStopBySession.delete(id);
  drainLatchBySession.delete(id);
  useSessionPromptQueueStore.setState((state) => {
    if (!state.bySession[id]) return state;
    const bySession = { ...state.bySession };
    delete bySession[id];
    return { bySession };
  });
}

function sessionQueueItems(
  state: SessionPromptQueueStore,
  sessionId: string,
): QueuedPrompt[] {
  return state.bySession[sessionId] ?? [];
}

export const useSessionPromptQueueStore = create<SessionPromptQueueStore>((set) => ({
  bySession: {},
  enqueue: (sessionId, draft) => {
    const id = `qp_${crypto.randomUUID()}`;
    let accepted: string | null = null;
    set((state) => {
      const current = sessionQueueItems(state, sessionId);
      const next = insertQueuedPrompt(current, draft, id);
      if (next === current) return state;
      accepted = id;
      return { bySession: { ...state.bySession, [sessionId]: next } };
    });
    return accepted;
  },
  remove: (sessionId, id) => {
    let removed: QueuedPrompt | null = null;
    set((state) => {
      const result = removeQueuedPrompt(sessionQueueItems(state, sessionId), id);
      removed = result.removed;
      if (!removed) return state;
      const bySession = { ...state.bySession };
      if (result.items.length === 0) delete bySession[sessionId];
      else bySession[sessionId] = result.items;
      return { bySession };
    });
    return removed;
  },
  promote: (sessionId, id) => {
    set((state) => {
      const current = sessionQueueItems(state, sessionId);
      const next = promoteQueuedPrompt(current, id);
      if (next === current) return state;
      return { bySession: { ...state.bySession, [sessionId]: next } };
    });
  },
  reorder: (sessionId, fromId, toId) => {
    set((state) => {
      const current = sessionQueueItems(state, sessionId);
      const next = moveQueuedPrompt(current, fromId, toId);
      if (next === current) return state;
      return { bySession: { ...state.bySession, [sessionId]: next } };
    });
  },
  take: (sessionId) => {
    let next: QueuedPrompt | null = null;
    set((state) => {
      const result = takeQueuedPrompt(sessionQueueItems(state, sessionId));
      next = result.next;
      if (!next) return state;
      const bySession = { ...state.bySession };
      if (result.rest.length === 0) delete bySession[sessionId];
      else bySession[sessionId] = result.rest;
      return { bySession };
    });
    return next;
  },
  restore: (sessionId, item) => {
    set((state) => {
      const current = sessionQueueItems(state, sessionId);
      const next = restoreQueuedPrompt(current, item);
      if (next === current) return state;
      return { bySession: { ...state.bySession, [sessionId]: next } };
    });
  },
}));
