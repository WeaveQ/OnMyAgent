/** @jsxImportSource react */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { type UIMessage } from "ai";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  revealDesktopItemCandidates,
} from "../../../../app/lib/desktop";
import { currentLocale } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  type StepGroupMode,
} from "../../../../app/types";
import { groupMessageParts } from "../../../../app/utils";
import { DEFAULT_SHOW_THINKING } from "../../../kernel/local-provider";
import { type MarkdownCodePathOpenMode, type MarkdownVerifiedCodePath } from "./markdown";

import { buildTranscriptTurns } from "./transcript/turn-model";
import {
  groupTranscriptRenderItems,
  type TranscriptRenderItem,
} from "./transcript/render-items";
import {
  summarizeTranscriptTurn,
} from "./transcript/turn-presentation";
import {
  buildTurnContentPresentation,
  type TurnContentPresentation,
} from "./transcript/turn-content";
import {
  classifyOpenTarget,
  resolveArtifactRevealCandidates,
  type OpenTarget,
} from "../artifacts/open-target";
import {
  MESSAGE_LIST_CONTAIN_STYLE,
} from "./message-list/styles";
import type {
  MessageBlockItem,
  SessionTranscriptDivider,
  SessionTranscriptDividerVariant,
  StepClusterBlock,
  TranscriptBlockTurnPresentation,
  TranscriptMessage,
  TranscriptPart,
} from "./message-list/types";
import {
  cancelledAssistantMessageIds,
  isTranscriptDividerReady,
} from "./message-list/dividers";
import { resolveDisplayedPastedText } from "./message-list/pasted-text";
import {
  toggleTranscriptFeedback,
  type TranscriptFeedbackValue,
} from "./message-list/feedback";
import { selectTurnOpenTargets } from "./message-list/open-targets";
import {
  blockIdentityKey,
  canMergeStepClusters,
  mergeLeadingAssistantStepClusters,
  messageIdsForBlock,
  shouldFoldStepGroups,
  stabilizeMessageBlocks,
} from "./message-list/block-model";
import {
  attachmentsForParts,
  isAttachmentPart,
  messageToText,
  partToText,
  partsForUserVisibleGroups,
  toLegacyPart,
} from "./message-list/parts";
import { estimateRenderItemSize } from "./message-list/estimate-size";
import {
  summarizeStepCluster,
} from "./message-list/step-cluster";
import {
  processFoldChipMeta,
  shouldUseSemanticProcessFold,
} from "./message-list/process-fold";
import {
  TranscriptAssistantHeader,
} from "./message-list/chrome";
import { MessageBlockRow } from "./message-list/message-block-row";
import { blockIsActivelyStreaming } from "./message-list/message-block-row-equality";
import { activeTurnReserveStyle } from "./message-list/virtual-window";

export type {
  SessionTranscriptDivider,
  SessionTranscriptDividerVariant,
} from "./message-list/types";
export type { TranscriptFeedbackValue } from "./message-list/feedback";
export {
  isTranscriptDividerReady,
  summarizeStepCluster,
  canMergeStepClusters,
  shouldFoldStepGroups,
  mergeLeadingAssistantStepClusters,
  toggleTranscriptFeedback,
  resolveDisplayedPastedText,
  shouldUseSemanticProcessFold,
  processFoldChipMeta,
  selectTurnOpenTargets,
};

type SessionTranscriptProps = {
  messages: UIMessage[];
  isStreaming: boolean;
  developerMode: boolean;
  showThinking?: boolean;
  expandedStepIds?: Set<string>;
  onExpandedStepIdsChange?: (updater: (current: Set<string>) => Set<string>) => void;
  searchMatchMessageIds?: ReadonlySet<string>;
  activeSearchMessageId?: string | null;
  searchHighlightQuery?: string;
  scrollElement?: () => HTMLElement | null | undefined;
  /**
   * Prefer a stable ref over a register callback so parent re-renders
   * (composer typing, sending flag) do not bust SessionTranscript memo.
   */
  scrollToMessageByIdRef?: {
    current: ((messageId: string, behavior?: ScrollBehavior) => boolean) | null;
  };
  /** @deprecated Prefer scrollToMessageByIdRef for stable memo props. */
  setScrollToMessageById?: (
    handler: ((messageId: string, behavior?: ScrollBehavior) => boolean) | null,
  ) => void;
  footer?: ReactNode;
  dividers?: SessionTranscriptDivider[];
  variant?: "default" | "nested";
  /** Revert to this message (undo everything after it). */
  onRevertToMessage?: (messageId: string) => void;
  openTargets?: OpenTarget[];
  onOpenTarget?: (target: OpenTarget) => void;
  workspaceRoot?: string;
  /**
   * When set, renders this identity once at the start of each visible
   * assistant turn. The root transcript always supplies the active identity.
   */
  assistantAvatar?: { name: string; avatarUrl: string | null; avatarBackground?: string | null };
};

// 500 was too high for real-world OnMyAgent sessions: a handful of giant
// messages (emails, legal docs, pasted transcripts) can still produce a
// massive DOM even when the block count is low. Lowering the threshold means
// we switch to react-virtual much earlier and keep the main thread lighter
// during workspace/session switches.
// Virtualize aggressively. A session with 20+ message blocks already pays
// more to render eagerly than to run the virtualizer, so there's no reason
// to defer. The only reason the threshold exists at all is to avoid the
// virtualizer's baseline overhead for tiny sessions.
const VIRTUALIZATION_THRESHOLD = 20;
const VIRTUAL_OVERSCAN = 4;

function TranscriptDividerRow(props: {
  label: string;
  variant?: SessionTranscriptDividerVariant;
}) {
  return (
    <div
      className={cn(
        "session-transcript-divider mx-auto flex items-center justify-center gap-3 px-3 py-3 text-xs text-dls-secondary sm:px-5",
        props.variant && `session-transcript-divider-${props.variant}`,
      )}
      data-divider-variant={props.variant}
    >
      <div className="session-transcript-divider-line min-w-10 flex-1" />
      <span className="session-transcript-divider-label shrink-0">{props.label}</span>
      <div className="session-transcript-divider-line min-w-10 flex-1" />
    </div>
  );
}

function SessionTranscriptInner(props: SessionTranscriptProps) {
  const showThinking = props.showThinking ?? DEFAULT_SHOW_THINKING;
  const isNestedVariant = props.variant === "nested";
  const transcriptLocale = currentLocale();
  const [internalExpandedStepIds, setInternalExpandedStepIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedTurnIds, setExpandedTurnIds] = useState<Set<string>>(
    () => new Set(),
  );
  const expandedStepIds = props.expandedStepIds ?? internalExpandedStepIds;
  const internalOnExpandedStepIdsChange = useCallback(
    (updater: (current: Set<string>) => Set<string>) => {
      setInternalExpandedStepIds((current) => updater(current));
    },
    [],
  );
  // Stable callback identity so memo(MessageBlockRow) is not busted every parent render.
  const onExpandedStepIdsChange =
    props.onExpandedStepIdsChange ?? internalOnExpandedStepIdsChange;
  const onTurnDetailsExpandedChange = useCallback((turnId: string, expanded: boolean) => {
    if (!turnId) return;
    setExpandedTurnIds((current) => {
      const next = new Set(current);
      if (expanded) next.add(turnId);
      else next.delete(turnId);
      return next;
    });
  }, []);

  const transcriptMessages = useMemo<TranscriptMessage[]>(() => {
    return props.messages.map((message) => ({
      id: message.id,
      role: message.role,
      source: message,
      parts: message.parts.flatMap((part, index) => {
        const legacyPart = toLegacyPart(part, `${message.id}:${index}`);
        return legacyPart ? [legacyPart] : [];
      }),
    }));
  }, [props.messages]);

  // Cache of the previous messageBlocks array, indexed by identity key.
  // Used by useStableBlocks below so structurally-equivalent blocks keep
  // their previous object reference across renders.
  const previousBlocksRef = useRef<Map<string, MessageBlockItem>>(new Map());

  const rawMessageBlocks = useMemo<MessageBlockItem[]>(() => {
    const blocks: MessageBlockItem[] = [];
    const dividers = [...(props.dividers ?? [])]
      .filter((divider) => divider.label.trim())
      .sort((left, right) => {
        if (left.afterMessageCount !== right.afterMessageCount) {
          return left.afterMessageCount - right.afterMessageCount;
        }
        return left.id.localeCompare(right.id);
      });
    let nextDividerIndex = 0;
    const pushReadyDividers = (afterMessageCount: number) => {
      while (
        nextDividerIndex < dividers.length &&
        isTranscriptDividerReady(dividers[nextDividerIndex], afterMessageCount)
      ) {
        const divider = dividers[nextDividerIndex];
        if (divider) {
          blocks.push({
            kind: "divider",
            id: divider.id,
            label: divider.label,
            variant: divider.variant,
            afterMessageCount: divider.afterMessageCount,
            isUser: false,
          });
        }
        nextDividerIndex += 1;
      }
    };

    pushReadyDividers(0);
    transcriptMessages.forEach((message, messageIndex) => {
      const renderableParts = message.parts.filter((part) => {
        if (part.type === "reasoning") {
          return showThinking;
        }

        if (part.type === "step-start" || part.type === "step-finish") {
          return false;
        }

        return (
          part.type === "text" ||
          part.type === "tool" ||
          part.type === "agent" ||
          part.type === "file" ||
          props.developerMode
        );
      });

      if (!renderableParts.length) {
        pushReadyDividers(messageIndex + 1);
        return;
      }

      // Filter out empty assistant messages. A newly-created session can briefly have
      // an empty assistant message with just a text part containing whitespace.
      // User messages always render even if empty because they carry the prompt.
      const isUser = message.role === "user";
      if (!isUser && renderableParts.every((part) => {
        if (part.type === "text") return partToText(part).trim().length === 0;
        if (part.type === "reasoning") return partToText(part).trim().length === 0;
        return false;
      })) {
        pushReadyDividers(messageIndex + 1);
        return;
      }
      const attachments = attachmentsForParts(renderableParts);
      // File parts render as chips only; never as raw text rows.
      const nonAttachmentParts = renderableParts.filter((part) => !isAttachmentPart(part));
      // Strip model-only upload path dump from user bubbles (chips carry the files).
      const visibleParts = isUser
        ? partsForUserVisibleGroups(nonAttachmentParts)
        : nonAttachmentParts;
      const groups = groupMessageParts(visibleParts, message.id);
      const isStepsOnly = groups.length > 0 && groups.every((group) => group.kind === "steps");
      const stepGroups = isStepsOnly
        ? (groups as Array<{
            kind: "steps";
            id: string;
            parts: TranscriptPart[];
            segment: "execution";
            mode: StepGroupMode;
          }>).map((group) => ({
            id: group.id,
            parts: group.parts,
            mode: group.mode,
          }))
        : [];

      if (isStepsOnly && stepGroups.length > 0) {
        const nextBlock: StepClusterBlock = {
          kind: "steps-cluster",
          id: stepGroups[0].id,
          stepGroups,
          messageIds: [message.id],
          isUser,
        };
        const previousBlock = blocks.at(-1);
        if (canMergeStepClusters(previousBlock, nextBlock) && previousBlock?.kind === "steps-cluster") {
          previousBlock.stepGroups = [...previousBlock.stepGroups, ...nextBlock.stepGroups];
          previousBlock.messageIds = [...previousBlock.messageIds, ...nextBlock.messageIds];
        } else {
          blocks.push(nextBlock);
        }
        pushReadyDividers(messageIndex + 1);
        return;
      }

      blocks.push({
        kind: "message",
        message: message.source,
        renderableParts,
        attachments,
        groups,
        isUser,
        messageId: message.id,
      });
      pushReadyDividers(messageIndex + 1);
    });
    while (nextDividerIndex < dividers.length) {
      const divider = dividers[nextDividerIndex];
      if (divider) {
        blocks.push({
          kind: "divider",
          id: divider.id,
          label: divider.label,
          variant: divider.variant,
          afterMessageCount: divider.afterMessageCount,
          isUser: false,
        });
      }
      nextDividerIndex += 1;
    }

    return blocks;
  }, [props.developerMode, props.dividers, showThinking, transcriptMessages]);

  // Structural sharing: reuse previous block refs when content-equivalent
  // (see stabilizeMessageBlocks) so memo'd rows skip work during streaming.
  const messageBlocks = useMemo<MessageBlockItem[]>(() => {
    const stabilized = stabilizeMessageBlocks(
      previousBlocksRef.current,
      rawMessageBlocks,
    );
    previousBlocksRef.current = stabilized.nextByKey;
    return stabilized.blocks;
  }, [rawMessageBlocks]);

  const cancelledMessageIds = useMemo(
    () => cancelledAssistantMessageIds(props.messages, props.dividers),
    [props.dividers, props.messages],
  );
  const transcriptTurns = useMemo(
    () => buildTranscriptTurns(props.messages, {
      isStreaming: props.isStreaming,
      cancelledMessageIds,
    }),
    [cancelledMessageIds, props.isStreaming, props.messages],
  );
  const turnIdByMessageId = useMemo(() => {
    const turnIds = new Map<string, string>();
    transcriptTurns.forEach((turn) => {
      turn.messages.forEach((message) => turnIds.set(message.id, turn.id));
    });
    return turnIds;
  }, [transcriptTurns]);
  const renderItems = useMemo(() => {
    if (isNestedVariant) {
      return messageBlocks.map<TranscriptRenderItem<MessageBlockItem>>((block) => {
        const blockKey = blockIdentityKey(block);
        return block.kind === "divider"
          ? { kind: "divider", id: blockKey, block }
          : { kind: "turn", id: `block:${blockKey}`, turnId: null, blocks: [block] };
      });
    }
    return groupTranscriptRenderItems(
      messageBlocks.map((block) => ({
        key: blockIdentityKey(block),
        block,
        messageIds: messageIdsForBlock(block),
        dividerId: block.kind === "divider" ? block.id : null,
      })),
      turnIdByMessageId,
    );
  }, [isNestedVariant, messageBlocks, turnIdByMessageId]);
  const firstAssistantRenderItemId = useMemo(() => (
    renderItems.find((item) => (
      item.kind === "turn" && item.blocks.some((block) => (
        block.kind !== "divider" && !block.isUser
      ))
    ))?.id ?? null
  ), [renderItems]);

  const turnContentByTurnId = useMemo(() => {
    const presentations = new Map<string, TurnContentPresentation>();
    if (isNestedVariant || props.searchHighlightQuery?.trim()) return presentations;
    transcriptTurns.forEach((turn) => {
      const presentation = buildTurnContentPresentation(turn, {
        locale: transcriptLocale,
      });
      if (presentation) presentations.set(turn.id, presentation);
    });
    return presentations;
  }, [isNestedVariant, props.searchHighlightQuery, transcriptLocale, transcriptTurns]);

  const turnPresentationByBlockKey = useMemo(() => {
    const presentations = new Map<string, TranscriptBlockTurnPresentation>();
    if (isNestedVariant) return presentations;
    const turnIdByAssistantMessageId = new Map<string, string>();
    transcriptTurns.forEach((turn) => {
      turn.assistantMessages.forEach((message) => {
        turnIdByAssistantMessageId.set(message.id, turn.id);
      });
    });
    const firstAssistantBlockKeys = new Set<string>();
    renderItems.forEach((item) => {
      if (item.kind === "divider") return;
      const firstAssistantBlock = item.blocks.find((block) =>
        messageIdsForBlock(block).some((messageId) =>
          turnIdByAssistantMessageId.has(messageId),
        ),
      );
      if (firstAssistantBlock) {
        firstAssistantBlockKeys.add(blockIdentityKey(firstAssistantBlock));
      }
    });
    const blockKeysByTurnId = new Map<string, string[]>();
    const turnsWithExecutionDetails = new Set<string>();
    messageBlocks.forEach((block) => {
      if (block.kind === "divider" || block.isUser) return;
      const messageIds = block.kind === "steps-cluster"
        ? block.messageIds
        : [...(block.leadingStepMessageIds ?? []), block.messageId];
      const turnId = messageIds
        .map((messageId) => turnIdByAssistantMessageId.get(messageId))
        .find((candidate) => candidate !== undefined);
      if (!turnId) return;
      const blockKeys = blockKeysByTurnId.get(turnId) ?? [];
      blockKeys.push(blockIdentityKey(block));
      blockKeysByTurnId.set(turnId, blockKeys);
      const hasExecutionDetails = block.kind === "steps-cluster"
        ? shouldFoldStepGroups(block.stepGroups)
        : shouldFoldStepGroups([
            ...(block.leadingStepGroups ?? []),
            ...block.groups.flatMap((group) =>
              group.kind === "steps"
                ? [{ id: group.id, parts: group.parts, mode: group.mode }]
                : [],
            ),
          ]);
      if (hasExecutionDetails) turnsWithExecutionDetails.add(turnId);
    });

    transcriptTurns.forEach((turn) => {
      const blockKeys = blockKeysByTurnId.get(turn.id);
      const turnContent = turnContentByTurnId.get(turn.id) ?? null;
      const turnContentAnchorBlockKey = turnContent
        ? blockKeys?.find((blockKey) => {
            const block = messageBlocks.find(
              (candidate) => blockIdentityKey(candidate) === blockKey,
            );
            if (!block || block.kind === "divider") return false;
            return messageIdsForBlock(block).includes(turnContent.anchorMessageId);
          })
        : undefined;
      const actionBlockKey = turnContentAnchorBlockKey ?? blockKeys?.at(-1);
      if (!blockKeys || !actionBlockKey) return;
      const presentation = summarizeTranscriptTurn(turn, messageToText);
      blockKeys.forEach((blockKey) => {
        presentations.set(blockKey, {
          ...presentation,
          copyText: turnContent?.finalText ?? presentation.copyText,
          isFirstAssistantBlock: turnContentAnchorBlockKey
            ? blockKey === turnContentAnchorBlockKey
            : firstAssistantBlockKeys.has(blockKey),
          isActionBlock: blockKey === actionBlockKey,
          hasExecutionDetails: turnContent
            ? turnContent.processItems.length > 0 || turnContent.turnCollapseEligible
            : turnsWithExecutionDetails.has(turn.id),
          turnContent,
          isTurnContentAnchor: turnContentAnchorBlockKey === blockKey,
          isHiddenByTurnContent: Boolean(
            turnContentAnchorBlockKey && blockKey !== turnContentAnchorBlockKey,
          ),
        });
      });
    });
    return presentations;
  }, [isNestedVariant, messageBlocks, renderItems, transcriptTurns, turnContentByTurnId]);

  const latestAssistantMessageId = useMemo(() => {
    for (let index = props.messages.length - 1; index >= 0; index -= 1) {
      const message = props.messages[index];
      if (message?.role === "assistant") {
        return message.id;
      }
    }
    return "";
  }, [props.messages]);

  const turnOpenTargetsByTurnId = useMemo(() => {
    const targets = new Map<string, OpenTarget[]>();
    transcriptTurns.forEach((turn) => {
      targets.set(
        turn.id,
        selectTurnOpenTargets(turn.assistantMessages, props.openTargets),
      );
    });
    return targets;
  }, [props.openTargets, transcriptTurns]);
  const verifiedMarkdownCodePaths = useMemo<MarkdownVerifiedCodePath[]>(() => (
    (props.openTargets ?? [])
      .filter((target) => target.kind === "file" && target.exists === true)
      .map((target) => ({
        path: target.value.replace(/[\\]+/g, "/").replace(/^\.\//, ""),
        resolvedPath: target.value,
      }))
  ), [props.openTargets]);
  const verifiedOpenTargetByPath = useMemo(() => new Map(
    (props.openTargets ?? [])
      .filter((target) => target.kind === "file" && target.exists === true)
      .map((target) => [target.value, target]),
  ), [props.openTargets]);
  const onOpenMarkdownCodePath = useCallback((path: string, mode: MarkdownCodePathOpenMode = "preview") => {
    const normalized = path.replace(/[\\]+/g, "/").replace(/^\.\//, "").trim();
    if (!normalized) return;
    const target = verifiedOpenTargetByPath.get(path)
      ?? verifiedOpenTargetByPath.get(normalized)
      ?? [...verifiedOpenTargetByPath.entries()].find(([key]) => {
        const candidate = key.replace(/[\\]+/g, "/");
        return candidate === normalized
          || candidate.endsWith(`/${normalized}`)
          || normalized.endsWith(`/${candidate}`);
      })?.[1];
    if (mode === "reveal") {
      const candidates = resolveArtifactRevealCandidates(normalized, {
        workspaceRoot: props.workspaceRoot,
        verifiedValue: target?.value ?? null,
      });
      void revealDesktopItemCandidates(candidates)
        .catch((error) => {
          console.error("Failed to open artifact in folder:", error, candidates);
          if (target) props.onOpenTarget?.(target);
        });
      return;
    }
    const name = normalized.split("/").filter(Boolean).at(-1) ?? normalized;
    const resolved: OpenTarget = target ?? {
      id: `file:${normalized.toLowerCase()}`,
      kind: "file",
      value: normalized,
      name,
      preview: classifyOpenTarget(normalized, "file"),
      confidence: 100,
      reason: "markdown artifact link",
    };
    props.onOpenTarget?.(resolved);
  }, [props.onOpenTarget, props.workspaceRoot, verifiedOpenTargetByPath]);

  const blockIndexByMessageId = useMemo(() => {
    const next = new Map<string, number>();
    renderItems.forEach((item, index) => {
      if (item.kind === "divider") return;
      item.blocks.forEach((block) => {
        messageIdsForBlock(block).forEach((messageId) => {
          if (messageId) next.set(messageId, index);
        });
      });
    });
    return next;
  }, [renderItems]);
  const blockIndexByKey = useMemo(() => {
    const next = new Map<string, number>();
    messageBlocks.forEach((block, index) => next.set(blockIdentityKey(block), index));
    return next;
  }, [messageBlocks]);
  const activeTurn = transcriptTurns.at(-1);
  const activeTurnHasAssistantBlock = Boolean(
    activeTurn && renderItems.some((item) => (
      item.kind === "turn" &&
      item.turnId === activeTurn.id &&
      item.blocks.some((block) => block.kind !== "divider" && !block.isUser)
    )),
  );
  const footerNeedsAssistantIdentity = Boolean(
    props.footer &&
    props.assistantAvatar &&
    activeTurn &&
    !activeTurnHasAssistantBlock,
  );
  const activeTurnId = activeTurn && (
    activeTurn.state === "streaming" || activeTurn.state === "awaiting-approval"
  ) ? activeTurn.id : null;
  const activeRenderItemId = activeTurnId
    ? renderItems.findLast((item) => item.kind === "turn" && item.turnId === activeTurnId)?.id ?? null
    : null;
  const footerRenderItemId = activeRenderItemId ?? renderItems.at(-1)?.id ?? null;
  // Live-turn minHeight reserve is intentionally 0 — see activeTurnReserveStyle.
  const activeTurnMinHeight = 0;

  // Virtualize by turn once either the turn count or the underlying block
  // count is large. Do NOT gate on whether
  // the scrollElement ref has already attached — that's false on the first
  // render of a session, which used to make us render every message
  // eagerly (freezing the UI on large sessions) for one tick before
  // switching to virtualization.
  const shouldVirtualize =
    renderItems.length >= VIRTUALIZATION_THRESHOLD ||
    messageBlocks.length >= VIRTUALIZATION_THRESHOLD;
  // Keep the newest turn in normal document flow even after streaming ends.
  // Re-inserting a just-grown row into the virtualizer on completion causes a
  // visible measurement correction before sticky-bottom catches up.
  const detachedTailRenderItemIndex = shouldVirtualize ? renderItems.length - 1 : -1;
  const detachedTailRenderItem = detachedTailRenderItemIndex >= 0
    ? renderItems[detachedTailRenderItemIndex]
    : null;
  const virtualRenderItems = detachedTailRenderItem
    ? renderItems.slice(0, detachedTailRenderItemIndex)
    : renderItems;

  // While the user is actively scrolling, skip measureElement (ResizeObserver +
  // getBoundingClientRect on every entering row). After ~3–4s of continuous
  // scrolling that measurement work piles up and the list suddenly stutters.
  // Estimates are good enough mid-gesture; remeasure once scrolling settles.
  // Keep measuring while the assistant streams — sticky-bottom fires many
  // programmatic scrolls that would otherwise disable measure and leave huge
  // estimate-only blank regions above the live tail.
  const [measureWhileScrolling, setMeasureWhileScrolling] = useState(true);
  const measureWhileScrollingRef = useRef(true);
  useEffect(() => {
    if (!shouldVirtualize) return;
    const scrollContainer = props.scrollElement?.();
    if (!scrollContainer) return;

    let settleTimer: number | undefined;
    const onScroll = () => {
      if (props.isStreaming) return;
      if (measureWhileScrollingRef.current) {
        measureWhileScrollingRef.current = false;
        setMeasureWhileScrolling(false);
      }
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        measureWhileScrollingRef.current = true;
        setMeasureWhileScrolling(true);
      }, 140);
    };
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener("scroll", onScroll);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    };
  }, [props.isStreaming, props.scrollElement, shouldVirtualize]);

  // Never inflate historical virtual-row estimates with the live-turn reserve
  // height. That reserve is only for the detached tail; baking it into
  // estimateSize left multi-viewport blank gaps after the turn scrolled up.
  const estimateVirtualItemSize = useCallback(
    (index: number) => estimateRenderItemSize(virtualRenderItems[index]),
    [virtualRenderItems],
  );

  const getVirtualItemKey = useCallback((index: number) => {
    return virtualRenderItems[index]?.id ?? `item-${index}`;
  }, [virtualRenderItems]);

  const virtualizer = useVirtualizer({
    count: virtualRenderItems.length,
    getScrollElement: () => props.scrollElement?.() ?? null,
    // TanStack recommends estimating the largest comfortable dynamic size.
    // Content-aware estimates reduce the measurement corrections that cause
    // long transcripts to jitter as previously-unmeasured rows enter view.
    estimateSize: estimateVirtualItemSize,
    overscan: VIRTUAL_OVERSCAN,
    getItemKey: getVirtualItemKey,
  });
  const virtualRows = shouldVirtualize ? virtualizer.getVirtualItems() : [];
  const firstVirtualRow = virtualRows[0];
  // When the scroll parent is not ready, getVirtualItems() is empty but
  // getTotalSize() still sums estimates — a fixed-height empty shell looks like
  // multi-screen blank space above the live message. Fall back to normal flow.
  const useVirtualWindow = shouldVirtualize && virtualRows.length > 0;
  const shouldMeasureVirtualRows =
    measureWhileScrolling || props.isStreaming;

  // After scroll settles (or while streaming), force measurement so estimates converge.
  useEffect(() => {
    if (!shouldVirtualize || !shouldMeasureVirtualRows) return;
    virtualizer.measure();
  }, [shouldMeasureVirtualRows, shouldVirtualize, virtualizer]);

  // Remeasure when the live turn ends or message volume changes (export/tools).
  const previousActiveRenderItemIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousActiveRenderItemIdRef.current;
    previousActiveRenderItemIdRef.current = activeRenderItemId;
    if (!shouldVirtualize) return;
    if (previous && previous !== activeRenderItemId) {
      virtualizer.measure();
    }
  }, [activeRenderItemId, shouldVirtualize, virtualizer]);

  useEffect(() => {
    if (!shouldVirtualize) return;
    virtualizer.measure();
  }, [props.messages.length, props.isStreaming, shouldVirtualize, virtualizer]);

  useEffect(() => {
    const scrollToMessage = (messageId: string, behavior: ScrollBehavior = "smooth") => {
      const index = blockIndexByMessageId.get(messageId);
      if (index === undefined) return false;

      if (shouldVirtualize) {
        if (index < virtualRenderItems.length) {
          virtualizer.scrollToIndex(index, { align: "center" });
        }
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            const container = props.scrollElement?.();
            if (!container) return;
            const escapedId = messageId.replace(/"/g, '\\"');
            const target = container.querySelector(
              `[data-message-id="${escapedId}"]`,
            );
            if (target instanceof HTMLElement) {
              target.scrollIntoView({ behavior, block: "center" });
            }
          });
        });
        return true;
      }

      const container = props.scrollElement?.();
      if (!container) return false;
      const escapedId = messageId.replace(/"/g, '\\"');
      const target = container.querySelector(`[data-message-id="${escapedId}"]`) as HTMLElement | null;
      if (!target) return false;
      target.scrollIntoView({ behavior, block: "center" });
      return true;
    };

    const ref = props.scrollToMessageByIdRef;
    if (ref) {
      ref.current = scrollToMessage;
      return () => {
        if (ref.current === scrollToMessage) ref.current = null;
      };
    }

    const register = props.setScrollToMessageById;
    if (!register) return;
    register(scrollToMessage);
    return () => {
      register(null);
    };
  }, [
    blockIndexByMessageId,
    props.scrollElement,
    props.scrollToMessageByIdRef,
    props.setScrollToMessageById,
    shouldVirtualize,
    virtualizer,
    virtualRenderItems.length,
  ]);

  // NOTE: we intentionally do NOT call virtualizer.measure() on every
  // messageBlocks change. react-virtual already invalidates and
  // re-measures rows whose refs remount or whose content changes. Calling
  // measure() explicitly on each streaming token forces a synchronous
  // getBoundingClientRect() pass over every measured row, which made
  // streaming into large sessions feel like the UI was frozen.

  // Apply content-visibility earlier too. Even when the transcript is below
  // the virtualization threshold, hiding distant blocks from layout/paint
  // work reduces the chance that one large session makes the UI feel frozen.
  const shouldUseContentVisibility = !shouldVirtualize && messageBlocks.length > 24;

  // Always fill the parent contentRef (SESSION max-w-[1120px]). A second
  // maxWidth here used to re-cap the body narrower than the composer card.
  const transcriptStyle = {
    ...MESSAGE_LIST_CONTAIN_STYLE,
    width: "100%",
    maxWidth: "100%",
  } satisfies CSSProperties;
  const renderConversationBlock = (block: MessageBlockItem) => {
    const blockKey = blockIdentityKey(block);
    if (block.kind === "divider") {
      return (
        <TranscriptDividerRow
          key={blockKey}
          label={block.label}
          variant={block.variant}
        />
      );
    }
    const blockIndex = blockIndexByKey.get(blockKey);
    if (blockIndex === undefined) return null;
    const turnPresentation = turnPresentationByBlockKey.get(blockKey);
    if (turnPresentation?.isHiddenByTurnContent) return null;
    return (
      <MessageBlockRow
        key={blockKey}
        block={block}
        blockIndex={blockIndex}
        totalBlocks={messageBlocks.length}
        isNestedVariant={isNestedVariant}
        shouldUseContentVisibility={shouldUseContentVisibility}
        expandedStepIds={expandedStepIds}
        onExpandedStepIdsChange={onExpandedStepIdsChange}
        searchMatchMessageIds={props.searchMatchMessageIds}
        activeSearchMessageId={props.activeSearchMessageId}
        searchHighlightQuery={props.searchHighlightQuery}
        // Per-block streaming flag so non-tail rows stay memo-stable during token bursts.
        isStreaming={blockIsActivelyStreaming(
          block,
          props.isStreaming,
          latestAssistantMessageId,
        )}
        latestAssistantMessageId={latestAssistantMessageId}
        onRevertToMessage={props.onRevertToMessage}
        turnOpenTargets={turnPresentation
          ? turnOpenTargetsByTurnId.get(turnPresentation.turnId)
          : undefined}
        verifiedCodePaths={verifiedMarkdownCodePaths}
        onOpenCodePath={onOpenMarkdownCodePath}
        onOpenTarget={props.onOpenTarget}
        workspaceRoot={props.workspaceRoot}
        assistantAvatar={props.assistantAvatar}
        showAssistantIdentity={turnPresentation?.isFirstAssistantBlock === true}
        turnPresentation={turnPresentation}
        turnDetailsExpanded={turnPresentation ? expandedTurnIds.has(turnPresentation.turnId) : false}
        onTurnDetailsExpandedChange={onTurnDetailsExpandedChange}
      />
    );
  };
  const renderTranscriptItem = (item: TranscriptRenderItem<MessageBlockItem>) => {
    if (item.kind === "divider") {
      return item.block.kind === "divider"
        ? (
            <TranscriptDividerRow
              label={item.block.label}
              variant={item.block.variant}
            />
          )
        : null;
    }
    const isActiveTurn = item.id === activeRenderItemId;
    const isDetachedTail =
      !shouldVirtualize || item.id === detachedTailRenderItem?.id;
    const isInitialAssistantOnly = item.id === firstAssistantRenderItemId && !item.blocks.some(
      (block) => block.kind !== "divider" && block.isUser,
    );
    return (
      <div
        className={cn(
          "session-transcript-turn",
          isInitialAssistantOnly && "session-transcript-turn-assistant-only",
        )}
        data-transcript-turn-id={item.turnId ?? undefined}
        data-transcript-turn-active={isActiveTurn ? "true" : undefined}
        data-transcript-turn-assistant-only={isInitialAssistantOnly ? "true" : undefined}
        style={activeTurnReserveStyle({
          isActiveTurn,
          isNestedVariant,
          isDetachedTail,
          minHeightPx: activeTurnMinHeight,
        })}
      >
        {item.blocks.map(renderConversationBlock)}
        {!isNestedVariant && props.footer && item.id === footerRenderItemId ? (
          <div className="session-transcript-assistant-row">
            {footerNeedsAssistantIdentity ? (
              <TranscriptAssistantHeader
                assistantAvatar={props.assistantAvatar}
                showAssistantAvatar
                detailsExpanded={false}
                onDetailsExpandedChange={() => undefined}
              />
            ) : null}
            {props.footer}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div
      className={cn("pb-0", !isNestedVariant && "session-transcript-root mx-auto w-full")}
      style={transcriptStyle}
    >
      {useVirtualWindow ? (
        <>
          <div
            className="relative"
            style={{
              height: `${Math.max(virtualizer.getTotalSize(), 1)}px`,
              width: "100%",
            }}
          >
            {firstVirtualRow ? (
              <div
                className="absolute left-0 top-0 w-full"
                style={{
                  transform: `translateY(${firstVirtualRow.start}px)`,
                }}
              >
                {virtualRows.map((virtualRow) => {
                  const item = virtualRenderItems[virtualRow.index];
                  if (!item) return null;
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      // Skip live measure mid-scroll — keep measuring while streaming.
                      ref={
                        shouldMeasureVirtualRows
                          ? virtualizer.measureElement
                          : undefined
                      }
                      className="w-full"
                    >
                      {renderTranscriptItem(item)}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
          {detachedTailRenderItem
            ? renderTranscriptItem(detachedTailRenderItem)
            : null}
        </>
      ) : (
        <div>
          {/*
            Prefer normal flow until the virtualizer has a real scroll window.
            Otherwise estimate-only totalSize creates a tall empty shell.
          */}
          {(shouldVirtualize ? virtualRenderItems : renderItems).map((item) => (
            <div key={item.id}>{renderTranscriptItem(item)}</div>
          ))}
          {shouldVirtualize && detachedTailRenderItem
            ? renderTranscriptItem(detachedTailRenderItem)
            : null}
        </div>
      )}
    </div>
  );
}

/**
 * Memoize at the transcript boundary so SessionSurface state churn (e.g.
 * sending=true flipping while the assistant streams) doesn't force a full
 * transcript re-render on every parent commit. Re-renders now happen only
 * when the transcript's own props actually change (messages array
 * identity, isStreaming, developerMode, etc.).
 */
export const SessionTranscript = memo(SessionTranscriptInner);
SessionTranscript.displayName = "SessionTranscript";
