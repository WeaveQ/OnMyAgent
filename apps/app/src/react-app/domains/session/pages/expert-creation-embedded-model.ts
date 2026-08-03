import type { SessionSurfaceModelBag } from "../surface/session-surface-types";

export function buildIsolatedExpertCreationModel(
  model: SessionSurfaceModelBag,
  modelPickerOpen: boolean,
  onModelPickerOpenChange: (open: boolean) => void,
): SessionSurfaceModelBag {
  return {
    ...model,
    modelPickerOpen,
    onModelPickerOpenChange,
  };
}
