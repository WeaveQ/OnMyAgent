import { usePendingAgentStore } from "../../agents";
import { workspaceAssistantRoute } from "../../../shell";
import { writeAssistantSelectionMemory } from "../sidebar/assistant-selection-memory";
import { writeAssistantCategoryMemory } from "../sidebar/rail-navigation-memory";
import { setComposerDraftAfterNewTask } from "./shared-page-utils";
import { SKILL_CHAT_OPEN_PRIMARY_EVENT } from "./skill-chat-events";
import { resetRailBookmarkToPrimary } from "./use-rail-location";

/** Slash draft for the composer chip. Package/folder name only. */
export function skillSlashDraft(name: string): string {
  const token = name.trim().replace(/^\/+/, "");
  return token ? `/${token} ` : "";
}

export function openSkillChatInAssistant(input: {
  workspaceId: string;
  skillName: string;
  navigate: (to: string) => void;
  onCreateTask?: (workspaceId: string) => void;
}): boolean {
  const workspaceId = input.workspaceId.trim();
  const draft = skillSlashDraft(input.skillName);
  if (!workspaceId || !draft) return false;

  writeAssistantSelectionMemory(workspaceId, "office", { kind: "newTask" });
  writeAssistantCategoryMemory(workspaceId, "office");
  resetRailBookmarkToPrimary("assistant", workspaceId);
  usePendingAgentStore.getState().setAgent(null);
  setComposerDraftAfterNewTask(workspaceId, draft);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SKILL_CHAT_OPEN_PRIMARY_EVENT));
  }

  input.onCreateTask?.(workspaceId);
  input.navigate(workspaceAssistantRoute(workspaceId));
  return true;
}
