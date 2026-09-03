/** @jsxImportSource react */
/**
 * Expert-page skill/create navigation: always open a new assistant office task
 * (never restore the last assistant conversation).
 */
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { installBuiltinSkillPackage } from "../../../../app/lib/desktop";
import { isElectronRuntime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import { usePendingAgentStore } from "../../agents";
import { workspaceAssistantRoute } from "../../../shell";
import { writeAssistantSelectionMemory } from "../sidebar/assistant-selection-memory";
import { writeAssistantCategoryMemory } from "../sidebar/rail-navigation-memory";
import { setComposerDraftAfterNewTask } from "./shared-page-utils";
import { openSkillChatInAssistant } from "./skill-chat-navigation";
import { resetRailBookmarkToPrimary } from "./use-rail-location";

const CREATE_SKILL_PACKAGE_NAME = "skill-creator";

export function useExpertSkillNavigation(input: {
  workspaceId: string;
  onNavigateToMode: (mode: "assistant" | "expert") => void;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
}) {
  const navigate = useNavigate();
  const workspaceId = input.workspaceId;

  const goAssistantOfficeNewTaskWithDraft = useCallback(
    (draft: string) => {
      const id = workspaceId.trim();
      if (!id) return;
      writeAssistantSelectionMemory(id, "office", { kind: "newTask" });
      writeAssistantCategoryMemory(id, "office");
      resetRailBookmarkToPrimary("assistant", id);
      usePendingAgentStore.getState().setAgent(null);
      setComposerDraftAfterNewTask(id, draft);
      navigate(workspaceAssistantRoute(id));
    },
    [navigate, workspaceId],
  );

  const handleCreateSkill = useCallback(() => {
    goAssistantOfficeNewTaskWithDraft(t("session.create_skill_prompt"));
    if (isElectronRuntime()) {
      void installBuiltinSkillPackage({
        source: "builtin",
        packageName: CREATE_SKILL_PACKAGE_NAME,
        skillName: CREATE_SKILL_PACKAGE_NAME,
      }).catch((error) => {
        console.warn(
          `[skills-marketplace] failed to install ${CREATE_SKILL_PACKAGE_NAME}`,
          error,
        );
      });
    }
  }, [goAssistantOfficeNewTaskWithDraft]);

  const handleChatWithSkill = useCallback(
    (skill: { name: string }) => {
      openSkillChatInAssistant({
        workspaceId,
        skillName: skill.name,
        navigate,
        onCreateTask: input.onCreateTaskInWorkspace,
      });
    },
    [input.onCreateTaskInWorkspace, navigate, workspaceId],
  );

  const handleEditSkill = useCallback(
    (skill: { name: string }) => {
      const name = skill.name.trim().replace(/^\/+/, "");
      if (!name) return;
      goAssistantOfficeNewTaskWithDraft(t("session.edit_skill_prompt", { name }));
      if (isElectronRuntime()) {
        void installBuiltinSkillPackage({
          source: "builtin",
          packageName: CREATE_SKILL_PACKAGE_NAME,
          skillName: CREATE_SKILL_PACKAGE_NAME,
        }).catch((error) => {
          console.warn(
            "[skills-marketplace] failed to install skill-creator",
            error,
          );
        });
      }
    },
    [goAssistantOfficeNewTaskWithDraft],
  );

  return {
    handleCreateSkill,
    handleChatWithSkill,
    handleEditSkill,
  };
}
