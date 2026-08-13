import { useCallback, useEffect } from "react";

import type { ComposerDraft, SidebarSessionItem } from "../../../../app/types";
import type { PendingAgentContext } from "../../agents";
import { selectAgentIdForSession } from "../../../capabilities/session-identity/expert-directory-page-model";
import type { buildExpertDirectoryPageModel } from "../../../capabilities/session-identity/expert-directory-page-model";
import {
  resolveBoundExpertDraftSession,
  shouldKeepUnboundExpertDraft,
} from "./expert-draft-session";
import { useExpertComposerTemplateEvents } from "./use-expert-composer-template-events";
import { useExpertWaybillPatch } from "./use-expert-waybill-patch";
import type { ExpertPageProps } from "./use-expert-page";

type DirectoryPage = ReturnType<typeof buildExpertDirectoryPageModel>;

/** Owns send wrapping and session-bound Expert effects. */
export function useExpertPageSessionEffects(input: {
  props: ExpertPageProps;
  draftSessionActive: boolean;
  draftAgentId: string | null;
  pendingAgent: PendingAgentContext | null;
  directoryPage: DirectoryPage;
  clearSurfaceDraft: () => void;
  codeWorkspaceCatalogRoot: string | null;
  rawWorkspaceSessions: SidebarSessionItem[];
  currentAgentSessions: SidebarSessionItem[];
  showToast: (input: { tone: "warning"; title: string }) => void;
}) {
  const { props } = input;
  const wrappedOnSendDraft = useCallback(async (draft: ComposerDraft) => {
    if (input.draftSessionActive && props.onCreateSessionForAgent) {
      props.onCreateSessionForAgent();
    }
    return props.surface?.onSendDraft({
      ...draft,
      sessionStartIntent: { mode: "expert" },
    });
  }, [input.draftSessionActive, props.onCreateSessionForAgent, props.surface]);

  useExpertWaybillPatch({
    client: props.onmyagentServerClient,
    workspaceId: props.runtimeWorkspaceId?.trim() || props.selectedWorkspaceId.trim(),
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceRoot: props.selectedWorkspaceRoot,
    catalogRoot: input.codeWorkspaceCatalogRoot,
    rawWorkspaceSessions: input.rawWorkspaceSessions,
    currentAgentSessions: input.currentAgentSessions,
    showToast: input.showToast,
  });
  useExpertComposerTemplateEvents({
    runtimeWorkspaceId: props.runtimeWorkspaceId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    selectedSessionId: props.selectedSessionId,
    draftAgentId: input.draftAgentId,
  });
  useEffect(() => {
    const sessionId = props.selectedSessionId?.trim() ?? "";
    if (!sessionId || sessionId.startsWith("draft:")) return;
    // Once first-send has bound the draft, the bound-transition state machine
    // owns navigation and cleanup. Clearing here exposes the empty route to
    // cold-open, which can select another expert before the new route paints.
    if (resolveBoundExpertDraftSession({
      draftSessionActive: input.draftSessionActive,
      draftAgentId: input.draftAgentId,
      pendingAgent: input.pendingAgent,
    })) return;
    if (shouldKeepUnboundExpertDraft({
      draftSessionActive: input.draftSessionActive,
      draftAgentId: input.draftAgentId,
      pendingDraftSource: input.pendingAgent?.draftSource,
      pendingAgentId: input.pendingAgent?.id,
      pendingBoundSessionId: input.pendingAgent?.boundSessionId,
      selectedSessionAgentId: selectAgentIdForSession(
        input.directoryPage.payload,
        sessionId,
      ),
    })) return;
    input.clearSurfaceDraft();
  }, [
    input.clearSurfaceDraft,
    input.directoryPage.payload,
    input.draftAgentId,
    input.draftSessionActive,
    input.pendingAgent?.boundSessionId,
    input.pendingAgent?.draftSource,
    input.pendingAgent?.id,
    props.selectedSessionId,
  ]);
  return wrappedOnSendDraft;
}
