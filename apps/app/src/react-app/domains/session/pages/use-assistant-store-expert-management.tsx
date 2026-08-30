/** @jsxImportSource react */
import type { ReactNode } from "react";

import type { AgentRegistry, PendingAgentContext } from "../../agents";
import type { AgentConversationGroup } from "../sidebar/session-chrome";
import type { SessionPageProps } from "./session-page-types";
import { ExpertDeleteModal } from "./expert-page-modals";
import { useExpertPageModals } from "./use-expert-page-modals";
import { useSessionExpertCreation } from "./use-session-expert-creation";

export function useAssistantStoreExpertManagement(input: {
  props: SessionPageProps & {
    onNavigateToMode: (mode: "assistant" | "expert") => void;
  };
  registry: AgentRegistry | null;
  conversationGroups: AgentConversationGroup[];
  showToast: Parameters<typeof useSessionExpertCreation>[0]["showToast"];
  onCreatedAgent: (agent: PendingAgentContext) => void;
}): {
  openExpertCreation: ReturnType<typeof useSessionExpertCreation>["openExpertCreation"];
  handleDeleteMarketplaceExpert: ReturnType<typeof useExpertPageModals>["handleDeleteMarketplaceExpert"];
  handleEditMarketplaceExpert: ReturnType<typeof useSessionExpertCreation>["handleEditMarketplaceExpert"];
  overlays: ReactNode;
} {
  const deletion = useExpertPageModals({
    props: input.props,
    client: input.props.onmyagentServerClient,
    activeConversationAgentId: null,
    currentAgentSessions: [],
    registry: input.registry,
    conversationGroups: input.conversationGroups,
  });
  const creation = useSessionExpertCreation({
    props: input.props,
    registry: input.registry,
    showToast: input.showToast,
    onCreatedAgent: input.onCreatedAgent,
  });

  return {
    openExpertCreation: creation.openExpertCreation,
    handleDeleteMarketplaceExpert: deletion.handleDeleteMarketplaceExpert,
    handleEditMarketplaceExpert: creation.handleEditMarketplaceExpert,
    overlays: (
      <>
        {creation.expertCreationPage}
        <ExpertDeleteModal
          open={deletion.deleteOpen}
          busy={deletion.deleteBusy}
          title={deletion.expertDeleteTitle}
          message={deletion.expertDeleteMessage}
          confirmLabel={deletion.expertDeleteConfirmLabel}
          onConfirm={() => void deletion.confirmDelete()}
          onCancel={deletion.closeDeleteModal}
        />
      </>
    ),
  };
}
