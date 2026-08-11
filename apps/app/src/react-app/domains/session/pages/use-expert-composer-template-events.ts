import { useEffect } from "react";
import { useComposerStateStore } from "../surface/composer-state-store";
import { COMPOSER_TEMPLATE_EVENTS } from "../surface/composer/capability-template";
import { setExpertComposerDraftAfterNewTask } from "./shared-page-utils";

export function useExpertComposerTemplateEvents(input: {
  runtimeWorkspaceId: string | null | undefined;
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  draftAgentId: string | null;
}) {
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          template?: string;
          targetSessionId?: string;
        }>
      ).detail;
      const template = detail?.template;
      if (typeof template !== "string" || !template.trim()) return;
      const workspaceId =
        input.runtimeWorkspaceId?.trim() || input.selectedWorkspaceId.trim();
      if (!workspaceId) return;
      if (detail.targetSessionId) {
        useComposerStateStore.getState().setDraft(detail.targetSessionId, template);
      } else if (input.selectedSessionId) {
        useComposerStateStore.getState().setDraft(input.selectedSessionId, template);
      } else if (input.draftAgentId) {
        setExpertComposerDraftAfterNewTask(workspaceId, input.draftAgentId, template);
      }
    };
    for (const eventName of COMPOSER_TEMPLATE_EVENTS) {
      window.addEventListener(eventName, handler);
    }
    return () => {
      for (const eventName of COMPOSER_TEMPLATE_EVENTS) {
        window.removeEventListener(eventName, handler);
      }
    };
  }, [
    input.draftAgentId,
    input.runtimeWorkspaceId,
    input.selectedSessionId,
    input.selectedWorkspaceId,
  ]);
}
