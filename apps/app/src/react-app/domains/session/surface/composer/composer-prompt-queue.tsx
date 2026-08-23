/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
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
import {
  composerDraftToRequeue,
  isPromptQueueTurnBusy,
  shouldDrainQueuedPrompt,
  shouldEnqueuePrompt,
  type QueuedPrompt,
} from "./prompt-queue-model";
import {
  advanceSessionPromptQueueDrainLatch,
  isSessionPromptQueueDrainPaused,
  markSessionPromptQueueSendStarted,
  pauseSessionPromptQueueDrain,
  releaseSessionPromptQueueDrainPause,
  sessionPromptQueueDrainLatchBlocks,
  useSessionPromptQueueStore,
} from "./prompt-queue-store";

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
                  {t(
                    fileCount === 1 ? "composer.queued_files_one" : "composer.queued_files",
                    { count: fileCount },
                  )}
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
    }).catch(() => {
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
      const current = composerDraftToRequeue(
        input.buildDraft(input.draft, input.attachments),
      );
      if (current) {
        const queuedId = useSessionPromptQueueStore.getState().enqueue(input.sessionId, current);
        if (!queuedId) {
          useSessionPromptQueueStore.getState().restore(input.sessionId, removed);
          return;
        }
      }
      input.setComposerDraft(input.sessionId, removed.draft.text);
      input.setComposerAttachments(input.sessionId, removed.draft.attachments);
      input.onDraftChange(removed.draft);
    },
    [
      input.attachments,
      input.buildDraft,
      input.draft,
      input.onDraftChange,
      input.sessionId,
      input.setComposerAttachments,
      input.setComposerDraft,
    ],
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
