/**
 * Domain-bag builders for SessionRoute → SessionSurface props assembly.
 * Keeps surface-props-hook focused on orchestration rather than bag shape.
 */
import type {
  SessionSurfaceCollaborationBag,
  SessionSurfaceDraftWorkspaceBag,
  SessionSurfaceMarketplaceBag,
  SessionSurfaceModelBag,
  SessionSurfacePermissionBag,
} from "../../domains/session/surface/session-surface-types";
import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  ComposerAccessMode,
  ComposerCollaborationMode,
  ModelRef,
} from "../../../app/types";

export function buildSessionSurfaceModelBag(input: {
  modelLabel: string;
  onModelClick: () => void;
  modelPickerOpen: boolean;
  modelUnavailable?: boolean;
  selectedModel: ModelRef;
  onModelPickerOpenChange: (open: boolean) => void;
  onModelChange: (model: ModelRef) => void;
  modelVariantLabel: string;
  modelVariant: string | null;
  modelBehaviorOptions?: { value: string | null; label: string }[];
  onModelVariantChange: (value: string | null) => void;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
}): SessionSurfaceModelBag {
  return {
    modelLabel: input.modelLabel,
    onModelClick: input.onModelClick,
    modelPickerOpen: input.modelPickerOpen,
    modelUnavailable: input.modelUnavailable,
    selectedModel: input.selectedModel,
    onModelPickerOpenChange: input.onModelPickerOpenChange,
    onModelChange: input.onModelChange,
    modelVariantLabel: input.modelVariantLabel,
    modelVariant: input.modelVariant,
    modelBehaviorOptions: input.modelBehaviorOptions,
    onModelVariantChange: input.onModelVariantChange,
    onChangeModel: input.onChangeModel,
  };
}

export function buildSessionSurfaceCollaborationBag(input: {
  sessionAccessMode?: ComposerAccessMode;
  onSessionAccessModeChange?: (mode: ComposerAccessMode) => void;
  sessionCollaborationMode?: ComposerCollaborationMode;
  onSessionCollaborationModeChange?: (mode: ComposerCollaborationMode) => void;
  planRuntime?: CollaborationPlanRuntime | null;
  onPlanRuntimeChange?: (runtime: CollaborationPlanRuntime | null) => void;
  goalRuntime?: CollaborationGoalRuntime | null;
  onGoalRuntimeChange?: (runtime: CollaborationGoalRuntime | null) => void;
  onClearSessionProgress?: () => void;
}): SessionSurfaceCollaborationBag {
  return { ...input };
}

export function buildSessionSurfacePermissionBag(
  input: SessionSurfacePermissionBag,
): SessionSurfacePermissionBag {
  return { ...input };
}

export function buildSessionSurfaceMarketplaceBag(
  input: SessionSurfaceMarketplaceBag,
): SessionSurfaceMarketplaceBag {
  return { ...input };
}

export function buildSessionSurfaceDraftWorkspaceBag(
  input: SessionSurfaceDraftWorkspaceBag,
): SessionSurfaceDraftWorkspaceBag {
  return { ...input };
}
