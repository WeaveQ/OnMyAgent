import type { Dispatch, ReactNode, SetStateAction } from "react";
import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/action-row";
import { NoticeBox } from "@/components/ui/notice-box";
import { Zap } from "lucide-react";
import { SessionSurface } from "../surface/session-surface";
import type { SessionSurfaceProps } from "../surface/session-surface";
import type { PendingAgentContext } from "../../agents";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";
import type { StorePrimaryTab } from "../components/side-panel-pages";
import type { OnMyAgentPrimaryView } from "../sidebar/session-chrome";
import type { CustomConnectorDialogView } from "./use-custom-connector-dialog";
import type { SessionPageProps } from "./session-page-types";

export type ExpertPageSessionSurfaceProps = {
  surface: NonNullable<SessionPageProps["surface"]>;
  onmyagentServerClient: SessionPageProps["onmyagentServerClient"];
  runtimeWorkspaceId: string;
  todos: SessionPageProps["todos"];
  activePermission: SessionPageProps["activePermission"];
  permissionReplyBusy: SessionPageProps["permissionReplyBusy"];
  respondPermission: SessionPageProps["respondPermission"];
  autoApprovedPermissionNoticeId: SessionPageProps["autoApprovedPermissionNoticeId"];
  questionReplyBusy: SessionPageProps["questionReplyBusy"];
  safeStringify: SessionPageProps["safeStringify"];
  account: SessionPageProps["account"];
  mountExpertSessionSurface: boolean;
  wrappedOnSendDraft: NonNullable<SessionSurfaceProps["onSendDraft"]>;
  renderedSessionId: string;
  isDraftSession: boolean;
  isPrimarySessionView: boolean;
  reactSessionBaseUrl: string;
  reactSessionToken: string;
  effectiveActiveQuestion: SessionPageProps["activeQuestion"];
  effectiveRespondQuestion: SessionPageProps["respondQuestion"];
  automationOfferFlow: { busy: boolean };
  automationResultAccessory: ReactNode;
  localAuthUser: { username?: string | null } | null;
  draftSessionActive: boolean;
  headerPanelControls: ReactNode;
  conversationTabs: ReactNode;
  historySearchOpen: boolean;
  historySearchQuery: string;
  historyActiveMatch: number;
  setHistoryMatchCount: Dispatch<SetStateAction<number>>;
  openTarget: NonNullable<SessionSurfaceProps["onOpenTarget"]>;
  handleOpenTargetsChange: NonNullable<SessionSurfaceProps["onOpenTargetsChange"]>;
  activeExpertFeatureCategoryId: AssistantCategoryId;
  activeAgentContext: PendingAgentContext | null;
  setStoreActiveTab: Dispatch<SetStateAction<StorePrimaryTab>>;
  openRailView: (view: OnMyAgentPrimaryView) => void;
  openCustomConnector: (view?: CustomConnectorDialogView) => void;
};

export function ExpertPageSessionSurface({
  surface,
  onmyagentServerClient,
  runtimeWorkspaceId,
  todos,
  activePermission,
  permissionReplyBusy,
  respondPermission,
  autoApprovedPermissionNoticeId,
  questionReplyBusy,
  safeStringify,
  account,
  mountExpertSessionSurface,
  wrappedOnSendDraft,
  renderedSessionId,
  isDraftSession,
  isPrimarySessionView,
  reactSessionBaseUrl,
  reactSessionToken,
  effectiveActiveQuestion,
  effectiveRespondQuestion,
  automationOfferFlow,
  automationResultAccessory,
  localAuthUser,
  draftSessionActive,
  headerPanelControls,
  conversationTabs,
  historySearchOpen,
  historySearchQuery,
  historyActiveMatch,
  setHistoryMatchCount,
  openTarget,
  handleOpenTargetsChange,
  activeExpertFeatureCategoryId,
  activeAgentContext,
  setStoreActiveTab,
  openRailView,
  openCustomConnector,
}: ExpertPageSessionSurfaceProps) {
  if (!mountExpertSessionSurface) return null;
  return (
    <SessionSurface
      key={runtimeWorkspaceId ?? "expert-surface"}
      {...surface}
      onSendDraft={wrappedOnSendDraft}
      client={onmyagentServerClient!}
      workspaceId={runtimeWorkspaceId!}
      sessionId={renderedSessionId}
      draftOnly={isDraftSession}
      surfaceVisible={isPrimarySessionView}
      opencodeBaseUrl={reactSessionBaseUrl}
      onmyagentToken={reactSessionToken}
      todos={todos}
      permission={{
        ...surface.permission,
        activePermission,
        permissionReplyBusy,
        respondPermission,
        autoApprovedPermissionNoticeId,
        activeQuestion: effectiveActiveQuestion,
        questionReplyBusy: questionReplyBusy || automationOfferFlow.busy,
        respondQuestion: effectiveRespondQuestion,
      }}
      extraComposerAccessory={automationResultAccessory}
      safeStringify={safeStringify}
      userIdentity={{
        name:
          localAuthUser?.username ||
          account?.name ||
          account?.email ||
          t("session.current_user"),
      }}
      headerActions={draftSessionActive ? null : headerPanelControls}
      conversationTabs={conversationTabs}
      searchQuery={historySearchOpen ? historySearchQuery : ""}
      searchActiveMatchIndex={historyActiveMatch}
      onSearchMatchCountChange={setHistoryMatchCount}
      onOpenTarget={openTarget}
      onOpenTargetsChange={handleOpenTargetsChange}
      personalAssistantHome={false}
      assistantFeatureCategoryId={activeExpertFeatureCategoryId}
      agentContext={activeAgentContext}
      marketplace={{
        ...surface.marketplace,
        onOpenSkillsMarketplace: () => {
          setStoreActiveTab("skills");
          openRailView("store");
        },
        onOpenConnectorsMarketplace: () => {
          setStoreActiveTab("plugins");
          openRailView("store");
        },
        onOpenCustomConnector: () => openCustomConnector("config"),
      }}
    />
  );
}

export type ExpertPageAfterPrimaryProps = {
  selectedSessionId: SessionPageProps["selectedSessionId"];
  notFoundMessage: SessionPageProps["notFoundMessage"];
  sidebar: SessionPageProps["sidebar"];
  selectedWorkspaceId: string;
  isPrimarySessionView: boolean;
  showNoExpertConversationEmptyState: boolean;
  showDelayedSessionLoadingState: boolean;
  canRenderReactSurface: boolean;
  blockExpertSurfaceForWorkspaceError: boolean;
  showBlockingStartupSkeleton: boolean;
  showWorkspaceSetupEmptyState: boolean;
  showSelectedWorkspaceError: boolean;
  selectedWorkspaceErrorMessage: string;
  selectedWorkspaceErrorTitle: string;
};

export function ExpertPageAfterPrimary({
  selectedSessionId,
  notFoundMessage,
  sidebar,
  selectedWorkspaceId,
  isPrimarySessionView,
  showNoExpertConversationEmptyState,
  showDelayedSessionLoadingState,
  canRenderReactSurface,
  blockExpertSurfaceForWorkspaceError,
  showBlockingStartupSkeleton,
  showWorkspaceSetupEmptyState,
  showSelectedWorkspaceError,
  selectedWorkspaceErrorMessage,
  selectedWorkspaceErrorTitle,
}: ExpertPageAfterPrimaryProps) {
  if (
    !isPrimarySessionView ||
    showNoExpertConversationEmptyState ||
    showDelayedSessionLoadingState ||
    (canRenderReactSurface && !blockExpertSurfaceForWorkspaceError) ||
    showBlockingStartupSkeleton
  ) {
    return null;
  }
  return (
    <div
      className={`mx-auto max-w-[800px] px-6 ${showWorkspaceSetupEmptyState ? "pt-20" : "pt-10"}`}
    >
      {notFoundMessage ? (
        <div className="px-6 py-16 text-center">
          <div className="mx-auto max-w-md rounded-xl border border-dls-border bg-dls-card px-5 py-6">
            <h3 className="text-base font-medium text-dls-text">Workspace or session not found</h3>
            <p className="mt-2 text-sm leading-6 text-dls-secondary">{notFoundMessage}</p>
          </div>
        </div>
      ) : showWorkspaceSetupEmptyState ? (
        <div className="space-y-6 px-6 text-center">
          <IconTile size="2xl" shape="xl" border className="mx-auto rounded-xl">
            <Zap className="text-dls-secondary" />
          </IconTile>
          <div className="space-y-2">
            <h3 className="text-xl font-medium">{t("session.create_or_connect_workspace")}</h3>
            <p className="mx-auto max-w-sm text-sm text-dls-secondary">{t("workspace.empty_state_body")}</p>
          </div>
          <div className="flex justify-center">
            <Button onClick={sidebar.onOpenCreateWorkspace}>
              {t("workspace.create_workspace")}
            </Button>
          </div>
        </div>
      ) : showSelectedWorkspaceError ? (
        <div className="px-6 py-16">
          <NoticeBox className="mx-auto max-w-lg text-left" size="comfortable" tone="error">
            <div className="font-medium">{selectedWorkspaceErrorTitle}</div>
            <p className="mt-2 whitespace-pre-wrap wrap-anywhere leading-6">
              {selectedWorkspaceErrorMessage}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => sidebar.onCreateTaskInWorkspace(selectedWorkspaceId)}
              >
                Retry
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void Promise.resolve(sidebar.onTestWorkspaceConnection(selectedWorkspaceId))}
              >
                {t("workspace_list.test_connection")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => sidebar.onEditWorkspaceConnection(selectedWorkspaceId)}
              >
                {t("workspace_list.edit_connection")}
              </Button>
              {sidebar.workspaceConnectionStateById[selectedWorkspaceId]?.status === "error" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void Promise.resolve(sidebar.onRecoverWorkspace(selectedWorkspaceId))}
                >
                  {t("workspace_list.recover")}
                </Button>
              ) : null}
            </div>
          </NoticeBox>
        </div>
      ) : selectedSessionId ? (
        <div className="px-6 py-16 text-center text-sm text-dls-secondary">
          {t("session.loading_detail")}
        </div>
      ) : null}
    </div>
  );
}
