import { DEFAULT_BROWSER_SIDE_PANEL_WIDTH } from "../../../shell";
import {
  ResizableHandle,
  ResizablePanel,
} from "@/components/ui/resizable";
import {
  LazyCodeWorkspaceSidePanel,
  LazyInfiniteCanvasPanel,
} from "./lazy-session-side-panels";
import { EXPERT_SIDE_PANEL_DEFAULT_WIDTH, EXPERT_SIDE_PANEL_MIN_WIDTH } from "./expert-page-utils";
import type { ExpertPageSidePanelViewProps } from "./expert-page-view-types";

export type ExpertPageSidePanelProps = ExpertPageSidePanelViewProps;

export function ExpertPageSidePanel({
  settingsSlot,
  selectedSessionFileRoot,
  runtimeWorkspaceId,
  selectedSessionId,
  onmyagentServerClient,
  sidePanelOpen,
  isPrimarySessionView,
  browserPanelRef,
  activeSidePanel,
  canvasSessionKey,
  closeRightPane,
  codeWorkspacePath,
  codeWorkspaceCatalogRoot,
  artifactFileTargets,
  artifactTarget,
  artifactFocusToken,
  openCreatedAutomation,
  snapToBrowserWidth,
  activeExpertFeatureCategoryId,
}: ExpertPageSidePanelProps) {
  if (!sidePanelOpen || !isPrimarySessionView) return null;
  return (
    <>
      <ResizableHandle className="hidden w-[2px] before:hidden lg:flex" />
      <ResizablePanel
        key="office-side-panel"
        panelRef={browserPanelRef}
        defaultSize={`${
          activeSidePanel === "browser"
            ? DEFAULT_BROWSER_SIDE_PANEL_WIDTH
            : EXPERT_SIDE_PANEL_DEFAULT_WIDTH
        }px`}
        minSize={`${EXPERT_SIDE_PANEL_MIN_WIDTH}px`}
        maxSize="70%"
        className="min-h-0 overflow-hidden bg-dls-background lg:flex lg:flex-col"
      >
        {activeSidePanel === "canvas" ? (
          <LazyInfiniteCanvasPanel
            canvasKey={canvasSessionKey}
            onClose={closeRightPane}
          />
        ) : activeSidePanel === "extensions" && settingsSlot ? (
          <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-dls-background">
            {settingsSlot}
          </div>
        ) : (
          <LazyCodeWorkspaceSidePanel
            workspacePath={codeWorkspacePath}
            workspaceCatalogRoot={codeWorkspaceCatalogRoot}
            fileRoot={selectedSessionFileRoot ?? ""}
            fileTargets={artifactFileTargets}
            focusPath={artifactTarget?.value ?? null}
            focusToken={artifactFocusToken}
            workspaceId={runtimeWorkspaceId}
            sessionId={selectedSessionId}
            automationSourceSessionId={selectedSessionId}
            client={onmyagentServerClient}
            initialKind={
              activeSidePanel === "review"
                ? "review"
                : activeSidePanel === "terminal"
                  ? "terminal"
                  : activeSidePanel === "browser"
                    ? "browser"
                    : activeSidePanel === "artifacts"
                      ? "files"
                      : null
            }
            onClose={closeRightPane}
            onBrowserOpen={snapToBrowserWidth}
            onViewAutomation={openCreatedAutomation}
            hiddenKinds={
              activeExpertFeatureCategoryId === "office" ? ["review"] : undefined
            }
          />
        )}
      </ResizablePanel>
    </>
  );
}
