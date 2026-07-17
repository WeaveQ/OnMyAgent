/**
 * Public chrome-state module for session-route orchestration.
 * Groups chrome, model-picker, surface, workspace interaction, loaders,
 * and related hooks. Implementations remain in sibling files.
 */

export { useSessionRouteChromeState } from "./chrome-state-hook";
export { useSessionRouteModelPickerState } from "./model-picker-state-hook";
export { useSessionRouteComposerRuntimeState } from "./composer-runtime-state-hook";
export { useSessionRouteSurfaceProps } from "./surface-props-hook";
export { useSessionRouteWorkspaceInteraction } from "./workspace-interaction-hook";
export { useSessionRoutePermissionQuestionHandlers } from "./permission-question-hook";
export { useSessionRouteGlobalShortcuts } from "./global-shortcuts-hook";
export { useSessionRouteSessionLoader } from "./session-loader-hook";
export { useSessionRouteRefresh } from "./refresh-hook";
export { useSessionRouteModelCatalog } from "./model-catalog-hook";
export { useSessionRouteInspector } from "./inspector";
export { useRouteEngineInfo } from "./engine-info";
export { useSessionRouteRefs } from "./refs";
export * from "./sidebar-model";
export * from "./surface-guards";
