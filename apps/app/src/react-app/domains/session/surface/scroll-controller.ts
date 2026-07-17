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
  active: boolean;
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
  const messageEls = container.querySelectorAll("[data-message-id]");
  for (const element of messageEls) {
    if (!(element instanceof HTMLElement)) continue;
    if (messageIdForElement(element) === messageId) return element;
  }
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

export function useSessionScrollController(
  options: SessionScrollControllerOptions,
) {
  const selectedSessionId = options.selectedSessionId;
  const selectScrollState = useCallback(
    (state: ReturnType<typeof useSessionScrollStore.getState>) => getSessionScrollState(state.sessions, selectedSessionId),
    [selectedSessionId],
  );
  const scrollState = useSessionScrollStore(selectScrollState);
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
  const prependAnchorRef = useRef<{
    sessionId: string;
    messageId: string;
    top: number;
    scrollTop: number;
  } | null>(null);

  const isAtBottom = scrollState.mode === "stickyBottom";
  const topClippedMessageId = scrollState.topClippedMessageId;

  const hasScrollGesture = useCallback(
    () => Date.now() - lastGestureAtRef.current < SCROLL_GESTURE_WINDOW_MS,
    [],
  );

  const updateOverflowAnchor = useCallback(() => {
    const container = options.containerRef.current;
    if (!container) return;
    container.style.overflowAnchor = isAtBottom ? "none" : "auto";
  }, [isAtBottom, options.containerRef]);

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

  const refreshTopClippedMessage = useCallback(() => {
    const container = options.containerRef.current;
    const nextId = container ? latestMessageTopClippedId(container) : null;
    setTopClippedMessageId(selectedSessionId, nextId);
    return nextId;
  }, [options.containerRef, selectedSessionId, setTopClippedMessageId]);

  const syncToBottom = useCallback(() => {
    const container = options.containerRef.current;
    if (!container) return;

    programmaticScrollRef.current = true;
    container.scrollTop = container.scrollHeight;
    lastKnownScrollTopRef.current = container.scrollTop;
    refreshTopClippedMessage();
    releaseProgrammaticScrollSoon();
  }, [options.containerRef, refreshTopClippedMessage, releaseProgrammaticScrollSoon]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const container = options.containerRef.current;
      if (!container) return;

      setStickyBottom(selectedSessionId, null);
      programmaticScrollRef.current = true;

      if (behavior === "smooth") {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        releaseProgrammaticScrollSoon();
        return;
      }

      syncToBottom();
    },
    [options.containerRef, releaseProgrammaticScrollSoon, selectedSessionId, setStickyBottom, syncToBottom],
  );

  const saveScrollPosition = useCallback(
    (container: HTMLDivElement) => {
      const nextTopClippedMessageId = latestMessageTopClippedId(container);
      if (isExactlyAtBottom(container)) {
        setStickyBottom(selectedSessionId, nextTopClippedMessageId);
      } else {
        setManualScroll(selectedSessionId, container.scrollTop, nextTopClippedMessageId);
      }
      return nextTopClippedMessageId;
    },
    [selectedSessionId, setManualScroll, setStickyBottom],
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

      // If the user scrolls up meaningfully while a programmatic scroll is
      // in flight, abandon the programmatic state and switch to manual browse
      // immediately. Without this the ResizeObserver's auto-scroll during
      // streaming keeps re-anchoring us to the bottom and the user can never
      // actually get away from the tail of the transcript.
      if (intent === "interrupt-follow") {
        programmaticScrollRef.current = false;
        clearProgrammaticScrollReset();
        saveScrollPosition(container);
        lastKnownScrollTopRef.current = currentTop;
        return;
      }

      if (intent === "follow-frame") {
        lastKnownScrollTopRef.current = currentTop;
        refreshTopClippedMessage();
        return;
      }

      if (intent === "restore-follow") {
        setStickyBottom(selectedSessionId, latestMessageTopClippedId(container));
        lastKnownScrollTopRef.current = currentTop;
        return;
      }

      if (intent === "passive") {
        refreshTopClippedMessage();
        lastKnownScrollTopRef.current = currentTop;
        return;
      }

      saveScrollPosition(container);
      lastKnownScrollTopRef.current = currentTop;
    },
    [clearProgrammaticScrollReset, hasScrollGesture, refreshTopClippedMessage, saveScrollPosition, selectedSessionId, setStickyBottom],
  );

  const jumpToLatest = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      scrollToBottom(behavior);
    },
    [scrollToBottom],
  );

  useEffect(() => {
    updateOverflowAnchor();
  }, [updateOverflowAnchor]);

  useLayoutEffect(() => {
    void options.renderedMessages;
    if (
      !isAtBottom ||
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
    isAtBottom,
    options.active,
    options.renderedMessages,
    options.sessionChangeScroll,
    syncToBottom,
  ]);

  useEffect(() => {
    const content = options.contentRef.current;
    if (!content) return;

    observedContentHeightRef.current = content.offsetHeight;
    const stickToMutatedGrowth = () => {
      const nextContent = options.contentRef.current;
      if (!nextContent) return;

      // Math, Mermaid, syntax highlighting, iframe reports, and other child
      // effects can change transcript geometry without changing the messages
      // prop. MutationObserver runs in the same microtask checkpoint as those
      // DOM writes; forcing layout here lets us pin the tail before the next
      // frame instead of waiting for a later ResizeObserver delivery.
      const nextHeight = nextContent.offsetHeight;
      const grew = nextHeight > observedContentHeightRef.current + 1;
      observedContentHeightRef.current = nextHeight;
      if (shouldAutoStickTranscriptGrowth({
        grew,
        stickyBottom: isAtBottom,
        active: options.active,
        userInteracting: hasScrollGesture(),
        sessionChangeScroll: options.sessionChangeScroll,
      })) {
        syncToBottom();
      }
    };
    const mutationObserver = new MutationObserver(stickToMutatedGrowth);
    mutationObserver.observe(content, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const observer = new ResizeObserver(() => {
      const nextContent = options.contentRef.current;
      if (!nextContent) return;

      const nextHeight = nextContent.offsetHeight;
      const previousContentHeight = observedContentHeightRef.current;
      const grew = nextHeight > previousContentHeight + 1;
      observedContentHeightRef.current = nextHeight;

      // Only re-anchor to the bottom when we're already in sticky bottom mode
      // AND the user isn't actively scrolling. If they've touched the wheel,
      // touchpad, or scrollbar in the last SCROLL_GESTURE_WINDOW_MS, treat
      // that as intent to break out of autoscroll and leave their position
      // alone until the next handleScroll tick reclassifies the mode.
      if (shouldAutoStickTranscriptGrowth({
        grew,
        stickyBottom: isAtBottom,
        active: options.active,
        userInteracting: hasScrollGesture(),
        sessionChangeScroll: options.sessionChangeScroll,
      })) {
        syncToBottom();
        return;
      }

      refreshTopClippedMessage();
    });

    observer.observe(content);
    return () => {
      mutationObserver.disconnect();
      observer.disconnect();
    };
  }, [
    hasScrollGesture,
    isAtBottom,
    options.active,
    options.contentRef,
    options.sessionChangeScroll,
    refreshTopClippedMessage,
    syncToBottom,
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
    options.containerRef,
    options.sessionChangeScroll,
    releaseProgrammaticScrollSoon,
    saveScrollPosition,
    scrollToBottom,
    selectedSessionId,
    setManualScroll,
  ]);

  const renderedMessageIdsKey = options.renderedMessageIds.join("\u0000");
  useLayoutEffect(() => {
    const previousIds = previousMessageIdsRef.current;
    const prependedCount = countPrependedTranscriptMessages(
      previousIds,
      options.renderedMessageIds,
    );
    const pendingAnchor = prependAnchorRef.current;
    const container = options.containerRef.current;

    if (
      prependedCount > 0 &&
      pendingAnchor?.sessionId === selectedSessionId &&
      scrollState.mode === "manual" &&
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
      if (!selectedSessionId || !currentContainer || scrollState.mode !== "manual") {
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
    saveScrollPosition,
    scrollState.mode,
    selectedSessionId,
  ]);

  useEffect(() => {
    void options.renderedMessages;
    queueMicrotask(refreshTopClippedMessage);
  }, [options.renderedMessages, refreshTopClippedMessage]);

  useEffect(() => {
    return () => {
      clearProgrammaticScrollReset();
    };
  }, [clearProgrammaticScrollReset]);

  return {
    isAtBottom,
    topClippedMessageId,
    handleScroll,
    markScrollGesture,
    markWheelGesture,
    scrollToBottom,
    jumpToLatest,
  };
}
