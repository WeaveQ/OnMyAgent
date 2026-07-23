import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject, type UIEventHandler } from "react";

import { getSessionScrollState, useSessionScrollStore } from "./scroll-store";
import {
  classifyTranscriptScrollIntent,
  shouldAutoStickTranscriptGrowth,
  shouldPauseTranscriptFollowOnWheel,
} from "./transcript/scroll-intent";
import {
  anchoredTranscriptScrollTop,
  countPrependedTranscriptMessages,
} from "./transcript/prepend-anchor";

const EXACT_BOTTOM_GAP_PX = 1;
// Widened from 250ms so a single wheel or trackpad flick isn't missed between
// two rapid programmatic scroll-to-bottom frames during streaming.
const SCROLL_GESTURE_WINDOW_MS = 600;
// Threshold (px) that counts as a meaningful "scroll upward" gesture. Anything
// smaller is treated as anchoring jitter and ignored so we don't trip out of
// sticky bottom mode for pixel-level content growth.
const MANUAL_BROWSE_UPWARD_THRESHOLD_PX = 16;

type SessionScrollControllerOptions = {
  selectedSessionId: string | null;
  renderedMessages: unknown;
  renderedMessageIds: readonly string[];
  containerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  sessionChangeScroll?: "bottom" | "top";
  /** Sticky-bottom while streaming / content growth. */
  active: boolean;
  /**
   * Whether the transcript chrome is on-screen (not keep-alive hidden).
   * Leaving the page saves scroll; returning restores it for the same session.
   */
  surfaceVisible?: boolean;
};

function scrollBottomGap(container: HTMLElement) {
  return container.scrollHeight - (container.scrollTop + container.clientHeight);
}

function isExactlyAtBottom(container: HTMLElement) {
  return scrollBottomGap(container) <= EXACT_BOTTOM_GAP_PX;
}

function messageIdForElement(element: HTMLElement) {
  const id = element.getAttribute("data-message-id")?.trim();
  return id && id.length > 0 ? id : null;
}

function latestMessageElement(container: HTMLElement) {
  const messageEls = container.querySelectorAll("[data-message-id]");
  for (let index = messageEls.length - 1; index >= 0; index -= 1) {
    const element = messageEls.item(index);
    if (element instanceof HTMLElement) return element;
  }
  return null;
}

function firstVisibleMessageElement(container: HTMLElement) {
  const containerRect = container.getBoundingClientRect();
  const messageEls = container.querySelectorAll("[data-message-id]");
  for (const element of messageEls) {
    if (!(element instanceof HTMLElement)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.bottom >= containerRect.top - 1) return element;
  }
  return null;
}

function messageElementById(container: HTMLElement, messageId: string) {
  // Prefer getElementById-style attribute selector for one id over scanning all.
  const escaped = messageId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const direct = container.querySelector(`[data-message-id="${escaped}"]`);
  if (direct instanceof HTMLElement) return direct;
  return null;
}

function latestMessageTopClippedId(container: HTMLElement) {
  const latestMessage = latestMessageElement(container);
  if (!latestMessage) return null;

  const messageId = messageIdForElement(latestMessage);
  if (!messageId) return null;

  const containerRect = container.getBoundingClientRect();
  const latestRect = latestMessage.getBoundingClientRect();
  const lastMessageDoesNotFit = latestRect.height > containerRect.height + 1;
  const startVisible = latestRect.top >= containerRect.top - 1 && latestRect.top <= containerRect.bottom + 1;

  return lastMessageDoesNotFit && !startVisible ? messageId : null;
}

/**
 * Transcript scroll controller.
 *
 * Performance contract:
 * - Never re-render SessionSurface on scroll frames. Sticky mode lives in a
 *   ref; only the tiny "jump to latest" chip subscribes to store mode.
 * - Mid-scroll writes only coalesce scrollTop (no O(n) topClipped measure).
 * - Layout-heavy topClipped measurement runs on leave / unmount / sticky edge.
 */
export function useSessionScrollController(
  options: SessionScrollControllerOptions,
) {
  const selectedSessionId = options.selectedSessionId;

  // Stable action handles — selecting functions from zustand never re-renders.
  const setStickyBottom = useSessionScrollStore((state) => state.setStickyBottom);
  const setManualScroll = useSessionScrollStore((state) => state.setManualScroll);
  const setTopClippedMessageId = useSessionScrollStore((state) => state.setTopClippedMessageId);

  const lastKnownScrollTopRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollResetRafARef = useRef<number | undefined>(undefined);
  const programmaticScrollResetRafBRef = useRef<number | undefined>(undefined);
  const observedContentHeightRef = useRef(0);
  const lastGestureAtRef = useRef(0);
  const previousSessionIdRef = useRef<string | null>(null);
  const previousMessageIdsRef = useRef<readonly string[]>([]);
  const pendingManualSaveRafRef = useRef<number | undefined>(undefined);
  const pendingTopClippedRafRef = useRef<number | undefined>(undefined);
  const pendingManualScrollTopRef = useRef(0);
  const pendingTopClippedIdRef = useRef<string | null>(null);
  const prependAnchorRef = useRef<{
    sessionId: string;
    messageId: string;
    top: number;
    scrollTop: number;
  } | null>(null);

  // Source of truth for sticky follow while scrolling — ref only, no React state.
  const isAtBottomRef = useRef(
    getSessionScrollState(
      useSessionScrollStore.getState().sessions,
      selectedSessionId,
    ).mode === "stickyBottom",
  );

  const hasScrollGesture = useCallback(
    () => Date.now() - lastGestureAtRef.current < SCROLL_GESTURE_WINDOW_MS,
    [],
  );

  const applyOverflowAnchor = useCallback(
    (sticky: boolean) => {
      const container = options.containerRef.current;
      if (!container) return;
      container.style.overflowAnchor = sticky ? "none" : "auto";
    },
    [options.containerRef],
  );

  const markScrollGesture = useCallback(
    (target?: EventTarget | null) => {
      const container = options.containerRef.current;
      if (!container) return;

      const el = target instanceof Element ? target : undefined;
      const nested = el?.closest("[data-scrollable]");
      if (nested && nested !== container) return;

      lastGestureAtRef.current = Date.now();
    },
    [options.containerRef],
  );

  const clearProgrammaticScrollReset = useCallback(() => {
    if (programmaticScrollResetRafARef.current !== undefined) {
      window.cancelAnimationFrame(programmaticScrollResetRafARef.current);
      programmaticScrollResetRafARef.current = undefined;
    }
    if (programmaticScrollResetRafBRef.current !== undefined) {
      window.cancelAnimationFrame(programmaticScrollResetRafBRef.current);
      programmaticScrollResetRafBRef.current = undefined;
    }
  }, []);

  const markWheelGesture = useCallback(
    (deltaY: number, target?: EventTarget | null) => {
      if (!shouldPauseTranscriptFollowOnWheel(deltaY)) return;
      markScrollGesture(target);
      programmaticScrollRef.current = false;
      clearProgrammaticScrollReset();
    },
    [clearProgrammaticScrollReset, markScrollGesture],
  );

  const releaseProgrammaticScrollSoon = useCallback(() => {
    clearProgrammaticScrollReset();
    programmaticScrollResetRafARef.current = window.requestAnimationFrame(() => {
      programmaticScrollResetRafARef.current = undefined;
      programmaticScrollResetRafBRef.current = window.requestAnimationFrame(() => {
        programmaticScrollResetRafBRef.current = undefined;
        programmaticScrollRef.current = false;
      });
    });
  }, [clearProgrammaticScrollReset]);

  const flushPendingManualScroll = useCallback(() => {
    if (pendingManualSaveRafRef.current !== undefined) {
      window.cancelAnimationFrame(pendingManualSaveRafRef.current);
      pendingManualSaveRafRef.current = undefined;
    }
    setManualScroll(
      selectedSessionId,
      pendingManualScrollTopRef.current,
      pendingTopClippedIdRef.current,
    );
  }, [selectedSessionId, setManualScroll]);

  /** Layout-heavy: measure at most once per frame; avoid on pure scroll frames. */
  const refreshTopClippedMessage = useCallback(
    (immediate = false) => {
      const measure = () => {
        const el = options.containerRef.current;
        const nextId = el ? latestMessageTopClippedId(el) : null;
        pendingTopClippedIdRef.current = nextId;
        setTopClippedMessageId(selectedSessionId, nextId);
        return nextId;
      };

      if (immediate) {
        if (pendingTopClippedRafRef.current !== undefined) {
          window.cancelAnimationFrame(pendingTopClippedRafRef.current);
          pendingTopClippedRafRef.current = undefined;
        }
        return measure();
      }

      if (pendingTopClippedRafRef.current !== undefined) {
        return pendingTopClippedIdRef.current;
      }
      pendingTopClippedRafRef.current = window.requestAnimationFrame(() => {
        pendingTopClippedRafRef.current = undefined;
        measure();
      });
      return pendingTopClippedIdRef.current;
    },
    [options.containerRef, selectedSessionId, setTopClippedMessageId],
  );

  const syncToBottom = useCallback(() => {
    const container = options.containerRef.current;
    if (!container) return;

    programmaticScrollRef.current = true;
    container.scrollTop = container.scrollHeight;
    lastKnownScrollTopRef.current = container.scrollTop;
    // Skip topClipped DOM walk on high-frequency stick-to-bottom frames.
    releaseProgrammaticScrollSoon();
  }, [options.containerRef, releaseProgrammaticScrollSoon]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const container = options.containerRef.current;
      if (!container) return;

      isAtBottomRef.current = true;
      applyOverflowAnchor(true);
      setStickyBottom(selectedSessionId, null);
      programmaticScrollRef.current = true;

      if (behavior === "smooth") {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        releaseProgrammaticScrollSoon();
        return;
      }

      syncToBottom();
    },
    [
      applyOverflowAnchor,
      options.containerRef,
      releaseProgrammaticScrollSoon,
      selectedSessionId,
      setStickyBottom,
      syncToBottom,
    ],
  );

  const saveScrollPosition = useCallback(
    (container: HTMLDivElement, immediate = false) => {
      if (isExactlyAtBottom(container)) {
        if (pendingManualSaveRafRef.current !== undefined) {
          window.cancelAnimationFrame(pendingManualSaveRafRef.current);
          pendingManualSaveRafRef.current = undefined;
        }
        isAtBottomRef.current = true;
        applyOverflowAnchor(true);
        // Only measure topClipped when leaving the page / explicit flush.
        const topClipped = immediate
          ? latestMessageTopClippedId(container)
          : pendingTopClippedIdRef.current;
        if (immediate) pendingTopClippedIdRef.current = topClipped;
        setStickyBottom(selectedSessionId, topClipped);
        return topClipped;
      }

      isAtBottomRef.current = false;
      applyOverflowAnchor(false);
      pendingManualScrollTopRef.current = container.scrollTop;

      if (immediate) {
        pendingTopClippedIdRef.current = latestMessageTopClippedId(container);
        flushPendingManualScroll();
        return pendingTopClippedIdRef.current;
      }

      // Restore scroll height persistence: coalesce scrollTop into the store
      // once per frame so leave / switch-session restore works again.
      // Still skip latestMessageTopClippedId mid-scroll (layout thrash).
      // Jump-chip only subscribes to mode — manual+scrollTop updates do not
      // re-render SessionSurface / message list.
      if (pendingManualSaveRafRef.current === undefined) {
        pendingManualSaveRafRef.current = window.requestAnimationFrame(() => {
          pendingManualSaveRafRef.current = undefined;
          setManualScroll(
            selectedSessionId,
            pendingManualScrollTopRef.current,
            pendingTopClippedIdRef.current,
          );
        });
      }
      return pendingTopClippedIdRef.current;
    },
    [
      applyOverflowAnchor,
      flushPendingManualScroll,
      selectedSessionId,
      setManualScroll,
      setStickyBottom,
    ],
  );

  const handleScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      const container = event.currentTarget;
      const currentTop = container.scrollTop;
      const previousTop = lastKnownScrollTopRef.current;
      const delta = currentTop - previousTop;
      const scrolledUp = delta <= -MANUAL_BROWSE_UPWARD_THRESHOLD_PX;
      const userGestured = hasScrollGesture();
      const exactlyAtBottom = isExactlyAtBottom(container);
      const intent = classifyTranscriptScrollIntent({
        programmatic: programmaticScrollRef.current,
        userGestured,
        scrolledUp,
        exactlyAtBottom,
      });

      if (intent === "interrupt-follow") {
        programmaticScrollRef.current = false;
        clearProgrammaticScrollReset();
        saveScrollPosition(container);
        lastKnownScrollTopRef.current = currentTop;
        return;
      }

      if (intent === "follow-frame") {
        lastKnownScrollTopRef.current = currentTop;
        return;
      }

      if (intent === "restore-follow") {
        isAtBottomRef.current = true;
        applyOverflowAnchor(true);
        // No topClipped measure mid-scroll — store mode flip only.
        setStickyBottom(selectedSessionId, pendingTopClippedIdRef.current);
        lastKnownScrollTopRef.current = currentTop;
        return;
      }

      if (intent === "passive") {
        lastKnownScrollTopRef.current = currentTop;
        return;
      }

      saveScrollPosition(container);
      lastKnownScrollTopRef.current = currentTop;
    },
    [
      applyOverflowAnchor,
      clearProgrammaticScrollReset,
      hasScrollGesture,
      saveScrollPosition,
      selectedSessionId,
      setStickyBottom,
    ],
  );

  const jumpToLatest = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      scrollToBottom(behavior);
    },
    [scrollToBottom],
  );

  // Pin tail while streaming without depending on React state for sticky mode.
  useLayoutEffect(() => {
    void options.renderedMessages;
    if (
      !isAtBottomRef.current ||
      !options.active ||
      options.sessionChangeScroll === "top" ||
      hasScrollGesture()
    ) {
      return;
    }

    // React has committed the new token, but the browser has not painted it
    // yet. Keep the tail pinned in this layout phase so users never see an
    // intermediate frame where content grows before scrollTop catches up.
    syncToBottom();
  }, [
    hasScrollGesture,
    options.active,
    options.renderedMessages,
    options.sessionChangeScroll,
    syncToBottom,
  ]);

  useEffect(() => {
    const content = options.contentRef.current;
    if (!content) return;

    observedContentHeightRef.current = content.offsetHeight;
    let mutationRaf = 0;
    const stickToMutatedGrowth = () => {
      // Coalesce streaming DOM thrash to one layout read per frame.
      if (mutationRaf) return;
      mutationRaf = window.requestAnimationFrame(() => {
        mutationRaf = 0;
        const nextContent = options.contentRef.current;
        if (!nextContent) return;

        const nextHeight = nextContent.offsetHeight;
        const grew = nextHeight > observedContentHeightRef.current + 1;
        observedContentHeightRef.current = nextHeight;
        if (shouldAutoStickTranscriptGrowth({
          grew,
          stickyBottom: isAtBottomRef.current,
          active: options.active,
          userInteracting: hasScrollGesture(),
          sessionChangeScroll: options.sessionChangeScroll,
        })) {
          syncToBottom();
        }
      });
    };
    const mutationObserver = new MutationObserver(stickToMutatedGrowth);
    // childList only — characterData/attributes fire on every streaming text
    // node update and made the conversation surface unusable while generating.
    mutationObserver.observe(content, {
      childList: true,
      subtree: true,
    });
    let resizeRaf = 0;
    const observer = new ResizeObserver(() => {
      if (resizeRaf) return;
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = 0;
        const nextContent = options.contentRef.current;
        if (!nextContent) return;

        const nextHeight = nextContent.offsetHeight;
        const previousContentHeight = observedContentHeightRef.current;
        const grew = nextHeight > previousContentHeight + 1;
        observedContentHeightRef.current = nextHeight;

        if (shouldAutoStickTranscriptGrowth({
          grew,
          stickyBottom: isAtBottomRef.current,
          active: options.active,
          userInteracting: hasScrollGesture(),
          sessionChangeScroll: options.sessionChangeScroll,
        })) {
          syncToBottom();
        }
      });
    });

    observer.observe(content);
    return () => {
      if (mutationRaf) window.cancelAnimationFrame(mutationRaf);
      if (resizeRaf) window.cancelAnimationFrame(resizeRaf);
      mutationObserver.disconnect();
      observer.disconnect();
    };
  }, [
    hasScrollGesture,
    options.active,
    options.contentRef,
    options.sessionChangeScroll,
    syncToBottom,
  ]);

  // Keep-alive hide/show: persist height when leaving; restore when returning.
  const surfaceVisible = options.surfaceVisible !== false;
  const previousSurfaceVisibleRef = useRef(surfaceVisible);
  useLayoutEffect(() => {
    const wasVisible = previousSurfaceVisibleRef.current;
    previousSurfaceVisibleRef.current = surfaceVisible;
    const container = options.containerRef.current;
    if (!selectedSessionId || !container) return;

    if (!surfaceVisible) {
      if (wasVisible) {
        flushPendingManualScroll();
        saveScrollPosition(container, true);
      }
      return;
    }

    if (wasVisible) return;
    // Became visible again on the same session (rail switch / delayed loader).
    const savedState = getSessionScrollState(
      useSessionScrollStore.getState().sessions,
      selectedSessionId,
    );
    programmaticScrollRef.current = true;
    if (savedState.mode === "manual") {
      isAtBottomRef.current = false;
      applyOverflowAnchor(false);
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = Math.min(savedState.scrollTop, maxTop);
      lastKnownScrollTopRef.current = container.scrollTop;
      window.requestAnimationFrame(() => {
        const next = options.containerRef.current;
        if (!next) {
          programmaticScrollRef.current = false;
          return;
        }
        const nextMax = Math.max(0, next.scrollHeight - next.clientHeight);
        next.scrollTop = Math.min(savedState.scrollTop, nextMax);
        lastKnownScrollTopRef.current = next.scrollTop;
        releaseProgrammaticScrollSoon();
      });
      return;
    }
    scrollToBottom("auto");
  }, [
    applyOverflowAnchor,
    flushPendingManualScroll,
    options.containerRef,
    releaseProgrammaticScrollSoon,
    saveScrollPosition,
    scrollToBottom,
    selectedSessionId,
    surfaceVisible,
  ]);

  useLayoutEffect(() => {
    if (selectedSessionId === previousSessionIdRef.current) return;
    previousSessionIdRef.current = selectedSessionId;
    if (!selectedSessionId) return;

    observedContentHeightRef.current = 0;
    lastKnownScrollTopRef.current = 0;
    if (options.sessionChangeScroll === "top") {
      const container = options.containerRef.current;
      if (container) {
        programmaticScrollRef.current = true;
        isAtBottomRef.current = false;
        applyOverflowAnchor(false);
        container.scrollTop = 0;
        setManualScroll(selectedSessionId, 0, null);
        releaseProgrammaticScrollSoon();
      }
      return;
    }

    queueMicrotask(() => {
      const container = options.containerRef.current;
      if (!container) return;

      const savedState = getSessionScrollState(useSessionScrollStore.getState().sessions, selectedSessionId);
      if (savedState.mode === "manual") {
        isAtBottomRef.current = false;
        applyOverflowAnchor(false);
        programmaticScrollRef.current = true;
        container.scrollTop = Math.min(savedState.scrollTop, Math.max(0, container.scrollHeight - container.clientHeight));
        lastKnownScrollTopRef.current = container.scrollTop;
        window.requestAnimationFrame(() => {
          const next = options.containerRef.current;
          if (!next) {
            programmaticScrollRef.current = false;
            return;
          }
          next.scrollTop = Math.min(savedState.scrollTop, Math.max(0, next.scrollHeight - next.clientHeight));
          lastKnownScrollTopRef.current = next.scrollTop;
          saveScrollPosition(next);
          releaseProgrammaticScrollSoon();
        });
        return;
      }

      scrollToBottom("auto");
    });
  }, [
    applyOverflowAnchor,
    options.containerRef,
    options.sessionChangeScroll,
    releaseProgrammaticScrollSoon,
    saveScrollPosition,
    scrollToBottom,
    selectedSessionId,
    setManualScroll,
  ]);

  // Cheap identity key — avoid joining every id into a giant string each render.
  const renderedMessageIdsKey =
    options.renderedMessageIds.length === 0
      ? ""
      : `${options.renderedMessageIds.length}:${options.renderedMessageIds[0]}:${options.renderedMessageIds[options.renderedMessageIds.length - 1]}`;

  useLayoutEffect(() => {
    const previousIds = previousMessageIdsRef.current;
    const prependedCount = countPrependedTranscriptMessages(
      previousIds,
      options.renderedMessageIds,
    );
    const pendingAnchor = prependAnchorRef.current;
    const container = options.containerRef.current;
    const isManual = !isAtBottomRef.current;

    if (
      prependedCount > 0 &&
      pendingAnchor?.sessionId === selectedSessionId &&
      isManual &&
      container
    ) {
      const anchor = messageElementById(container, pendingAnchor.messageId);
      if (anchor) {
        programmaticScrollRef.current = true;
        container.scrollTop = anchoredTranscriptScrollTop({
          scrollTop: pendingAnchor.scrollTop,
          anchorTopBefore: pendingAnchor.top,
          anchorTopAfter: anchor.getBoundingClientRect().top,
        });
        lastKnownScrollTopRef.current = container.scrollTop;
        saveScrollPosition(container);
        releaseProgrammaticScrollSoon();
      }
    }

    prependAnchorRef.current = null;
    previousMessageIdsRef.current = options.renderedMessageIds;

    return () => {
      const currentContainer = options.containerRef.current;
      if (!selectedSessionId || !currentContainer || isAtBottomRef.current) {
        prependAnchorRef.current = null;
        return;
      }
      const anchor = firstVisibleMessageElement(currentContainer);
      const messageId = anchor ? messageIdForElement(anchor) : null;
      if (!anchor || !messageId) {
        prependAnchorRef.current = null;
        return;
      }
      prependAnchorRef.current = {
        sessionId: selectedSessionId,
        messageId,
        top: anchor.getBoundingClientRect().top,
        scrollTop: currentContainer.scrollTop,
      };
    };
  }, [
    options.containerRef,
    releaseProgrammaticScrollSoon,
    renderedMessageIdsKey,
    options.renderedMessageIds,
    saveScrollPosition,
    selectedSessionId,
  ]);

  // Top-clipped is only needed for restore anchors — throttle to message set
  // changes, never per scroll frame.
  useEffect(() => {
    void options.renderedMessages;
    if (!isAtBottomRef.current) {
      queueMicrotask(() => refreshTopClippedMessage(false));
    }
  }, [options.renderedMessages, refreshTopClippedMessage]);

  useEffect(() => {
    return () => {
      clearProgrammaticScrollReset();
      if (pendingManualSaveRafRef.current !== undefined) {
        window.cancelAnimationFrame(pendingManualSaveRafRef.current);
        pendingManualSaveRafRef.current = undefined;
      }
      if (pendingTopClippedRafRef.current !== undefined) {
        window.cancelAnimationFrame(pendingTopClippedRafRef.current);
        pendingTopClippedRafRef.current = undefined;
      }
      // Flush last known position before unmount so leave-page restore works.
      const container = options.containerRef.current;
      if (container && selectedSessionId) {
        if (isExactlyAtBottom(container)) {
          setStickyBottom(selectedSessionId, latestMessageTopClippedId(container));
        } else {
          setManualScroll(
            selectedSessionId,
            container.scrollTop,
            latestMessageTopClippedId(container),
          );
        }
      }
    };
  }, [
    clearProgrammaticScrollReset,
    options.containerRef,
    selectedSessionId,
    setManualScroll,
    setStickyBottom,
  ]);

  return {
    /**
     * Snapshot only — do not put this in parent render paths that rebuild the
     * transcript. The jump-to-latest chip reads store mode on its own.
     */
    isAtBottom: isAtBottomRef.current,
    topClippedMessageId: pendingTopClippedIdRef.current,
    handleScroll,
    markScrollGesture,
    markWheelGesture,
    scrollToBottom,
    jumpToLatest,
  };
}
