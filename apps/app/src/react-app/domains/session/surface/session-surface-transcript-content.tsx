/** @jsxImportSource react */
/**
 * Presentational switch for transcript pane body:
 * skeleton | load error | waiting | expert empty | transcript.
 */
import type { ReactNode } from "react";
import { DevProfiler } from "../../../shell/dev-profiler";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  AssistantWaitingCard,
  TranscriptHistorySkeleton,
} from "./chrome/assistant-status";
import { SessionErrorCard } from "./chrome/personal-assistant";
import type { SessionError } from "./session-surface-support";
import { sessionSurfaceStateClass } from "./surface-styles";

export function SessionSurfaceTranscriptContent(props: {
  showDelayedLoading: boolean;
  pendingSessionLoad: boolean;
  snapshotQueryError: boolean;
  snapshotErrorMessage: string;
  visibleTranscriptError: SessionError | null | undefined;
  hasSnapshot: boolean;
  hasTranscriptContent: boolean;
  activityIdle: boolean;
  draftOnly?: boolean;
  snapshotEmpty: boolean;
  personalAssistantHome?: boolean;
  expertEmpty: ReactNode | null;
  waitingLabel: string;
  transcript: ReactNode;
  onDismissError: () => void;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
  onOpenModelPicker?: () => void;
}) {
  if (props.showDelayedLoading && props.pendingSessionLoad) {
    return <TranscriptHistorySkeleton pairCount={3} />;
  }

  if (
    (props.snapshotQueryError || props.visibleTranscriptError) &&
    !props.hasSnapshot &&
    !props.hasTranscriptContent
  ) {
    return (
      <div className="px-6 py-8">
        {props.visibleTranscriptError ? (
          <SessionErrorCard
            error={props.visibleTranscriptError}
            onDismiss={props.onDismissError}
            onChangeModel={props.onChangeModel}
            onOpenModelPicker={props.onOpenModelPicker}
          />
        ) : (
          <div className={sessionSurfaceStateClass.snapshotError}>
            {props.snapshotErrorMessage}
          </div>
        )}
      </div>
    );
  }

  if (
    !props.hasTranscriptContent &&
    !props.activityIdle &&
    !props.visibleTranscriptError
  ) {
    return (
      <div className="px-6 py-12">
        <AssistantWaitingCard label={props.waitingLabel} />
      </div>
    );
  }

  if (
    !props.hasTranscriptContent &&
    (props.draftOnly || props.snapshotEmpty)
  ) {
    if (props.visibleTranscriptError) {
      return (
        <SessionErrorCard
          error={props.visibleTranscriptError}
          onDismiss={props.onDismissError}
          onChangeModel={props.onChangeModel}
          onOpenModelPicker={props.onOpenModelPicker}
        />
      );
    }
    if (props.personalAssistantHome) return null;
    return props.expertEmpty;
  }

  return (
    <DevProfiler id="SessionTranscript">
      <>
        {props.transcript}
        {props.visibleTranscriptError ? (
          <SessionErrorCard
            error={props.visibleTranscriptError}
            onDismiss={props.onDismissError}
            onChangeModel={props.onChangeModel}
            onOpenModelPicker={props.onOpenModelPicker}
          />
        ) : null}
      </>
    </DevProfiler>
  );
}

/** Small badge while session model is switching (optional chrome above body). */
export function SessionSurfaceSwitchingBadge(props: {
  visible: boolean;
  fromCache: boolean;
}) {
  if (!props.visible) return null;
  return (
    <div className="flex justify-center px-6 pt-4">
      <StatusBadge tone="surface" size="default">
        {props.fromCache
          ? "Switching session from cache..."
          : "Switching session..."}
      </StatusBadge>
    </div>
  );
}
