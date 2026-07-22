/** @jsxImportSource react */
/**
 * Presentational layout shells for SessionSurface:
 * - transcript scroll region (above composer)
 * - draft-home / composer column
 *
 * State and data stay in session-surface.tsx; these only own structure/classes.
 */
import type { ReactNode, RefObject, UIEvent, WheelEvent, TouchEvent, PointerEvent } from "react";
import { t } from "../../../../i18n";
import { cn } from "@/lib/utils";
import { TranscriptScrollToLatest } from "./chrome/transcript-scroll-to-latest";
import { getSessionScrollState, useSessionScrollStore } from "./scroll-store";
import {
  SESSION_CONTENT_MAX_WIDTH_CLASS,
  SESSION_CONTENT_X_PADDING_CLASS,
} from "./surface-styles";

/**
 * Isolated subscriber for sticky mode — only this chip re-renders when the
 * user leaves / returns to the bottom. SessionSurface + message list stay put.
 */
function TranscriptJumpToLatestChip(props: {
  sessionId: string | null | undefined;
  enabled: boolean;
  onActivate: () => void;
}) {
  const isAtBottom = useSessionScrollStore(
    (state) =>
      getSessionScrollState(state.sessions, props.sessionId).mode ===
      "stickyBottom",
  );
  return (
    <TranscriptScrollToLatest
      visible={props.enabled && !isAtBottom}
      label={t("session.jump_to_latest")}
      onActivate={props.onActivate}
    />
  );
}

export function SessionSurfaceTranscriptPane(props: {
  /** When true (assistant draft home), the pane is not shown. */
  hidden?: boolean;
  sessionId?: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  showJumpToLatest: boolean;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
  onTouchStart: (event: TouchEvent<HTMLDivElement>) => void;
  onTouchMove: (event: TouchEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  onJumpToLatest: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative min-h-0 flex-1",
        props.hidden && "hidden",
      )}
    >
      <div
        ref={props.scrollRef}
        onWheel={props.onWheel}
        onTouchStart={props.onTouchStart}
        onTouchMove={props.onTouchMove}
        onPointerDown={props.onPointerDown}
        onScroll={props.onScroll}
        className={cn(
          "absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-y-contain py-5",
          // Match composer horizontal inset so content + input share one column.
          SESSION_CONTENT_X_PADDING_CLASS,
          // Promote the scroll layer so compositor can scroll without
          // re-painting the whole session chrome on every wheel tick.
          "[transform:translateZ(0)]",
        )}
      >
        <div
          ref={props.contentRef}
          className={cn("mx-auto w-full", SESSION_CONTENT_MAX_WIDTH_CLASS)}
        >
          {props.children}
        </div>
      </div>
      <TranscriptJumpToLatestChip
        sessionId={props.sessionId}
        enabled={props.showJumpToLatest}
        onActivate={props.onJumpToLatest}
      />
    </div>
  );
}

export function SessionSurfaceComposerColumn(props: {
  /** Assistant draft home: constrained width + brand hero above composer. */
  personalAssistantDraftHome: boolean;
  homeComposerLayout: boolean;
  /** Floating code-scene tools on draft home (top-right of body). */
  floatingToolbar?: ReactNode;
  draftHome?: ReactNode;
  composerShellRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    <>
      {props.personalAssistantDraftHome && props.floatingToolbar ? (
        <div className="absolute right-5 top-14 z-20 flex items-center gap-1.5 mac:titlebar-no-drag">
          {props.floatingToolbar}
        </div>
      ) : null}
      {/*
        Brand hero stays max-w-2xl on assistant draft home.
        Composer width matches in-session (max-w-[1120px] inside the composer host)
        so expert empty and chat use the same input bar size.
      */}
      <div
        className={cn(
          "flex w-full shrink-0 flex-col items-stretch",
          props.personalAssistantDraftHome && "items-center",
        )}
      >
        {props.draftHome ? (
          <div
            className={cn(
              props.personalAssistantDraftHome &&
                "w-full max-w-2xl",
            )}
          >
            {props.draftHome}
          </div>
        ) : null}
        <div
          ref={props.composerShellRef}
          className={cn(
            "w-full shrink-0 px-0 pb-2 pt-2",
            (props.personalAssistantDraftHome || props.homeComposerLayout) &&
              "pb-0 pt-0",
          )}
        >
          {props.children}
        </div>
      </div>
    </>
  );
}

/** Outer body wrapper: centers draft home, fills height for chat. */
export function SessionSurfaceBody(props: {
  personalAssistantDraftHome: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        props.personalAssistantDraftHome &&
          "items-center justify-center px-6 pb-[min(8vh,3.5rem)] pt-6",
      )}
    >
      {props.children}
    </div>
  );
}
