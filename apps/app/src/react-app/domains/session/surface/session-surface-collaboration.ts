/**
 * Access + collaboration mode state for SessionSurface.
 * Pure presentational host concern — no send/abort side effects.
 */
import { useCallback, useState } from "react";

import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  ComposerAccessMode,
  ComposerCollaborationMode,
} from "../../../../app/types";

export type SessionSurfaceCollaborationInput = {
  sessionAccessMode?: ComposerAccessMode;
  onSessionAccessModeChange?: (mode: ComposerAccessMode) => void;
  sessionCollaborationMode?: ComposerCollaborationMode;
  onSessionCollaborationModeChange?: (mode: ComposerCollaborationMode) => void;
  onPlanRuntimeChange?: (runtime: CollaborationPlanRuntime | null) => void;
  onGoalRuntimeChange?: (runtime: CollaborationGoalRuntime | null) => void;
  /** Office features active (assistant home or office feature category). */
  assistantOfficeFeaturesActive: boolean;
  assistantFeatureCategoryId: string;
};

export function useSessionSurfaceCollaboration(
  input: SessionSurfaceCollaborationInput,
) {
  const [accessMode, setAccessMode] = useState<ComposerAccessMode>("default");
  const [collaborationMode, setCollaborationMode] =
    useState<ComposerCollaborationMode>({
      planning: false,
      pursueGoal: false,
    });
  const [officeCollaborationMode, setOfficeCollaborationMode] =
    useState<ComposerCollaborationMode>({
      kind: "craft",
      planning: false,
      pursueGoal: false,
    });

  const effectiveAccessMode = input.sessionAccessMode ?? accessMode;
  const baseCollaborationMode =
    input.assistantOfficeFeaturesActive &&
    input.assistantFeatureCategoryId === "office"
      ? officeCollaborationMode
      : collaborationMode;
  const effectiveCollaborationMode =
    input.sessionCollaborationMode ?? baseCollaborationMode;

  const updateAccessMode = useCallback(
    (nextMode: ComposerAccessMode) => {
      setAccessMode(nextMode);
      input.onSessionAccessModeChange?.(nextMode);
    },
    [input.onSessionAccessModeChange],
  );

  const updateCollaborationMode = useCallback(
    (nextMode: ComposerCollaborationMode) => {
      if (nextMode.planning || nextMode.kind === "plan") {
        input.onGoalRuntimeChange?.(null);
      } else if (
        nextMode.pursueGoal === true &&
        nextMode.kind !== "craft"
      ) {
        input.onPlanRuntimeChange?.(null);
      }
      if (
        input.assistantOfficeFeaturesActive &&
        input.assistantFeatureCategoryId === "office"
      ) {
        setOfficeCollaborationMode(nextMode);
      } else {
        setCollaborationMode(nextMode);
      }
      input.onSessionCollaborationModeChange?.(nextMode);
    },
    [
      input.assistantFeatureCategoryId,
      input.assistantOfficeFeaturesActive,
      input.onGoalRuntimeChange,
      input.onPlanRuntimeChange,
      input.onSessionCollaborationModeChange,
    ],
  );

  return {
    accessMode,
    collaborationMode,
    officeCollaborationMode,
    effectiveAccessMode,
    effectiveCollaborationMode,
    updateAccessMode,
    updateCollaborationMode,
  };
}
