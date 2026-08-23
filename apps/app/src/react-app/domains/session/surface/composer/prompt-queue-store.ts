import { create } from "zustand";
import type { ComposerDraft } from "../../../../../app/types";
import {
  advancePromptQueueDrainLatch,
  insertQueuedPrompt,
  moveQueuedPrompt,
  notePromptQueueSendStarted,
  promptQueueDrainLatchBlocks,
  promoteQueuedPrompt,
  removeQueuedPrompt,
  restoreQueuedPrompt,
  takeQueuedPrompt,
  EMPTY_PROMPT_QUEUE_DRAIN_LATCH,
  type PromptQueueDrainLatch,
  type QueuedPrompt,
} from "./prompt-queue-model";

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

function sessionItems(
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
      const current = sessionItems(state, sessionId);
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
      const result = removeQueuedPrompt(sessionItems(state, sessionId), id);
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
      const current = sessionItems(state, sessionId);
      const next = promoteQueuedPrompt(current, id);
      if (next === current) return state;
      return { bySession: { ...state.bySession, [sessionId]: next } };
    });
  },
  reorder: (sessionId, fromId, toId) => {
    set((state) => {
      const current = sessionItems(state, sessionId);
      const next = moveQueuedPrompt(current, fromId, toId);
      if (next === current) return state;
      return { bySession: { ...state.bySession, [sessionId]: next } };
    });
  },
  take: (sessionId) => {
    let next: QueuedPrompt | null = null;
    set((state) => {
      const result = takeQueuedPrompt(sessionItems(state, sessionId));
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
      const current = sessionItems(state, sessionId);
      const next = restoreQueuedPrompt(current, item);
      if (next === current) return state;
      return { bySession: { ...state.bySession, [sessionId]: next } };
    });
  },
}));
