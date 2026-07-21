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
import {
  SESSION_CONTENT_MAX_WIDTH_CLASS,
  SESSION_CONTENT_X_PADDING_CLASS,
} from "./surface-styles";

export function SessionSurfaceTranscriptPane(props: {
  /** When true (assistant draft home), the pane is not shown. */
  hidden?: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
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
        )}
      >
        <div
          ref={props.contentRef}
          className={cn("mx-auto w-full", SESSION_CONTENT_MAX_WIDTH_CLASS)}
        >
          {props.children}
        </div>
      </div>
      <TranscriptScrollToLatest
        visible={props.showJumpToLatest && !props.isAtBottom}
        label={t("session.jump_to_latest")}
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
      {/* Home: one max-w-2xl column so brand title + composer share width. */}
      <div
        className={cn(
          props.personalAssistantDraftHome &&
            "flex w-full max-w-2xl shrink-0 flex-col items-stretch",
        )}
      >
        {props.draftHome}
        <div
          ref={props.composerShellRef}
          className={cn(
            "shrink-0 px-0 pb-2 pt-2",
            (props.personalAssistantDraftHome || props.homeComposerLayout) &&
              "w-full pb-0 pt-0",
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
