import type {
  ComponentProps,
  Dispatch,
  SetStateAction,
} from "react";
import type { NavigateFunction } from "react-router-dom";
import type { SessionPageProps } from "./session-page-types";
import type { OnMyAgentPrimaryView } from "../sidebar/session-chrome";
import type { SidePanelItem } from "../../../shell";
import type { OpenTarget } from "../artifacts/open-target";

export type ExpertPageRailViewProps = {
  account: SessionPageProps["account"];
  selectedWorkspaceId: string;
  onNavigateToMode: (mode: "assistant" | "expert") => void;
  onOpenAccountSettings: SessionPageProps["onOpenAccountSettings"];
  onOpenProfile: SessionPageProps["onOpenProfile"];
  onSignOut: SessionPageProps["onSignOut"];
  activeSidebarView: OnMyAgentPrimaryView;
  closeExpertCreation: () => void;
  closeExpertCreationThen: (callback: (() => void) | undefined) => () => void;
  openRailView: (view: OnMyAgentPrimaryView) => void;
  navigate: NavigateFunction;
  setAgentPanelCollapsed: Dispatch<SetStateAction<boolean>>;
};

export type ExpertPageSidePanelViewProps = {
  settingsSlot: SessionPageProps["settingsSlot"];
  selectedSessionFileRoot: SessionPageProps["selectedSessionFileRoot"];
  runtimeWorkspaceId: SessionPageProps["runtimeWorkspaceId"];
  selectedSessionId: SessionPageProps["selectedSessionId"];
  onmyagentServerClient: SessionPageProps["onmyagentServerClient"];
  sidePanelOpen: boolean;
  isPrimarySessionView: boolean;
  browserPanelRef: ComponentProps<
    typeof import("@/components/ui/resizable").ResizablePanel
  >["panelRef"];
  activeSidePanel: SidePanelItem | null;
  canvasSessionKey: ComponentProps<
    typeof import("./lazy-session-side-panels").LazyInfiniteCanvasPanel
  >["canvasKey"];
  closeRightPane: () => void;
  codeWorkspacePath: string;
  codeWorkspaceCatalogRoot: string;
  artifactFileTargets: ComponentProps<
    typeof import("./lazy-session-side-panels").LazyCodeWorkspaceSidePanel
  >["fileTargets"];
  artifactTarget: OpenTarget | null;
  artifactFocusToken: number;
  openCreatedAutomation: ComponentProps<
    typeof import("./lazy-session-side-panels").LazyCodeWorkspaceSidePanel
  >["onViewAutomation"];
  snapToBrowserWidth: () => void;
  activeExpertFeatureCategoryId: string | null;
};
