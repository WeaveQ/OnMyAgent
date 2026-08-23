/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { create } from "zustand";
import { ArrowUpToLine, GripVertical, Paperclip, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ComposerAttachment, ComposerDraft } from "../../../../../app/types";
import { t } from "../../../../../i18n";

/** Busy + empty composer keeps Stop; any sendable draft shows Send (queues). */
export function composerShowsStopButton(input: {
  busy: boolean;
  canSend: boolean;
}): boolean {
  return input.busy && !input.canSend;
}

export function shouldRestoreComposerFocus(input: {
  wasBusy: boolean;
  busy: boolean;
  externalEditorActive: boolean;
}): boolean {
  return input.wasBusy && !input.busy && !input.externalEditorActive;
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

function QueueIconButton(props: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={props.label}
            onClick={props.onClick}
            className={
              props.danger
                ? "shrink-0 text-dls-secondary hover:bg-dls-danger-soft hover:text-dls-danger"
                : "shrink-0 text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
            }
          >
            {props.children}
          </Button>
        }
      />
      <TooltipContent side="top" sideOffset={6}>
        {props.label}
      </TooltipContent>
    </Tooltip>
  );
}

function queuedPreview(item: QueuedPrompt): string {
  const text = item.draft.text.trim().replace(/\s+/g, " ");
  if (text) return text;
  const name = item.draft.attachments[0]?.name.trim();
  if (name) return name;
  return t("composer.queued_empty");
}

function ComposerPromptQueue(props: {
  items: QueuedPrompt[];
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
  onPromote: (id: string) => void;
  onReorder: (fromId: string, toId: string) => void;
}) {
  const [dragFromId, setDragFromId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const dragFromIdRef = useRef<string | null>(null);
  if (props.items.length === 0) return null;

  const handleDragStart = (event: DragEvent<HTMLLIElement>, id: string) => {
    const target = event.target;
    if (target instanceof Element && target.closest("button")) {
      event.preventDefault();
      return;
    }
    dragFromIdRef.current = id;
    setDragFromId(id);
    try {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    } catch {
      // Electron may reject setData on some drag paths.
    }
  };
  const handleDragOver = (event: DragEvent<HTMLLIElement>, id: string) => {
    const fromId = dragFromIdRef.current;
    if (!fromId || fromId === id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetId(id);
  };
  const handleDrop = (event: DragEvent<HTMLLIElement>, id: string) => {
    event.preventDefault();
    const fromId = dragFromIdRef.current ?? event.dataTransfer.getData("text/plain");
    dragFromIdRef.current = null;
    setDragFromId(null);
    setDropTargetId(null);
    if (!fromId || fromId === id) return;
    props.onReorder(fromId, id);
  };
  const clearDrag = () => {
    dragFromIdRef.current = null;
    setDragFromId(null);
    setDropTargetId(null);
  };

  return (
    <div className="overflow-hidden rounded-t-[inherit] border-b border-dls-mist mac:titlebar-no-drag">
      <div className="sr-only">
        {t("composer.queued_count", { count: props.items.length })}
      </div>
      <ul className="divide-y divide-dls-mist">
        {props.items.map((item) => {
          const preview = queuedPreview(item);
          const fileCount = item.draft.attachments.length;
          const dragging = dragFromId === item.id;
          const dropTarget = dropTargetId === item.id && dragFromId !== item.id;
          return (
            <li
              key={item.id}
              draggable
              onDragStart={(event) => handleDragStart(event, item.id)}
              onDragOver={(event) => handleDragOver(event, item.id)}
              onDrop={(event) => handleDrop(event, item.id)}
              onDragEnd={clearDrag}
              aria-grabbed={dragging || undefined}
              className={cn(
                "flex cursor-grab items-center gap-2 px-4 py-2 select-none hover:bg-dls-hover active:cursor-grabbing",
                dragging && "opacity-50",
                dropTarget &&
                  "relative before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:rounded-full before:bg-dls-accent",
              )}
            >
              <span
                className="inline-flex shrink-0 text-dls-secondary"
                aria-label={t("composer.queued_reorder")}
              >
                <GripVertical className="size-3.5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-dls-text">
                {preview}
              </span>
              {fileCount > 0 ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-dls-secondary">
                  <Paperclip className="size-3" aria-hidden="true" />
                  {t("composer.queued_files", { count: fileCount })}
                </span>
              ) : null}
              <div className="flex shrink-0 items-center">
                <QueueIconButton
                  label={t("composer.queued_promote")}
                  onClick={() => props.onPromote(item.id)}
                >
                  <ArrowUpToLine />
                </QueueIconButton>
                <QueueIconButton
                  label={t("composer.queued_edit")}
                  onClick={() => props.onEdit(item.id)}
                >
                  <Pencil />
                </QueueIconButton>
                <QueueIconButton
                  label={t("composer.queued_delete")}
                  danger
                  onClick={() => props.onRemove(item.id)}
                >
                  <Trash2 />
                </QueueIconButton>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const EMPTY_QUEUE: never[] = [];

export function useSessionPromptQueue(input: {
  sessionId: string;
  sending: boolean;
  remoteBusy: boolean;
  activityStatus: string;
  stopRequested: boolean;
  draftOnly: boolean;
  draft: string;
  attachments: ComposerAttachment[];
  buildDraft: (text: string, attachments: ComposerAttachment[]) => ComposerDraft;
  handleSend: (queued?: ComposerDraft) => Promise<boolean>;
  clearComposerSession: (sessionId: string) => void;
  onDraftChange: (draft: ComposerDraft) => void;
  setComposerDraft: (sessionId: string, draft: string) => void;
  setComposerAttachments: (sessionId: string, attachments: ComposerAttachment[]) => void;
}) {
  const items = useSessionPromptQueueStore(
    (state) => state.bySession[input.sessionId] ?? EMPTY_QUEUE,
  );
  const busy = isPromptQueueTurnBusy({
    sending: input.sending,
    remoteBusy: input.remoteBusy,
    activityStatus: input.activityStatus,
  });
  const sessionIdRef = useRef(input.sessionId);
  const drainingRef = useRef(false);
  if (sessionIdRef.current !== input.sessionId) {
    sessionIdRef.current = input.sessionId;
    drainingRef.current = false;
  }

  const sendOrEnqueue = useCallback(async () => {
    const queuedDraft = input.buildDraft(input.draft, input.attachments);
    if (
      shouldEnqueuePrompt({
        busy,
        draftOnly: input.draftOnly,
        sessionId: input.sessionId,
      })
    ) {
      if (!queuedDraft.text.trim() && queuedDraft.attachments.length === 0) return;
      const id = useSessionPromptQueueStore.getState().enqueue(input.sessionId, queuedDraft);
      if (!id) return;
      releaseSessionPromptQueueDrainPause(input.sessionId);
      input.clearComposerSession(input.sessionId);
      input.onDraftChange(input.buildDraft("", []));
      return;
    }
    const started = await input.handleSend();
    if (started) releaseSessionPromptQueueDrainPause(input.sessionId);
  }, [
    input.attachments,
    busy,
    input.buildDraft,
    input.clearComposerSession,
    input.draft,
    input.draftOnly,
    input.handleSend,
    input.onDraftChange,
    input.sessionId,
  ]);

  useEffect(() => {
    if (input.stopRequested) pauseSessionPromptQueueDrain(input.sessionId);
    advanceSessionPromptQueueDrainLatch(input.sessionId, input.remoteBusy);
    const paused =
      isSessionPromptQueueDrainPaused(input.sessionId)
      || input.activityStatus === "error";
    if (
      !shouldDrainQueuedPrompt({
        busy,
        draining: drainingRef.current,
        queuedCount: items.length,
        awaitingTurn: sessionPromptQueueDrainLatchBlocks(input.sessionId),
        paused,
      })
    ) {
      return;
    }
    const sessionId = input.sessionId;
    const next = useSessionPromptQueueStore.getState().take(sessionId);
    if (!next) return;
    drainingRef.current = true;
    void input.handleSend(next.draft).then((started) => {
      if (started) {
        markSessionPromptQueueSendStarted(sessionId);
        return;
      }
      useSessionPromptQueueStore.getState().restore(sessionId, next);
    }).finally(() => {
      if (sessionIdRef.current === sessionId) drainingRef.current = false;
    });
  }, [
    busy,
    input.activityStatus,
    input.handleSend,
    input.remoteBusy,
    input.sessionId,
    input.stopRequested,
    items.length,
  ]);

  const onRemove = useCallback(
    (id: string) => {
      useSessionPromptQueueStore.getState().remove(input.sessionId, id);
    },
    [input.sessionId],
  );
  const onEdit = useCallback(
    (id: string) => {
      const removed = useSessionPromptQueueStore.getState().remove(input.sessionId, id);
      if (!removed) return;
      input.setComposerDraft(input.sessionId, removed.draft.text);
      input.setComposerAttachments(input.sessionId, removed.draft.attachments);
      input.onDraftChange(removed.draft);
    },
    [input.onDraftChange, input.sessionId, input.setComposerAttachments, input.setComposerDraft],
  );
  const onPromote = useCallback(
    (id: string) => {
      useSessionPromptQueueStore.getState().promote(input.sessionId, id);
    },
    [input.sessionId],
  );
  const onReorder = useCallback(
    (fromId: string, toId: string) => {
      useSessionPromptQueueStore.getState().reorder(input.sessionId, fromId, toId);
    },
    [input.sessionId],
  );

  const bar =
    items.length === 0 ? null : (
      <ComposerPromptQueue
        items={items}
        onRemove={onRemove}
        onEdit={onEdit}
        onPromote={onPromote}
        onReorder={onReorder}
      />
    );

  return { sendOrEnqueue, bar, turnBusy: busy };
}
